---
title: "番外篇：FastAPI 面试体系梳理 —— 从四层架构到请求生命周期"
pubDate: 2026-07-12
description: "不写代码，纯讲面试会问但写业务时不一定意识到的架构知识：Uvicorn/Starlette/Pydantic/FastAPI 四层分工、完整请求生命周期、Middleware vs Depends 选型、response_model、Pydantic V2 进阶、Depends 缓存与覆盖、BackgroundTasks 等高频考点。"
type: 学习日志
tags: ["FastAPI", "面试", "Python", "ASGI", "Pydantic"]
featured: false
---

## 前言

写完 day1（Docker + FastAPI 项目初始化）和 day2（Psycopg 原生 SQL + 多表建模）之后，回头看了一下面经，发现有一类面试题我们的笔记还没有系统覆盖。

这类题的特点是：**写代码时不一定能意识到，但面试几乎必问**。它们不关注某个具体 API 怎么用，而是关注你对框架整体运行机制的理解——比如"一个请求从进来到出去经历了什么"、"FastAPI 底层依赖哪些组件"、"Middleware 和 Depends 什么时候用哪个"。

这篇文章就把这些"系统级认知题"一次性梳理清楚，作为 day1/day2 的知识体系补充。

---

## 1. FastAPI 四层架构：谁干了什么？

这是面试中最经典的开篇题。如果你被问到「FastAPI 的底层依赖哪些组件」，答不出四个角色的分工，后面印象分就打折了。

```
┌─────────────────────────────────────────┐
│                  FastAPI                  │  ← 胶水层：把类型标注、Depends、
│  (路由装饰器 + Depends + OpenAPI 生成)     │     OpenAPI 串成开发体验
├─────────────────────────────────────────┤
│                Starlette                  │  ← Web 框架底座：路由匹配、
│  (路由 / 中间件 / 异常处理 / 静态文件)      │     中间件链、请求/响应封装
├─────────────────────────────────────────┤
│                 ASGI                     │  ← 通信协议：scope + receive + send
│  (异步网关接口规范，支持 HTTP + WebSocket)  │
├─────────────────────────────────────────┤
│                Uvicorn                    │  ← 网络入口：监听端口、解析 HTTP、
│  (ASGI Server，基于 uvloop + httptools)    │     构造 ASGI scope、调用 ASGI app
└─────────────────────────────────────────┘

独立组件：
  Pydantic → 数据校验与序列化，驱动 /docs 的 JSON Schema 生成
```

| 组件 | 一句话职责 | 类比 |
|------|-----------|------|
| **Uvicorn** | 监听端口，接收 HTTP 连接，按 ASGI 规范调用应用 | Tomcat / Nginx |
| **ASGI** | 异步网关接口协议，定义 `scope + receive + send` 三个通道 | Servlet 规范 |
| **Starlette** | Web 框架底座，提供路由、中间件、异常处理 | Spring MVC 内核 |
| **Pydantic** | 请求校验、响应序列化、自动生成 OpenAPI Schema | Bean Validation + Jackson |
| **FastAPI** | 把上面四个组件的能力组合成完整的 API 开发模型 | Spring Boot |

> **面试一句话**：Uvicorn 管网络入口，ASGI 定异步协议，Starlette 管 Web 机制，Pydantic 管数据契约，FastAPI 负责缝合。

### 追问：为什么是 ASGI 而不是 WSGI？

| | WSGI | ASGI |
|------|------|------|
| 模型 | 同步 | 异步 |
| 并发 | 一个请求一个线程 | 事件循环 |
| 协议支持 | 仅 HTTP | HTTP + WebSocket + Server-Sent Events |
| 代表框架 | Flask, Django | FastAPI, Starlette |

对于 LLM Agent 后端，流式响应（SSE）是刚需——这正是 ASGI 的原生优势，WSGI 做不到。

### 深入 ASGI：`scope`、`receive`、`send` 分别是什么？

