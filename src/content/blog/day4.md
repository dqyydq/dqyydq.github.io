---
title: "Day 4：SQLAlchemy ORM —— 从「写 SQL」到「操作对象」的跨越"
pubDate: 2026-07-13
description: "进入 SQLAlchemy ORM 层：Declarative Base、Session、Identity Map、对象四种状态、relationship 理解方法、异步/同步双引擎架构、N+1 问题与 selectinload 解决方案、Unit of Work 模式。"
type: 学习日志
tags: ["SQLAlchemy", "ORM", "PostgreSQL", "Python", "FastAPI"]
featured: false
series: fastapi-postgres-learning
seriesOrder: 4
---

## 前言

Day 3 用 SQLAlchemy Core 写 API 时，虽然比 Psycopg 多了命名参数和连接池，但代码仍然围绕着 SQL 字符串转——每个端点都要手写 `INSERT INTO ... VALUES (:a, :b)` 和 `dict(zip(columns, row))`。

今天进入 ORM 层。**从"写 SQL"切换到"操作 Python 对象"**——表变成类，行变成对象，列变成属性。但 ORM 不是魔法：它只是帮我们生成和 Day 3 一模一样的 SQL。理解了这一点，就不会被 ORM 的"黑盒感"困扰。

---

## 1. ORM 的本质：表 = 类，行 = 对象

先看一个直观对比：

```python
# Core：查出来的是一行数据，访问列需要知道列的位置
row = conn.execute(text("SELECT * FROM agents WHERE id = 1")).fetchone()
print(row[2])   # name 在第几列？得去数或者翻建表语句

# ORM：查出来的是一个对象，属性名就是列名
agent = session.get(Agent, 1)
print(agent.name)   # 直觉——IDE 还能自动补全
```

ORM 没有改变底层——它最终发出的 SQL 和 Core 一模一样。它改变的是**你与数据库交互的方式**：不再拼字符串，而是操作 Python 对象。

---

## 2. 三个核心组件：Base、Model、Session

```
┌───────────────────┐
│ Declarative Base   │  所有模型的基类。Base = declarative_base()
│                    │  它声明了一个规则：继承 Base 的类 = 一张数据库表
├───────────────────┤
│ Model（模型）       │  class Agent(Base): ...
│  类 = 表            │  一个类对应一张表
│  属性 = 列          │  一个属性对应一列
│  对象 = 行          │  一个实例对应一行数据
├───────────────────┤
│ Session            │  和数据库的"会话窗口"
│  session.add(obj)  │  标记为"下次 flush 时插入"
│  session.commit()  │  flush + 提交事务
│  session.get(...)  │  按主键查（会走 Identity Map 缓存）
│  session.flush()   │  发 SQL 但不提交事务
└───────────────────┘
```

Session 可以理解为一个"暂存区"——你往里面 `add(obj)`，对象只是被标记了，SQL 还没发。直到 `flush()` 或 `commit()`，ORM 才一次性把所有变更转换成 SQL 发出去。这就是 **Unit of Work 模式**。

---

## 3. Identity Map：同一行数据只有一个 Python 对象

这是 ORM 区别于 Core 和 Psycopg 的最大特性：

```python
a1 = session.get(Agent, 1)   # → SELECT ... WHERE id = 1
a2 = session.get(Agent, 1)   # → 不发 SQL！直接从 Identity Map 缓存中拿
print(a1 is a2)               # → True — 同一个 Python 对象
```

Psycopg 和 Core 每次查询都返回新行，即使查的是同一个 id。ORM 在 Session 内部维护了一个字典：`{ (Model, primary_key): instance }`。同一主键的同一模型，整个 Session 周期内只有一份对象。

> **面试重点**：Identity Map 的好处——① 避免重复查询同一行数据；② 保证 Session 内数据一致性（不会出现一个对象的 name 是 "A"、另一个是 "B" 的诡异情况）；③ 减少数据库往返。

但 Identity Map 也有代价：长 Session 会导致缓存越来越大。处理大量数据时要用分页 + 定期 `session.expunge_all()` 释放内存。

---

## 4. ORM 对象的四种状态

理解对象状态是调试 ORM 问题的基础。一个 ORM 对象在生命周期中会经历四个阶段：

```
transient → add() → pending → flush()/commit() → persistent → session.close() → detached
    │                  │              │                    │                  │
Agent(name="x")   在 session 里    在 session 内        脱离 session
还没进 session     等提交           正常使用            访问未加载属性可能报错
```

