---
title: "Day 13：从 API 到 Worker 的阶段复盘"
pubDate: 2026-07-21
description: "暂停功能扩张，沿 AgentLab 真实链路复盘 Day 1-12：FastAPI 分层、SQLAlchemy、Alembic、事务与 MVCC、PostgreSQL 队列、异步 Worker、ToolCall 幂等和模型 Adapter。"
type: 项目复盘
tags: ["FastAPI", "PostgreSQL", "SQLAlchemy", "并发", "Worker", "阶段复盘"]
featured: false
series: fastapi-postgres-learning
seriesOrder: 13
---

## 前言

Day 12 结束后，原计划直接实现 `persist_model_tool_requests(...)`。但这个功能同时依赖事务边界、Run 状态机、RunStep 顺序、ToolCall 幂等和外部副作用等知识，如果前置理解不牢，继续堆代码只会把不确定性带进核心链路。

因此 Day 13 主动暂停新功能，沿 AgentLab 已有代码按 Day 1-12 的顺序完成一次系统复盘。89 个复习节点覆盖 API 分层、SQL/ORM、迁移、事务隔离、MVCC、队列索引、Worker 生命周期、工具安全和 Provider Adapter；每个节点都记录了回答、纠正、工程边界与下一步。原功能并未取消，而是在复盘完成后顺延到下一学习日。

---

## 今日主题

Day 1-12 阶段复习：以 AgentLab 已有代码串联 FastAPI、SQL、SQLAlchemy、Alembic、事务、MVCC、PostgreSQL 队列、异步 Worker、可靠性和模型 Adapter。

## 今日进度

```text
[x] Day 1：Docker、PostgreSQL 基础、/health、配置与生命周期
[x] Day 2：Psycopg、参数化 SQL、约束、JOIN、CRUD
[x] Day 3：SQLAlchemy Core、CTE、窗口函数、工程错误处理与测试（口述复习完成）
[x] Day 4：ORM、Identity Map、Relationship、Session 生命周期
[x] Day 5：Alembic、迁移链、upgrade/downgrade
[x] Day 6：事务、隔离级别、锁与并发控制
[x] Day 7-8：MVCC、死元组、VACUUM、队列领取与索引
[x] Day 9-12：Worker、ToolCall、模型 Adapter 与可靠性
[x] Markdown 增量记录
[x] Git 收尾
```

## Task Log

### Task 13.1: Day 13 功能任务延期

- Status: deferred
- Scope: 原计划的 `persist_model_tool_requests(...)` 主动顺延，不在本次学习日实现。
- Out of scope: Day 13 生产代码、集成测试和迁移。
- Acceptance criteria: 完成 Day 1-12 复习并记录薄弱点后，才能恢复该任务。
- Evidence: 学习者于 2026-07-21 主动要求暂停新知识，先复习 Day 13 前内容。
- Next task: Task 13.R1，FastAPI / HTTP / API 分层复习。

### Task 13.R1: FastAPI / HTTP / API 分层复习

- Status: completed
- Scope: 用 `app/main.py`、`app/api/`、`app/schemas/` 和 `app/services/` 复盘请求生命周期、输入校验、路由职责和 Service 事务边界。
- Out of scope: 新增 API、认证、CORS、分页或修改现有 Router。
- Acceptance criteria: 能说明一个请求从 HTTP 到 PostgreSQL 再返回响应的路径，并正确区分 Router、Schema、Service、Repository、ORM Model 的职责。
- Evidence: Day 1-12 已实现 `/health`、Agent、Conversation、Run 等 API 与分层目录。
- Evidence: 学习者能够说明 Router、Schema、Service、Repository、ORM Model 的基本职责；能够解释 `async_engine`、`sync_engine`、事件循环和 `lifespan` 资源释放。
- Next task: Task 13.R2，按 Day 1 内容复习 Docker、PostgreSQL 基础和 FastAPI 启动链路。

### Task 13.R2: 按 Day 顺序复习基础链路

- Status: completed
- Scope: 严格复习 Day 1 的 Docker、PostgreSQL database/schema/table/role、约束、`/health` 和应用启动；再进入 Day 2。
- Out of scope: Day 2 之前不提前讲 JOIN、Core、ORM 或并发锁。
- Acceptance criteria: 能按 Day 1 的代码和实验顺序解释容器、数据库连接、表约束和健康检查。
- Evidence: 已完成 Day 1-4 的分层、async/sync、AsyncSession、flush/commit 概念复习；这些内容会在对应 Day 重新验收，不作为跳过前置 Day 的理由。
- Evidence: 已完成 Docker Image / Container / Compose、PostgreSQL 对象层级、约束、`pg_isready` 和 FastAPI lifespan 的口述复习。
- Next task: Task 13.R3，Day 2 Psycopg 与参数化 SQL。

### Task 13.R3: Day 2 Psycopg 与关系型数据复习

- Status: completed
- Scope: 参数化 SQL、SQL 注入、`RETURNING`、上下文管理器、外键与 JOIN。
- Out of scope: SQLAlchemy Core、ORM 和 Alembic。
- Acceptance criteria: 能解释参数化查询的安全机制，并区分 INNER JOIN 和 LEFT JOIN。
- Evidence: 已复习参数化 SQL、`RETURNING`、上下文管理器、JOIN、外键、外键索引与 ON DELETE 语义。
- Next task: Task 13.R4，Day 3 SQLAlchemy Core、CTE 与窗口函数。

### Task 13.R4: Day 3 SQLAlchemy Core 与查询表达复习

- Status: completed
- Scope: SQLAlchemy Core 的 Engine / Connection / `text()` 参数化、CTE、窗口函数与查询结果。
- Out of scope: ORM Model、Session Identity Map 和 Alembic。
- Acceptance criteria: 能区分 Psycopg 与 Core 的参数风格，说明 Engine 与 Connection 的职责，并解释一个窗口函数的实际用途。
- Evidence: 已复习 Engine / Connection、Core 参数化、CTE、窗口函数、Core 事务边界、PostgreSQL 集成测试隔离、外键失败映射与 API 失败测试断言。
- Next task: Task 13.R5，Day 4 ORM、Identity Map 与 Session 生命周期。

### Task 13.R5: Day 4 ORM 与 Session 复习

- Status: completed
- Scope: ORM Model、Session、Identity Map、relationship、异步 Session 生命周期及 AgentLab 查询边界。
- Out of scope: Alembic 迁移和 Day 6 事务隔离实验。
- Acceptance criteria: 能说明 Session 为什么不能跨并发任务共享，何时会产生 N+1，以及如何在 AgentLab API 中避免将 ORM 对象泄漏出 Session 生命周期。
- Evidence: 已复习 ORM 与数据库约束、Identity Map、N+1、lazy loading、AsyncSession 并发所有权、commit 后属性过期、`refresh`、`flush`、Service 事务所有权、relationship 删除边界和 Core/ORM 选择。
- Next task: Task 13.R6，Day 5 Alembic 迁移链与安全演进。

### Task 13.R6: Day 5 Alembic 迁移复习

- Status: completed
- Scope: revision 链、`upgrade` / `downgrade`、autogenerate 审查和已有数据的安全 schema 演进。
- Out of scope: 新增生产表、执行真实迁移或修改既有 revision。
- Acceptance criteria: 能说明 `create_all()` 的边界，并为已有数据表的字段变更选择安全迁移步骤。
- Evidence: Day 5 原始笔记和 `migrations/versions/` 中的 migration 链已读取。
- Next task: Task 13.R7，Day 6 事务、隔离级别与并发控制。

### Task 13.R7: Day 6 事务与并发复习

- Status: completed
- Scope: 丢失更新、行锁、`SKIP LOCKED`、短事务、Read Committed、Repeatable Read、Serializable、写偏差、部分唯一索引与死锁。
- Out of scope: Day 7 MVCC 的 tuple/xmin/xmax 与 VACUUM 内部机制。
- Acceptance criteria: 能按 AgentLab 场景选择约束、条件更新、行锁或隔离级别，并解释 Worker 领取和死锁重试的事务边界。
- Evidence: 已完成相关口述复习；本轮未运行双会话并发实验。
- Next task: Task 13.R8，Day 7 MVCC、死元组与 VACUUM。

## 复习路线

```text
HTTP 请求和 FastAPI 边界
        -> SQL / ORM / Migration 数据访问链
        -> 事务 / MVCC / 锁 / 索引的一致性机制
        -> PostgreSQL 队列与异步 Worker 生命周期
        -> ToolCall、模型 Adapter、幂等和外部副作用边界
```

每段按“代码定位 -> 场景 -> 原理 -> 高频面试题 -> 你的口述答案”进行；回答不完整时只补当前知识点，不提前进入 Day 13 功能。

学习偏好更新：后续仍按 Day 顺序，但问题优先使用 AgentLab 的真实 API、数据库、Worker、失败路径、并发风险和运维决策；避免脱离项目的纯概念提问。

持久规则：已将该偏好写入 `agentlab-learning` Skill 的 `Agent Engineering Review Mode`。复习问题必须先给出 AgentLab 工程场景，再讨论机制、生产风险、较安全设计、剩余边界与相关热门面试追问。

基础知识规则：不假设学习者已掌握后端基础。每个 AgentLab 工程场景先补齐当前需要的 HTTP、Python、async I/O、SQL、数据建模、事务、测试、安全或运维基础，再进行工程判断；热门面试题用于场景理解后的复测。

## 按 Day 顺序的复习进度

```text
[x] Day 1：Docker、PostgreSQL 基础、/health、配置与生命周期
[x] Day 2：Psycopg、参数化 SQL、约束、JOIN、CRUD
[x] Day 3：SQLAlchemy Core、CTE、窗口函数、执行连接
[x] Day 4：ORM、Identity Map、Relationship、Session 生命周期
[x] Day 5：Alembic、迁移链、upgrade/downgrade
[x] Day 6：事务、隔离级别、锁与双会话实验
[x] Day 7：MVCC、死元组、死锁、VACUUM
[x] Day 8：SKIP LOCKED、队列领取、状态机和索引
[x] Day 9：重试、stale 恢复、heartbeat
[x] Day 10：Worker 生命周期、取消和优雅关闭
[x] Day 11：ToolCall、幂等、Recovery、工具安全
[x] Day 12：模型 Adapter、Provider Registry、Runner 接线
```

## 复习记录

### Review 13.1: 分层与异步基础

- 学习者回答：Router 处理 HTTP；Schema 校验和定义；Service 负责业务；Repository 封装查询；ORM Model 描述表；同步调用会占住执行资源。
- 纠正与补充：Service 还拥有用例事务和状态机；Repository 通常不提交事务；Schema 是 API 契约，Model 是数据库映射；同步 I/O 在 async 路由中会阻塞事件循环；`AsyncSession` 不能被并发 Task 共享。
- 已掌握：`flush` 会执行 SQL 但仍可回滚；`commit` 最终提交并使修改对其他事务可见；flush 失败后事务必须 rollback。
- 薄弱点：需要按 Day 1-12 原顺序重新验证，不能只按概念跳跃复习。
- 下一步：Day 1 Docker、PostgreSQL 基础和 `/health`。

### Review 13.2: Day 1 Docker 基础

- 学习者回答：Image 是静态镜像；Container 是运行中的容器；Docker Compose 编排多个容器服务；FastAPI 是自己编写的，PostgreSQL 使用别人的。
- 判断：前三项正确。
- 纠正与补充：FastAPI 和 PostgreSQL 都是已有的软件/镜像。AgentLab 自己编写的是 FastAPI 应用代码和 `Dockerfile`；`compose.yaml` 中 PostgreSQL 使用官方 `postgres:18-alpine` Image。Image 是不可变模板，Container 是由 Image 创建的运行实例；Docker Compose 根据一个 YAML 文件统一定义、启动和连接服务。
- 代码证据：`compose.yaml` 定义了 `db` 服务、`postgres:18-alpine`、`pgdata` 命名卷、端口映射与 `pg_isready` 健康检查。
- 下一步：Day 1 PostgreSQL 的 database、schema、table、role 四层概念。