ASGI 应用的本质就是一个异步函数，签名为 `async def app(scope, receive, send)`。FastAPI/Starlette 把这三个参数封装成了 `Request` 和 `Response` 对象，所以写业务代码时不需要直接操作它们——但理解这三个参数，是理解"框架到底在干什么"的关键。

#### `scope` — "这个连接是什么"

一个字典，包含连接的全部元信息。Uvicorn 解析 HTTP 报文后构造它，然后传给 ASGI 应用：

```python
scope = {
    "type": "http",                    # 协议类型：http / websocket / lifespan
    "method": "POST",                  # HTTP 方法
    "path": "/agents/",               # 请求路径
    "raw_path": b"/agents/",          # 原始字节路径
    "query_string": b"page=1&size=10", # 查询字符串（字节）
    "headers": [                       # 请求头列表（字节对元组）
        (b"content-type", b"application/json"),
        (b"authorization", b"Bearer xxxx"),
    ],
    "client": ("192.168.1.5", 54321),  # 客户端 IP 和端口
    "server": ("127.0.0.1", 8000),     # 服务端 IP 和端口
    "scheme": "http",                  # http 或 https
    "http_version": "1.1",
    "asgi": {"version": "3.0"},        # ASGI 版本
}
```

不同协议类型的 scope 不同——WebSocket 的 scope 有 `"type": "websocket"`，没有 method/path 等 HTTP 特有字段。

#### `receive` — "从客户端接收数据"

一个异步 callable。每次 `await receive()` 返回一个事件字典：

```python
# HTTP 请求体事件（可能分多次接收）
event = await receive()
# → {"type": "http.request", "body": b'{"name":"codex"}', "more_body": False}
#                                                         ↑ True 表示后面还有数据，
#                                                           需要继续 await receive()

# WebSocket 消息事件
event = await receive()
# → {"type": "websocket.receive", "text": "Hello", "bytes": None}

# 客户端断开事件
event = await receive()
# → {"type": "http.disconnect"}
```

#### `send` — "向客户端发送数据"

一个异步 callable。每次 `await send(event)` 向客户端推送事件：

```python
# HTTP 响应开始
await send({
    "type": "http.response.start",
    "status": 200,
    "headers": [(b"content-type", b"application/json")],
})

# HTTP 响应体（可以分多次发送——这是流式响应/SSE 的底层基础）
await send({
    "type": "http.response.body",
    "body": b'{"status": "ok"}',
    "more_body": False,  # True = 后面还有数据 → 流式输出
})

# WebSocket 关闭
await send({
    "type": "websocket.close",
    "code": 1000,
})
```

#### 三参数关系一句话

> `scope` 告诉你"谁在请求什么"，`receive` 让你从客户端读数据，`send` 让你向客户端写数据。FastAPI 把这三个底层通道封装成了 `Request` 对象（读）和 `Response` 对象（写），所以你平时不需要直接跟它们打交道——但面试时被问到 "ASGI 是什么"，你得能说出这三个参数。

---

## 2. 一次请求的完整生命周期（面试必考题）

这是考察你"系统理解"的标志性题目。应该按以下 8 步回答：

