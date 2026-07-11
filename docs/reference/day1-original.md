# Day 1 — 第 1 天学习笔记

**日期**：2026-07-11
**主题**：Docker Compose 基础、PostgreSQL 概念、项目初始化

---

## 今日目标

- [x] 创建项目目录结构和 `pyproject.toml`
- [x] 理解 Docker 三大概念（Image / Container / Compose）
- [x] 编写 `compose.yaml` 和 `Dockerfile`
- [x] 理解 YAML 语法规则
- [x] 理解 PostgreSQL 的 database、schema、table、role
- [x] 启动 PostgreSQL 容器并用 psql 动手操作
- [x] 创建 FastAPI `/health` 接口

---

## 完成内容

### 1. 项目结构

```
agent-lab/
├── pyproject.toml          # 项目元数据和依赖声明
├── .env.example            # 环境变量模板（不含真实密码）
├── .gitignore              # Git 忽略规则
├── compose.yaml            # Docker 多容器编排
├── Dockerfile              # API 容器构建配方
├── app/                    # 应用代码
│   ├── api/                # FastAPI 路由
│   ├── models/             # SQLAlchemy 模型
│   ├── schemas/            # Pydantic 请求/响应模型
│   ├── repositories/       # 数据库查询封装
│   ├── services/           # 业务逻辑
│   ├── agents/             # Agent 运行器
│   │   └── tools/          # Agent 可调用工具
│   ├── workers/            # 后台任务 Worker
│   └── exceptions/         # 自定义异常
├── tests/                  # 测试
│   ├── unit/               # 单元测试
│   ├── integration/        # 集成测试
│   └── concurrency/        # 并发测试
├── scripts/                # 脚本
├── sql/                    # SQL 实验
├── docs/                   # 学习笔记
└── migrations/             # Alembic 数据库迁移
```

---

### 2. `pyproject.toml` — Python 项目的"身份证"

```toml
[project]
name = "agent-lab"                    # pip install 时的包名
version = "0.1.0"                     # 语义化版本，必须加引号
description = "一个Agent运行平台"
requires-python = ">=3.12"           # 限制 Python 最低版本
dependencies = [                      # 运行时依赖
    "fastapi",                        # Web 框架
    "uvicorn[standard]",              # ASGI 服务器，[standard] 是 extra
    "psycopg[binary]",                # PostgreSQL 驱动，[binary] 免编译
    "sqlalchemy[asyncio]",            # ORM + 异步支持
    "alembic",                        # 数据库迁移工具
    "pydantic",                       # 数据校验
    "pydantic-settings",              # 环境变量读取
]

[project.optional-dependencies]
dev = [
    "pytest",                         # 测试框架
    "pytest-asyncio",                 # 异步测试
    "httpx",                          # HTTP 客户端（测试用）
]
```

| 关键点 | 说明 |
|--------|------|
| `[project]` 节头 | 必须写，不写属性不知道属于谁 |
| `version` 必填 | PEP 621 硬性要求，必须用引号（否则 0.1.0 被解析为浮点数） |
| 带 extra 的包要加引号 | `psycopg[binary]` 的 `[]` 在 TOML 里是特殊字符 |
| `dev` 可选依赖 | 用 `pip install -e ".[dev]"` 安装，生产环境不装 |

---

### 3. Docker 三大概念

```
镜像 (Image)          →   容器 (Container)       →   服务 (Service)
类似于安装 U 盘            类似运行中的系统              Compose 中一组容器的定义
只读模板                  可读写的运行实例              可以多副本
postgres:18-alpine       正在跑的 PostgreSQL           compose.yaml 里的 db
```

| 概念 | 你用的 | 来源 |
|------|--------|------|
| Image | `postgres:18-alpine` | Docker Hub 下载（别人做好的） |
| Image | Dockerfile 构建的镜像 | 自己写菜谱，本地生成 |
| Container | `db` 和 `api` 两个容器 | `docker compose up` 启动 |
| Service | `compose.yaml` 里的 `db` / `api` | 你定义的 |

---

### 4. `compose.yaml` — 多容器部署说明书

#### 完整文件及逐行解释