### Review 13.3: Day 1 PostgreSQL 对象层级

- 学习者回答：database 负责连接数据库；schema 负责校验数据；table 是表；role 管理角色。
- 纠正与补充：database 是独立的数据库容器，不负责“连接”；schema 是数据库内的命名空间，用于组织表、视图、函数，例如默认 `public`，不负责校验；table 才是行和列构成的数据表；role 是登录身份和权限主体，可以拥有对象或被授予权限。
- 易混淆点：PostgreSQL `schema` 与 FastAPI/Pydantic Schema 不是同一概念。前者组织数据库对象，后者定义 API 数据契约和校验。
- 正确层级：PostgreSQL 实例 -> database -> schema -> table；role 独立存在，通过权限控制访问这些对象。
- 下一步：Day 1 约束与数据完整性。

### Review 13.4: Day 1 约束与数据完整性

- 学习者回答：能识别 `PRIMARY KEY`、`UNIQUE`、`NOT NULL`、`FOREIGN KEY` 名称，选择跳过举例。
- 状态：partially completed。
- 补充：PRIMARY KEY 唯一标识一行且不可为 NULL；UNIQUE 阻止重复值；NOT NULL 阻止缺失必填值；FOREIGN KEY 阻止引用不存在的父记录，维持引用完整性。约束由数据库强制，是应用校验的最后防线。
- 薄弱点：尚未口述每种约束防止的具体数据错误；后续 Day 2 关系建模时再次验收。
- 下一步：Day 1 `healthcheck`、`pg_isready` 与 FastAPI lifespan。

### Review 13.5: Day 1 健康检查

- 学习者回答：检查数据库容器是否正常运行。
- 判断：方向正确。
- 纠正与补充：容器进程存在只说明进程启动；`pg_isready -U agentlab` 更进一步检查 PostgreSQL 是否已就绪并能接受客户端连接。数据库初始化、恢复或认证配置异常时，容器可能仍是 running，但服务尚不可用。
- 代码证据：`compose.yaml` 为 `db` 配置 `healthcheck`，每 5 秒运行 `pg_isready`，最多重试 5 次。
- 下一步：Day 1 FastAPI lifespan 的启动和关闭边界。

### Review 13.6: Day 1 FastAPI 生命周期

- 学习者回答：`yield` 前是开启过程，后是生命周期结束过程，需要关闭数据库连接。
- 判断：正确。
- 补充：`yield` 前执行应用启动逻辑；`yield` 后只在应用关闭时执行。`async_engine.dispose()` 释放的是连接池及其中空闲/已归还的数据库连接，避免应用退出后资源未清理。
- 代码证据：`app/main.py` 的 `lifespan()` 在 `yield` 后调用 `await async_engine.dispose()`。
- Day 1 结论：Docker、PostgreSQL 基础、健康检查和 FastAPI 生命周期已完成口述复习；约束的具体错误场景留作 Day 2 再验收。
- 下一步：Day 2 参数化 SQL 与 SQL 注入。

### Review 13.7: Day 2 参数化 SQL

- 学习者回答：字符串拼接有 SQL 注入风险；Psycopg 会把输入当作字符而不是 SQL。
- 判断：正确。
- 补充：`%s` 是参数占位符，不是 Python 字符串格式化。Psycopg 将 SQL 语句结构与参数值分开发送/绑定，攻击者输入只能作为值，不能改变 WHERE、OR、DROP 等 SQL 语法结构。
- 安全边界：参数占位符不能安全替代表名、列名、ORDER BY 方向等 SQL 标识符或语法片段；动态标识符必须使用白名单或 Psycopg 的 SQL 组合 API。
- 下一步：Day 2 `INSERT ... RETURNING` 的用途与事务边界。

### Review 13.8: Day 2 INSERT ... RETURNING

- 学习者回答：插入后能获取数据，避免再 SELECT 一次的资源消耗。
- 判断：正确，需区分 INSERT 与 UPDATE。
- 补充：`INSERT ... RETURNING id` 在同一条 SQL 中插入并返回数据库实际生成的值，例如 identity id、server default、触发器修改后的值。它减少一次网络往返；更重要的是避免第二条查询依赖不唯一条件、排序或猜测序列值而取错并发写入的数据。
- 下一步：Day 2 关系型建模与 JOIN。

### Review 13.9: Day 2 JOIN（待通过示例巩固）

- 学习者反馈：尚未理解 INNER JOIN 与 LEFT JOIN，要求通俗解释。
- 讲解重点：JOIN 的核心不是“连接方式名称”，而是先决定哪一侧的记录必须保留；查询所有 Agent 时，Agent 位于 LEFT JOIN 左侧。聚合 Conversation 数量必须使用 `COUNT(c.id)`，不能使用 `COUNT(*)`。
- 下一步：用 AgentLab 的 agents / conversations 小数据集完成口述判断。

### Review 13.10: Day 2 JOIN 示例讲解

- 已讲解：INNER JOIN 只保留两侧能匹配的记录；LEFT JOIN 保留左表所有记录，未匹配右表字段为 NULL。
- 已讲解：查询全部 Agent 及 Conversation 数量时，应使用 `agents LEFT JOIN conversations` 和 `COUNT(conversations.id)`；`COUNT(*)` 会把 LEFT JOIN 补出的 NULL 行错误计为 1。
- 学习者反馈：已理解。
- 状态：待口述确认。
- 下一步：判断“只查询至少有一条 Conversation 的 Agent”使用 INNER JOIN 还是 LEFT JOIN。

### Review 13.11: Day 2 JOIN 口述判断

- 题目：只查询至少有一条 Conversation 的 Agent，应使用 INNER JOIN 还是 LEFT JOIN？
- 学习者回答：LEFT JOIN。
- 纠正：应使用 INNER JOIN。因为题目要求排除没有 Conversation 的 Agent，只有两表能匹配的 Agent 才保留。LEFT JOIN 会保留所有左表 Agent，包括没有 Conversation 的记录。
- 记忆规则：不是看“有几条”，而是看“没有右表匹配时左表记录是否必须保留”；必须保留时才使用 LEFT JOIN。
- 状态：需要在 Day 2 收尾复测 JOIN。
- 下一步：Day 2 外键与 INNER/LEFT JOIN 的关系。

### Review 13.12: Day 2 JOIN 复测

- 题目：查询所有 Agent，包括没有 Conversation 的 Agent，使用哪个 JOIN？
- 学习者回答：LEFT JOIN。
- 判断：正确。
- 补充：LEFT 指 JOIN 左边的表，而不是左边的列。左表应放必须完整保留的实体，本题是 `agents`。
- 状态：JOIN 的保留规则已掌握；Day 2 收尾可再用聚合题复测 `COUNT(c.id)`。
- 下一步：Day 2 Psycopg 上下文管理器与资源清理。

### Review 13.13: Day 2 Psycopg 上下文管理器

- 学习者回答：防止资源泄漏，异常时自动回滚。
- 判断：正确。
- 补充：`with` 在正常路径完成提交，在异常路径回滚事务；连接和 cursor 在离开上下文时被清理或归还连接池，避免连接、cursor 或未完成事务泄漏。它提升可靠性，但不能替代参数化 SQL、权限控制等安全措施。
- 下一步：Day 2 外键与索引。

### Review 13.14: Day 2 外键索引

- 题目：PostgreSQL FOREIGN KEY 是否自动创建索引？
- 学习者回答：自动创建，但仍需要考虑手动建索引。
- 纠正：PostgreSQL 只会为 PRIMARY KEY 和 UNIQUE 约束自动创建唯一 B-Tree 索引；FOREIGN KEY 引用列不会自动创建索引。
- 原因：外键约束保证引用完整性，索引服务于查询和 JOIN 性能，这是两个独立问题。若频繁按 `conversations.agent_id` 过滤、JOIN，或删除/更新父 Agent 时需要检查子表引用，通常应根据实际查询模式手动为该列建索引；仍需用 EXPLAIN 验证收益并考虑写入成本。
- 状态：Day 2 高频易错点，后续索引章节复测。
- 下一步：Day 2 外键完整性与删除行为。

### Review 13.15: Day 2 外键与索引职责

- 学习者回答：FOREIGN KEY 保证引用不指向不存在的父记录，不负责性能；询问为什么。
- 判断：正确。
- 解释：外键是数据正确性规则，索引是性能结构。数据库无法知道某个外键列是否会被频繁 JOIN、过滤或按父表删除；若对每个外键都自动建索引，会给不需要查询加速的表带来额外磁盘、INSERT/UPDATE/DELETE 维护成本。故 PostgreSQL 将索引选择留给实际查询模式与 EXPLAIN 证据。
- 删除父记录时：PostgreSQL 需要检查子表是否仍有引用；子表外键列索引常能加速该检查，但仍由开发者按工作负载决定。
- 下一步：Day 2 `ON DELETE` 行为。

### Review 13.16: Day 2 ON DELETE 行为

- 题目：删除仍被 Conversation 引用的 Agent 时，默认外键行为及 `ON DELETE CASCADE` 行为。
- 学习者回答：外键指向空。
- 纠正：默认通常为 `NO ACTION` / `RESTRICT`，数据库拒绝删除父 Agent，避免产生悬空 Conversation。`ON DELETE CASCADE` 会在同一事务中删除关联子记录；`ON DELETE SET NULL` 才会将子表外键设为 NULL，且该列必须允许 NULL。
- 风险边界：CASCADE 适合“子记录没有独立业务意义”的所有权关系；删除用户、账单、审计等重要记录时必须谨慎，不能把 CASCADE 当作默认选择。
- 下一步：Day 2 关系建模复测并收尾。

### Review 13.17: Day 2 关系删除策略

- 学习者选择：Conversation 随 Agent 删除，使用 `ON DELETE CASCADE`。
- 判断：在“Conversation 仅属于 Agent 且没有独立保留价值”的业务定义下正确。
- AgentLab 权衡：Conversation、Message 和 Run 通常带有用户历史、执行结果和审计价值，默认拒绝删除更保守；真正删除需要显式的业务流程、权限和数据保留策略，不能因为有 CASCADE 就自动级联删除。
- Day 2 结论：完成口述复习。待复测点为 INNER/LEFT JOIN 的筛选判断、外键不自动创建索引、ON DELETE 的业务选择。
- 下一步：Day 3 SQLAlchemy Core。

### Review 13.18: Day 3 Engine 与 Connection

- 学习者回答：Engine 管理连接池；Connection 是从连接池取得的一个连接。
- 判断：正确。
- 补充：Engine 还保存数据库方言和连接配置，通常在应用生命周期创建一次并复用；每次请求或操作只短暂 checkout 一个 Connection，结束后归还池。若每次操作新建 Engine，会反复创建池、浪费连接建立成本，也会更难控制连接总数。
- 下一步：Day 3 `text()` 与 Core 参数化。

### Review 13.19: Day 3 参数占位符语法

- 学习者回答：命名参数在参数较多时更容易判断含义和位置。
- 判断：正确，但不完整。
- 补充：`%s` 是 Psycopg 的 DB-API 参数占位符，Psycopg 负责解析并绑定位置参数；`:name` 是 SQLAlchemy `text()` 的绑定参数语法，SQLAlchemy Core 负责解析并编译为该驱动需要的形式，再绑定字典参数。两种占位符不是 PostgreSQL 通用 SQL 语法，跨库原样使用会无法被对应工具识别。
- 下一步：Day 3 CTE 的用途。

### Review 13.20: Day 3 CTE

