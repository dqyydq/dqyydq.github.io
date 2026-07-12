---
title: "Day 2：Psycopg 原生 SQL、多表建模与 FastAPI 依赖注入"
pubDate: 2026-07-12
description: "从 Psycopg 参数化查询入手，到三表 FOREIGN KEY 建模、JOIN 实验、CRUD 实战，再到排查一个诡异的 IPv6 hang 问题，最后深入理解 FastAPI 的 Depends + yield 依赖注入机制。"
type: 学习日志
tags: ["PostgreSQL", "Psycopg", "FastAPI", "SQL", "Python"]
featured: false
---

## 前言

第二天的主要任务是"写 SQL"。但不是随便写——而是遵循项目的学习路径：**psql → Psycopg → SQLAlchemy Core → SQLAlchemy ORM → Alembic**，一步步从底层走到上层。

今天的收获比预期大得多。除了建表、JOIN、CRUD 这些预期内容，还排查了一个诡异的 IPv6 hang 问题（花了最长时间），以及搞懂了 FastAPI `Depends` + `yield` 依赖注入的完整执行流程。

---

## 1. 为什么先学 Psycopg，不直接学 ORM？

项目的 CLAUDE.md 规定了学习顺序，背后有明确的理由：

| 先学 ORM 的风险 | 先学 Psycopg 的好处 |
|---------------|-------------------|
| ORM 隐藏了 SQL，你不知道它实际发了什么 | 你写的就是最终发给 PG 的 SQL |
| N+1 问题看不出来 | 每句 SQL 都是你亲手写的，性能心里有数 |
| 事务边界模糊 | 事务由你显式 commit/rollback |
| 出了问题不知从哪查 | 原生 SQL → `EXPLAIN` 直接分析 |

Psycopg 的角色很简单：

```
Python ──→ Psycopg ──→ 发 SQL ──→ PostgreSQL
              │
              负责：建立 TCP 连接、发送参数化 SQL、接收结果、管理事务
```

连接字符串的区别也值得注意——SQLAlchemy 多了驱动名：

```
Psycopg:     postgresql://user:password@host:port/dbname
SQLAlchemy:  postgresql+psycopg://user:password@host:port/dbname
                  ↑ 多了 +psycopg 指定驱动
```

---

## 2. 参数化查询：防 SQL 注入的第一道防线

这是今天最重要的安全认知。看一个对比：

```python
# ❌ 危险：字符串拼接
user_input = "zhangsan'; DROP TABLE users; --"
sql = f"SELECT * FROM users WHERE username = '{user_input}'"

# ✅ 安全：参数化查询
cur.execute("SELECT * FROM users WHERE username = %s", (user_input,))
```

关键认知：**参数化不是简单的引号转义**。PG 在协议层面就把参数和数据分开传输——SQL 语句和参数值走不同的通道。哪怕参数里包含 `DROP TABLE`，PG 也只当它是一个普通的 username 值，绝不执行。

> **面试标准答案**：SQL 注入的根本原因是**把数据当作代码执行了**。防御的核心是参数化查询（Psycopg 用 `%s` 占位符），让 PG 在协议层面区分 SQL 代码和参数数据。额外防线：数据库权限最小化（应用账号不应有 DROP TABLE 权限）、输入校验、WAF。

---

## 3. `INSERT ... RETURNING`：一次查询完成插入 + 获取

```python
cur.execute(
    "INSERT INTO users (username) VALUES (%s) RETURNING id",
    ("lisi",)
)
new_id = cur.fetchone()[0]  # → (7,)
```

| 不用 RETURNING | 用 RETURNING |
|---------------|-------------|
| INSERT → SELECT 查 id（两次查询） | INSERT + 返回列（一次查询） |
| 并发时可能查出别人的 id | 返回的一定是你刚插入的 |

`RETURNING` 是 **PostgreSQL 特有扩展**，MySQL 不支持。它可以返回任意列，甚至 `RETURNING *`。

一个小但重要的 Python 细节——单元素元组必须加逗号：

```python
("lisi",)   # ✅ 单元素元组
("lisi")    # ❌ 这是字符串，不是元组
```

---

## 4. `with` 语句管理连接

```python
with psycopg.connect(DATABASE_URL) as conn:       # 自动关闭连接
    with conn.cursor() as cur:                     # 自动关闭 cursor
        cur.execute("SELECT ...")
        row = cur.fetchone()
# ← 退出 with 块：cursor.close() → conn.close() 自动执行
#   即使中间抛异常，也会执行清理
```