```python
agent = Agent(name="test")     # transient：普通 Python 对象，和数据库无关
session.add(agent)              # pending：标记为待插入，还没发 SQL
session.flush()                 # 发 SQL（INSERT），但不提交事务
session.commit()                # persistent：提交事务，其他连接可见
session.close()                 # detached：离开 session
# print(agent.name)             # ✅ 已加载的属性还在
# print(agent.user.name)        # ❌ lazy load 需要 session → DetachedInstanceError
```

**最佳实践**：Web 应用中一个 HTTP 请求对应一个 Session。用 `Depends(yield)` 或 `async with` 管理生命周期，请求结束自动关闭 Session。异步场景务必设置 `expire_on_commit=False`，否则 commit 后属性过期，下次访问触发隐式 I/O → 异步上下文中报错。

---

## 5. `relationship()` 的理解方法："从属/包含"模型

`relationship()` 是 ORM 里最让人困惑的部分。一个实用的理解方法——**从右往左读外键**：

```python
class Agent(Base):
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    #    ↑ 从右往左读：users.id → user_id
    #    含义：Agent 的 user_id 来自 User 表 → Agent 属于 User

    user: Mapped["User"] = relationship(back_populates="agents")
    #  ↑ 单数 → 一个 Agent 只有一个 User

class User(Base):
    agents: Mapped[list["Agent"]] = relationship(back_populates="user")
    # ↑ 复数 → 一个 User 有多个 Agent
```

### 判断规则

外键列在谁身上，谁就是"多"的那一方，属于另一张表：

| 外键方向 | 从属关系 | relationship 命名 |
|---------|---------|----------------------|
| Agent → User | Agent 属于 User | Agent 上 `user`（单数），User 上 `agents`（复数） |
| Conv → Agent | Conv 属于 Agent | Conv 上 `agent`（单数），Agent 上 `conversations`（复数） |
| Msg → Conv | Msg 属于 Conv | Msg 上 `conversation`（单数），Conv 上 `messages`（复数） |

### `back_populates` 就是"双向绑定"

```python
# 只需检查：back_populates 的值 = 对方类上的属性名
User.agents.back_populates = "user"     → Agent 上有属性叫 "user" 吗？✅
Agent.user.back_populates = "agents"    → User 上有属性叫 "agents" 吗？✅
```

双方互相指认——像握手一样，两边都要伸出来。

---

## 6. 异步引擎 vs 同步引擎：为什么需要两个？

项目里有一个重要的架构决策——同时维护同步和异步两套引擎：

```
async def → agents_orm.py          → async_engine + AsyncSessionLocal
async def → /health                → 同上

def      → agents.py (Core)        → sync_engine + get_connection()
def      → conversations.py (Core) → 同上
```

| | 异步线 | 同步线 |
|------|--------|--------|
| 引擎 | `create_async_engine()` | `create_engine()` |
| Session | `async_sessionmaker()` → `AsyncSession` | `engine.connect()` → `Connection` |
| 路由 | `async def` | `def` |
| 执行 SQL | `await session.execute(...)` | `conn.execute(...)` |
| 用在 | ORM 路由 + /health | Core def 路由 |

**根因**：`async def` 跑在事件循环里，所有 I/O 必须是异步的。`def` 跑在线程池里，不需要 async。以后新增路由统一走异步线，已有的同步线保留不删——能跑就不动。

---

## 7. 用 ORM 重写 `/agents` API

这是今天的核心实战：把 Day 3 的 Core 版本用 ORM 重写。

### 异步 Session 依赖

```python
# database.py
AsyncSessionLocal = async_sessionmaker(
    async_engine,
    class_=AsyncSession,
    expire_on_commit=False,  # 异步必须设 False
)

# api/agents_orm.py
async def get_session():
    async with AsyncSessionLocal() as session:
        yield session  # 请求结束自动关闭
```

### Core 版本 vs ORM 版本

```python
# ── Core 版本（Day 3）── 手写 SQL、手动 dict(zip(...))
result = conn.execute(
    text("INSERT INTO agents (user_id, name, system_prompt, model) "
         "VALUES (:user_id, :name, :system_prompt, :model) RETURNING *"),
    {"user_id": body.user_id, "name": body.name, ...},
)
row = result.fetchone()
conn.commit()
return dict(zip(("id", "user_id", "name", ...), row))

# ── ORM 版本（Day 4）── 没有 SQL 字符串，没有列名列表
agent = Agent(**body.model_dump())   # Pydantic dict → ORM 对象
session.add(agent)                    # 标记插入
await session.commit()                # flush + 提交事务
await session.refresh(agent)          # 拿回数据库生成的 id 和 created_at
return agent                          # Pydantic 从 ORM 对象自动序列化
```