- 学习者反馈：不清楚 CTE 的用途。
- 讲解要点：CTE 是 `WITH name AS (...)` 定义的、只在当前一条 SQL 中有效的“有名字的中间查询结果”。它将复杂查询分为可阅读、可单独验证的步骤，例如先计算每个 Agent 的 Conversation 数量，再筛选数量大于 1 的 Agent。
- 边界：CTE 不是持久化表；在现代 PostgreSQL 中也不必然意味着物化或更快，首要价值是组织复杂 SQL。是否物化由 PostgreSQL 版本、查询形态和 `MATERIALIZED` 指定决定。
- 下一步：通过两步查询判断 CTE 的作用。

### Review 13.21: Day 3 CTE 口述确认

- 学习者回答：CTE 是中间结果，主要解决可读性问题。
- 判断：正确。
- 补充：CTE 还便于复用中间结果、分阶段调试复杂查询，以及表达递归查询；但普通场景下首先把它当作“有名字的子查询”。
- 下一步：Day 3 窗口函数与 GROUP BY 的区别。

### Review 13.22: Day 3 GROUP BY 与窗口函数

- 学习者回答：一个会保留信息，一个不会。
- 判断：正确。
- 补充：GROUP BY 折叠同组多行，适合只需要汇总结果；窗口函数在不折叠原始行的前提下，为每行附加同组统计、排名或前后行比较结果。工程上，列表接口既要展示每条 Conversation 又要显示该 Agent 对话总数时，窗口函数更合适。
- 学习偏好：后续提问优先使用 AgentLab 的真实工程场景。
- 下一步：Day 3 Core 路由的数据库错误与 HTTP 错误契约。

### Review 13.23: Day 3 Agent 创建的外键竞态

- 场景：`POST /agents` 预先确认 User 存在后，另一个请求在 INSERT 前删除该 User。
- 学习者回答：查询不加锁，其他操作删除 User 后，A 再创建会返回 404。
- 判断：已识别 TOCTOU 竞态，正确。
- 纠正：A 的 INSERT 会被数据库 FOREIGN KEY 拒绝并抛出 IntegrityError；只有 Service/异常处理层显式映射这个已知错误后，客户端才会收到预期的 4xx（例如 404 或 409，取决于 API 契约），而不是自动得到 404。
- 工程结论：应用层预检查改善错误信息；数据库约束在并发下作为最终正确性防线；错误映射负责稳定的 HTTP 契约。
- 下一步：设计 Agent 创建用例的错误分层与测试。

### Review 13.24: Day 3 Agent 创建失败的集成测试

- 场景：客户端用不存在的 `user_id` 调用 `POST /agents`。
- 学习者反馈：不知道最关键的测试断言。
- 基础讲解：集成测试至少验证 API 合约与持久化状态两层。第一层断言响应是约定的 4xx 和稳定错误信息；第二层直接查询测试 PostgreSQL，断言没有创建任何 Agent。前者证明客户端体验，后者证明失败没有留下脏数据或半完成事务。
- 工程价值：只断言 HTTP 响应无法证明事务回滚；只查数据库又无法证明 API 契约正确。两者一起覆盖用例边界。
- 下一步：用一句话复述失败 API 测试的两类断言。

### Review 13.25: Day 3 失败 API 测试复述

- 学习者回答：还需要断言数据库信息。
- 判断：正确。
- 精确表达：断言测试数据库的最终状态符合预期，例如没有新增 Agent；不只是任意读取数据库信息。
- 已掌握：失败 API 集成测试同时验证 HTTP 合约和数据库最终状态。
- 下一步：测试数据库隔离与真实 PostgreSQL 约束。

### Review 13.26: Day 3 PostgreSQL 集成测试隔离

- 学习者回答：项目使用 PostgreSQL，因此测试也应使用它；测试与开发环境应独立。
- 判断：正确。
- 补充：测试目标应尽量匹配生产使用的 PostgreSQL，而不仅是“和开发相同”。独立 `agentlab_test` 允许安全执行 migration、TRUNCATE、回滚和失败注入，不污染开发数据。
- 工程风险：SQLite 不能证明 PostgreSQL 特有的 JSONB、`FOR UPDATE SKIP LOCKED`、行锁、隔离级别、并发事务及部分索引行为；用 SQLite 可能测试通过而真实 Worker 队列仍有缺陷。
- 下一步：Day 3 Core 路由的事务边界复测。

### Review 13.27: Day 3 Core 事务边界

- 场景：`conn.execute(INSERT ...)` 成功后、`conn.commit()` 前发生异常。
- 学习者回答：不会留下新 Agent，commit 才是让表更新的关键。
- 判断：结论正确。
- 纠正：`execute()` 已经在当前事务中执行 INSERT，当前 Connection 可以读到新 Agent；若异常路径 rollback 或 Connection 关闭时回滚，修改才不会最终持久化或对其他事务可见。`commit()` 是事务的持久化边界，不是唯一执行 SQL 的时刻。
- 下一步：创建 Agent 与初始 Conversation 的原子用例边界。

### Review 13.28: Day 3 原子用例边界

- 场景：创建 Agent 后自动创建初始 Conversation，要求不留下半完成 Agent。
- 学习者回答：是否使用一个或两个事务取决于是否允许半完成 Agent；若都不留，使用一个事务。
- 判断：正确。
- 工程结论：事务边界由业务原子性决定，而不是由“有几条 SQL”决定。此用例应由 Service 用一个事务包住两个 INSERT；任一步失败则整体 rollback。
- Day 3 结论：完成口述复习。未运行新测试；当前 API 的错误映射和事务分层仍是后续实现/重构任务，不将讨论结论误记为已上线行为。
- 下一步：Day 4 ORM 与 Session。

### Review 13.29: Day 4 ORM 与数据库约束

- 学习者回答：ORM 在数据库上一层，不能取代数据库约束。
- 判断：正确。
- 补充：ORM 负责对象映射、查询构造与变更跟踪，只约束经过当前应用代码路径的数据。FOREIGN KEY、UNIQUE、NOT NULL 等数据库约束同时覆盖 API、Worker、迁移脚本、管理脚本和并发请求，是数据完整性的最终防线。
- 工程后果：仅依赖 ORM 或 Pydantic 校验，直接 SQL、另一进程或并发竞态仍能写入脏数据；必须将业务体验校验与数据库约束一起使用。
- 下一步：Day 4 Identity Map 与 Session 查询边界。

### Review 13.30: Day 4 Identity Map

- 场景：同一 AsyncSession 两次 `session.get(Agent, 7)`。
- 学习者回答：直接返回第一次加载的对象，有缓存优化。
- 判断：正确。
- 补充：这是 Session 内的 Identity Map，而非跨请求的缓存。它保证同一主键在同一 Session 中对应同一个 Python 对象，使未 flush 的修改、关系引用和对象状态一致；Session 结束后这份映射失效。
- 下一步：Day 4 Agent 列表接口的 N+1 查询风险。

### Review 13.31: Day 4 Identity Map 基础解释

- 学习者提问：不理解“当前 Session 的 Identity Map”。
- 讲解：Session 在内存中维护一个 `(<ORM 类>, primary key) -> Python 对象` 的登记表。第一次加载 `Agent(id=7)` 后，这个 Session 记住该对象；同一 Session 再请求相同主键时通常直接返回同一个对象实例。Session 关闭后登记表消失，不是跨请求缓存。
- 工程意义：避免同一用例出现两个状态不一致的 `Agent(id=7)` Python 对象；不能用它代替数据库、Redis 或进程间缓存。
- 下一步：用 Agent 列表与 Conversation 访问说明 N+1。

### Review 13.32: Day 4 N+1 查询

- 场景：列表读取 100 个 Agent 后，在循环中访问每个 Agent 的 Conversations。
- 学习者回答：会多次查询，浪费资源。
- 判断：正确。
- 补充：典型路径是 1 条 Agent 查询加最多 100 条 Conversation 查询，即 N+1。它增加数据库往返、连接占用和请求延迟；异步 ORM 中隐式 lazy loading 还可能在不允许的 I/O 边界导致错误。
- 方案选择：页面需要完整 Conversation 列表时可显式 `selectinload`（通常两条查询）或按数据形态选择 `joinedload`；页面只需要数量时应在 SQL 中 `COUNT` / 聚合，不加载全部 Conversation 对象。
- 学习者补充：只展示每个 Agent 的 Conversation 数量时，使用 SQL `COUNT`。
- 判断：正确。让 PostgreSQL 在查询中完成聚合，避免把完整的 Conversation ORM 对象传回 Python；这能减少查询数据量、对象创建和内存占用。
- 下一步：根据页面数据需求选择加载策略。

### Review 13.33: Day 4 Session 关闭与 lazy loading

- 场景：路由查出 `Agent` 后关闭 `AsyncSession`，FastAPI 序列化响应时才读取未预加载的 `agent.conversations`。
- 学习者回答：Session 关闭后没有可用资源；问题属于 lazy loading。
- 判断：核心正确。
- 补充：已经加载到对象内存中的普通字段通常仍可读取；但未加载的 relationship 在首次访问时需要 Session 再执行一条 SQL。Session 已关闭时没有数据库通道，常会抛出 detached-instance 类错误。异步 ORM 还不应让响应序列化阶段隐式发起数据库 I/O。
- 工程方案：在 Session 存活时使用 `selectinload` 等显式预加载所需关系，或在此时转换为 Pydantic response schema / 普通数据后再返回；不要把仍依赖 Session 的 ORM 对象泄漏到响应边界外。
- 下一步：区分“一个请求一个 Session”与“多个并发任务共用一个 AsyncSession”的风险。

### Review 13.34: Day 4 AsyncSession 并发所有权

- 场景：两个并发 HTTP 请求或两个 Worker Task 共享同一个 `AsyncSession`。
- 学习者回答：会造成读写混乱；应当一个 HTTP 请求一个异步 Session。
- 判断：结论正确。
- 精确机制：`AsyncSession` 是一个可变的 Unit of Work，内部持有事务状态、Identity Map、待 flush 的对象变更和一条正在执行的数据库操作；它不是并发安全对象。两个 Task 交错执行 `execute`、`flush`、`commit` 或 `rollback` 时，可能互相提交/回滚对方的工作、污染对象状态，或直接触发 SQLAlchemy 的并发使用错误。
- 边界：数据库的行锁、约束与隔离级别仍用于处理不同 Session 之间的真实并发；“每个用例独立 Session”先保证应用进程内的事务所有权清晰。
- 工程规则：每个 HTTP 请求通过 FastAPI 依赖创建和关闭独立 `AsyncSession`；每个 Worker 的一次领取、执行或恢复用例也由自己的 Session / 事务边界管理，绝不跨并发 Task 共享。
- 下一步：理解 `commit` 后 ORM 对象为什么可能需要重新读取，以及 API 响应为什么不该依赖这种隐式刷新。

### Review 13.35: Day 4 commit 后的属性过期

- 场景：创建 Agent 并 `session.commit()` 后，访问 `agent.name` 或其他普通字段。
- 学习者回答：不知道。
- 基础讲解：SQLAlchemy 的默认配置 `expire_on_commit=True`。`commit()` 后，Session 会将已加载的 ORM 属性标记为 expired；下次读取属性时，ORM 可能自动发出 `SELECT` 来 refresh 该对象，使 Session 不把提交前的内存值误当作数据库当前值。
- 与 lazy loading 的相同点：两者都是在“访问 Python 属性”时补发 SQL，因而在异步 API 或 Session 已关闭时都可能成为隐式 I/O / detached-instance 问题。
- 不同点：lazy loading 是 relationship 从未加载，首次读关系时查询；expiration 是普通字段原本加载过，但 commit 后被标记为需要刷新。两者的触发原因不同。
- 工程选择：API 应在 Session 内明确取得所需的返回数据；新建后需要数据库生成值可显式 `refresh(agent)`。也可以为短生命周期 API Session 配置 `expire_on_commit=False`，但不能将此当作跨请求缓存或忽略并发更新的理由。
- 下一步：在创建 Agent 的响应中选择 commit 后的显式数据读取方式。