```yaml
volumes:                              # ← 最外层：声明命名卷
  pgdata:                             # 卷名，数据存在 Docker 管理的存储中

services:                             # ← "我要以下服务"
  db:                                 # 服务名 = 容器间 DNS 域名
    image: postgres:18-alpine         # 从 Docker Hub 下载现成镜像
    environment:                      # 首次启动时 PG 自动读取这些变量
      POSTGRES_USER: agentlab         # → 创建角色 agentlab
      POSTGRES_PASSWORD: agentlab     # → 角色密码
      POSTGRES_DB: agentlab_dev       # → 自动创建数据库 agentlab_dev
    ports:
      - "127.0.0.1:15432:5432"        # 127.0.0.1=仅本机；15432=避免 Windows 端口冲突
    volumes:
      - pgdata:/var/lib/postgresql    # PG 18+ 要求挂载上级目录（/data 不行）
    healthcheck:                      # 健康检查，探测 PG 是否真正就绪
      test: ["CMD-SHELL", "pg_isready -U agentlab"]
      interval: 5s                    # 每 5 秒检查一次
      timeout: 5s                     # 单次检查超时
      retries: 5                      # 连续失败 5 次 → unhealthy

  # api 服务删掉了 —— 开发阶段不用 Docker 跑 API
  # 改用本地 uv/venv + uvicorn（热重载，秒级生效）
```

#### 关键设计决策

| 问题 | 答案 | 为什么 |
|------|------|--------|
| 为什么 db 用 `image`？ | PostgreSQL 是别人写好的软件 | 官方已打包镜像，直接下载即可 |
| 为什么 api 用 `build`？ | API 是你自己的代码 | 没人帮你打包，需要 Dockerfile 现场构建 |
| 为什么主机名是 `db`？ | Docker 内部 DNS | compose 服务名 = 容器间通信的域名 |
| 为什么需要 `volumes`？ | 数据持久化 | 容器删除后，卷中的数据仍然保留。没有卷 = 数据丢失 |
| 为什么需要 `healthcheck`？ | 容器启动 ≠ 数据库就绪 | PG 内部初始化比容器启动慢 2-5 秒，api 必须等 db 真正可连接 |
| 为什么挂载 `/var/lib/postgresql` 而不是 `.../data`？ | PG 18 改版 | 18+ 镜像要求挂载上级目录，数据存在版本子目录中，支持 pg_upgrade |

#### `pg_isready` 原理

```
pg_isready -U agentlab
     │         └── 用 agentlab 用户尝试 TCP 连接 + PG 握手
     └── 成功 → 退出码 0（healthy）
          失败 → 退出码 1 或 2（unhealthy）
```

- 不执行 SQL，不查表，不开事务
- 只做 TCP 连接 + PostgreSQL 协议握手
- 开销几乎为零，适合高频探测

---

### 5. `Dockerfile` — 自定义镜像构建配方

```dockerfile
# 基于最小化 Python 3.12 Linux
FROM python:3.12-slim                # 第 1 层：基础镜像

# 容器内工作目录
WORKDIR /app                         # 第 2 层：设工作目录

# 先复制依赖文件，利用 Docker 层缓存
COPY pyproject.toml .                # 第 3 层：只拷依赖声明

# 安装依赖（不装 dev 组，减体积）
RUN pip install --no-cache-dir .     # 第 4 层：装依赖

# 再复制全部代码
COPY . .                             # 第 5 层：拷代码

# 启动 FastAPI
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

#### 为什么分两步 COPY？

```
改代码但不改依赖：
  第 3-4 层（依赖文件）没变 → Docker 命中缓存，跳过 pip install ✅
  第 5 层（代码）变了 → 只重新 COPY 代码，秒级完成

改依赖时：
  第 3 层变了 → 缓存失效，pip install 重跑（应该的，依赖确实变了）
```

```
--no-cache-dir：不保存 pip 下载缓存，减小最终镜像体积
CMD vs RUN：  CMD 是"容器启动时执行"，RUN 是"构建镜像时执行"
```

---

### 6. Dockerfile 与 compose.yaml 的关系

```
compose.yaml                    Dockerfile
────────────                    ──────────
定义"要几个容器"                 定义"api 容器长什么样"
定义"容器怎么通信"               定义"api 运行需要什么环境"
定义"端口、卷、环境变量"          定义"api 如何安装和启动"

