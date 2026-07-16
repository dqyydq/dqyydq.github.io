---
title: "Day 3：SQLAlchemy Core —— 在 SQL 字符串和 ORM 之间的「中间地带」"
pubDate: 2026-07-13
description: "从 Psycopg 原生 SQL 升级到 SQLAlchemy Core：命名参数、连接池管理、text() 的编译流程，以及 CTE + 窗口函数（ROW_NUMBER、LAG、RANK）实战实验。"
type: 学习日志
tags: ["SQLAlchemy", "PostgreSQL", "Python", "SQL", "窗口函数"]
featured: false
series: fastapi-postgres-learning
seriesOrder: 3
---

## 前言

前两天我们用 Psycopg 手写 SQL 字符串完成了 agents 和 conversations 的 CRUD。手写 SQL 的好处是透明——你写的每一条 `SELECT` 就是最终发给 PostgreSQL 的 SQL，但问题也明显：参数多了容易传错位置，列名和值的映射全靠人工 `dict(zip(...))`。

今天是项目的学习路径第三步：**SQLAlchemy Core**。它恰好卡在 Psycopg（纯字符串 SQL）和 ORM（纯 Python 对象）之间——比 Psycopg 多了连接池和命名参数，比 ORM 保留了 SQL 的完全控制权。

---

## 1. SQLAlchemy 三层架构：你现在站在哪里？

```
┌──────────────────────┐
│  SQLAlchemy ORM       │  model.add(user) → 自动生成 SQL（Day 4）
├──────────────────────┤
│  SQLAlchemy Core      │  今天：用 Python 构建 SQL，但完全透明
│  text(), engine, conn │
├──────────────────────┤
│  Psycopg              │  Day 1-2：手写字符串 SQL
└──────────────────────┘
```

CLAUDE.md 规定的学习路径是 **psql → Psycopg → Core → ORM → Alembic**。每一层都不跳过——跳过 Psycopg 直接学 ORM，你就不知道 `session.add(obj)` 背后实际发了什么 SQL；跳过 Core 直接学 ORM，你就不理解连接池和引擎是怎么工作的。

---

## 2. Core vs Psycopg：到底多了什么？

从一个简单查询看两边的差异：

```python
# Psycopg（Day 2）—— 位置参数，元组传参
conn = psycopg.connect(url)
cur = conn.cursor()
cur.execute("SELECT * FROM users WHERE id = %s", (1,))
row = cur.fetchone()

# Core（Day 3）—— 命名参数，字典传参，引擎管理连接池
with engine.connect() as conn:
    result = conn.execute(
        text("SELECT * FROM users WHERE id = :uid"),
        {"uid": 1},
    )
    row = result.fetchone()
```

| | Psycopg | SQLAlchemy Core |
|------|----------|-----------------|
| 连接管理 | `psycopg.connect(url)` 每次新建 | `engine.connect()` 从连接池拿，用完归还 |
| 引擎 | 无 | `create_engine(url)` 创建一次，内部管理 ~5 个常连接 |
| 参数占位符 | `%s`（位置） | `:name`（命名）→ Core 编译成 `%(name)s` |
| 参数格式 | 元组 `(val,)` | 字典 `{"name": val}` |
| 事务 | 手工 `commit()` | 隐式 `BEGIN`，不显式 `commit()` 就自动 `ROLLBACK` |
| 结果 | `cursor.fetchone()` 返回 tuple | `result.fetchone()` 返回 `Row` 对象 |

**核心升级**：引擎和连接池。`engine = create_engine(url)` 只在模块级别创建一次，内部维护连接池。每个请求调用 `engine.connect()` 从池中拿连接，用完 `close()` 归还。这比 Psycopg 每次新建 TCP 连接高效得多。

---

## 3. 为什么 `:name` 比 `%s` 好？

当 SQL 参数超过 3 个时，位置参数是灾难：