`with` 在 Python 里是上下文管理器（Context Manager），靠 `__enter__` 和 `__exit__` 实现。`__exit__` 无论正常返回还是抛异常都会执行——所以**连接不可能泄露**。

---

## 5. 三表建模：FOREIGN KEY 实战

今天建了 agents、conversations、messages 三张表，形成了完整的外键链：

```sql
CREATE TABLE agents (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id),
    name TEXT NOT NULL,
    system_prompt TEXT,
    model TEXT NOT NULL DEFAULT 'gpt-4o',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE conversations (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id),
    agent_id BIGINT NOT NULL REFERENCES agents(id),
    title TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE messages (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    conversation_id BIGINT NOT NULL REFERENCES conversations(id),
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

建表过程中几个值得记录的观察：

### 外键自动命名

PG 自动命名规则：`表名_列名_fkey`。用 `\d conversations` 可以看到 `conversations_agent_id_fkey` 这样的约束名。

### CHECK 约束被 PG 内部改写

```sql
-- 你写的
CHECK (role IN ('user', 'assistant', 'system'))

-- PG 实际存的
CHECK (role = ANY (ARRAY['user'::text, 'assistant'::text, 'system'::text]))
```

功能完全一样，PG 在内部做了等价转换。

### ⚠️ 外键不会自动建索引

这是今天最重要的数据库认知之一：

```
-- \d conversations 输出
Indexes:
    "conversations_pkey" PRIMARY KEY, btree (id)  ← 只有主键有索引！

Foreign-key constraints:
    "conversations_agent_id_fkey" FOREIGN KEY (agent_id) REFERENCES agents(id)
    -- 外键列 agent_id 没有索引！
```

> **面试重点**：PRIMARY KEY 自动建索引，FOREIGN KEY **不自动建索引**。如果你经常用外键列筛选或 JOIN，需要手动 `CREATE INDEX`。

### 外键是数据库级护栏

```sql
INSERT INTO conversations (user_id, agent_id, title) VALUES (1, 999, '应该失败');
-- ERROR: insert or update on table "conversations" violates foreign key constraint
-- DETAIL: Key (agent_id)=(999) is not present in table "agents".
```

应用代码绕不过去——这是数据库层面的最后一道防线，和 Day 1 的 UNIQUE 约束一样。

---

## 6. INNER JOIN vs LEFT JOIN

四表 JOIN 的实际查询：

```sql
SELECT u.username, a.name, c.title, m.role, m.content
FROM messages m
JOIN conversations c ON m.conversation_id = c.id
JOIN agents a ON c.agent_id = a.id
JOIN users u ON a.user_id = u.id;
```

JOIN 的思考方式：从 FROM 开始，每 JOIN 一次就挂上更多列，最终一行包含四张表的字段。

INNER JOIN 和 LEFT JOIN 的区别用一个实验就能看清：

```sql
-- 先插一个没有消息的会话
INSERT INTO conversations (user_id, agent_id, title) VALUES (1, 1, '没有消息的会话');

-- LEFT JOIN：左边全保留
SELECT c.title, m.content
FROM conversations c
LEFT JOIN messages m ON m.conversation_id = c.id;
-- 结果包含 "没有消息的会话 | (NULL)"  ← 没消息也保留

-- INNER JOIN（默认 JOIN）：两边都要有匹配
SELECT c.title, m.content
FROM conversations c
JOIN messages m ON m.conversation_id = c.id;
-- "没有消息的会话" 消失了
```

| INNER JOIN | LEFT JOIN |
|------------|-----------|
| 两边都要有匹配 | 左边全保留 |
| 匹配不上 → 丢弃该行 | 右边匹配不上 → NULL |
| 默认 `JOIN` 就是 INNER | 必须显式写 `LEFT JOIN` |

---

## 7. Psycopg CRUD 全流程

将建表知识串起来，写了一个完整的 CRUD 实验脚本：

```python
import psycopg

DB = "postgresql://agentlab:agentlab@127.0.0.1:15432/agentlab_dev"

