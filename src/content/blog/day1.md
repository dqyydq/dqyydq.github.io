---
title: "Day 1：从零搭建一个 FastAPI + PostgreSQL + Docker 项目"
pubDate: 2026-07-11
description: "记录用 Docker Compose 编排 PostgreSQL、用 FastAPI 写第一个接口、以及深入理解 async/await 事件循环的完整过程。"
type: 学习日志
tags: ["FastAPI", "PostgreSQL", "Docker", "Python", "async"]
featured: false
series: fastapi-postgres-learning
seriesOrder: 1
---

## 前言

这是「Agent 实验平台」项目的第一天。目标很明确：把项目骨架搭起来，让 PostgreSQL 在 Docker 里跑起来，再用 FastAPI 写一个 `/health` 接口验证整个链路是通的。

听起来简单，但过程中踩了不少坑——从 TOML 语法、YAML 缩进，到 PostgreSQL 18 的目录结构变化、Windows 端口冲突，再到 `async def` 和 `def` 在 FastAPI 里的本质区别。这篇文章把第一天学到的内容系统整理出来。

---

## 1. 项目初始化：`pyproject.toml`

Python 项目的"身份证"是 `pyproject.toml`。以下是核心配置：

```toml
[project]
name = "agent-lab"
version = "0.1.0"
description = "一个 Agent 运行平台"
requires-python = ">=3.12"
dependencies = [
    "fastapi",
    "uvicorn[standard]",
    "psycopg[binary]",
    "sqlalchemy[asyncio]",
    "alembic",
    "pydantic",
    "pydantic-settings",
]

[project.optional-dependencies]
dev = [
    "pytest",
    "pytest-asyncio",
    "httpx",
]
```

几个容易踩坑的点：

| 关键点 | 说明 |
|--------|------|
| `version` 必须加引号 | `0.1.0` 不加引号会被 TOML 解析为浮点数 |
| 带 extra 的包要加引号 | `psycopg[binary]` 的 `[]` 在 TOML 里是特殊字符，必须写成 `"psycopg[binary]"` |
| `dev` 可选依赖 | 用 `pip install -e ".[dev]"` 安装，生产环境不装 |

---

## 2. Docker 三件套：Image、Container、Compose

理解这三个概念是使用 Docker 的前提：

```
镜像 (Image)          →   容器 (Container)       →   服务 (Service)
类似于安装 U 盘            类似运行中的系统              Compose 中一组容器的定义
只读模板                  可读写的运行实例              可以多副本
postgres:18-alpine       正在跑的 PostgreSQL           compose.yaml 里的 db
```

| 概念 | 来源 |
|------|------|
| Image | 可以从 Docker Hub 下载现成的（如 `postgres:18-alpine`），也可以自己写 Dockerfile 构建 |
| Container | `docker compose up` 启动的运行实例 |
| Service | 你在 `compose.yaml` 里定义的 |

---

## 3. `compose.yaml`：多容器编排

```yaml
volumes:
  pgdata:

services:
  db:
    image: postgres:18-alpine
    environment:
      POSTGRES_USER: agentlab
      POSTGRES_PASSWORD: agentlab
      POSTGRES_DB: agentlab_dev
    ports:
      - "127.0.0.1:15432:5432"
    volumes:
      - pgdata:/var/lib/postgresql
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U agentlab"]
      interval: 5s
      timeout: 5s
      retries: 5
```

### 几个关键设计决策

**为什么端口用 `127.0.0.1:15432:5432`？**

- `127.0.0.1` 前缀让端口只绑定本机，外部无法访问——安全性更好
- `15432` 是高位端口，避免和 Windows 上已被占用的 5432/5433 冲突

**为什么挂载 `/var/lib/postgresql` 而不是 `/var/lib/postgresql/data`？**

PostgreSQL 18 镜像改了数据目录结构，数据存在版本子目录中。挂载上级目录才能支持 `pg_upgrade`。

**为什么需要 healthcheck？**

容器启动 ≠ 数据库就绪。PG 内部初始化比容器启动慢 2-5 秒，如果 API 容器在数据库真正可连接之前就连它，就会失败。`pg_isready` 只做 TCP 连接 + PG 协议握手，不执行 SQL，开销几乎为零，适合高频探测。

### 开发策略：混合模式

开发阶段不在 Docker 里跑 FastAPI——改一行代码等两分钟 build 太痛苦了。实际做法：

- **PostgreSQL** → Docker 容器（稳定、隔离、一键启停）
- **FastAPI** → 本地 `uvicorn app.main:app --reload`（热重载，秒级生效）

---

## 4. `Dockerfile`：自定义镜像