api:                             FROM python:3.12-slim
  build: .  ──────────────→      WORKDIR /app
  ports:                         COPY pyproject.toml .
    - "8000:8000"                RUN pip install ...
                                 COPY . .
                                 CMD ["uvicorn", ...]
```

**一句话**：`compose.yaml` 是总指挥，`Dockerfile` 只负责 api 这一个服务的构建细节。

---

### 7. YAML 语法要点

| 规则 | 正确 | 错误 |
|------|------|------|
| 冒号后必须有空格 | `image: postgres` | `image:postgres` |
| 缩进用空格，不用 Tab | 两个空格一级 | Tab 或混用 |
| 数组用 `- ` | `- "5432:5432"` | 不加 `-` |
| 字符串可加可不加引号 | `"postgres:18-alpine"` | 含特殊字符时必须加 |

---

### 8. PostgreSQL 四大概念

```
PostgreSQL 实例 (类比：一栋楼)
├── Database: agentlab_dev  (类比：楼里一个仓库)
│   ├── Schema: public      (类比：仓库里的货架分区)
│   │   ├── Table: users    (类比：货架上的箱子)
│   │   ├── Table: agents
│   │   └── Table: conversations
│   └── Schema: audit       (另一个货架分区)
└── Role: agentlab          (类比：门禁卡，控制谁进哪个仓库)
```

| 概念 | SQL 关键字 | 你创建的 |
|------|-----------|----------|
| Role | `CREATE ROLE` / `CREATE USER` | `agentlab`（compose 环境变量自动创建） |
| Database | `CREATE DATABASE` | `agentlab_dev`（compose 环境变量自动创建） |
| Schema | `CREATE SCHEMA` | `public`（PG 默认自带） |
| Table | `CREATE TABLE` | 还没建，后面学习 |

---

## 新增接口

| 接口 | 方法 | 响应 | 状态 |
|------|------|------|------|
| `/health` | GET | `{"status": "ok"}` | ✅ 已完成 |

---

## 9. FastAPI 应用架构

### 文件职责

```
app/
├── __init__.py       # 空文件，告诉 Python "app 是一个包"
├── config.py         # 从环境变量和 .env 加载配置
├── database.py       # 创建异步引擎和 Session 工厂
└── main.py           # FastAPI 应用：lifespan、路由
```

### `app/__init__.py`

空文件。没有它，`from app.main import app` 会报错。Python 的 import 系统需要它来识别包。

### `app/config.py` — 配置管理

```python
from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    database_url: str
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")
```

| 组件 | 含义 |
|------|------|
| `BaseSettings` | Pydantic 的配置基类，自动读环境变量 |
| `database_url: str` | 自动匹配环境变量 `DATABASE_URL`（大小写不敏感） |
| `env_file=".env"` | 还会去 `.env` 文件找 |
| `extra="ignore"` | `.env` 里多出的变量不报错（不设的话 pydantic 会拒绝多余字段） |

#### 🔑 为什么单独文件？

| 反模式 | 正解 |
|--------|------|
| `DATABASE_URL = "postgresql://..."` 写死在代码里 | 从环境变量读 |
| 每个文件自己 `os.getenv("DATABASE_URL")` | 一个 Settings 类，全局复用 |
| 不校验，少变量跑到一半才崩 | Pydantic 启动时校验，缺字段立即报错 |
| 测试时修改全局状态 | `Settings(database_url="...")` 直接覆盖 |

#### 🐛 今天踩的坑：`extra_forbidden`

```
pydantic_core.ValidationError: Extra inputs are not permitted
```

`.env` 里写了 `TEST_DATABASE_URL`，但 `Settings` 类只声明了 `database_url`。
解决：`extra="ignore"`（允许不认识的环境变量）。

### `app/database.py` — 数据库连接管理

```python
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from app.config import Settings

settings = Settings()

engine = create_async_engine(settings.database_url, echo=True)

AsyncSessionLocal = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
)
```

#### `create_async_engine` — 连接池

```
你的代码
   ↓