with psycopg.connect(DB) as conn:
    with conn.cursor() as cur:
        # 1. INSERT agent + RETURNING id
        cur.execute("INSERT INTO agents (user_id,name) VALUES (%s,%s) RETURNING id", (1, "codex"))
        agent_id = cur.fetchone()[0]

        # 2. INSERT conversation（用上一步的 agent_id）
        cur.execute("INSERT INTO conversations (user_id,agent_id,title) VALUES (%s,%s,%s) RETURNING id",
                    (1, agent_id, "测试会话"))
        conv_id = cur.fetchone()[0]

        # 3. INSERT message（用上一步的 conv_id）
        cur.execute("INSERT INTO messages (conversation_id,role,content) VALUES (%s,%s,%s) RETURNING id",
                    (conv_id, "user", "你好"))
        msg_id = cur.fetchone()[0]

        # 4. SELECT + JOIN 四张表
        cur.execute("""
            SELECT u.username, a.name, c.title, m.role, m.content
            FROM messages m
            JOIN conversations c ON m.conversation_id = c.id
            JOIN agents a ON c.agent_id = a.id
            JOIN users u ON a.user_id = u.id
        """)
        for row in cur.fetchall():
            print(row)

        # 5. UPDATE + RETURNING
        cur.execute("UPDATE messages SET content=%s WHERE id=%s RETURNING id",
                    ("更新后的问题内容", msg_id))

        # 6. DELETE — 外键保护！
        try:
            cur.execute("DELETE FROM conversations WHERE id = %s", (conv_id,))
        except Exception as e:
            print(f"外键保护: {e}")  # 有 messages 引用，删不掉
```

| 操作 | 模式 | 关键点 |
|------|------|--------|
| INSERT | `execute(sql, params)` + `fetchone()[0]` | `RETURNING` 拿 id |
| SELECT+JOIN | `execute(sql)` + `fetchall()` | JOIN 之间不用逗号 |
| UPDATE | `execute(sql, params)` + `RETURNING` | 可选拿回修改后的行 |
| DELETE | `execute()` + `try/except` | 外键保护 → 优雅处理而不崩溃 |

---

## 8. 🐛 深度排查：`localhost` vs `127.0.0.1` —— IPv6 hang

这是今天花时间最多的问题，值得单独写一节。

### 现象

`/health` 接口正常返回，但 `POST /agents/` 卡住，无响应也无报错。

### 排查过程

一步步缩小范围：

1. TCP 测试：`socket.connect(('127.0.0.1', 15432))` → 正常
2. 实验脚本中 `psycopg.connect("...@127.0.0.1...")` → 正常
3. 实验脚本中 `psycopg.connect("...@localhost...")` → **hang**
4. 检查 `.env` → 写的是 `localhost`
5. agents.py 通过 Settings 读 `.env` → 用的就是 `localhost`

### 根因

```
Windows 上：
  localhost → DNS 解析 → ::1 (IPv6) → 尝试连接 → Docker 只绑了 IPv4 → 没人应答 → 卡住
  127.0.0.1 → 直接 IPv4 → 连接成功 ✅
```

**为什么 `/health` 不受影响？** `/health` 走的是 SQLAlchemy 异步 engine，内部有独立的地址解析和超时机制，做了 fallback。同步 `psycopg.connect()` 没有这个保护。

### 修复

```python
# database.py — get_connection() 中自动替换
settings.database_url.replace("localhost", "127.0.0.1")
```

简单但关键的一行。

> **面试题**：`localhost` 是主机名，需 DNS 解析。Windows 上优先解析为 IPv6 `::1`，如果服务只绑了 IPv4 就连不上。`127.0.0.1` 是 IPv4 字面地址，直接连接，不经过 DNS。

---

## 9. `Depends` + `yield` Generator 依赖注入机制

这是今天第二深的认知收获。先看工作代码：

```python
# database.py
def get_connection():
    """FastAPI 依赖：每个请求拿到一个独立的 Psycopg 连接"""
    conn = psycopg.connect(
        settings.database_url.replace("+psycopg", "")
                             .replace("localhost", "127.0.0.1"))
    try:
        yield conn          # yield：返回给路由，函数暂停
    finally:
        conn.close()        # 路由返回后，finally 执行清理


# api/agents.py
@router.post("/")
def creat_agent(body, conn=Depends(get_connection)):
    with conn.cursor() as cur:
        cur.execute(...)
        conn.commit()
    return ...