### Review 13.36: Day 4 创建后返回数据库生成字段

- 场景：创建 Agent 的响应需返回数据库生成的 `id` 和 `created_at`。
- 学习者选择：`commit()` 后显式 `refresh(agent)`。
- 判断：正确。
- 原因：`refresh(agent)` 在仍有效的 Session 中明确执行查询，将数据库最终值装回 ORM 对象；它处理 server default、触发器或提交后的属性过期，避免 FastAPI 序列化 Session 外的 ORM 对象时发生隐式 I/O 或 detached-instance 错误。
- 补充：若只需 PostgreSQL 在 INSERT 时生成的主键，`flush()` 后通常已经可取得 `agent.id`，且事务还未提交；`flush()` 不等于提交。完整响应需依赖数据库最终值时，常见流程是 `add -> flush -> commit -> refresh -> 转 response schema`。Service 决定这一事务边界，Repository 默认不自行 commit。
- 学习者确认：在 Session 生命周期内主动读取，避免响应阶段因 Session 断开而隐式查询失败。
- 判断：正确。`refresh()` 不是机械地“多查一次更好”；若 `flush()` / `INSERT ... RETURNING` 已取回所需字段，则无需额外刷新。原则是显式控制 I/O 时机，并在 Session 内将响应需要的数据准备好。
- 下一步：通过创建 Agent 和初始 Conversation 的场景复习 `flush`、`commit` 与 Service 事务所有权。

### Review 13.37: Day 4 Repository 不应自行提交

- 场景：Service 创建 Agent 和默认 Conversation，业务要求不允许存在没有默认 Conversation 的 Agent。
- 学习者回答：Agent 初始化时需要默认 Conversation，因此不能分开 `commit`。
- 判断：正确。
- 失败路径：若 `AgentRepository.create()` 先自行 commit，随后 Conversation 插入失败，Agent 已永久存在，留下半完成状态；外层 Service 无法回滚已经提交的第一个事务。
- 正确分层：Repository 执行 `add` / 查询 / `flush`，让 Service 以一个 `async with session.begin():` 事务编排 Agent 与 Conversation；任一步异常则整体 rollback，成功才统一 commit。事务边界由业务原子性决定，不由 Repository 方法数量决定。
- 边界：若产品明确允许“先创建空 Agent，稍后异步补 Conversation”，可以拆为两个用例/事务，但必须显式建模中间状态、重试与用户可见行为，不能是意外的半完成数据。
- 下一步：理解 `session.begin()` 中发生异常时，事务、连接和 ORM 对象分别如何变化。

### Review 13.38: Day 4 `session.begin()` 的异常回滚

- 场景：`async with session.begin():` 中 Agent 已 `flush()`，插入默认 Conversation 时发生异常。
- 学习者回答：事务回滚，数据库不会创建 Agent 和 Conversation。
- 判断：正确。
- 机制：`flush()` 已向 PostgreSQL 执行 Agent 的 INSERT，也可能已为其生成主键，但尚未 `commit`，其他事务通常不可见。异常离开 `session.begin()` 上下文时，SQLAlchemy 自动 `rollback` 当前事务；因此 Agent INSERT 被撤销，失败的 Conversation 也不会持久化。
- 工程边界：rollback 保证本地 PostgreSQL 数据原子性；若事务中已经调用发送邮件、支付或外部 Tool，则数据库 rollback 无法撤回外部副作用，必须另行设计幂等、Outbox 或对账。
- 下一步：理解在同一事务中为什么可能先 `flush()` Agent，再创建引用其主键的 Conversation。

### Review 13.39: Day 4 `flush()` 与新对象外键

- 场景：同一事务创建新 Agent 和引用其 `agent_id` 的 Conversation。
- 学习者回答：不 `flush` 就没有 Agent，因而不能创建 Conversation。
- 判断：核心正确，需精确化。
- 机制：`session.add(agent)` 后 Agent 已是 Session 中的 pending 对象，但数据库尚未执行 INSERT，通常也没有 PostgreSQL 生成的 `agent.id`。若代码需要手动传入 `Conversation(agent_id=agent.id)`，应先 `await session.flush()`，使 INSERT 执行并取得主键，再构造子对象；整个事务仍可继续 rollback。
- ORM 便利：若使用 `Conversation(agent=agent)` 建立 relationship，SQLAlchemy Unit of Work 通常能在最终 flush 时自动按父表先、子表后的顺序 INSERT，因此不必为了顺序机械地手动 flush。显式 flush 的价值还包括尽早暴露约束错误和取得数据库生成值。
- 下一步：通过 ToolCall 批量持久化场景复习显式 `flush` 的“尽早失败”价值。

### Review 13.40: Day 4 批量持久化时显式 flush

- 场景：Worker 在同一事务写入多个 RunStep 和 pending ToolCall；其中一个 ToolCall 违反唯一约束。
- 学习者回答：显式 flush 可以尽早知道错误，方便记录或重试。
- 判断：方向正确。
- 精确机制：`flush()` 将待写入对象的 SQL 提前发送给 PostgreSQL，因而在 Service 仍掌控事务、错误映射和日志上下文的位置暴露 UNIQUE / FOREIGN KEY / NOT NULL 等约束错误；若只等 `commit()`，错误会集中在事务末尾，定位与分支处理更不明确。它暴露的是本地持久化失败，不是外部 Tool 执行失败，也不会自动通知 Agent。
- 事务规则：发生 `IntegrityError` 后，该事务已不能继续正常使用；需要 rollback 整个原子用例，或在预计可能冲突且允许局部失败时，预先用 nested transaction / savepoint 隔离该小段。不能捕获异常后在同一失败事务中直接继续查询、写入或“重试”。
- AgentLab 后果：持久化 ToolCall 失败时，不应将 Run 标成 `waiting_tools`；应让同一事务 rollback，记录结构化故障并按既定恢复策略处理，避免 Run 指向不存在的 ToolCall。
- 下一步：判断何时应使用一个整体 rollback，何时业务上允许 savepoint 隔离单个可选写入。

### Review 13.41: Day 4 ToolCall 持久化原子性

- 场景：一个 Provider 响应中的多个 ToolCall 必须全部持久化，才允许 Run 进入 `waiting_tools`；其中一个违反唯一约束。
- 学习者选择：回滚整个事务。
- 判断：正确。
- 原因：Run 状态、RunStep 和 ToolCall 是同一个一致性整体。若跳过冲突 ToolCall 或用 savepoint 忽略错误后仍提交其余记录，Run 会宣称自己正在等待可执行工具，但其工作集并不完整，可能造成漏执行、顺序断裂和不可恢复的状态不一致。
- 边界：savepoint 适合可选的、允许独立失败的写入，例如一条不影响主用例完成的最佳努力审计指标；前提是业务状态明确表达该部分缺失。它不适用于这个全有或全无的 ToolCall 工作集。
- 下一步：区分 ORM relationship 的 cascade 与数据库外键 `ON DELETE` 的 cascade。

### Review 13.42: Day 4 ORM cascade 与数据库 `ON DELETE CASCADE`

- 场景：关系配置 `cascade="all, delete-orphan"`，是否等同于外键的 `ON DELETE CASCADE`。
- 学习者回答：不知道。
- 基础讲解：不等同。ORM cascade 是 SQLAlchemy 在当前 Python Session 操作对象图时决定要额外执行哪些 INSERT / UPDATE / DELETE；它只覆盖走该 ORM Session 的路径。数据库 `ON DELETE CASCADE` 是 PostgreSQL 外键规则，任何客户端通过 ORM、Core、Psycopg、迁移脚本或 psql 删除父记录时都会在数据库内删除匹配子记录。
- `delete-orphan` 特性：它表示子对象从父对象 relationship 集合中移除、且不再属于任何父对象时，ORM 将其视为孤儿并删除；这不是数据库外键的删除规则。
- 工程选择：二者可按需要配合，但必须明确谁负责删除和避免意外重复行为。对 AgentLab 的 Conversation、Message、Run、ToolCall 等历史/审计数据，不能仅因关系存在就默认开启任一删除级联；删除策略应由保留要求、权限和恢复能力决定。
- 下一步：以从 Agent relationship 中移除 Conversation 的场景判断是否适合 `delete-orphan`。

### Review 13.43: Day 4 Conversation 的删除策略

- 场景：代码从 `agent.conversations` 集合移除一条 Conversation。
- 学习者回答：不能自动删除，需要用户统一（确认）。
- 判断：正确。
- 工程结论：关系集合变化不应隐式销毁用户历史。删除 Conversation 必须是显式的业务用例，并执行授权、用户确认（按产品风险决定）、数据保留与审计判断；需要可恢复或留痕时可采用软删除/归档，而不是 ORM `delete-orphan` 或数据库 cascade 的静默物理删除。
- 边界：临时草稿、无独立价值且无审计要求的内部子记录可以在明确所有权下级联删除，但需由领域规则而非 ORM 默认选项决定。
- 下一步：按查询形态在 AgentLab 中选择 ORM 或 SQLAlchemy Core。

### Review 13.44: Day 4 Worker 热路径的 Core 选择

- 场景：Worker 使用 `FOR UPDATE SKIP LOCKED` 领取 Run，执行条件更新，只需要返回 `run_id` 和 `status`，不需要完整关系对象。
- 学习者回答：使用 Core，因为不需要完整 ORM 对象，Core 更快。
- 判断：选择正确；“更快”应视查询与实现而定，不是 ORM 天生一定更慢。
- 工程理由：Core 更直接表达锁定 SQL、条件更新和少量标量结果，避免不需要的 ORM 对象构建与状态跟踪。ORM 也能表达这些语义；选择依据是查询形态、可读性和是否需要对象生命周期能力，而不是教条化性能判断。
- Day 4 结论：完成口述复习。薄弱点为 commit 后属性过期、ORM cascade 与数据库 `ON DELETE` cascade 的边界，后续实现中继续复测。
- 下一步：Day 5 Alembic 迁移。

### Review 13.45: Day 5 为什么用 Alembic 而非 `create_all()`

- 场景：已有 `agent_runs` 与真实 Run 数据，需要新增 `heartbeat_at` 字段。
- 学习者回答：迁移方便管理数据库变更，能追踪新增字段，且支持降版本。
- 判断：正确。
- 补充：Alembic 将 DDL 变更保存为可审查、可排序的 revision 链，并用数据库内的 `alembic_version` 标记当前版本，使开发、测试和生产按同一条路径升级。`Base.metadata.create_all()` 主要创建缺失表，不能可靠演化已有表，也不提供版本历史、部署顺序和可验证的回滚路径。
- 下一步：评估为已有百万行 `agent_runs` 新增 `NOT NULL` 字段的迁移风险。

### Review 13.46: Day 5 已有数据表新增必填字段

- 场景：`agent_runs` 已有 100 万条记录，需要新增最终为 `NOT NULL` 的 `model_provider`。
- 学习者回答：不知道。
- 风险：直接新增无默认值的 `NOT NULL` 列时，历史行没有字段值，无法满足约束，迁移会失败。用一个不经业务验证的默认值强行通过，会把不同来源的历史 Run 错误地伪造成同一 Provider；大表 DDL 或一次性回填还可能持有锁、制造 WAL/表膨胀并阻塞线上读写。
- 安全演进（expand -> migrate -> contract）：
  1. 先添加允许 `NULL` 的列，使旧代码与旧数据都能继续工作。
  2. 部署新代码，确保新建 Run 始终写入 `model_provider`。
  3. 按主键范围分批回填历史记录；每批单独提交，控制事务时长与负载，并根据可追溯数据推导真实 Provider，无法推导时显式标记/保留异常处理策略。
  4. 查询确认 `NULL` 数量为零，并监控迁移期间的新写入。
  5. 最后单独迁移为 `NOT NULL`；对高流量大表，进一步评估锁、表扫描与 PostgreSQL 版本，必要时使用经过验证的 `CHECK ... NOT VALID` / `VALIDATE CONSTRAINT` 等低影响步骤。