engine ──► 连接池（维持 ~5 个常连接，复用）
   │
   └── 不用每次 SQL 都重新建 TCP 连接
```

| 参数 | 含义 | 注意事项 |
|------|------|----------|
| `echo=True` | 打印每条 SQL 到控制台 | 开发用，生产必须关 |

#### `async_sessionmaker` — Session 工厂

| 参数 | 含义 |
|------|------|
| `engine` | 从这个引擎拿连接 |
| `class_=AsyncSession` | 生产出来的 Session 是异步版 |
| `expire_on_commit=False` | commit 后对象属性不失效 |

#### 🔑 `expire_on_commit=False` 为什么重要？

| 默认 True | 设为 False |
|-----------|-------------|
| commit 后属性标记为"过期"，下次访问重新查数据库 | commit 后属性保留，直接用 |
| 同步代码中合理（对象生命周期长） | ✅ 异步代码：对象生命周期短，过期没意义，反而报错 |

> 💡 **面试题**：FastAPI + SQLAlchemy async 为什么设 `expire_on_commit=False`？异步请求中对象生命周期短，commit 后通常不再访问同一对象的属性。设 False 可以避免"object is expired"报错。

### `app/main.py` — FastAPI 应用入口

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

#### `lifespan` — 应用生命周期

```
启动 (startup)          运行中              关闭 (shutdown)
─────────────────      ─────────────        ────────────────
yield 之前的代码        处理请求             yield 之后的代码
engine 初始化                               await engine.dispose()
```

| 对比 | `@app.on_event("startup")` | lifespan |
|------|---------------------------|----------|
| 用法 | 旧版 FastAPI | ✅ 新版推荐 |
| 优点 | 简单 | 启动/关闭在同一函数，代码更内聚 |

#### `@app.get("/health")`

- `@app.get`：处理 HTTP GET 请求
- `"/health"`：路由路径
- `async`：异步处理函数（FastAPI 支持 async）
- 返回 dict → FastAPI 自动序列化为 JSON

#### 启动命令

```bash
uvicorn app.main:app --reload
#         │   │    └── 代码改了自动重启
#         │   └── FastAPI 实例名
#         └── 模块路径
```

| 参数 | 含义 |
|------|------|
| `app.main:app` | 模块 `app/main.py`，变量 `app` |
| `--reload` | 开发热重载，生产不要用 |

#### 🔑 面试考点：`app.main:app` 的命名规则

Dockerfile 里 `CMD ["uvicorn", "app.main:app", ...]` 中的 `app.main:app`：
- `app.main` = Python 模块路径（等价于 `app/main.py`）
- `:app` = 该模块中 FastAPI() 实例的变量名
- 必须一致，否则 uvicorn 找不到

---

### 9.1 Pydantic V2 的 `model_config` vs 旧版 `class Config`

```python
# Pydantic V2（新，推荐）
class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

# Pydantic V1（旧，本次未使用）
class Settings(BaseSettings):
    class Config:
        env_file = ".env"
```

你的 `.venv` 是 Pydantic V2，所以用 `model_config`。

---

## 新增接口

| 接口 | 方法 | 响应 | 状态 |
|------|------|------|------|
| `/health` | GET | `{"status": "ok"}` | ✅ 已完成 |

---

## 新增数据表或迁移

（本日尚未创建数据表）

---

## SQL 实验

### 实验 1：探索环境

```sql
-- 查看当前数据库
SELECT current_database();
-- 结果：agentlab_dev
-- 说明：compose.yaml 中 POSTGRES_DB 创建的

-- 查看当前用户
SELECT current_user;
-- 结果：agentlab
-- 说明：compose.yaml 中 POSTGRES_USER 创建的角色