| 操作 | Core 需要写的 | ORM 需要写的 |
|------|-------------|------------|
| 插入 | INSERT SQL + 参数 dict + RETURNING + dict(zip(columns, row)) | `Agent(**data)` + `add()` + `commit()` + `refresh()` |
| 查询 | SELECT SQL + fetchall + dict(zip) | `select(Agent)` + `scalars().all()` |
| 修改 | UPDATE SQL + 参数 | 改对象属性 + `commit()`（Dirty Check 自动生成 UPDATE） |
| 序列化 | 手动 `dict(zip(...))` | `from_attributes=True`，Pydantic 自动读取 ORM 对象属性 |

### 几个关键操作

```python
# 1. 按主键查（走 Identity Map 缓存）
agent = session.get(Agent, 1)
print(agent.user.username)  # relationship 自动 JOIN

# 2. 用 select() 条件查询
stmt = select(Agent).where(Agent.name.ilike("%学习%"))
agents = session.execute(stmt).scalars().all()

# 3. 修改（Dirty Check：改属性 → commit → ORM 自动生成 UPDATE）
agent = session.get(Agent, 1)
agent.name = "改名了"
session.commit()  # ORM 对比快照发现 name 变了 → 自动发 UPDATE

# 4. 删除（传 ORM 对象，不是 id）
session.delete(agent)  # 传 id 会 UnmappedInstanceError
session.commit()
```

---

## 8. N+1 查询：ORM 最常见的性能陷阱

这是 ORM 面试中最高频的问题。看一个经典例子：

```python
# ❌ N+1：主查询 1 条 + 每个 agent 查 user 各 1 条
agents = session.execute(select(Agent)).scalars().all()
for a in agents:
    print(a.user.username)   # 每次 .user 触发一条新的 SELECT——N 条！
```

**三种解决方案**：

| 方式 | SQL 数 | 原理 | 适用场景 |
|------|--------|------|------|
| `selectinload()` | 2 条 | 先查 Agent，再用 `WHERE user_id IN (...)` 批量查 User | ✅ 一对多、多对多 |
| `joinedload()` | 1 条 | LEFT JOIN 一次查出所有数据 | 多对一、一对一 |
| `lazy="raise"` | — | 延迟加载时报错而非静默执行 | 开发环境立即暴露 N+1 |

```python
# ✅ selectinload：2 条 SQL，两步完成
from sqlalchemy.orm import selectinload
stmt = select(Agent).options(selectinload(Agent.user))
agents = session.execute(stmt).scalars().unique().all()
# SQL 1: SELECT * FROM agents
# SQL 2: SELECT * FROM users WHERE id IN (1, 2, 3, ...)
```

> **异步特别提醒**：async 上下文中，lazy loading **完全不可用**（触发隐式同步 I/O）。必须显式写 `selectinload` 或 `joinedload`。这其实是好事——它强迫你在写代码时就考虑好加载策略，而不是上线后发现 N+1。

---

## 9. `flush()` vs `commit()` vs `refresh()` 三兄弟

这是面试中的精确区分题：

| | flush | commit | refresh |
|------|-------|--------|---------|
| 发 SQL | ✅ | ✅（内部先调 flush） | ✅（发 SELECT） |
| 提交事务 | ❌ | ✅ | ❌ |
| 其他连接可见 | ❌ | ✅ | ❌ |
| 对象更新 | 部分（id 填了，但 DB 默认值不一定） | 部分 | ✅ 完整重载（拿回所有 DB 生成的值） |
| 用在哪 | 需要拿到 INSERT 生成的 id | 持久化数据 | 拿到 DEFAULT/NOW() 生成的字段 |

**面试追问**："flush 后别的连接能看到数据吗？"

> **不能。** flush 只是把当前事务内的变更发到 PG，但事务还没提交。其他连接在 MVCC 下看不到未提交事务的数据。只有 commit 后才对其他连接可见。

---

## 10. Unit of Work 模式：为什么 ORM 不需要写 UPDATE/DELETE SQL