```python
# Psycopg：参数多了容易传错位置（第 3 个和第 4 个搞反了？谁看得出来）
cur.execute(
    "INSERT INTO t (a, b, c, d, e) VALUES (%s, %s, %s, %s, %s)",
    (1, 2, 3, 4, 5)
)

# Core：命名参数，一眼看出谁对应谁，顺序无所谓
conn.execute(
    text("INSERT INTO t (a, b, c, d, e) VALUES (:a, :b, :c, :d, :e)"),
    {"d": 4, "b": 2, "a": 1, "e": 5, "c": 3},  # 顺序随便
)
```

`:name` 的编译流程：

```
你写        :uid
    ↓
Core 编译    %(uid)s     ← 翻译成 Psycopg 的命名参数格式
    ↓
Psycopg     参数单独发送
    ↓
PostgreSQL  接收：SQL 和参数分离，参数绝不当作代码执行
```

最终仍然是参数化查询——安全性和 Psycopg 的 `%s` 一样，但可读性提升了一个量级。

---

## 4. Core 的 API 变化：没有 `.cursor()` 了

从 Psycopg 切换到 Core，最大的 API 变化是**不需要手动管理 cursor**：

```python
# ❌ Core 没有 cursor 这个概念
with conn.cursor() as cur:
    cur.execute(...)

# ✅ Core 直接在 connection 上 execute
result = conn.execute(text(...), params)
row = result.fetchone()
```

Core 的 `Connection.execute()` 内部封装了 cursor 的创建、执行、取结果的完整流程。你少写一行代码，框架多做一件事。

---

## 5. 事务行为：隐式 BEGIN，必须显式 commit

这是 Core 和 Psycopg 的另一个关键差异：

```python
with engine.connect() as conn:
    conn.execute(text("SELECT 1"))    # 隐式 BEGIN
    # 退出 with → 没有显式 commit → 自动 ROLLBACK

with engine.connect() as conn:
    conn.execute(text("INSERT ..."))
    conn.commit()                      # 显式 commit → 持久化
```

Core 的哲学：**你不说 commit，我就当你不想持久化**。这比 Psycopg 的 `conn.commit()` 忘记调导致数据丢失的模式更安全——Core 默认是安全的（不 commit 就回滚），Psycopg 默认是危险的（忘记 commit 数据就丢了）。

---

## 6. `RETURNING *` 在 Core 中同样可用

```python
result = conn.execute(
    text("INSERT INTO agents (user_id, name) VALUES (:uid, :name) RETURNING *"),
    {"uid": 1, "name": "Test"},
)
row = result.fetchone()   # row 包含新插入行的所有列（id、created_at 等）
conn.commit()
```

`RETURNING *` 省去了一次 SELECT。不用 RETURNING 的话，`result.fetchone()` 返回 `None`，后续 `zip(columns, None)` 直接报错——这是今天踩的一个小坑。

---

## 7. `create_engine` 和 `create_async_engine` 为什么需要两个？

我们项目中同时存在两个引擎：

| | sync_engine | async_engine |
|------|-------------|--------------|
| 用在哪 | `def` 路由 + Core | `async def` 路由 + ORM |
| 连接池 | 线程安全连接池 | 异步连接池 |
| 驱动 | `psycopg`（同步） | `psycopg`（异步层） |
| `/health` | — | ✅ 用这个 |
| `/agents` (Core) | ✅ 用这个 | — |

这不是重复，是 Day 1 学到的"事件循环 vs 线程池"的必然结果：`async def` 路由里的所有 I/O 都必须是异步的，所以需要异步引擎。`def` 路由跑在线程池里，用同步引擎就行。

---

## 8. SQL 实验：CTE + 窗口函数

今天 SQL 实验的重点是 CTE（Common Table Expression）和窗口函数——这是面试中的 SQL 高频题。

### 8.1 CTE：给子查询起名