```

### FastAPI 如何执行 `def` 路由 + Generator 依赖？

一个关键问题：`get_connection()` 是 generator，它的 `next()` 和 `close()` 分别在哪个线程执行？会不会跨线程？

```
主线程（事件循环）
    │
    │  收到 POST /agents/
    │  路由是 def → 扔给线程池
    │
    └──→ anyio.to_thread.run_sync(creat_agent)
              │
              线程池线程：
                1. Depends 调用 get_connection() → 拿到 generator
                2. next(gen) → 拿到 conn
                3. conn 传入 creat_agent
                4. creat_agent 用 conn 执行 SQL
                5. creat_agent 返回
                6. gen.close() → 触发 finally: conn.close()
                7. conn 创建、使用、关闭 → 全在同一个线程池线程 ✅
```

**FastAPI 把整个调用链（包括 Depends 的创建和清理）都包在 `run_in_threadpool` 里**，所以不存在跨线程问题。

### 踩坑：`@contextmanager` 装饰器导致报错

最初在 `get_connection()` 上加了 `@contextmanager` 装饰器：

```python
@contextmanager          # ← 这个包装器导致了问题
def get_connection():
    conn = psycopg.connect(...)
    try:
        yield conn
    finally:
        conn.close()
```

`@contextmanager` 把 generator 包了一层 `_GeneratorContextManager` 对象。FastAPI 的依赖注入尝试在这个对象上调用 `.throw()` 方法 → 不存在 → `AttributeError`。

**修复**：去掉 `@contextmanager`，直接用裸 generator 函数。FastAPI 原生支持 `yield` 依赖，不需要额外包装。

---

## 10. 新增接口

| 接口 | 方法 | 请求体 | 响应 |
|------|------|--------|------|
| `/agents/` | POST | `AgentCreate` | `AgentResponse` |
| `/agents/` | GET | — | `list[AgentResponse]` |

API 架构一目了然：

```
HTTP 请求
    │
    ▼
FastAPI Router (app/api/agents.py)
    ├── 解析请求 (Pydantic Schema)
    ├── Depends(get_connection) → Psycopg 连接
    ├── 执行 SQL
    └── 返回 JSON (Pydantic 序列化)
    ▼
PostgreSQL
```

Schema 和 Model 的分离也值得强调——`AgentCreate` 定义 API 契约（请求/响应的形状），后面 SQLAlchemy 的 Model 定义数据库表映射。两者独立演变，互不耦合。

---

## 11. 常见面试题速查

**SQL 注入是什么？如何防止？**
参数化查询。PG 协议层面区分代码和数据，参数绝不当作 SQL 执行。绝不字符串拼接。

**`INSERT ... RETURNING` 是什么？MySQL 有吗？**
PG 特有扩展。INSERT 的同时返回指定列，省去 SELECT。MySQL 不支持。

**Python 的 `with` 语句原理？**
上下文管理器。`__enter__` 和 `__exit__`。`__exit__` 无论异常与否都执行，保证资源释放。

**PRIMARY KEY 和 FOREIGN KEY 都会自动建索引吗？**
PRIMARY KEY 自动建 B-Tree 索引。FOREIGN KEY **不自动建索引**——需要手动 `CREATE INDEX`。

**`localhost` 和 `127.0.0.1` 有什么区别？**
`localhost` 是主机名，需 DNS 解析。Windows 上优先解析为 IPv6 `::1`，IPv4-only 服务会连不上。`127.0.0.1` 是 IPv4 字面地址，不经过 DNS。

---

## 踩坑记录

| 问题 | 原因 | 解决 |
|------|------|------|
| POST /agents/ 卡住无响应 | `.env` 里 `localhost` → Windows 解析为 IPv6 → Docker 只绑 IPv4 → hang | `.replace("localhost", "127.0.0.1")` |
| `@contextmanager` + Depends 报错 | `_GeneratorContextManager` 无 `throw` 方法 | 去掉装饰器，直接用 `yield` |
| `RETUENING` 拼写错误 | 打字错误 | `RETURNING` |
| `%s` 参数没传 | 忘了第二个参数 | `execute(sql, (param,))` |
| 单元素元组写成 `("lisi")` | 没加逗号 | `("lisi",)` |
| JOIN 之间写了逗号 | JOIN 语法不需要逗号分隔 | 去掉逗号 |

---

## 下一步

- 进入 SQLAlchemy Core 层，理解 ORM 生成的 SQL
- 给 API 加上参数校验和错误处理
- 补全 agents/conversations/messages 的完整 CRUD 端点

第二天最大的收获不是写了多少 SQL，而是排查 `localhost` hang 问题和搞懂 `Depends` + `yield` 的执行流程——这些问题在实际项目中迟早会遇到，提前搞清楚原理就能少踩坑。