Core 里你手写 `UPDATE agents SET name = '新名字' WHERE id = 1`。ORM 里你改 `agent.name = '新名字'` + `session.commit()`，ORM 自动生成 UPDATE。

原理——**Dirty Check**：

1. 加载对象时，ORM 保存一份快照（snapshot）：`name = '老名字'`
2. 你改了属性：`agent.name = '新名字'`
3. `flush()` 时，ORM 对比每个对象的当前值和快照
4. 发现 `name` 变了 → 生成 `UPDATE agents SET name='新名字' WHERE id=1`
5. 把所有变更一次性发给数据库

这就是 **Unit of Work 模式**：Session 跟踪所有变更（新增、修改、删除），`flush()` 时把待处理变更转换为 SQL，并在当前事务中执行。是否满足业务原子性，仍取决于事务边界和异常处理，不能仅因为使用 ORM 就认为“事务安全”。

---

## 11. 面试题速查

**SQLAlchemy 五层使用场景？什么时候 Core、什么时候 ORM？**

| 比例 | 场景 | 工具 |
|------|------|------|
| 80% | 简单 CRUD | ORM |
| 15% | 复杂查询、聚合、多表 JOIN | Core Expression（`select()`、`func.count()`） |
| 5% | CTE、窗口函数、递归查询 | Raw SQL（`text()` 或直接 Psycopg） |

ORM 不是 SQL 知识的替代品——它是让懂 SQL 的人更高效的工具。不懂 SQL 的人用了 ORM 也写不出高性能查询。

**Identity Map 的好处和风险？**

好处：同 Session 内重复查询走缓存（不发 SQL），保证对象一致性。风险：长 Session 内存暴涨。处理大数据时分页 + 定期 `expunge_all()`。

**N+1 问题怎么发现、怎么解决？**

发现：开发环境设 `lazy="raise"`，或者看日志里的重复 SELECT。解决：用 `selectinload()`（2 条 SQL，适合一对多）或 `joinedload()`（1 条 JOIN，适合多对一）。

**`expire_on_commit=False` 为什么异步中必须设？**

commit 后属性默认标记为"过期" → 下次访问触发额外 SELECT → 异步场景中这是隐式同步 I/O → 报错。设 False 后 commit 不自动过期。

**ORM 对象四种状态分别是什么？**

transient（新建未 add）→ pending（add 后等 flush）→ persistent（commit 后在 session 内）→ detached（session 关闭后）。detached 对象访问未加载属性会报 `DetachedInstanceError`。

---

## 遇到的问题

| 问题 | 原因 | 处理或后续验证 |
|------|------|----------------|
| `session.delete(id)` 报错 | ORM delete 需要传对象，而不是主键值 | 先查询对象，再传给 `session.delete()` |
| 同步与异步 Session API 容易混用 | `Session` 与 `AsyncSession` 的调用方式不同 | 异步路径统一使用 `await session.execute/commit/refresh` |
| Relationship 可能触发额外查询 | 默认懒加载会在访问属性时发 SQL | 用 SQL 日志观察，并按查询场景选择 `selectinload` / `joinedload` |
| commit 后访问属性可能隐式查询 | 默认会 expire ORM 对象 | 异步 Session 使用 `expire_on_commit=False`，同时避免依赖隐式 I/O |
| `.scalars().all()` 结果重复 | JOIN 后有多行匹配同一对象 | 加 `.unique()` 去重 |

---

## 仍不理解的内容

- [ ] `selectinload` 与 `joinedload` 在一对多结果集、去重和性能上的取舍
- [ ] `flush()` 失败后为什么必须先 `rollback()` 才能继续使用 Session
- [ ] Repository 不提交事务时，Service 如何组织多个写操作的原子性

---

## 已知问题

- 尚未写出可重复的 N+1 查询实验，也没有记录实际 SQL 条数。
- 当日 ORM CRUD 只有实验脚本，没有 pytest 自动化测试。
- 模型的状态字段、时间默认值和数据库约束还需由 Alembic 迁移正式固化。

---

## 明日任务

- 初始化 Alembic，让数据库结构由迁移管理而不是 `create_all()` 管理。
- 为 Run、RunStep、ToolCall、ToolApproval 建模并检查 upgrade / downgrade。
- 复习 Session 生命周期、Relationship、N+1 和 `flush()` / `commit()` 区别。

至此，项目的数据库栈完整了：Psycopg（原生 SQL）→ Core（命名参数和连接池）→ ORM（对象映射）→ Alembic（迁移管理）。