```sql
WITH my_agents AS (
    SELECT id, name FROM agents WHERE user_id = 1
)
SELECT * FROM my_agents;
```

CTE 的本质是**给子查询起个名字**。就像 Python 把长函数拆成小函数——CTE 把长 SQL 拆成多个命名块，从上往下读，而不是从里往外读。

链式 CTE + LEFT JOIN + COALESCE 的实战例子：

```sql
WITH
    user_agents AS (
        SELECT a.id, a.name, u.username
        FROM agents a JOIN users u ON a.user_id = u.id
    ),
    agent_conv_count AS (
        SELECT agent_id, COUNT(*) AS conv_count
        FROM conversations GROUP BY agent_id
    )
SELECT
    ua.username, ua.name,
    COALESCE(acc.conv_count, 0) AS 会话数    -- NULL → 0
FROM user_agents ua
LEFT JOIN agent_conv_count acc ON acc.agent_id = ua.id;
```

几个技巧：多个 CTE 用逗号分隔；LEFT JOIN 确保没有会话的 agent 也显示；`COALESCE(x, 0)` 把 NULL 替换为 0。

### 8.2 窗口函数：保留每一行的聚合

窗口函数和普通聚合（GROUP BY）的核心区别：

| 聚合（GROUP BY） | 窗口（OVER） |
|-----------------|-------------|
| 多行压成一行 | **保留每一行**，额外多一列聚合值 |
| `COUNT(*)` → 1 行 | `COUNT(*) OVER()` → N 行，每行多一列 |

```sql
-- ROW_NUMBER：每个 conversation 内按时间编号
SELECT
    conversation_id, content,
    ROW_NUMBER() OVER (
        PARTITION BY conversation_id    -- 按什么分组
        ORDER BY created_at             -- 组内按什么排序
    ) AS 序号
FROM messages;
```

`PARTITION BY` 拆组，`ORDER BY` 组内排序，`ROW_NUMBER()` 从 1 开始编号，每行唯一。

### 8.3 ROW_NUMBER vs RANK vs DENSE_RANK

| | ROW_NUMBER | RANK | DENSE_RANK |
|------|-----------|------|-----------|
| 有并列时 | 1, 2, 3（每行不同） | 1, 1, 3（并列跳过） | 1, 1, 2（并列不跳过） |
| 适用场景 | 分页、取前 N | 排行榜 | 排名无间隔 |

---

## 9. 窗口函数高频面试题

### Top-N per Group（最高频）

"查询每个 agent 最近创建的 3 个 conversation"——这是 SQL 面试中最常见的题型之一：

```sql
WITH ranked AS (
    SELECT *, ROW_NUMBER() OVER (
        PARTITION BY agent_id ORDER BY created_at DESC
    ) AS rn
    FROM conversations
)
SELECT * FROM ranked WHERE rn <= 3;
```

### LAG/LEAD：时间序列对比

计算相邻两条消息的时间间隔：

```sql
SELECT conversation_id, content, created_at,
       created_at - LAG(created_at) OVER (
           PARTITION BY conversation_id ORDER BY created_at
       ) AS gap
FROM messages;
```

`LAG(column)` 取前一行的值，`LEAD(column)` 取后一行的值。

### 窗口函数不能出现在 WHERE 中

这是经典陷阱：

```sql
-- ❌ 错误：WHERE 不能引用窗口函数（窗口函数在 WHERE 之后才计算）
SELECT *, ROW_NUMBER() OVER (...) AS rn FROM t WHERE rn > 1;

-- ✅ 正确：用 CTE 包一层
WITH ranked AS (
    SELECT *, ROW_NUMBER() OVER (...) AS rn FROM t
)
SELECT * FROM ranked WHERE rn > 1;
```

> 这是 SQL 执行顺序决定的：FROM → WHERE → GROUP BY → HAVING → SELECT → ORDER BY。窗口函数在 SELECT 阶段计算，WHERE 在它之前，所以 WHERE 里用不了窗口函数的结果。