```
客户端
  │
  ▼
┌──────────────────────────────────────────────────────────┐
│ 1. Uvicorn 接收 TCP 连接                                  │
│    解析 HTTP 报文 → 构造 ASGI scope 字典                   │
│    scope = {                                             │
│        "type": "http",                                   │
│        "method": "POST",                                 │
│        "path": "/agents/",                               │
│        "headers": [(b"content-type", b"application/json")]│
│    }                                                     │
├──────────────────────────────────────────────────────────┤
│ 2. Middleware 链（洋葱模型，由外向内）                       │
│    CORS 中间件 → 日志中间件 → trace id 中间件 → ...         │
│    每个中间件可以对 request 做前置处理                        │
├──────────────────────────────────────────────────────────┤
│ 3. 路由匹配                                               │
│    Starlette 的路由表：method + path → endpoint 函数        │
│    POST /agents/ → def creat_agent(...)                  │
├──────────────────────────────────────────────────────────┤
│ 4. FastAPI 解析函数签名                                    │
│    参数从哪里来？                                          │
│    - 路径参数：{agent_id} → Path                          │
│    - 查询参数：?page=1 → Query                            │
│    - 请求头：Authorization → Header                       │
│    - 请求体：JSON → Body (Pydantic model)                  │
├──────────────────────────────────────────────────────────┤
│ 5. Pydantic 类型转换 + 校验                                │
│    "100" → int, "2026-07-12" → date                       │
│    校验约束：Field(gt=0), min_length=3, ...               │
│    失败 → 422 Unprocessable Entity                        │
├──────────────────────────────────────────────────────────┤
│ 6. 解析 Depends 依赖图（递归）                              │
│    endpoint 需要 conn → Depends(get_connection)            │
│    get_connection 需要 settings → Settings()               │
│    FastAPI 拓扑排序，确保每个依赖的返回值在其消费者之前准备好   │
├──────────────────────────────────────────────────────────┤
│ 7. 调用业务函数                                            │
│    async def → 在事件循环中执行，await 时让出控制权           │
│    def       → 扔给线程池（anyio.to_thread.run_sync）       │
├──────────────────────────────────────────────────────────┤
│ 8. 序列化响应 → ASGI send 发回客户端                        │
│    如果声明了 response_model → Pydantic 过滤/转换           │
│    dict/list 自动序列化为 JSON                             │
│    Depends yield 依赖的 finally 块执行清理                  │
└──────────────────────────────────────────────────────────┘
```

> **面试技巧**：不要只背 8 个步骤的名字，要能串讲「为什么是这个顺序」——比如 Pydantic 校验在第 5 步、Depends 解析在第 6 步，是因为 Depends 依赖可能用到已经校验好的请求参数。

---

## 3. Middleware vs Depends：选型决策框架

这是我们之前笔记的一个空白地带。单独讲 Middleware 和 Depends 都不难，真正的面试考点是**何时用哪个**。

| 维度 | Middleware | Depends |
|------|-----------|---------|
| 作用范围 | 全局，所有请求 | 可选，支持路由级 |
| 能否注入到业务函数 | ❌ 只能修改 request/response | ✅ 返回值直接注入参数 |
| 能否获取请求参数 | ⚠️ 需手动从 request 解析 | ✅ 自动解析 header/query/body |
| OpenAPI 文档 | ❌ 不会体现 | ✅ 自动生成 |

### 决策口诀

```
所有请求都要经过 + 不需要注入业务函数 → Middleware
  例：CORS、全局日志、trace id、请求耗时统计、全局异常边界

某些接口需要 + 结果要注入业务函数 → Depends
  例：当前用户、权限校验、数据库 session、租户上下文
```

### Middleware 代码示例

```python
import time
import uuid
from fastapi import FastAPI, Request

app = FastAPI()

@app.middleware("http")
async def add_trace_id(request: Request, call_next):
    request.state.request_id = str(uuid.uuid4())[:8]
    start = time.time()

    response = await call_next(request)  # ← 进入下一层

    process_time = time.time() - start
    response.headers["X-Request-ID"] = request.state.request_id
    response.headers["X-Process-Time"] = str(process_time)
    return response
```

### 黄金组合模式

在实际项目中，两者各司其职：

```
Middleware 层（全局）
  ├── CORSMiddleware          ← 跨域
  ├── Trace ID 中间件          ← 日志追踪
  ├── 请求耗时统计             ← 性能监控
  └── 全局异常包装             ← 统一错误格式

Depends 层（路由级）
  ├── get_current_user        ← 认证 + 注入用户对象
  ├── require_permission      ← 权限校验
  ├── get_db_session          ← 数据库连接（yield 模式）
  └── get_tenant_context      ← 多租户上下文
```