- 边界：若业务确实定义了所有历史记录的同一个正确默认 Provider，可在审查后采用该默认值；默认值必须是领域事实，不能只为让 migration 通过。
- 学习者复述：生产上线时先增加字段，逐步填充，最后设置为 `NOT NULL`。
- 判断：正确。完整顺序还包含在回填前部署新代码，使后续新写入不再产生 NULL；这是一种允许旧代码、旧数据与新代码短暂兼容的 schema 演进方式。
- 下一步：理解 revision 的 `downgrade()` 在有真实数据时为何不总是安全回滚。

### Review 13.47: Day 5 `downgrade()` 的生产边界

- 场景：生产 migration 提供了 `downgrade()`，是否意味着可以随时安全回退数据库版本。
- 学习者回答：存在危险；用户已填充的数据在回滚后可能丢失。
- 判断：正确。
- 机制：回滚删除新列、表、索引或收窄类型时，可能永久删除部署后才产生的数据；无法仅靠 schema 回滚重建其业务含义。新应用代码若已经依赖新结构，先回退数据库还会造成运行时错误；多版本服务并存时也可能互不兼容。
- 工程规则：将 `downgrade()` 视为开发/测试验证和有限事故恢复工具，而非生产的默认回滚按钮。生产变更优先采用向后兼容的 expand/contract、代码 feature flag、备份与经演练的恢复方案；真正执行破坏性回滚前要确认流量、代码版本、数据保留和恢复计划。
- 下一步：审查 `alembic revision --autogenerate` 对列重命名的危险输出。

### Review 13.48: Day 5 autogenerate 与列重命名

- 场景：ORM Model 将 `model_name` 改名为 `provider_model`，运行 `alembic revision --autogenerate`。
- 学习者回答：不知道。
- 基础讲解：Alembic 比较的是旧数据库 schema 和当前 `Base.metadata`，无法可靠得知两个不同名称的列代表同一份业务数据。它常会生成“新增 `provider_model` 列”加“删除 `model_name` 列”，而不是 rename。
- 风险：直接执行这种迁移会丢失旧列的模型名称数据，或因新增列/约束与旧数据冲突而失败；在生产中还会破坏运行旧版本代码的实例。
- 正确做法：人工审查生成 migration，并明确写 PostgreSQL 的 rename（例如 `op.alter_column(..., new_column_name="provider_model")`）或采用兼容性演进：新增列、双写/回填、切读、确认后删除旧列。选哪种取决于是否需要多版本服务并存及数据迁移复杂度。
- 下一步：定义 migration 验证的最小闭环：upgrade、downgrade、再 upgrade。

### Review 13.49: Day 5 migration 升降级闭环

- 场景：验证一条新 migration：`upgrade head -> downgrade -1 -> upgrade head`。
- 学习者回答：升级不产生副作用；降级不产生副作用；最后切换到新版本。
- 判断：方向正确，需精确化。
- 三步分别证明：第一次 `upgrade head` 验证 revision 能从当前版本正确应用到目标 schema；`downgrade -1` 验证其反向 DDL 在隔离开发/测试数据库中可执行且 revision 状态正确回退；最后一次 `upgrade head` 验证回退后的数据库能再次沿同一 revision 正确前进，避免升级/降级脚本或版本表状态不一致。
- 边界：这证明 schema 演进链可运行，不证明生产数据语义无损、长表迁移无锁等待，也不授权在生产任意 downgrade；这些要用数据备份、兼容性设计、负载评估和演练补足。
- 下一步：理解多人并行开发导致 Alembic 出现多个 head 时的处理。

### Review 13.50: Day 5 多个 Alembic head

- 场景：两位开发者从同一 revision 各创建一条 migration，合并代码后出现两个 head。
- 学习者回答：数据库结构不同，退回最开始版本后再检查合并。
- 判断：已识别版本链分叉，但处理方式不正确。
- 机制：两个 head 表示 revision 图出现两个并行分支，不必然表示数据库已经不一致；常见原因是两个独立功能在不同 Git 分支各自新增 migration。退回 base 会扩大变更范围、破坏已存在数据，且不能解决版本图分叉。
- 正确处理：先人工审查两条 migration 的 DDL 是否冲突、是否有顺序依赖；若可共存，创建一个 Alembic merge revision，让它的 `down_revision` 同时指向两个 head，恢复单一共同 head。若 DDL 冲突，先修正/重写其中迁移并在隔离数据库验证，再合并。部署时按目标环境的真实 revision 状态升级，不凭猜测强制回退。
- Day 5 结论：完成 Alembic 口述复习。已掌握迁移版本化、expand/contract、新字段回填、downgrade 边界、autogenerate 审查和多 head 合并；尚未在本复习轮运行 `upgrade -> downgrade -> upgrade` 实验。
- 下一步：Day 6 事务、隔离级别与并发实验。

### Review 13.51: Day 6 同行并发修改与丢失更新

- 场景：两个请求各自拥有事务，同时读取并修改同一个 Agent 的 `temperature`。
- 学习者回答：第一个请求更新并释放 lock 后，第二个请求再更新会覆盖第一个请求。
- 判断：正确，已识别丢失更新。
- 时间线：A、B 都读取 `temperature = 0.7`；A 写入 `0.8` 并提交；B 等待 A 的行锁释放后，仍按自己先前读取的旧状态写入 `0.9` 并提交。行锁使写入顺序串行，却不会自动发现 B 的业务决定已经过期，最终 A 的修改丢失。
- 方案选择：配置编辑这类冲突通常使用乐观锁（请求携带 `version`，条件 UPDATE 仅在版本匹配时成功；失败返回冲突并提示刷新）；需要在读取后执行必须基于最新状态的短临界区决策时，可用 `SELECT ... FOR UPDATE` 悲观锁；累加等可在数据库完成的操作使用 `SET value = value + 1`，避免 read-modify-write。
- 边界：锁只保护事务期间的数据库行，不会自动合并两个用户的配置意图；悲观锁持有时间过长会造成等待、超时与吞吐下降。
- 下一步：选择 Agent 配置编辑与 Run 状态转换分别适用的并发控制策略。

### Review 13.52: Day 6 Worker 领取的读写竞态

- 场景：多个 Worker 用“先 `SELECT` 一条 `queued` Run，再单独 `UPDATE` 为 `running`”领取任务。
- 学习者回答：需要按等待时间排序，让等待久的 Run 优先处理。
- 判断：排序思路正确但没有解决并发安全。
- 机制：`ORDER BY created_at` 决定候选任务的公平顺序，却不能让候选任务只被一个 Worker 看见。A 与 B 可以在各自的 SELECT 中同时读到同一条最早的 queued Run；随后两者都 UPDATE 成 running，并都开始调用 Agent，造成重复执行和重复外部副作用。
- 正确边界：领取必须在同一个短事务中完成 `SELECT ... FOR UPDATE SKIP LOCKED ... ORDER BY created_at LIMIT 1` 和 `queued -> running` 更新。第一个 Worker 锁住该行后，其他 Worker 跳过它并领取下一条，而不是等待或重复领取。
- 下一步：区分 `SKIP LOCKED` 与普通 `FOR UPDATE` 在多个 Worker 领取队列时的吞吐差异。

### Review 13.53: Day 6 `FOR UPDATE` 与 `SKIP LOCKED`

- 场景：多个 Worker 同时按最早 queued Run 领取任务，但使用普通 `FOR UPDATE`。
- 学习者回答：会被阻塞。
- 判断：正确。
- 机制：第一个 Worker 锁住最早候选行后，其他 Worker 尝试锁同一行会等待其 commit/rollback；期间即使后面存在其他 queued Run，也可能无法及时被领取，形成锁等待和队列 convoy，降低 Worker 吞吐。锁释放后 PostgreSQL 会按当前事务可见状态重新检查候选行，等待者仍需处理该行可能已不再 queued 的结果。
- `SKIP LOCKED` 的价值：后续 Worker 不等待已锁行，直接跳到下一条可领取 Run，使多个 Worker 并行消费不同任务。代价是严格的全局 FIFO 公平性不再保证，且只能用于“可以跳过忙碌记录”的队列领取场景，不能随意用于普通用户编辑。
- 下一步：解释 Run 领取事务为什么必须短，不能把模型调用放在持锁事务内。

### Review 13.54: Day 6 短事务与外部 I/O 隔离

- 场景：Worker 领取 Run 后，在持有行锁的事务中调用模型 Provider 或执行 Tool。
- 学习者回答：长时间任务会加剧死锁风险、长期占用数据库连接，不利于 I/O 密集系统。
- 判断：正确。
- 机制：行锁和事务持续到 commit/rollback。Provider 调用、网络等待和 Tool 执行耗时不可控；若放在事务内，会造成其他 Worker/取消/恢复流程锁等待，连接池被长期占用，长事务也会延迟 PostgreSQL 对旧 MVCC 版本的清理。死锁可能增加，但更常见的是吞吐下降、超时和连接池耗尽。
- 正确三段式：短事务领取并持久化 `queued -> running` 后立即 commit；在事务外执行模型/Tool；再用新的短事务加锁并持久化 `completed`、`failed` 或下一状态。这样不把数据库锁跨越外部 I/O。
- 边界：事务外执行引入进程崩溃与外部副作用不确定性，后续需要 heartbeat、stale recovery 和外部幂等键处理；数据库事务不能提供外部调用的 exactly-once。
- 下一步：辨认外部执行成功但最终状态尚未写入数据库时的故障窗口。

### Review 13.55: Day 6 事务外执行后的不确定性

- 场景：模型/Tool 已在事务外成功执行，Worker 在写入最终状态前崩溃，Run 保持 `running`。
- 学习者回答：取决于模型是否有副作用；无副作用可以重试，有副作用需要人工审核。
- 判断：方向正确。
- 工程机制：数据库无法知道外部调用究竟是否成功，直接重试可能重复消耗模型额度、重复生成消息，或对 Tool 造成重复发信、重复扣费等副作用。若外部 Provider / Tool 支持稳定幂等键，可安全地以相同键重新请求，让外部系统去重；没有这种保证时，应按风险分类处理。
- 恢复策略：纯计算或可安全重试的操作可自动重试；支持幂等键的外部操作以同一键重试并对账；不可逆或高风险操作进入 `waiting_approval` / 人工对账，而非盲目重复。人工审核是高风险无幂等保障时的重要兜底，但不是所有副作用的唯一方案。
- 边界：这是 Day 9 ToolCall recovery 的核心问题，本轮只建立故障窗口意识；Day 6 继续聚焦 PostgreSQL 隔离级别与事务可见性。
- 下一步：理解 PostgreSQL 默认 Read Committed 下，同一事务的两条 SELECT 可见数据为何不同。

### Review 13.56: Day 6 Read Committed 的语句级快照

- 场景：同一事务内连续执行两条 SELECT；两者之间另一事务提交了修改。
- 学习者回答：第二次 SELECT 能看到新值。
- 判断：正确。
- 机制：PostgreSQL 默认 `Read Committed` 为每一条 SQL 语句创建新的已提交数据快照，而不是在整个事务期间固定一份快照。因此第二个 SELECT 可以看见第一个 SELECT 后其他事务已 commit 的值，这称为不可重复读。
- 工程后果：业务代码中“先读一次，做一段计算，再读一次”不能假设两个读到的是同一世界；需要稳定判断时使用明确的行锁、条件 UPDATE、或按业务要求选择更高隔离级别。
- 下一步：对比 `Repeatable Read` 下相同时间线的可见性与写入冲突。

### Review 13.57: Day 6 Repeatable Read 的事务快照