### CTE vs 子查询 vs 临时表

| | CTE | 子查询 | 临时表 |
|------|-----|--------|--------|
| 可读性 | ✅ 从上往下 | ❌ 从里往外 | ✅ |
| 多次引用 | ✅ 一次定义到处用 | ❌ 每处重写 | ✅ |
| 性能 | PG 12+ 可选物化/展开 | 优化器自动展开 | 写入磁盘 |

---

## 10. 面试题速查

**SQLAlchemy 三层架构分别什么时候用？**

- Psycopg：简单脚本、需要完全控制 SQL 时
- Core：API 端点，比 Psycopg 多了连接池和命名参数，同时保留 SQL 透明性
- ORM：CRUD 密集场景，用 Python 对象替代 SQL 字符串

**`:name` 和 `%s` 的区别？**

`:name` 是命名参数，靠名称匹配；`%s` 是位置参数，靠顺序匹配。5 个参数以上时命名参数不会传错位置。

**`ROW_NUMBER()` vs `RANK()` vs `DENSE_RANK()`？**

ROW_NUMBER 每行唯一编号，RANK 并列跳号，DENSE_RANK 并列不跳号。分页用 ROW_NUMBER，排行榜用 RANK。

**窗口函数为什么不能出现在 WHERE 中？**

SQL 执行顺序：WHERE 在 SELECT 之前，窗口函数在 SELECT 阶段计算。所以 WHERE 看不到窗口函数的结果。用 CTE 包一层即可。

**`PARTITION BY` vs `GROUP BY`？**

GROUP BY 把多行压成一行；PARTITION BY 保留每一行，额外附加聚合值。要保留明细数据时用窗口函数。

---

## 遇到的问题

| 问题 | 原因 | 处理或后续验证 |
|------|------|----------------|
| `RETURNING` 忘记写，`fetchone()` 返回 None | INSERT 不加 RETURNING 不返回行 | 加 `RETURNING *` |
| Core 里写了 `.cursor()` | Core 没有 cursor 概念 | 直接使用 `conn.execute()` |
| Core 与 Psycopg 占位符混淆 | 两层 API 使用不同参数风格 | Core 使用 `:name`，Psycopg 使用 `%s`，均通过参数对象传值 |
| `engine.connect()` 退出后写入未保留 | Connection 会隐式开启事务，但不会自动提交 | 写操作后显式 `commit()`，或使用 `engine.begin()` |
| 窗口函数结果不能直接写进 `WHERE` | SQL 逻辑执行顺序中 `WHERE` 早于窗口函数 | 用 CTE 或子查询包一层后过滤 |

---

## 仍不理解的内容

- [ ] `engine.begin()` 与 `engine.connect()` + `commit()` 的异常回滚差异
- [ ] CTE 在 PostgreSQL 12+ 被内联或物化时对执行计划的影响
- [ ] Core 同步连接在异步 FastAPI 路由中的阻塞风险

---

## 已知问题

- 当日没有保存 `EXPLAIN (ANALYZE, BUFFERS)`，因此只能确认 SQL 语义，不能证明 CTE 或窗口查询的性能。
- API 仍缺少自动化测试和统一异常映射。
- 示例中的索引需求尚未结合数据量和执行计划验证，暂不新增索引。

---

## 明日任务

- 学习 ORM Model、Relationship、Session、Identity Map 和对象状态。
- 用 ORM 重写 Agent CRUD，并打开 SQL 日志核对 ORM 实际发出的 SQL。
- 复习 Core 的事务提交、CTE、窗口函数和参数化查询。

Core 让我们理解了引擎、连接池和命名参数的编译流程，ORM 在此基础上把“表和行”映射为“类和对象”。有了 Core 的基础，看 ORM 生成的 SQL 就不会觉得黑盒了。