---

## 4. `response_model`：被低估的安全防线

`response_model` 在 day1/day2 的笔记里完全没有出现，但它是 FastAPI 面试中一个被低估的重要考点。

### 核心作用

```python
from pydantic import BaseModel

class UserIn(BaseModel):
    username: str
    password: str        # ← 请求时包含密码

class UserOut(BaseModel):
    username: str
    email: str
    # 注意：没有 password 字段

@app.post("/users", response_model=UserOut)
def create_user(user: UserIn):
    # user 对象包含 password，但响应中绝不会出现
    return user
```

**即使你 return 的对象里有 `hashed_password` 字段，`response_model=UserOut` 也会把它过滤掉。** 这不是"记得删"的问题，是"不可能泄露"的安全保证。

### 常用参数速查

| 参数 | 效果 |
|------|------|
| `response_model=UserOut` | 只输出 UserOut 定义的字段（安全过滤） |
| `response_model_exclude_unset=True` | 只输出显式赋值的字段（PATCH 语义） |
| `response_model_exclude_none=True` | 忽略值为 `None` 的字段（减少 JSON 体积） |
| `response_model_exclude={"internal_id"}` | 排除特定字段 |
| `response_model_include={"id", "name"}` | 只包含指定字段 |

### 面试追问：`response_model` 和手动 dict 过滤有什么区别？

手动过滤是人肉保证，容易遗漏。`response_model` 是框架级保证——FastAPI 在序列化时用 Pydantic 的 schema 做输出校验，多出的字段直接丢弃，少了的字段报错。更重要的是 `response_model` 会驱动 OpenAPI 文档的响应 Schema 生成，手动返回 dict 做不到这一点。

---

## 5. Pydantic V2 进阶：`field_validator` 和 `model_validator`

我们的笔记只提到了 `model_config`，但 V2 还有两个核心验证器：

### `field_validator`：单字段校验（替代 V1 的 `@validator`）

```python
from pydantic import BaseModel, field_validator

class AgentCreate(BaseModel):
    name: str
    system_prompt: str = ""

    @field_validator("name")
    @classmethod
    def name_must_be_meaningful(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Agent 名称不能为空")
        if len(v) < 2:
            raise ValueError("Agent 名称至少 2 个字符")
        return v

    @field_validator("system_prompt")
    @classmethod
    def prompt_max_length(cls, v: str) -> str:
        if len(v) > 4000:
            raise ValueError("System prompt 不能超过 4000 字符")
        return v
```

### `model_validator`：跨字段校验（替代 V1 的 `@root_validator`）

```python
from pydantic import BaseModel, model_validator

class RegisterRequest(BaseModel):
    password: str
    password_confirm: str

    @model_validator(mode="after")
    def passwords_match(self) -> "RegisterRequest":
        if self.password != self.password_confirm:
            raise ValueError("两次输入的密码不一致")
        return self
```

`mode="after"` 表示在单字段校验**之后**执行——此时 `self` 已经是一个完整的 Pydantic 实例，可以访问所有字段。

### 运行时序：谁先执行？

理解两者的执行顺序是面试中的关键区分点：

```
收到 JSON → Pydantic 开始解析

  1. 类型转换：字符串 → int/float/date...
     例："100" → 100（int）

  2. field_validator("password")  → 校验 password 单字段
     不关心其他字段，只关心 password 的值合不合法

  3. field_validator("password_confirm") → 校验 password_confirm 单字段
     同样不关心其他字段

  4. model_validator(mode="after") → 跨字段校验
     此时所有字段都已就绪，可以访问 self.password 和 self.password_confirm

解析完成 → 传入路由函数
```

**核心认知**：`field_validator` 看一棵树（单字段），`model_validator` 看整片森林（完整实例）。

### 选型规则