```dockerfile
FROM python:3.12-slim
WORKDIR /app

# 先复制依赖文件，利用 Docker 层缓存
COPY pyproject.toml .
RUN pip install --no-cache-dir .

# 再复制全部代码
COPY . .

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

**分两步 COPY 的原因**：Docker 的每一层都有缓存。如果只改了代码但没改依赖，前几层命中缓存，`pip install` 直接跳过，构建几乎是瞬间完成。只有当 `pyproject.toml` 变了，才会重新安装依赖。

`compose.yaml` 是总指挥（定义几个容器、怎么通信），`Dockerfile` 只负责 api 这一个服务的构建细节。

---

## 5. PostgreSQL 核心概念

```
PostgreSQL 实例（类比：一栋楼）
├── Database: agentlab_dev   （楼里的一个仓库）
│   ├── Schema: public       （仓库里的货架分区）
│   │   ├── Table: users     （货架上的箱子）
│   │   ├── Table: agents
│   │   └── Table: conversations
│   └── Schema: audit        （另一个分区）
└── Role: agentlab           （门禁卡——控制谁进哪个仓库）
```

| 概念 | 我们创建的 |
|------|-----------|
| Role | `agentlab`（compose 环境变量自动创建） |
| Database | `agentlab_dev`（`POSTGRES_DB` 自动创建） |
| Schema | `public`（PG 默认自带） |
| Table | `users`（手动 SQL 创建） |

---

## 6. SQL 实验：从建表到 UPSERT

### 建表

```sql
CREATE TABLE users (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

逐列解读：

| 语法 | 含义 |
|------|------|
| `BIGINT` | 64 位整数，范围约 ±9 千万亿 |
| `GENERATED ALWAYS AS IDENTITY` | SQL 标准自增列，**绝不允许**手动插入 id |
| `PRIMARY KEY` | `UNIQUE + NOT NULL + 自动创建 B-Tree 索引` |
| `TIMESTAMPTZ` | 存入时转 UTC，读取时转当前时区，推荐使用 |
| `DEFAULT now()` | 插入时自动填入当前时间 |

> **IDENTITY vs SERIAL**：IDENTITY 是 SQL 标准，权限分离更好，推荐。SERIAL 是 PG 老语法。

### 序列号的"坑"：ON CONFLICT 会消耗序列吗？

```sql
SELECT currval('users_id_seq');  -- 5

INSERT INTO users (username) VALUES ('zhangsan')
ON CONFLICT (username) DO NOTHING;
-- INSERT 0 0（冲突了，0 行插入）

SELECT currval('users_id_seq');  -- 6（不是 5！）
```

**原因**：`nextval()` 在冲突检查**之前**执行，序列已经前进到 6 了，冲突后不回退。

**为什么 PG 不回退序列？**这是性能权衡。如果回退，并发插入时序列要等所有 INSERT 完成才能确定下一个值——锁竞争严重。不回退则序列无锁、无等待，性能极高。BIGINT 有 90 亿亿个值，跳几个没关系。

> MySQL 的 InnoDB AUTO_INCREMENT 同样不回退。但 MySQL 8.0 之前序列值不持久化（重启重置为 `MAX(id)+1`），PG 的 SEQUENCE 是持久化的。

---

## 7. FastAPI 应用架构

```
app/
├── __init__.py       # 让 Python 识别 app 为包
├── config.py         # 从环境变量和 .env 加载配置
├── database.py       # 创建异步引擎和 Session 工厂
└── main.py           # FastAPI 应用入口
```

### config.py：配置管理

```python
from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    database_url: str
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")
```

- `BaseSettings` 自动读取环境变量，`database_url` 会自动匹配 `DATABASE_URL`
- `env_file=".env"` 还会从 `.env` 文件读取
- `extra="ignore"` 是关键——`.env` 里多出的变量不报错。第一天就踩了这个坑：`.env` 里写了 `TEST_DATABASE_URL`，但 Settings 类没声明，Pydantic 默认拒绝多余字段

### database.py：连接管理

```python
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession

engine = create_async_engine(settings.database_url, echo=True)

AsyncSessionLocal = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
)
```

**为什么 `expire_on_commit=False`？**这是异步 FastAPI 的标配。默认情况下 commit 后对象属性标记为"过期"，下次访问时重新查数据库。但在异步请求中对象生命周期很短，commit 后通常不再访问同一对象，过期检查反而报错 `"object is expired"`。

### main.py：应用入口

```python
from contextlib import asynccontextmanager
from fastapi import FastAPI
from app.database import engine

@asynccontextmanager
async def lifespan(app: FastAPI):
    # 启动：连接池已自动初始化
    yield
    # 关闭：释放连接池
    await engine.dispose()

app = FastAPI(lifespan=lifespan)

@app.get("/health")
async def health():
    return {"status": "ok"}
```

`lifespan` 用 `yield` 把函数劈成两半——`yield` 之前是启动逻辑，`yield` 之后是关闭逻辑。比旧版 `@app.on_event("startup")` / `@app.on_event("shutdown")` 更内聚。

---

## 8. 深入理解 `async def` vs `def`：事件循环与线程池

这是今天最核心的认知收获。FastAPI 启动后只有一条主线程，但处理请求时有两套机制：

```
请求进来
    │
    ├─ async def? ──→ 主线程（事件循环）
    │                  一个人来回切，await = 主动让路
    │                  一个线程处理几千并发
    │                  风险：不要在 async def 里写 time.sleep()
    │
    └─ def? ──→ 扔给线程池（另外 40 个小弟线程）
                 OS 自动在线程间切换
                 卡的是外援线程，主线程完全不受影响
```

### 事件循环：一个人干很多活

所有 `async def` 都在**同一条主线程**上轮转。`await` 是"我先让路"的信号，不是线程切换：

```
请求A：await session.execute() → "你去查数据库，我先处理别人的"（让出控制权）
请求B：await session.execute() → "你也去查"
请求C：return {"ok"}           → 直接完成
请求A 的数据库返回了            → "A 回来，继续你的"（恢复执行）
```

### 线程池：自己干不了，叫外援

`def` 请求不在主线程上跑。主线程把它交给线程池，自己继续接待新请求。即使函数里有 `time.sleep(10)`，卡住的也是线程池里的小弟线程，主线程毫发无伤。

| | `async def` | `def` |
|------|-------------|-------|
| 跑在哪 | 事件循环（主线程） | 外部线程池 |
| 切换方式 | `await` 主动让路 | OS 抢占式切换 |
| 并发上限 | 几千到上万个并发连接 | 线程池大小（默认 40） |
| 阻塞调用 | ❌ 卡死主线程 | ⚠️ 卡小弟线程，不卡主线程 |
| 适用场景 | 数据库查询、HTTP 调用等 I/O 等待 | CPU 密集计算、调用同步库 |

> 一句话记住：**`async def` = 主线程上协作轮转（`await` 让路），`def` = 扔给外援线程池（不堵主线程）。两个都不会让服务崩溃。**

---

## 9. 常见面试题速查

以下是今天内容覆盖的经典面试题：

**Docker 镜像和容器的区别？**
镜像是只读模板（类比安装盘），容器是运行实例（类比运行的系统）。删容器不删镜像。

**healthcheck 为什么需要？**
容器启动 ≠ 服务就绪。`depends_on` 只检查容器是否启动，healthcheck 等到真正可连接。

**PostgreSQL 的 database / schema / table / role 分别是什么？**
Role 是用户/角色（门禁卡），Database 是独立数据库（仓库），Schema 是命名空间（货架分区），Table 是实际存储数据的表（箱子）。

**IDENTITY vs SERIAL？**
IDENTITY 是 SQL 标准，权限分离更好。SERIAL 是 PG 老语法。推荐前者。

**ON CONFLICT DO NOTHING 会消耗序列号吗？**
会。`nextval()` 在冲突检查之前执行，序列不回退（性能优先）。

**TIMESTAMP vs TIMESTAMPTZ？**
用 `TIMESTAMPTZ`。存 UTC，读时自动转当前时区。`TIMESTAMP` 不管时区，容易出 bug。

**PRIMARY KEY 背后有什么？**
`PRIMARY KEY = UNIQUE + NOT NULL + 自动创建 B-Tree 索引`。每个 UNIQUE 也自动创建唯一索引，都有写入成本。

**FastAPI 的 `async def` 和 `def` 有什么区别？**
`async def` 跑在事件循环里，靠 `await` 主动让出控制权，适合 I/O 密集场景。`def` 被提交到外部线程池执行，即使有同步阻塞调用也不会卡死事件循环。声明了 `async def` 但内部一个 `await` 都没有，反而多了多余的协程开销。

---

## 踩坑记录

| 问题 | 解决方式 |
|------|---------|
| TOML `[]` 被解析为节头 | 包名含 `[extra]` 时必须加引号 |
| `version=0.1.0` 被解析为浮点数 | 版本号必须加引号 `"0.1.0"` |
| YAML 冒号后忘记空格 | `key: value` 不是 `key:value` |
| Dockerfile 行内注释报错 | Dockerfile 注释必须独占一行 |
| Windows 端口 5432/5433 被占用 | 换高位端口 `15432` + `127.0.0.1` 绑定 |
| PG 18 数据目录不兼容 | 挂载 `/var/lib/postgresql` 而非 `.../data` |
| Pydantic `extra_forbidden` 报错 | 设 `extra="ignore"` 允许未声明的环境变量 |

---

## 下一步

- 给 `/health` 加上数据库连通性检查
- 开始写 SQLAlchemy ORM 模型
- 深入 `async_sessionmaker` 的生命周期管理

第一天的内容就到这里。如果你也在做类似的项目，希望这篇笔记对你有帮助。