- 场景：事务使用 `Repeatable Read`，两条 SELECT 之间另一事务提交修改。
- 学习者回答：第二次不会看到新值，因为是可重复读模式。
- 判断：正确。
- 机制：PostgreSQL 在 `Repeatable Read` 事务的首次普通查询时建立快照，后续查询继续使用该快照，因此同一行的重复读取保持一致，不出现 Read Committed 中的不可重复读。
- 边界：固定快照保证读一致性，但不代表可以无冲突地基于旧快照写入；并发写同一行时 PostgreSQL 仍会等待/检测写入冲突并可能报错，应用必须设计重试或采用更适合的行锁/条件更新。
- 下一步：判断两个 Repeatable Read 事务同时修改同一 Agent 时，后提交者的结果。

### Review 13.58: Day 6 Repeatable Read 的同行写冲突

- 场景：两个 Repeatable Read 事务均读取 `temperature = 0.7`；A 更新为 `0.8` 并提交，B 再尝试更新为 `0.9`。
- 学习者回答：报冲突。
- 判断：正确。
- 机制：B 可能先等待 A 持有的行锁；A 提交后，PostgreSQL 发现 B 的事务快照所基于的旧行版本已被并发事务修改，B 的 UPDATE 失败并报 serialization / concurrent update 类错误，而不是静默覆盖 A。
- 工程后果：捕获到该类错误后不能只重试一条 UPDATE；必须 rollback 当前事务，并从头重新读取、重新执行业务判断后再重试整个事务。重试次数要受限并带退避，避免高冲突下持续打满数据库。
- 下一步：理解 Serializable 比 Repeatable Read 额外防护的写偏差场景。

### Review 13.59: Day 6 Repeatable Read 与写偏差

- 场景：两个事务为同一 Conversation 创建 Run；都查询到没有 `queued`/`running` Run 后，各自插入不同的新 Run。
- 学习者回答：Repeatable Read 不能保证最终只有一条活跃 Run。
- 判断：正确。
- 机制：Repeatable Read 固定读取快照，但主要检测同一行的写入冲突。两个事务写入不同的新行时可都成功提交；它们基于同一旧快照做出的判断共同破坏“至多一个活跃 Run”的谓词约束，这称为写偏差。
- AgentLab 正确防线：为该业务不变量建立数据库部分唯一索引，例如仅在 `status IN ('queued', 'running')` 时约束 `conversation_id` 唯一；应用层预查询只改善错误体验，最终必须捕获并映射唯一约束的 `IntegrityError`。Serializable 可在更广泛的读写依赖中中止其中一个事务，但仍要求重试，且不应替代明确的领域约束。
- 下一步：比较数据库部分唯一约束与 Serializable 在 AgentLab 活跃 Run 规则中的职责。

### Review 13.60: Day 6 Serializable 基础

- 场景：讨论为何活跃 Run 规则不能只依赖 Serializable；学习者询问 Serializable 的含义。
- 基础讲解：`Serializable` 是 PostgreSQL 的最高隔离级别。它允许事务并发执行，但检测读写依赖；若无法将结果解释为某种串行执行顺序，PostgreSQL 会使其中一个事务以 serialization failure 失败，应用必须 rollback 并从头重试。它可防护 Repeatable Read 下的写偏差。
- 边界：Serializable 不是“从此不需要设计并发”的开关。它可能中止事务，应用要有受限重试与幂等设计；冲突率高时会带来重试成本。具体领域不变量仍应优先由数据库约束直接表达。
- 下一步：用部分唯一索引与 Serializable 的职责区分复测活跃 Run 规则。

### Review 13.61: Day 6 部分唯一索引与 Serializable 的职责

- 场景：为何“每个 Conversation 最多一个 queued/running Run”仍要建立部分唯一索引，而不只使用 Serializable。
- 学习者回答：不知道。
- 基础讲解：部分唯一索引将明确的领域不变量直接交给数据库，例如 `UNIQUE (conversation_id) WHERE status IN ('queued', 'running')`。它对 ORM、Core、Psycopg、脚本和并发请求都生效，任何违反规则的 INSERT 或状态转换立即失败；不依赖每个调用方都正确开启 Serializable、完整重试并保留同一业务判断。
- Serializable 的职责：处理更宽泛且难以用约束表达的跨行/跨表读写依赖，代价是事务会以 serialization failure 中止，应用必须从头重试。它是并发控制工具，不是用来替代可清晰表达的唯一性、外键、CHECK 等数据规则。
- 工程结论：领域不变量优先用数据库约束做最终防线；业务预检查改善响应体验；必要时再按事务范围选择锁、条件 UPDATE 或 Serializable。
- 下一步：理解部分唯一索引如何随 Run 的终态自动释放一个 Conversation 的新建资格。

### Review 13.62: Day 6 部分唯一索引与 Run 终态

- 场景：Run 从 `running` 更新为 `completed` 后，同一 Conversation 能否创建新的 Run。
- 学习者回答：旧 Run 已解决，因此可以创建新的 Run。
- 判断：正确。
- 机制：部分唯一索引只收录 `status IN ('queued', 'running')` 的行。旧 Run 进入 completed 后不再满足索引谓词，PostgreSQL 在同一状态更新中移除其索引项，释放该 `conversation_id` 的活跃唯一名额；后续新 Run 可以插入。
- 边界：状态转换必须是受控的业务状态机。若任意 API 都能把 running 改为 completed，就可能绕过 Worker 的真实完成语义；唯一索引只保证数量，不保证状态转换本身合理。
- 下一步：识别两个事务以相反顺序加锁时的死锁。

### Review 13.63: Day 6 死锁与锁顺序

- 场景：事务 A 先锁 Agent 1 再锁 Conversation 2；事务 B 先锁 Conversation 2 再锁 Agent 1。
- 学习者回答：会死锁，使用 `SKIP LOCKED`。
- 判断：死锁正确；`SKIP LOCKED` 不是此场景的通用解法。
- 机制：A 持有 Agent 等 Conversation，B 持有 Conversation 等 Agent，形成循环等待。PostgreSQL 的死锁检测器会中止其中一个事务并报错，另一个才得以继续；被中止方必须 rollback。
- 正确预防：所有需要同时锁定这两类资源的代码路径采用同一全局顺序，例如始终先锁 Agent 再锁 Conversation，或按同类资源的稳定主键升序锁定。事务保持短小，避免在锁内执行外部 I/O。
- 为什么不用 `SKIP LOCKED`：它适用于“可跳过忙碌候选项”的队列领取；这里两个指定资源都是业务完成所必需，跳过任一个会产生半完成用例或错误业务结果。
- 下一步：理解被 PostgreSQL 选为死锁受害者后，应用应如何处理。

### Review 13.64: Day 6 死锁受害者的重试边界

- 场景：应用收到 PostgreSQL 的死锁受害者错误。
- 学习者回答：回滚整个事务，因为其他资源可能已改变。
- 判断：正确。
- 机制：PostgreSQL 选择死锁受害者后会中止其当前事务；该事务不能继续执行任意 SQL，必须先 rollback。此前读取到的状态和业务判断也可能已经过期，不能只重试最后一条 SQL。
- 工程策略：从头重试整个短事务，并设置有限次数、指数退避和结构化日志/指标；优先通过稳定锁顺序减少死锁。重试用例还必须具备幂等性或有数据库约束保证最终正确。
- Day 6 结论：完成口述复习，未在本轮运行双会话锁/隔离实验。
- 下一步：Day 7 MVCC、死元组与 VACUUM。

### Review 13.65: Day 7 UPDATE 的旧行版本

- 场景：PostgreSQL 更新一条 Agent 记录时写入新行版本，旧版本为何不能立即删除。
- 学习者回答：可能需要回滚，所以不应立即删除。
- 判断：方向相关，但核心原因是 MVCC 下的并发快照。
- 机制：已在更新前开始的其他事务可能仍持有旧快照，按其可见性规则应继续读到旧版本；PostgreSQL 不能为了新事务的 UPDATE 立刻物理删除它，否则会破坏读取一致性。更新事务回滚时新版本对其他事务不可见，旧版本仍是有效可见版本；但保留旧版本的主要长期理由是服务并发读者，而非等待是否回滚。
- 下一步：判断何时才可以回收不再被任何事务快照需要的旧版本。

### Review 13.66: Day 7 死元组的回收者

- 场景：旧行版本确认不再被活跃事务需要后，由谁清理，以及为何不由每次 UPDATE 立即清理。
- 学习者回答：使用 DELETE 清理。
- 判断：不正确。
- 基础讲解：PostgreSQL 使用 `VACUUM` 回收不再可见的旧行版本；通常由后台 `autovacuum` 自动运行。`DELETE` 不是物理清理操作，它同样以 MVCC 方式标记行已删除，并留下需要后续 VACUUM 回收的版本。
- 原因：每次 UPDATE 若都同步扫描和回收旧版本，必须检查所有活跃事务的快照并做额外维护，会让正常写入变慢且复杂。PostgreSQL 将写入新版本与后台回收分离，保持前台事务短且高并发。
- 下一步：理解长时间不结束的事务如何阻止 VACUUM 回收旧版本并造成表膨胀。

### Review 13.67: Day 7 长事务阻塞 VACUUM

- 场景：一个 API 请求开启事务后忘记提交或回滚，持续 30 分钟。
- 学习者回答：造成资源浪费，VACUUM 需要处理很多内容，表会变大。
- 判断：结果正确，机制需精确化。
- 机制：该事务持有很早的 MVCC 快照。即使其他事务已经更新/删除很多行，VACUUM 也不能回收对这个旧快照仍可能可见的版本；不是它“清得慢”，而是它必须保留这些版本。持续写入会积累 dead tuples，导致表/索引膨胀、缓存命中下降、扫描 I/O 增加，长期还会威胁事务 ID 回卷安全。
- 工程规则：API 数据库事务只包住短数据库操作，绝不跨越模型调用、Tool、用户等待或流式响应；监控 `pg_stat_activity` 中的长事务及其 `xact_start`，先定位来源，再按运维流程终止异常会话。
- 下一步：区分普通 VACUUM 与 `VACUUM FULL` 的回收效果和线上风险。

### Review 13.68: Day 7 `VACUUM` 与 `VACUUM FULL`

- 场景：表膨胀后，比较普通 `VACUUM` 与 `VACUUM FULL`，以及为何线上不应日常使用 FULL。
- 学习者回答：不知道。
- 基础讲解：普通 `VACUUM` 标记不再需要的死元组空间可供后续 INSERT/UPDATE 在同一张表内复用，并更新可见性等维护信息；它通常可与正常读写并行，但不会立即把磁盘文件缩小。`VACUUM FULL` 会重写整张表和索引以紧凑数据、归还操作系统磁盘空间。
- 线上风险：`VACUUM FULL` 需要 `ACCESS EXCLUSIVE` 锁，会阻塞该表的读写，并需要额外磁盘空间和较长维护窗口。它不是 autovacuum 的替代品，只适用于经过确认的严重膨胀和已安排停机/低流量窗口。
- 工程优先级：先排查并修复长事务、确认 autovacuum 配置/运行情况与真实膨胀，再决定普通 VACUUM、重建索引或维护窗口内的 FULL；不能把 FULL 当作发现慢查询后的即时按钮。
- 下一步：识别线上发现表膨胀时应先排查的根因，而不是直接执行 VACUUM FULL。

### Review 13.69: Day 7 表膨胀的排查优先级

- 场景：线上 `agent_runs` 表变大、查询变慢，是否应立即执行 `VACUUM FULL`。
- 学习者回答：不应直接执行，因为 FULL 占用更多资源、锁住整表、阻塞读写并需要额外空间。
- 判断：正确。
- 工程结论：先排查长事务和 autovacuum 是否被阻塞；若根因未消除，即便一次 FULL 完成，后续写入仍会再次积累无法回收的死元组。普通维护优先保持在线、低风险，FULL 只在确认严重膨胀且安排维护窗口后使用。
- Day 7 结论：完成 MVCC 旧版本、死元组、长事务、autovacuum 与 VACUUM FULL 的口述复习。尚未运行 `pg_stat_activity` / `pg_stat_user_tables` 的实库观察实验。
- 下一步：Day 8 PostgreSQL 队列、`SKIP LOCKED`、状态机和索引。