| 场景 | 用什么 | 原因 |
|------|--------|------|
| 校验单个字段的值是否在合法范围 | `field_validator` | 只关心这个字段本身 |
| 标准化单个字段（strip、lower、去空格） | `field_validator` | 返回值可以替换原始值 |
| 两个字段之间的关系（密码确认、开始时间 < 结束时间） | `model_validator` | 需要同时看到多个字段 |
| 根据某个字段的值动态调整另一个字段的规则 | `model_validator` | 逻辑依赖跨字段上下文 |

### `field_validator` 的返回值机制

一个容易被忽略的细节：`field_validator` 的返回值会**替换字段的原始值**：

```python
@field_validator("name")
@classmethod
def normalize_name(cls, v: str) -> str:
    return v.strip()  # ← 返回值替换原始 name，后续步骤拿到的是 strip 后的值
```

这也意味着如果你在 `field_validator` 里做类型转换（比如 str → int），会破坏 Pydantic 的默认类型转换流程——一般不建议这样做。

### Pydantic V1 → V2 迁移速查

| V1 写法 | V2 写法 |
|---------|---------|
| `class Config: orm_mode = True` | `model_config = {"from_attributes": True}` |
| `@validator("field")` | `@field_validator("field")` |
| `@root_validator` | `@model_validator(mode="after")` |
| `.dict()` | `.model_dump()` |
| `.json()` | `.model_dump_json()` |
| `.schema()` | `.model_json_schema()` |

---

## 6. Depends 进阶：缓存、作用域、覆盖

### 6.1 依赖缓存机制

FastAPI **默认对同一请求中的同一依赖进行缓存**——只执行一次：

```python
def get_current_user(token: str = Depends(verify_token)):
    print("查询数据库")  # ← 只打印一次
    return find_user(token)

@app.get("/data")
async def get_data(
    user1: User = Depends(get_current_user),  # 执行
    user2: User = Depends(get_current_user),  # 返回缓存，不重复执行
):
    assert user1 is user2  # True，同一个对象
```

这避免了同一请求中重复的数据库查询/认证调用。如果确实需要禁用缓存：

```python
user1 = Depends(get_current_user, use_cache=False)
```

### 6.2 `scope` 参数：控制 yield 清理时机

`scope` 控制的是 **yield 后面的清理代码在什么时候执行**。这个区别很微妙但面试喜欢深挖。

#### `scope="request"`（默认值）

清理代码在**响应已经发送给客户端之后**执行：

```python
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()  # ← 此时客户端已经收到 JSON 了

@app.get("/users")
def get_users(db=Depends(get_db)):  # scope="request" 是默认值
    users = db.query(User).all()
    return users
```

时间线：

```
路由 return → 序列化响应 → ASGI send 发回客户端 → 客户端收到 → finally: db.close()
                                                                    ↑
                                                           清理在这里（响应之后）
```

**关键含义**：`db.close()` 执行时，客户端已经拿到数据了。即使 `db.close()` 很慢（比如网络闪断），用户也感知不到——响应已经发出去了。

#### `scope="function"`

清理代码在**路由函数返回之后、响应发送之前**执行：

```python
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()  # ← 此时客户端还没收到 JSON

@app.get("/users")
def get_users(db=Depends(get_db, scope="function")):
    users = db.query(User).all()
    return users
```

时间线：

```
路由 return → finally: db.close() → 序列化响应 → ASGI send → 客户端收到
                  ↑
         清理在这里（响应之前）
```

#### 什么时候需要 `scope="function"`？

**场景 1：需要在响应中包含清理结果**

```python
def get_stats():
    stats = {"queries": 0}
    try:
        yield stats
    finally:
        # 在响应序列化之前计算耗时，结果才能被写进 JSON
        stats["total_time_ms"] = calculate_time()

@app.get("/debug")
def debug(stats=Depends(get_stats, scope="function")):
    stats["queries"] = 100
    return stats
    # scope="function"：finally 在 return 之后、序列化之前执行
    # → JSON 里包含 total_time_ms ✅
    # scope="request"：finally 在序列化之后执行
    # → JSON 里不包含 total_time_ms ❌
```