-- 查看当前 schema
SELECT current_schema;
-- 结果：public
-- 说明：PG 默认 schema，建表不指定 schema 时落在这里
```

#### `\l` — 列出所有数据库

```
agentlab_dev  — 你的开发库 ✅
postgres      — PG 默认管理库，别往里存数据
template0     — 空白模板，不允许连接
template1     — 默认模板，CREATE DATABASE 时复制它
```

> 🔑 **面试知识点**：`CREATE DATABASE mydb` 内部执行 `COPY template1 → mydb`。如果在 template1 装了扩展（如 pgvector），之后所有新库自动拥有它。

#### `\dn` — 列出 Schema

```
public | pg_database_owner
```

`pg_database_owner` 是占位角色，代表"当前数据库所有者"。它自动拥有 public schema。

#### `\du` — 列出角色

```
agentlab | Superuser, Create role, Create DB, Replication, Bypass RLS
```

> ⚠️ `POSTGRES_USER` 默认创建超级用户！本地开发可以，生产环境必须创建受限角色给应用。

#### `SHOW search_path` — Schema 搜索顺序

```
"$user", public
```

含义：先找与用户名同名的 schema → 再找 public。这是 `current_schema` 返回 `public` 的原因。

---

### 实验 2：创建第一张表

```sql
CREATE TABLE users (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

#### 逐列解读

| 语法 | 含义 |
|------|------|
| `BIGINT` | 64 位整数，范围约 ±9 千万亿 |
| `GENERATED ALWAYS AS IDENTITY` | SQL 标准自增列，内部用 SEQUENCE 实现 |
| `GENERATED ALWAYS`（vs BY DEFAULT） | 绝不允许手动插入 id |
| `PRIMARY KEY` | `UNIQUE + NOT NULL + 自动创建 B-Tree 索引` |
| `UNIQUE` | 值不能重复，自动创建唯一索引 |
| `TIMESTAMPTZ` | 存入时转 UTC，读取时转当前时区（推荐） |
| `DEFAULT now()` | 插入时自动填入当前时间 |

> 🔑 **面试：IDENTITY vs SERIAL**？IDENTITY 是 SQL 标准，权限分离更好，推荐。SERIAL 是 PG 老语法。

#### `\d users` 输出

```
Column      | Type     | Nullable | Default
id          | bigint   | not null | generated always as identity
username    | text     | not null |
created_at  | timestamptz | not null | now()

Indexes:
  "users_pkey" PRIMARY KEY, btree (id)
  "users_username_key" UNIQUE CONSTRAINT, btree (username)
```

> 🔑 **关键认知**：每个 UNIQUE 背后都有一个 B-Tree 索引。这是索引的"写入成本"——每插入一行要同时更新主键索引和唯一索引。

---

### 实验 3：INSERT 和 UNIQUE 约束

```sql
INSERT INTO users (username) VALUES ('zhangsan');
-- 输出：INSERT 0 1（OID=0, 插入了 1 行）

SELECT * FROM users;
-- id=1, username=zhangsan, created_at=2026-07-11 06:32:34+00
-- id 和 created_at 都是数据库自动填入的

INSERT INTO users (username) VALUES ('zhangsan');
-- ERROR: duplicate key value violates unique constraint "users_username_key"
-- DETAIL: Key (username)=(zhangsan) already exists.
```

> 🔑 **UNIQUE 约束是数据库级防线**，应用代码绕不过去。不能只靠应用层先查再插——并发时两条请求同时查、同时认为不存在、同时插，数据库约束是最后的正确性保证。

---

### 实验 4：ON CONFLICT（UPSERT）

```sql
-- DO NOTHING：冲突时什么都不做
INSERT INTO users (username) VALUES ('zhangsan')
ON CONFLICT (username) DO NOTHING;
-- 输出：INSERT 0 0（0 行插入，不报错）

-- DO UPDATE + RETURNING：冲突时更新
INSERT INTO users (username) VALUES ('zhangsan')
ON CONFLICT (username) DO UPDATE SET created_at = now()
RETURNING *;
-- 输出：id=1, username=zhangsan, created_at=<新时间>
-- id 没变 → 更新了原行，没有插入新行
-- RETURNING * 免去额外 SELECT
```

---

### 实验 5：序列号"被吃"问题 ⭐

```sql
SELECT currval('users_id_seq');  -- 5

INSERT INTO users (username) VALUES ('zhangsan')
ON CONFLICT (username) DO NOTHING;
-- INSERT 0 0（冲突了）

SELECT currval('users_id_seq');  -- 6（不是 5！）
```

**原因**：`nextval()` 在冲突检查**之前**执行。

```
INSERT 执行流程：
1. nextval('users_id_seq') → 拿到 6       ← 序列已经前进
2. 检查 UNIQUE 约束 → 冲突 ❌
3. DO NOTHING → 丢弃 id=6
4. 序列不回退（设计选择，不是 bug）
```

> 🔑 **面试重点 — 为什么 PG 不回退序列？**
>
> | 如果回退 | 如果不回退 |
> |----------|-----------|
> | 并发插入时，序列要等所有 INSERT 完成才能确定下一个值 | 序列无锁、无等待，性能极高 |
> | 慢 | 快 |
>
> PG 选择：**性能优先，接受间隙**。BIGINT 有 90 亿亿个值，跳几个没关系。
>
> **MySQL 对比**：InnoDB 的 AUTO_INCREMENT 同样不回退。但 MySQL 8.0 之前序列值不持久化（重启重置为 MAX(id)+1），PG SEQUENCE 是持久化的。

---

### 实验 6：检查角色权限

```sql
SELECT rolname, rolsuper, rolcreatedb
FROM pg_roles WHERE rolname = current_user;
-- agentlab | t | t（是超级用户，能创建数据库）
```

---

## 今天掌握的八股题（完整版）

### 1. Docker 镜像和容器的区别？
镜像是只读模板（类比安装盘），容器是运行实例（类比运行的系统）。删容器不删镜像，删镜像不删正在用的容器。

### 2. Docker Compose 是什么？
用 YAML 定义和运行多容器应用的工具，一条 `docker compose up` 启动所有服务。服务名 = 容器间 DNS 域名。

### 3. Dockerfile 和 compose.yaml 的关系？
Dockerfile 定义单个镜像的构建配方，compose.yaml 编排多个容器的运行方式。compose 里 `build: .` 就是在调用 Dockerfile。

### 4. healthcheck 为什么需要？pg_isready 是什么？
容器启动 ≠ 服务就绪。`depends_on` 只检查容器是否启动，healthcheck 等到真正可连接。`pg_isready` 只做 TCP 连接 + PG 握手，不执行 SQL，开销几乎为零。

### 5. volumes 的作用？
数据持久化。容器删除后数据保留。没有 volumes = 容器删了数据就没了。

### 6. PostgreSQL 的 database / schema / table / role 分别是什么？
- **Role**：用户/角色，控制谁进哪个库（类比门禁卡）
- **Database**：独立的数据库仓库（一个 PG 实例可有多个）
- **Schema**：仓库里的货架分区（命名空间，默认有 public）
- **Table**：实际存储数据的表（类比货架上的箱子）

### 7. IDENTITY vs SERIAL 的区别？
`GENERATED ALWAYS AS IDENTITY` 是 SQL 标准，权限分离更好。`SERIAL` 是 PG 老语法。推荐前者。

### 8. ON CONFLICT DO NOTHING 会消耗序列号吗？
**会。** `nextval()` 在冲突检查之前执行，序列不回退（性能优先）。主键会有间隙是正常的。

### 9. TIMESTAMP vs TIMESTAMPTZ 该用哪个？
用 `TIMESTAMPTZ`。它存 UTC，读时自动转当前时区。`TIMESTAMP` 不管时区，容易出 bug。

### 10. PRIMARY KEY 背后有什么？
`PRIMARY KEY = UNIQUE + NOT NULL + 自动创建 B-Tree 索引`。每个 UNIQUE 也自动创建唯一索引。索引有写入成本——每 INSERT 都要更新索引。

### 11. FastAPI 中 `lifespan` 是什么？和旧版 `@app.on_event` 有什么区别？
`lifespan` 是 FastAPI 推荐的资源生命周期管理方式，用 `@asynccontextmanager` 把启动和关闭逻辑放在同一个函数里（`yield` 前后）。旧版 `on_event` 把启动和关闭拆成两个独立函数，代码分散。新版更内聚。

### 12. `create_async_engine` 的 `echo=True` 什么时候用？
**开发时**。打印每条 SQL 语句，方便看 ORM 实际生成的 SQL。**生产必须关**——每条 SQL 多一行日志，性能受影响，安全上有泄露 SQL 的风险。

### 13. Pydantic Settings 的 `extra="ignore"` 做什么？
`.env` 文件或环境变量里有多余的变量时（比如 `TEST_DATABASE_URL`），不报错。设 `extra="forbid"`（默认）会拒绝未声明的字段。设 `extra="ignore"` 会静默跳过。

### 14. `uvicorn app.main:app` 中冒号前后是什么意思？
`app.main` = Python 模块路径 `app/main.py`；`app` = 该模块中 `FastAPI()` 实例的变量名。两边必须和实际文件/变量名一致。

---

## 遇到的问题

| 问题 | 我如何解决 |
|------|-----------|
| TOML 的 `[]` 被解析为节头 | 包名含 `[extra]` 时必须加引号：`"psycopg[binary]"` |
| `version=0.1.0` 不加引号 | TOML 解析为浮点数，版本号必须加引号 `"0.1.0"` |
| YAML 冒号后忘记空格 | YAML 硬性规则，`key: value` 不是 `key:value` |
| `images` / `posts` / `heathcheck` 拼写 | Docker Compose 有固定关键字，不能拼错 |
| Dockerfile 行内注释 | Dockerfile 注释必须独占一行 |
| `pip install -e .` 构建失败 | `-e` 需要完整源码目录，用 `pip install .` 安装依赖 |
| 卷路径写 `...` 占位符 | 必须写真实路径 `/var/lib/postgresql/data` |
| Windows 端口 5432/5433 被拦截 | `netsh` 查看排除端口；换高位端口 `15432` + `127.0.0.1` 绑定；重启 Docker Desktop |
| PG 18 数据目录不兼容 | `/var/lib/postgresql/data` → `/var/lib/postgresql`（PG 18+ 要求挂载上级目录以支持 pg_upgrade） |
| 开发阶段 Docker build 太慢 | PostgreSQL 用 Docker，FastAPI 用本地 uv/venv，混合模式开发 |

---

## 新增数据表

| 表 | 关键列 | 备注 |
|----|-----|------|
| `users` | `id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY`, `username TEXT NOT NULL UNIQUE`, `created_at TIMESTAMPTZ NOT NULL DEFAULT now()` | psql 实验中手动 SQL 创建 |

---

## 仍不理解的内容

- [ ] `async_sessionmaker` vs `AsyncSession` 的生命周期区别（后面实践加深）
- [ ] `lifespan` 中 `engine.dispose()` 的必要性（等做集成测试时验证）
- [ ] `.env` 优先级：环境变量 vs `.env` 文件（后面做实验）

---

## 📖 重点专题：`async`/`await` 和 `yield`

### `async` / `await` — 餐厅服务员类比

```
同步（没有 async）：
服务员站在桌边等菜做好 → 等 5 分钟什么都不干 → 端上去 → 才去服务下一桌
→ 一个线程一次只能做一件事，200 个请求 = 200 个线程

异步（async）：
服务员："12 号桌宫保鸡丁" → 不等，立刻去服务下一桌
厨师做好喊一声"12 号好了" → 服务员端过去
→ 一个线程同时处理几百个请求
```

**只有"等"才有异步的价值**：

| 场景 | 线程在干什么 | async 有意义？ |
|------|-------------|---------------|
| CPU 计算（算圆周率） | 真在干活 | ❌ 没意义 |
| 等数据库返回 | 干等 | ✅ 有意义 |
| 等 HTTP 响应 | 干等 | ✅ 有意义 |

### 深入理解：事件循环 vs 线程池（"两个工人体系"）

FastAPI 启动后，只有**一条主线程**。主线程上跑着"事件循环"。但 `def` 的请求不能被事件循环处理——它在一条主线程上，请求之间靠 `await` 主动让路，`def` 里没有 `await`，里面要是写着 `time.sleep(10)`，主线程就卡死了。

所以 FastAPI 有两套处理机制：

```
请求进来
    │
    ├─ async def? ──→ 主线程（事件循环）
    │                  一个人来回切，await = 主动让路
    │                  优点：一个线程处理几千并发
    │                  风险：不要在 async def 里写 time.sleep()
    │
    └─ def? ──→ 扔给线程池（另外 40 个小弟线程）
                  OS 自动在线程间切换
                  优点：卡的是外援线程，主线程完全不受影响
                  限制：线程池满了（40个）就排队
```

#### 事件循环：一个人干很多活

```
事件循环（就一个人，在主线程上）：

请求A：await session.execute() → "你去查数据库，我先处理别人的"
                                （让出控制权）
请求B：await session.execute() → "你也去查"
请求C：return {"ok"}           → 直接完成
请求A 的数据库返回了            → "A 回来，继续你的"
                                （恢复执行）

一个人来回跳，谁要等就让谁先等着，先去干能立刻干的事
```

**核心**：所有 `async def` 都在**同一条主线程**上轮转。`await` 是"我先让路"的信号，不是"线程切换"。

#### 线程池：自己干不了，叫外援

```
def sync_health():
    time.sleep(10)     ← 如果这在主线程上跑，所有人等 10 秒
    return "ok"

FastAPI 看了一眼："你不是 async def，里面没有 await，不能让你上主线程"
"送你去线程池！"

线程池：
┌──────┐ ┌──────┐ ┌──────┐ ... 40 个线程
│线程1  │ │线程2  │ │线程3  │
│请求A  │ │请求B  │ │空闲   │
│time.  │ │读文件 │ │       │
│sleep  │ │      │ │       │
└──────┘ └──────┘ └──────┘
    │        │
   卡住了   卡住了  ← 卡住的是外援线程，主线程毫发无伤
```

**核心**：`def` 请求不在主线程上跑。主线程把它交给线程池，自己继续接待新请求。

#### 对比表

| | `async def` | `def` |
|------|-------------|-------|
| 跑在哪 | **事件循环**（主线程） | **外部线程池**（40 个小弟线程） |
| 切换方式 | `await` 主动让路 | OS 抢占式切换 |
| 并发上限 | 几千到上万个并发连接 | 线程池大小（默认 40） |
| 阻塞调用 | ❌ 卡死主线程 | ⚠️ 卡小弟线程，不卡主线程 |
| 适用场景 | 数据库查询、HTTP 调用等 I/O 等待 | CPU 密集计算、调用同步库 |

### 🔑 面试标准答案

**Q: FastAPI 的 `async def` 和 `def` 有什么区别？**

1. `async def` 跑在**事件循环**里，靠 `await` 主动让出控制权给其他请求。适合 I/O 密集（数据库、HTTP 调用），一个线程可处理上万个并发连接。但如果内部写了同步阻塞调用（如 `time.sleep`），会**卡死整个事件循环**。
2. `def` 被 Starlette 自动提交到**外部线程池**（`run_in_threadpool`）执行。即使函数里有 `time.sleep(10)`，卡住的也是线程池里的小弟线程，主线程的事件循环完全不受影响。并发上限取决于线程池大小，默认约 40。
3. 声明了 `async def` 但内部一个 `await` 都没有 → 多余开销。函数通过事件循环同步跑完，凭空多一层协程包装。

### 一句话记住

> `async def` = 主线程上协作轮转（`await` 让路），`def` = 扔给外援线程池（不堵主线程）。两个都不会让服务崩溃。

### `yield` — 暂停而非结束

| `return` | `yield` |
|----------|---------|
| 函数结束，后面代码永不执行 | 函数暂停，之后可恢复 |
| `def x(): return 1; print("没了")` → "没了" 永远不执行 | `def x(): yield 1; print("继续")` → "继续" 下次执行 |

### `yield` 在 lifespan 中怎么工作

```python
@asynccontextmanager
async def lifespan(app: FastAPI):
    # ← 上半：FastAPI 启动时执行
    yield               # ← 暂停！应用开始运行
    # ← 下半：FastAPI 关闭时执行
    await engine.dispose()
```

```
时间线：
启动 → 执行 yield 之前 → yield（应用运行中...）
                              ↓ Ctrl+C
                         yield 之后继续执行
                         await engine.dispose()
```

`yield` 把函数劈成两半：上半 = startup，下半 = shutdown。

---

## 明日任务

- Step 5：给 `/health` 加上数据库连通性检查
- Step 6：Day 1 总结、面试题复习、Git 提交
- 预习：第二周 SQLAlchemy ORM 模型定义