### Review 13.70: Day 8 Worker 领取索引

- 场景：Worker 以 `WHERE status = 'queued' ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1` 领取 Run，队列达到百万行。
- 学习者回答：直接建立 status 为 queued 的索引。
- 判断：方向正确，需补全查询形态。
- 索引设计：优先建立部分索引，例如 `CREATE INDEX ... ON agent_runs (created_at) WHERE status = 'queued'`。它只收录可领取行，并按领取顺序组织，数据库可从最早 queued Run 开始扫描，而不必扫描所有状态或额外排序。是否附加 `id` 取决于稳定排序和实际查询需求。
- 边界：索引不替代 `FOR UPDATE SKIP LOCKED` 的并发正确性；它只减少寻找候选任务的代价。索引增加每次写入/状态转换的维护成本，必须用 `EXPLAIN (ANALYZE, BUFFERS)` 验证。
- 下一步：比较部分索引与全表 `(status, created_at)` 索引在队列状态分布下的取舍。

### Review 13.71: Day 8 部分索引与全表复合索引

- 场景：为何 queued Run 领取常用部分索引，而不是全表 `(status, created_at)` 复合索引。
- 学习者回答：全表索引可能扫描全部数据，浪费时间。
- 判断：方向正确，机制需精确化。
- 机制：全表 `(status, created_at)` B-Tree 也能利用 `status = 'queued'` 定位，通常不必扫描全表；但它收录 completed、failed、cancelled 等领取查询永远不会使用的行，索引更大、缓存局部性更差、状态转换时维护成本更高。部分索引只保留 queued 行，通常更小，更适合“绝大多数 Run 已结束、待领取比例低”的队列工作负载。
- 权衡：若系统也经常按其他 status + created_at 查询，或 queued 比例很高，复合索引可能更通用；索引选择必须由实际查询与 `EXPLAIN (ANALYZE, BUFFERS)` 证据决定。
- 下一步：用执行计划验证领取查询是否真正使用目标部分索引。

### Review 13.72: Day 8 验证队列领取索引

- 场景：使用 `EXPLAIN (ANALYZE, BUFFERS)` 验证 Worker 领取查询是否使用 queued 部分索引。
- 学习者回答：记不得。
- 基础讲解：理想计划包含 `Index Scan using <queued 部分索引>`，并且因为索引已按 `created_at` 排序，通常不应再有额外 `Sort`。`LIMIT 1` 应使实际返回行数很小，`Buffers` 反映较少的页面访问。由于 `FOR UPDATE` 必须锁住真实表行，这里通常是 `Index Scan` 而不是 `Index Only Scan`。
- 边界：小表或 queued 行占比很高时，优化器选择 Seq Scan 不必然是错误；应结合 actual rows、buffers、数据规模和实际延迟判断，不能只为看到 Index Scan 而盲目强制索引。
- 下一步：理解 Run 从 queued 变为 running 时，部分索引如何随状态变化更新。

### Review 13.73: Day 8 状态转换与部分索引项

- 场景：Run 从 `queued` 更新为 `running` 时，queued 部分索引中的索引项如何变化。
- 学习者回答：queued 变为 running。
- 判断：已指出状态转换；需补充索引行为。
- 机制：部分索引仅收录满足 `status = 'queued'` 的行。UPDATE 后该 Run 不再满足谓词，PostgreSQL 会移除其 queued 索引项，因此它不再是后续领取查询的候选记录；同一领取事务仍需以锁和状态 UPDATE 保证并发正确性。
- Day 8 结论：完成队列领取竞态、`FOR UPDATE SKIP LOCKED`、短领取事务、部分唯一约束、queued 部分索引与 EXPLAIN 验证的口述复习。尚未在本复习轮运行实际 `EXPLAIN (ANALYZE, BUFFERS)` 或多 Worker 实验。
- 下一步：Day 9 重试、stale recovery 与 heartbeat。

### Review 13.74: Day 9 stale Run 的判定

- 场景：Worker 已将 Run 标为 `running` 后进程崩溃，如何判断 Run 可以恢复。
- 学习者回答：判断是否超过一定时间，可以恢复。
- 判断：正确。
- 机制：Recovery Worker 定期寻找 `status = 'running' AND heartbeat_at < cutoff` 的 Run。`heartbeat_at` 是当前 Worker 周期性写入的“仍在运行”的证据；它比单纯 `started_at` 更可靠，因为合法的长模型调用可能运行很久，但仍会持续心跳。超出心跳超时阈值才标记 stale 并进入恢复流程。
- 边界：heartbeat 只能证明 Worker 事件循环与数据库更新路径还活着，不能证明模型业务一定有进展；超时阈值要大于正常心跳间隔和短暂抖动，避免误恢复仍正常的 Run。
- 下一步：根据 `retry_count` 与 `max_retries` 决定 stale Run 应回到 queued 还是进入 failed。

### Review 13.75: Day 9 stale Run 的重试分支

- 场景：Recovery Worker 发现 stale Run，需要根据 `retry_count` 与 `max_retries` 决定最终状态。
- 学习者回答：`retry_count < max_retries` 时转 queued；`retry_count >= max_retries` 时转 failed。
- 判断：正确。
- 机制：`retry_count` 表示已经开始过的执行尝试次数，`max_retries` 是允许的最大尝试数。尚有预算时重新排队；预算耗尽则明确标为 failed，不能将它过滤在恢复查询之外，否则可能永久卡在 running。
- 并发边界：stale 筛选、`FOR UPDATE SKIP LOCKED` 锁定、重试分支和状态更新必须处于同一短事务；这样两个 Recovery Worker 不会重复恢复同一 Run。
- 下一步：解释 heartbeat loop 为什么需要独立于主执行流程，并在取消/异常时停止。

### Review 13.76: Day 9 独立 heartbeat loop

- 场景：模型调用可能持续很久，为什么 heartbeat 不能只在执行开始与结束时更新一次。
- 学习者回答：长调用期间需要 heartbeat 判断任务是否仍在进行，超时后再重试。
- 判断：正确。
- 机制：若只写开始/结束两个时间点，合法的长模型调用会在中间长时间没有数据库活动，Recovery Worker 将它误判为 stale 并重复恢复。独立异步 loop 按固定间隔更新 `heartbeat_at`，持续证明 Worker 事件循环与数据库写入路径仍活着。
- 边界：heartbeat 不是模型业务进展证明，也不能替代模型调用超时；主任务结束、失败、取消或发生异常时，必须在 `finally` 停止并等待 heartbeat 子任务，避免已完成/已取消 Run 继续被误报为活跃。
- 下一步：区分 Worker 取消与业务执行失败时，对 Run 状态和 heartbeat 的不同处理。

### Review 13.77: Day 9 取消与业务失败的边界

- 场景：Worker 收到取消信号，模型任务被取消。
- 学习者回答：停止 heartbeat，Run 暂时保持 running 并交给 stale recovery；因为取消不是任务自身失败。
- 判断：正确。
- 机制：`CancelledError` 是运行时控制流，不能与模型异常、校验错误或业务失败混为一谈。应在 `finally` 停止 heartbeat，并重新传播取消；不伪造 failed 状态。之后 Run 因心跳停止成为 stale，由 Recovery Worker 依据统一重试策略决定 queued 或 failed。
- 对比：普通 `Exception` 代表本次执行失败，应按重试策略持久化失败/重排队并重新抛出；正常完成则在独立短事务中写最终结果与 completed。优雅关闭时若选择等待当前任务完成，任务也可走正常完成路径。
- Day 9 结论：完成 retry budget、stale detection/recovery、heartbeat、外部执行不确定性和取消边界的口述复习。尚未在本轮运行 heartbeat/recovery 并发测试。
- 下一步：Day 10 Worker 生命周期、异常包装与优雅关闭。

### Review 13.78: Day 10 Worker 优雅关闭

- 场景：部署重启 Worker，为什么不能直接杀进程，以及如何处理新任务和当前 Run。
- 学习者回答：直接杀进程会造成资源问题、用户提交内容可能未 commit；应给时间等待业务线程正常完成。
- 判断：正确。
- 正确流程：收到关闭信号后设置共享 `shutdown_event`，Worker loop 停止领取新 Run；让当前执行任务在有限宽限期内完成其最终状态持久化；超时后才取消任务。`finally` 中停止 heartbeat、关闭/归还 Session 并释放连接池资源。被取消且尚未持久化结果的 running Run 留给 stale recovery 处理。
- 边界：宽限期必须有限，否则部署可能永久卡住；不能为了“快速退出”让 Worker 在 shutdown 后继续领取任务。外部 Tool 的执行不确定性仍需依赖幂等键或对账。
- 下一步：判断 Worker 子任务发生未处理异常时，Supervisor 应如何处理其他 Worker 与 recovery loop。

### Review 13.79: Day 10 Supervisor 的未处理异常策略

- 场景：一个 Worker 子任务发生未处理异常，Supervisor 应继续其余 Worker/recovery loop 还是统一取消并退出。
- 学习者回答：统一取消并失败退出。
- 判断：正确；原因需精确化。
- 机制：单个 Run 的预期业务异常应在 Worker 内捕获、记录并按重试策略处理，不应到达 Supervisor。若异常仍未处理地冒泡，通常意味着 Worker loop、Recovery、连接或程序逻辑存在未知系统故障；使用 `asyncio.TaskGroup` 等 Supervisor 结构会取消兄弟任务并汇总异常，让进程失败退出，由运行环境重启，避免服务处于不可观测的半故障状态。
- 边界：这不是因为所有异常都会自动回滚所有历史事务。每笔已提交事务仍然存在；退出前要靠任务 `finally` 释放本地资源，未完成的 running Run 由 heartbeat/recovery 接管。
- 下一步：理解为什么每个 Worker 都应拥有独立的 AgentRunner 实例，而不是共享可变 Runner。

### Review 13.80: Day 10 Worker 的 Runner 所有权

- 场景：多个 Worker 是否共享同一个可变 AgentRunner 实例。
- 学习者回答：会有读写问题，状态混乱。
- 判断：正确。
- 机制：若 Runner 保存当前 Run、对话上下文、临时 ToolCall、取消标记或 Provider 请求状态，共享实例会导致并发 Worker 的状态相互覆盖、上下文串线或取消误伤。每个 Worker 使用独立 Runner，将可变执行状态绑定到单一所有者。
- 边界：不可变配置、线程/协程安全的连接池或明确设计为并发安全的 Provider client 可以共享；判断标准不是“对象名称”，而是其内部状态是否可变、是否跨任务保存、以及库的并发安全契约。
- Day 10 结论：完成 Worker 优雅关闭、Supervisor 故障传播和 Runner 所有权的口述复习。尚未在本轮运行 TaskGroup/SIGTERM 生命周期实验。
- 下一步：Day 11 ToolCall、基础工具与恢复边界。

### Review 13.81: Day 11 ToolCall 先持久化为 pending

- 场景：模型请求调用 `send_email` 后，为何不能直接执行外部工具，而要先持久化 ToolCall 为 pending。
- 学习者回答：ToolCall 有运行状态；同时请求发送可能产生问题。
- 判断：已识别并发与状态管理的重要性，需补充故障边界。
- 机制：先持久化 pending ToolCall，才能在外部执行前拥有可审计、可审批、可领取、可恢复和可幂等处理的事实记录。若直接调用 Tool 后进程崩溃，系统无法区分“尚未执行”“已执行但结果未保存”“执行失败”，对邮件、支付等外部副作用尤其危险。
- 并发边界：不同 Agent 的两个合法 ToolCall 可以并发执行；真正要防的是同一逻辑 ToolCall 被多个 Worker 重复领取/重复执行，或未经审批直接触发高风险操作。数据库状态机、条件领取、唯一幂等键和审批 gate 分别承担这些职责。
- 下一步：解释 ToolCall 从 pending 到 running 为什么要使用条件 UPDATE 或行锁原子领取。