**场景 2：独占资源需要立刻释放**

如果你有全局锁或有限额的资源池（比如 GPU 推理客户端），`scope="function"` 确保资源在函数返回后立刻归还，而不是等到 HTTP 响应完全发完——在高并发场景下，这几十毫秒的差距可能影响吞吐量。

#### 对比总结

| | `scope="request"`（默认） | `scope="function"` |
|------|------|------|
| 清理时机 | 客户端收到响应后 | 路由返回后、响应发送前 |
| 清理结果能否写入响应 | ❌ 来不及 | ✅ 可以 |
| 资源释放速度 | 慢（等响应发完） | 快（立刻释放） |
| 典型用途 | 数据库连接、99% 的场景 | 独占资源、需要把清理结果写进响应体 |

绝大多数场景用默认的 `"request"` 就够了——它还有一个额外好处：即使响应序列化或发送过程中出问题，清理代码仍然会执行（因为 finally 在 try 块保护下）。

### 6.3 依赖覆盖：测试的利器

这是 FastAPI 依赖注入体系最精妙的设计之一——业务代码和测试代码完全解耦，不需要传 mock 参数，不需要 monkey patch。

#### 为什么不用 mock.patch？

Flask/Django 的典型测试模式：

```python
# Flask 风格：用 mock.patch 猴子补丁
@mock.patch("app.database.SessionLocal")
def test_create_user(mock_session):
    mock_session.return_value = fake_session
    ...
```

问题：**mock 路径是字符串**。如果你重构了模块结构（移动了 `SessionLocal` 的位置），所有 mock.patch 的字符串路径都要跟着改——改漏一个，测试静默失效（mock 了一个不存在的路径，函数直接正常执行，你可能用生产数据库跑了测试）。

FastAPI 的 `dependency_overrides` 不同——直接替换函数对象，IDE 重构时自动追踪，不会出现字符串路径错位。

#### 基础示例：替换数据库连接

```python
from fastapi.testclient import TestClient

# 生产依赖
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

# 测试覆盖：用 SQLite 内存数据库替代 PostgreSQL
def override_get_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()

app.dependency_overrides[get_db] = override_get_db

client = TestClient(app)
# 后续所有请求自动使用 override_get_db
```

#### 进阶模式：事务回滚隔离

这是测试数据库最经典的隔离策略——每个测试用例通过依赖拿到连接，insert 的数据在事务内可见（断言可以通过），测试结束时 `rollback()` 让数据像从没写入过一样：

```python
# tests/conftest.py
import pytest
import psycopg
import os
from fastapi.testclient import TestClient
from app.main import app
from app.database import get_connection

@pytest.fixture
def client():
    """每个测试用例拿到独立的 TestClient，依赖已被覆盖"""

    def override_get_connection():
        conn = psycopg.connect(os.getenv("TEST_DATABASE_URL"))
        try:
            yield conn
        finally:
            conn.rollback()  # ← 不提交，测试结束后数据库保持干净
            conn.close()

    app.dependency_overrides[get_connection] = override_get_connection

    with TestClient(app) as client:
        yield client

    # 清理：去掉覆盖，避免影响其他测试模块
    app.dependency_overrides.clear()


# tests/test_agents.py
def test_create_agent(client):
    response = client.post("/agents/", json={"user_id": 1, "name": "测试助手"})
    assert response.status_code == 200
    data = response.json()
    assert data["name"] == "测试助手"
    assert "id" in data
    # 测试结束 → conftest 的 conn.rollback() → 数据回滚 → 下一个测试看到干净的库

def test_create_agent_invalid(client):
    response = client.post("/agents/", json={"user_id": 1, "name": ""})
    assert response.status_code == 422  # Pydantic 校验失败
```

#### 为什么 rollback 而不是 commit？

| 策略 | 优点 | 缺点 |
|------|------|------|
| `commit` | 和真实环境一致 | 测试之间数据污染，需要手动清理 |
| `rollback` | 自动隔离，测试间零干扰 | 无法测试 commit 行为本身 |
| 内存数据库 | 不依赖外部服务 | 和 PG 行为有差异（序列、JSONB 等） |

> 推荐：测试数据库用真实 PostgreSQL（保证行为一致），配合 `rollback` 实现隔离。内存 SQLite 只用于纯逻辑的快速跑测。

---

## 7. BackgroundTasks：响应之后的"暗线"

这也是 day1/day2 没涉及但实际开发中高频使用的能力：

```python
from fastapi import BackgroundTasks

def send_welcome_email(email: str, username: str):
    """模拟发送邮件——耗时操作"""
    time.sleep(3)
    print(f"欢迎邮件已发送至 {email}")

@app.post("/register")
async def register(
    email: str,
    username: str,
    background_tasks: BackgroundTasks,
):
    # 注册逻辑...
    user_id = create_user(username, email)

    # 添加后台任务——响应立即返回，任务在后台执行
    background_tasks.add_task(send_welcome_email, email, username)

    return {"user_id": user_id, "message": "注册成功"}
    # ← 客户端收到响应后，send_welcome_email 才在后台执行
```

### BackgroundTasks 的运作流程

```
请求进入 → 路由函数执行 → 把 send_email 放进任务队列 → return 响应 → 客户端收到 JSON
                                                              ↓
                                                    响应发送后，后台线程执行任务队列：
                                                      send_welcome_email()
                                                      send_sms()
                                                      write_audit_log()
```

### BackgroundTasks 的四个约束（面试重点）

面试时不要只说 BackgroundTasks 能做什么，更要说出它的**边界**：

**1. 不持久化**：任务存在进程内存里。如果你在 `send_welcome_email` 执行之前重启了服务（或者进程崩溃了），任务永久丢失——没有日志，没有记录，静默消失。

**2. 没有重试**：如果 `send_welcome_email` 抛异常了，不会自动重试。需要手动 try/except 自己兜底。

**3. 同一进程内**：任务和 API 服务共享 CPU 和内存。如果后台任务是 CPU 密集型的（比如图像处理），会直接抢占 API 的响应能力。

**4. 数据库连接不能复用**：请求的 `conn` 在响应返回后已经关闭了。后台任务必须自己新建独立的数据库连接。

### BackgroundTasks vs Celery：架构对比

```
BackgroundTasks（同一进程内）：
  ┌──────────────────────────────┐
  │        FastAPI 进程           │
  │  ┌──────────┬──────────────┐ │
  │  │ API 请求  │ 后台任务队列   │ │
  │  └──────────┴──────────────┘ │
  └──────────────────────────────┘
  ✅ 零部署成本
  ❌ 进程重启 → 任务全丢

Celery（消息队列 + 独立 Worker）：
  ┌──────────┐    ┌──────────┐    ┌──────────┐
  │ FastAPI  │    │  Broker  │    │  Worker  │
  │ 进程     │───►│ (Redis/  │───►│  进程    │
  │          │    │ RabbitMQ)│    │ (独立)   │
  └──────────┘    └──────────┘    └──────────┘
  ✅ 任务持久化     ✅ 队列持久化     ✅ 失败重试
  ❌ 额外部署成本
```

### 选型决策框架