### Review 13.82: Day 11 ToolCall 的原子领取

- 场景：多个 Worker 竞争将同一 ToolCall 从 pending 领取为 running。
- 学习者回答：一个 Session 准备修改时，其他 Session 也可能读到这个任务。
- 判断：正确，已识别检查与修改之间的竞态。
- 机制：两个 Session 可以同时读到 `status = 'pending'`；若分别再无条件 UPDATE 并执行工具，就会重复执行外部副作用。应用条件 UPDATE，例如 `UPDATE ... SET status = 'running' WHERE id = :id AND status = 'pending' RETURNING id`，仅影响一行的 Worker 才拥有执行权；或在短事务内先 `SELECT ... FOR UPDATE` 再验证状态和更新。
- 边界：领取事务只持久化所有权，不能包住外部 Tool 执行；执行必须在事务外完成。条件 UPDATE 防止重复领取，但不单独保证外部副作用 exactly-once，仍需要外部幂等键或恢复对账。
- 下一步：处理原执行 Worker 与 stale recovery 同时尝试写 ToolCall 最终状态的竞争。

### Review 13.83: Day 11 ToolCall 最终状态竞争

- 场景：原 Worker 执行 Tool 后要写 completed；Recovery Worker 同时误判 stale，尝试写 failed 或重排队。
- 学习者回答：保存运行结果，Recovery 后直接加载结果以避免覆盖。
- 判断：结果持久化有助于恢复/对账，但不足以防止并发终态覆盖。
- 正确机制：两个最终状态写入都必须在短事务中锁定同一 ToolCall（普通 `FOR UPDATE`），读取并验证当前状态与合法转换后再 UPDATE。先获得锁的一方完成转换；另一方随后看到状态已不再是预期的 running/stale 前状态，就拒绝覆盖或走明确的幂等分支。也可用带状态条件的 UPDATE 并检查影响行数。
- 边界：heartbeat/stale 阈值降低误恢复概率，状态锁保证数据库终态不会互相覆盖；但 Tool 已成功而 completed 保存失败的外部副作用不确定性，仍需要稳定幂等键和对账，不能仅靠数据库状态机解决。
- 下一步：判断模型请求不存在或未授权 Tool 时，ToolRegistry 应如何处理。

### Review 13.84: Day 11 ToolRegistry 的 fail-closed 边界

- 场景：模型请求调用不存在的工具，或当前 Agent 未被授权使用的工具。
- 学习者回答：拒绝，因为是危险行为。
- 判断：正确。
- 机制：模型输出不携带执行权限。ToolRegistry 仅允许服务器预先注册、当前 Agent 被显式授权、并且参数通过 Schema 校验的 Tool 进入执行路径；未知名称或未授权 Tool 必须 fail-closed，记录结构化失败/拒绝原因，而不是猜测工具、静默忽略或执行任意函数。
- 安全边界：拒绝信息要对 API/模型返回可控且不泄露内部路径、密钥或策略细节；高风险已注册 Tool 还需经过 approval gate，注册本身不代表每次调用都可自动执行。
- 下一步：解释为什么 Tool 参数应使用 Pydantic Schema 校验，而不能相信模型生成的 JSON。

### Review 13.85: Day 11 Tool 参数 Schema 边界

- 场景：模型输出看似合法 JSON 的 Tool 参数，为何仍必须经过 Pydantic Schema 校验。
- 学习者回答：参数类型或格式不对仍不可执行，工具调用校验规则应高。
- 判断：正确。
- 机制：JSON 合法只代表语法可解析，不代表参数符合工具契约。Pydantic Schema 将服务器侧的类型、必填字段、范围、枚举、长度、嵌套结构和额外字段边界明确化，阻止模型幻觉、格式漂移和外部恶意输入直接抵达 Tool。
- 安全边界：Schema 校验不是全部安全控制。文件路径、URL、SQL、命令等高风险值仍需按 Tool 自己的能力边界做白名单、SSRF/注入防护和授权；校验通过也不等于允许执行。
- 下一步：比较安全 calculator 为什么不能使用 Python `eval()` 执行模型提供的表达式。

### Review 13.86: Day 11 Calculator 与 `eval()` 注入风险

- 场景：实现 calculator Tool，是否直接对模型表达式使用 Python `eval()`。
- 学习者回答：可能出现异常或代码注入。
- 判断：正确，核心风险是代码注入。
- 机制：`eval()` 能执行 Python 表达式，而非仅执行四则运算。模型或用户可构造属性访问、函数调用或资源消耗表达式，触及进程环境、文件/网络能力或造成拒绝服务。异常处理无法把不安全执行变成安全执行。
- 正确做法：使用受限表达式解析器或基于 AST 的白名单，只允许所需数学运算、有限变量和资源上限；同时保留 Pydantic 输入长度/类型限制，并为超时、除零和非数值结果返回受控错误。
- Day 11 结论：完成 ToolCall 持久化、状态机领取/终态竞争、恢复边界、Registry fail-closed、参数校验和安全 calculator 的口述复习。尚未在本轮运行工具安全/恢复测试。
- 下一步：Day 12 模型 Adapter、Provider Registry 与真实 Worker 接线。

### Review 13.87: Day 12 模型 Adapter 的边界

- 场景：为何 Worker、Service 和数据库代码不应直接依赖一家模型厂商 SDK，而应通过 `AgentRunnerProtocol` / Adapter 调用模型。
- 学习者回答：用户可能使用多家厂商 SDK，需要通过接口处理适用性。
- 判断：正确。
- 机制：Adapter 将 Provider SDK、请求/响应格式、异常类型、认证和厂商特有重试细节封装在边缘；Worker/Service 仅依赖稳定协议。这样可按 Agent 配置选择/替换 Provider、使用 Fake Runner 做确定性测试，且不让供应商细节污染数据库状态机和事务边界。
- 边界：抽象不应抹平所有 Provider 差异；模型能力、Tool schema、流式响应、限流和错误语义仍要被显式建模或映射，不能假设不同厂商完全等价。
- 下一步：解释为何 Provider API Key 不能存入 Agent/Run 数据库记录或日志。

### Review 13.88: Day 12 Provider 密钥边界

- 场景：为何 Provider API Key 不能写入 Agent/Run 数据库记录、日志或测试快照。
- 学习者回答：密钥可能被恶意盗取，关键信息不应存入这些位置。
- 判断：正确。
- 机制：密钥进入数据库、日志、异常堆栈、测试快照或调试输出后，会随备份、读权限、日志平台和排障流程扩散，泄露面显著扩大。AgentLab 当前从环境变量读取密钥，并在结构化日志和错误映射中脱敏，绝不回显完整值。
- 边界：并非任何系统都绝对不能持久化密钥；若业务确实需要用户自带密钥，必须使用专用 Secrets Manager、信封加密、最小权限、轮换和审计，不能把明文塞进普通业务表。当前项目不实现这条扩展。
- 下一步：判断 Provider Registry 遇到未注册或配置不完整的 provider 时应如何处理。

### Review 13.89: Day 12 Provider Registry 的 fail-closed 行为

- 场景：Provider Registry 遇到未注册 Provider，或该 Provider 缺少必要配置。
- 学习者回答：默认拒绝；回退 Provider 本身也可能没有配置。
- 判断：正确。
- 机制：Provider Registry 必须 fail-closed，返回受控的配置/不支持错误，而不是猜测默认 Provider。隐式回退可能将请求发送到错误厂商、消耗错误账户额度、改变模型/工具行为，或造成不符合预期的数据外发。
- 工程规则：Provider 选择应由经过校验的 Agent 配置明确指定；Registry 在启动时或首次使用时验证必要配置，密钥缺失/Provider 未注册时拒绝执行并留下可观测的安全错误，不暴露密钥。
- Day 12 结论：完成 Adapter、Provider Registry、密钥边界和 fail-closed 的口述复习。尚未在本复习轮运行真实 Provider 调用。
- 下一步：Day 1-12 阶段复习完成，恢复 Day 13 `persist_model_tool_requests(...)` 的原子持久化设计。

## 阶段复习结论

- Day 1-12 已按顺序完成口述复习，并持续记录已掌握点与薄弱点。
- 已掌握主线：API 分层、PostgreSQL 约束与查询、Core/ORM、Alembic、事务与并发、MVCC、队列、Worker 生命周期、ToolCall 可靠性与 Provider 边界。
- 后续实现时重点复测：ORM commit 后属性过期、ORM cascade 与数据库级级联的差异、迁移大表兼容性、真实双会话并发实验、EXPLAIN 基线、Tool 外部副作用的幂等/对账。
- 下一任务：恢复 Task 13.1，仅设计和实现模型 ToolRequest 的原子持久化、回滚与幂等测试。

## 延期功能的前置知识：事务与幂等分工

```text
Worker A 已领取 Run，status = running
        |
        | Provider 返回 response_id=resp_42，包含 call_a、call_b
        v
BEGIN
SELECT agent_runs WHERE id = :run_id FOR UPDATE
SELECT max(step_order) FROM run_steps WHERE run_id = :run_id
INSERT run_steps(..., step_order = N + 1)
INSERT tool_calls(..., idempotency_key = stable key for call_a)
INSERT run_steps(..., step_order = N + 2)
INSERT tool_calls(..., idempotency_key = stable key for call_b)
UPDATE agent_runs SET status = 'waiting_tools' WHERE id = :run_id
FLUSH
COMMIT
```

- `FOR UPDATE` 让同一 Run 的状态转换和顺序分配串行化，锁持续到 commit 或 rollback。
- `flush` 将 SQL 发送给 PostgreSQL，能在 commit 前暴露唯一约束和外键错误；它不是提交。
- ToolCall 唯一约束是跨事务、跨进程的最终幂等防线；“先查有没有”只能优化正常路径，不能替代约束。
- 这笔事务只保证本地数据库记录的一致性。未来 Tool Worker 调用外部系统时，仍需要外部幂等键或对账，不能宣称 exactly-once。

## Problem Log

### Problem 13.1: Day 13 功能任务主动延期

- Observed at: 2026-07-21
- Symptom: Day 13 原功能尚未实现；当前学习者对前置知识掌握感不足。
- Reproduction or command: 阅读 `app/agents/model_runner.py`；该分支当前固定报错。
- Root cause: Day 12 的范围仅覆盖最终文本输出，工具循环的第一段持久化被明确留给 Day 13；学习者选择先巩固其前置知识。
- Impact: Day 13 实现顺延，项目功能暂不推进。
- Resolution or next action: Day 1-12 阶段复习已完成；下一学习日回到原 Task 13.1。
- Knowledge point: 后端功能的正确实现依赖对 API 边界、事务、锁、队列和幂等的整体理解。

## 核心复盘题

> 一个 `POST /runs` 请求进入 AgentLab 后，Router、Pydantic Schema、Service、Repository 和 ORM Model 分别做什么？为什么不应该把事务、状态机和 SQL 细节直接堆进 Router？

Router 处理 HTTP 输入输出和业务异常映射；Pydantic Schema 定义并校验 API 契约；Service 编排用例、状态机和事务；Repository 封装查询、锁与持久化细节；ORM Model 描述数据库映射及关系。把所有逻辑堆进 Router 会让 HTTP、业务规则和数据访问耦合，事务边界难以复用和测试，并更容易在失败路径留下部分提交。

## 明日固定任务

恢复 Day 13 原功能任务：仅在阶段复习完成后，设计 `persist_model_tool_requests(...)` 的原子持久化。