| 维度 | BackgroundTasks | Celery |
|------|:--:|:--:|
| 部署复杂度 | 零 | 需要 Broker + Worker（+ 可能 Flower 监控） |
| 任务持久化 | ❌ 进程内存 | ✅ 消息队列（Redis/RabbitMQ） |
| 失败重试 | ❌ | ✅ 自动 + 可配置次数和退避策略 |
| 定时任务 | ❌ | ✅ Celery Beat |
| 任务状态查询 | ❌ | ✅ 可查询进度/结果 |
| 进程隔离 | ❌ 共享进程，重任务影响 API | ✅ 独立 Worker，互不干扰 |
| 适合的任务重量 | 轻（< 500ms） | 重（> 1s） |
| 适合的任务重要性 | 丢了也没事 | 绝不能丢 |

### 判断口诀

> 任务丢了会不会让用户投诉？**不会** → BackgroundTasks（发通知邮件、写审计日志、更新非关键缓存）。**会** → Celery（订单处理、报告生成、模型训练、支付回调）。

实际项目中不是二选一，而是分层使用：

```python
# 轻量 + 不重要：BackgroundTasks
background_tasks.add_task(write_audit_log, user_id, action)
background_tasks.add_task(update_last_login_time, user_id)

# 重要 + 可靠：Celery
send_welcome_email.delay(user_id=user_id)       # 邮件必须送达
generate_monthly_report.delay(report_id=rid)     # 报告不能丢
train_recommendation_model.delay(config=cfg)     # 长时间训练
```

---

## 8. CORS 配置速查

前端联调时的必经之路，面试也常问：

```python
from fastapi.middleware.cors import CORSMiddleware

app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://your-frontend.com"],  # 生产：具体域名
    # allow_origins=["*"],    # 仅开发环境
    allow_credentials=True,   # 允许携带 Cookie / Authorization
    allow_methods=["GET", "POST", "PUT", "DELETE"],
    allow_headers=["*"],
    max_age=3600,             # 预检请求缓存（秒）
)
```

**高频追问**：「`allow_origins=["*"]` 和 `allow_credentials=True` 能同时用吗？」

❌ **不能**。CORS 规范规定：当 `Access-Control-Allow-Credentials: true` 时，`Access-Control-Allow-Origin` 必须是具体的域名，不能是通配符 `*`。

---

## 面试自测清单

面试前问自己这几个问题，能流畅回答就基本稳了：

- [ ] Uvicorn / ASGI / Starlette / Pydantic / FastAPI 各自职责能说清
- [ ] ASGI 三参数 `scope, receive, send` 分别是什么
- [ ] 一个 POST 请求从 Uvicorn 收到 TCP 包到客户端收到 JSON，中间经历了哪些步骤
- [ ] Middleware 和 Depends 的选型边界——什么场景用哪个
- [ ] `response_model` 的三个核心作用（安全、一致性、文档）
- [ ] Pydantic V2 `field_validator` 和 `model_validator` 的区别和用法
- [ ] `Depends` 的缓存机制——什么时候缓存、怎么禁用
- [ ] `Depends` + `yield` 的 `scope` 参数——`"request"` 和 `"function"` 的区别
- [ ] 怎么写带数据库依赖的接口测试——`dependency_overrides`
- [ ] BackgroundTasks 和 Celery 的选型边界
- [ ] CORS 中 `allow_origins=["*"]` + `allow_credentials=True` 为什么不行

---

## 补充到知识体系中的位置

这篇文章填补了 day1/day2 中"写代码时会用到但不一定被问到原理"的空白：

```
day1：Docker + FastAPI 初始化 + async/await 深度
day2：Psycopg SQL + 多表建模 + Depends+yield 实践
  ↓
★ 番外篇：FastAPI 面试体系（这篇文章）
  ├── 四层架构分工
  ├── 请求完整生命周期
  ├── Middleware vs Depends 选型
  ├── response_model / Pydantic V2 进阶
  ├── Depends 缓存 / scope / override
  ├── BackgroundTasks
  └── CORS 配置
  ↓
day3：SQLAlchemy ORM 模型定义 ...
```

每个"怎么用"的背后都有一个"为什么"，这些"为什么"才是面试真正考察的。希望这篇番外篇能让知识体系更完整。
