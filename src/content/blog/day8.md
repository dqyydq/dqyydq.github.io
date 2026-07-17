---
title: "Day 8：用 PostgreSQL SKIP LOCKED 实现并发 Worker 队列"
pubDate: 2026-07-17
description: "从双会话锁实验到可运行代码：使用 FOR UPDATE SKIP LOCKED 原子领取任务，设计 Repository 与 Service 事务边界，验证 Run 状态机和并发安全，并用部分索引将领取查询从全表扫描优化为有序索引扫描。"
type: 学习日志
tags: ["PostgreSQL", "FastAPI", "SQLAlchemy", "并发", "任务队列", "SKIP LOCKED"]
featured: false
series: fastapi-postgres-learning
seriesOrder: 8
---

## 前言

Day 7 解释了 MVCC、行锁和死锁，但理解锁机制并不等于已经能写出可靠的并发代码。Day 8 把这些知识落到一个真实问题上：多个 Worker 同时从 PostgreSQL 领取任务时，怎样保证同一个 Run 不会被重复处理？

这次实现从两个 psql 会话的锁实验开始，逐步完成原子领取、Repository / Service 分层、失败回滚、Run 状态机和 PostgreSQL 并发测试。最后用 10000 条数据对领取查询执行 `EXPLAIN (ANALYZE, BUFFERS)`，根据证据增加 queued 部分索引，并验证 Alembic 升降级可逆。

最终结果：10 项测试全部通过且无警告；领取查询执行时间从 0.466 ms 降至 0.091 ms，执行阶段访问页从约 124 个降至约 5 个。

---

## 上一阶段复习

开始前先口述并用 5～10 分钟写下答案：

1. Read Committed 下每条语句如何获取快照？
2. `SELECT FOR UPDATE` 锁住什么，锁何时释放？
3. 为什么“先 SELECT、后 UPDATE，但不在同一事务”会重复领取？
4. 死锁与普通锁等待有什么区别？
5. `ROLLBACK` 后为什么不能留下 `running` 状态？

Day 7 遗留且会影响今天实现的问题：

- Run API 仍直接提交事务，尚无 Service / Repository 边界。
- Run 状态缺少集中转换规则和数据库 CHECK。
- 幂等唯一约束目前是全局 key，而目标设计是 `(conversation_id, idempotency_key)`。
- 仓库尚无 `tests/`，开发库和测试库隔离也需要验证。

今天只处理 Worker 领取链路必需的部分；幂等约束改造可单独安排，避免把多个并发主题混在一个事务实验中。

---

## 今日目标

- [x] 用两个 psql 会话观察 `FOR UPDATE SKIP LOCKED` 的真实行为
- [x] 解释“选中 queued Run”和“更新为 running”为什么必须在同一事务
- [x] 实现最小任务领取函数，一次最多领取一个 Run
- [x] 建立 `queued → running → completed/failed` 的最小状态转换规则
- [x] 用并发测试证明多个 Worker 不会领取同一个 Run
- [x] 记录关键 SQL、测试结果、已知问题和面试题答案
- [x] 完成一次只包含 Day 8 成果的 Git 提交

---

## Step 1：准备测试数据与基线（30～45 分钟）

### 任务

1. 确认测试连接指向 `agent_lab_test`，不能连接 `agent_lab_dev`。
2. 执行 `alembic upgrade head`。
3. 创建至少 3 条 `queued` Run，记录它们的 `id` 和 `created_at`。
4. 查询当前状态分布：

```sql
SELECT status, count(*)
FROM agent_runs
GROUP BY status
ORDER BY status;
```

### 小练习

先写出你预期的领取顺序。若两条记录 `created_at` 相同，应如何增加稳定排序？

建议查询使用：

```sql
ORDER BY created_at, id
```

### 验证

- 测试库名称已打印并人工确认。
- 至少有 3 条 queued Run。
- 不修改开发库数据。

---

## Step 2：双会话 `SKIP LOCKED` 实验（60～90 分钟）

打开 psql 会话 A 和 B，不要先写 Python。

### 会话 A

```sql
BEGIN;

SELECT id, status, created_at
FROM agent_runs
WHERE status = 'queued'
ORDER BY created_at, id
FOR UPDATE SKIP LOCKED
LIMIT 1;
```

保持事务不提交。

### 会话 B

执行相同 SQL。预期 B 不等待 A，而是返回下一条 queued Run。

### 继续验证

1. 去掉 `SKIP LOCKED`，观察 B 是否等待。
2. 在 A 中 `ROLLBACK`，观察锁释放后该任务是否仍为 queued。
3. 重做实验，在一个事务内执行：

```sql
WITH candidate AS (
    SELECT id
    FROM agent_runs
    WHERE status = 'queued'
    ORDER BY created_at, id
    FOR UPDATE SKIP LOCKED
    LIMIT 1
)
UPDATE agent_runs AS r
SET status = 'running',
    started_at = now()
FROM candidate
WHERE r.id = candidate.id
RETURNING r.id, r.status, r.started_at;
```

### 必须回答

- `SKIP LOCKED` 解决的是重复领取、锁等待，还是两者？
- 为什么它适合队列，却不适合要求返回完整一致结果的普通列表查询？
- 如果事务在 UPDATE 后、COMMIT 前崩溃，Run 最终是什么状态？为什么？

---

## Step 3：实现最小领取边界（60～90 分钟）

### 建议结构

```text
app/
├── repositories/
│   └── runs.py       # claim_next_queued_run，只负责查询和持久化
├── services/
│   └── runs.py       # 事务边界和状态转换
└── workers/
    └── runner.py     # 循环、空队列等待、调用执行器
```

第一版不接模型 SDK，不做无限重试，不共享 `AsyncSession`。

### 约束

- 一个 Worker 循环每次创建或获取自己独立的 `AsyncSession`。
- 领取 SELECT 和状态 UPDATE 必须处于同一事务。
- Repository 不调用 `commit()`。
- 空队列返回 `None`，不是异常。
- 领取成功后返回明确类型，不返回未加载的隐式关系。
- SQL 日志中应能看到 `BEGIN → SELECT ... FOR UPDATE SKIP LOCKED → UPDATE → COMMIT`。

### 小练习

在编码前画出事务边界，并标记行锁在哪一步获得、在哪一步释放。写完后对照 SQL 日志修正图。

---

## Step 4：最小状态机与失败事务（45～60 分钟）

今天只允许：

```text
queued  → running
running → completed
running → failed
```

以下转换必须拒绝：

```text
completed → running
failed    → completed
queued    → completed
```

### 失败实验

在领取事务的 UPDATE 后故意抛出异常，验证：

```sql
SELECT id, status, started_at
FROM agent_runs
WHERE id = :run_id;
```

预期整笔事务回滚，Run 保持 `queued`，`started_at` 不应留下部分更新。

### 设计说明

应用状态机负责给出清晰业务错误；数据库 CHECK 可限制合法状态值，但普通 CHECK 不能独立验证“前一个状态 → 新状态”的转换历史。两者职责不同。

---

## Step 5：并发测试（75～105 分钟）

### 最低测试集

1. 空队列返回 `None`。
2. 单 Worker 领取最早 queued Run，并更新为 running。
3. 事务中途异常后全部回滚。
4. 两个 Worker 并发领取两条不同 Run。
5. N 个 Worker 竞争 1 条 Run，只有一个领取成功。
6. 已 completed / failed 的 Run 不会被领取。

### 并发测试要求

- 每个并发任务使用独立 `AsyncSession`。
- 使用 PostgreSQL 测试库，不用 SQLite 替代锁语义。
- 测试结束清理数据或通过事务 fixture 隔离。
- 断言领取到的 ID 集合无重复，不能只断言“没有报错”。

### 关键断言示例

```python
claimed_ids = [run.id for run in results if run is not None]
assert len(claimed_ids) == len(set(claimed_ids))
```

---

## Step 6：执行计划、复盘与提交（45～60 分钟）

先记录基线：

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT id
FROM agent_runs
WHERE status = 'queued'
ORDER BY created_at, id
LIMIT 1;
```

不要因为看到 Seq Scan 就立即创建索引。测试数据很少时 Seq Scan 可能更合理。只有补充足够数据并保存前后执行计划后，才评估类似下面的部分索引：

```sql
CREATE INDEX ...
ON agent_runs (created_at, id)
WHERE status = 'queued';
```

创建前必须回答：它优化哪条查询、写入成本是什么、是否与现有索引冗余。

### 今日面试题

1. `FOR UPDATE`、`NOWAIT`、`SKIP LOCKED` 分别适合什么场景？
2. 为什么领取和更新必须放在同一事务？
3. 多 Worker 为什么不能共享一个 `AsyncSession`？
4. Worker 在 COMMIT 前崩溃和 COMMIT 后崩溃有什么不同？
5. `SKIP LOCKED` 能否保证严格公平和完全 FIFO？
6. PostgreSQL 任务队列与 Redis / RabbitMQ 相比有什么边界？
7. PostgreSQL 与 InnoDB 在 `SKIP LOCKED` 和默认隔离级别上需要注意什么差异？

---

## 今日验收标准

- [x] 两个 psql 会话的时间线、SQL 和实际结果已写入本文
- [x] 可以说明行锁从获得到释放的基本过程
- [x] 领取与 `queued → running` 在同一数据库事务
- [x] Repository 没有偷偷 commit，Service 明确事务边界
- [x] 并发任务没有共享 AsyncSession
- [x] 并发测试证明同一 Run 不会被重复领取
- [x] 失败注入证明事务不会留下部分状态
- [x] 关键 SQL 已记录 `EXPLAIN (ANALYZE, BUFFERS)` 基线及部分索引对照
- [x] 未经执行计划证明不新增索引
- [x] 测试使用独立测试数据库
- [x] 无明文密钥、无拼接 SQL、无裸 `except`

---

## 今日应产出

- 一个最小 Worker 领取函数
- 一组双 psql 会话 SQL 实验及结果
- 一组 PostgreSQL 并发测试
- 一份领取查询执行计划基线
- 本文的“完成内容 / 实验结果 / 遇到的问题 / 仍不理解”更新
- 一次 Day 8 Git 提交

---

## 实验与实现

### 1. 测试数据库隔离

Compose 初始化时只自动创建 `agentlab_dev`。`.env.example` 中写有 `TEST_DATABASE_URL`，但它只是配置模板，不会自动创建数据库，也不会被应用直接加载。

配置层次：

```text
.env.example
    → 配置示例，不参与运行

.env
    → Pydantic Settings 默认读取

操作系统环境变量
    → 覆盖 .env 中同名配置

alembic.ini（修改前）
    → 曾硬编码 agentlab_dev，导致 Alembic 不读取测试地址
```

实际确认：

```sql
SELECT current_database(), current_user;
```

结果：

```text
current_database = agentlab_test
current_user     = agentlab
```

`Settings` 增加了可选字段：

```python
test_database_url: str | None = None
```

之所以可选，是因为生产环境运行应用时不应被强制要求提供测试数据库地址；测试 fixture 再单独要求该配置必须存在。

测试执行前还会检查实际 URL：

```python
if database_name is None or not database_name.endswith("_test"):
    raise RuntimeError(...)
```

这里只检查环境变量还不够，因为配置可能被其他来源覆盖。最终应检查解析后的实际数据库名。

---

### 2. Alembic 空数据库迁移缺口

第一次在空的 `agentlab_test` 执行 `alembic upgrade head` 时失败：

```text
psycopg.errors.UndefinedTable: relation "conversations" does not exist
```

失败 SQL 是创建 `agent_runs`：

```sql
CREATE TABLE agent_runs (...
    FOREIGN KEY(conversation_id) REFERENCES conversations (id)
);
```

根因是初始 revision `889d9c5fcf68` 只有：

```python
def upgrade() -> None:
    pass
```

Day 1～2 已经在开发库中手工创建 `users / agents / conversations / messages`，Day 5 执行 `alembic revision --autogenerate` 时，Alembic 比较的是：

```text
SQLAlchemy metadata
        vs
已经有这些表的 agentlab_dev
```

两边没有差异，所以生成空迁移。开发库能运行，是因为表早已手工存在；全新数据库无法重建结构。

关键结论：

> `autogenerate` 不是把全部 Model 转成建表 SQL，而是比较 Model metadata 与当前目标数据库的结构差异。

初始迁移补全了：

```text
users
  → agents
      → conversations
          → messages
```

外键引用的目标表必须先创建，downgrade 必须按相反顺序删除：

```text
messages
  → conversations
      → agents
          → users
```

迁移已验证：

```text
空测试库
  → upgrade head 成功
  → downgrade base 成功
  → 再次 upgrade head 成功
```

最终版本：

```text
1691672c5ae9
```

最终业务表：

```text
users
agents
conversations
messages
agent_runs
run_steps
tool_calls
tool_approvals
```

数据库结构迁移中应使用数据库默认值：

```python
server_default=sa.text("now()")
```

它与 ORM 的 Python 默认值不同：

```text
default         → SQLAlchemy 应用层填值
server_default  → 写进 PostgreSQL DDL，由数据库填值
```

---

### 3. queued 基线数据与稳定排序

测试库创建了 3 条 queued Run：

```text
id=1  day8-run-1  queued
id=2  day8-run-2  queued
id=3  day8-run-3  queued
```

三条记录的 `created_at` 完全相同：

```text
2026-07-16 09:04:26.051959+00
```

原因是 PostgreSQL 的 `now()` 返回事务开始时间，同一事务内保持稳定，不是每行执行时重新读取墙上时钟。

因此只使用：

```sql
ORDER BY created_at
```

不能保证相同时间记录的稳定顺序。领取查询使用：

```sql
ORDER BY created_at, id
```

`id` 作为第二排序键，保证领取顺序确定。

---

### 4. 双会话 `SKIP LOCKED` 实验

会话 A：

```text
PID = 33304
领取并锁住 id=1
```

会话 B：

```text
PID = 33598
跳过 A 锁住的 id=1，立即返回 id=2
```

两边执行的 SQL：

```sql
SELECT id, status, idempotency_key, created_at
FROM agent_runs
WHERE status = 'queued'
ORDER BY created_at, id
FOR UPDATE SKIP LOCKED
LIMIT 1;
```

普通第三方查询仍看到：

```text
1 queued
2 queued
3 queued
```

原因：

- `FOR UPDATE` 获取行锁，但不会隐藏行。
- A、B 此时只锁定，没有提交状态修改。
- PostgreSQL 普通 MVCC SELECT 不需要获取冲突行锁，因此不会被阻塞。

`SKIP LOCKED` 的含义不是“没有锁”，而是：

> 当前语句遇到无法立即锁定的候选行时，不等待它，继续寻找下一条可以锁定的记录。

它适合任务队列，因为 Worker 可以处理其他任务；不适合要求完整、一致结果集的普通业务查询，因为返回结果会主动忽略被锁行。

---

### 5. 不使用 `SKIP LOCKED` 的锁等待

会话 C：

```text
PID = 33841
```

执行普通 `FOR UPDATE` 后等待 id=1。观察 SQL：

```sql
SELECT
    pid,
    state,
    wait_event_type,
    wait_event,
    pg_blocking_pids(pid) AS blocked_by
FROM pg_stat_activity
WHERE pid = 33841;
```

实际结果：

```text
pid             = 33841
state           = active
wait_event_type = Lock
wait_event      = transactionid
blocked_by      = {33304}
```

解释：

- `state=active` 表示 SQL 尚未执行结束，不代表一直消耗 CPU。
- `wait_event_type=Lock` 表示实际在等待锁。
- `transactionid` 表示等待持锁事务结束，以判断目标行版本最终状态。
- `pg_blocking_pids()` 明确指出阻塞者是会话 A。

取消等待后，事务进入失败状态，psql 提示符可能变为：

```text
agentlab_test=!#
```

此时必须执行：

```sql
ROLLBACK;
```

---

### 6. 原子领取：锁定与更新处于同一事务

领取不能只做 SELECT。真正的领取过程是：

```text
找到 queued
  → 锁住该行
  → 更新 running 和 started_at
  → COMMIT
```

手工 SQL：

```sql
WITH candidate AS (
    SELECT id
    FROM agent_runs
    WHERE status = 'queued'
    ORDER BY created_at, id
    FOR UPDATE SKIP LOCKED
    LIMIT 1
)
UPDATE agent_runs AS run
SET status = 'running',
    started_at = now()
FROM candidate
WHERE run.id = candidate.id
RETURNING run.id, run.status, run.started_at;
```

实验中：

```text
会话 A：领取 id=1，COMMIT
会话 B：领取 id=2，ROLLBACK
```

最终状态：

```text
id=1  running  started_at 有值
id=2  queued   started_at NULL
id=3  queued   started_at NULL
```

这同时证明：

- COMMIT 后修改持久化并释放行锁。
- ROLLBACK 会撤销已经执行的 UPDATE，同时释放行锁。
- `flush/UPDATE 已执行` 不等于 `事务已提交`。

如果 SELECT 后立即释放锁，再单独 UPDATE，可能出现：

```text
Worker A SELECT Run 1
Worker B SELECT Run 1
Worker A UPDATE Run 1
Worker B UPDATE Run 1
```

因此锁必须从选中任务一直保持到状态更新及事务结束。

---

### 7. 原子性与隔离性的区别

本实验同时涉及 ACID 中的两个概念：

```text
原子性 Atomicity
    → 领取、更新及后续事务操作全部提交，或全部回滚

隔离性 Isolation
    → 一个 Worker 领取过程中，其他 Worker 不能同时领取同一行
```

不能只用“原子性”解释不重复领取。避免并发重复主要依赖事务隔离和行锁；异常后不留下部分状态主要体现原子性。

---

### 8. Repository / Service / Worker 分层

当前调用关系：

```text
Worker
  → 创建独立 AsyncSession
  → Service 控制事务
  → Repository 执行查询、锁和持久化
```

Repository：

```python
async def claim_next_queued_run(
    session: AsyncSession,
) -> AgentRun | None:
    stmt = (
        select(AgentRun)
        .where(AgentRun.status == "queued")
        .order_by(AgentRun.created_at, AgentRun.id)
        .with_for_update(skip_locked=True)
        .limit(1)
    )

    result = await session.execute(stmt)
    run = result.scalar_one_or_none()
    if run is None:
        return None

    run.status = "running"
    run.started_at = datetime.now(UTC)
    await session.flush()
    return run
```

Service：

```python
async def claim_next_run(
    session: AsyncSession,
) -> AgentRun | None:
    async with session.begin():
        run = await claim_next_queued_run(session)
    return run
```

职责：

```text
Repository
    → 如何查、如何锁、如何持久化
    → 可以 flush
    → 不 commit

Service
    → 业务规则和用例编排
    → 决定事务边界
    → session.begin() 正常退出时 commit，异常时 rollback

Worker
    → 什么时候领取、空队列等待多久、什么时候执行 Agent
```

前几天 Router 直接访问数据库是学习阶段结构，不代表最终结构。复杂、可复用、需要独立测试或涉及并发锁的查询更适合进入 Repository；简单 `/health` 查询不必机械包装 Repository。

---

### 9. `flush()`、`commit()` 与 autobegin

修改 ORM 对象：

```python
run.status = "running"
```

只修改 Python 内存中的对象。

执行：

```python
await session.flush()
```

SQLAlchemy 才发送 UPDATE，但事务仍未提交：

```text
当前事务可以看到修改
其他事务通常看不到未提交修改
仍然可以 ROLLBACK
```

`commit()` 提交整个数据库事务：

```text
修改对其他事务可见
行锁释放
普通 ROLLBACK 不能再撤销
```

日志中的：

```text
BEGIN (implicit)
```

表示 SQLAlchemy autobegin。`session.begin()` 建立 ORM 事务边界，第一次真正数据库 I/O 时才从连接池获取连接并自动发出 BEGIN，不需要业务代码手写 SQL `BEGIN`。

只读 Session 也可能出现：

```text
BEGIN
SELECT
ROLLBACK
```

因为 SELECT 同样触发 autobegin；如果 Session 关闭前没有显式提交，只读事务会回滚结束，这是正常行为。

---

### 10. 失败注入与事务回滚

实验流程：

```text
BEGIN
SELECT ... FOR UPDATE SKIP LOCKED
UPDATE id=3 SET status='running', started_at=...
flush 完成后故意抛出 RuntimeError
ROLLBACK
```

异常前，当前事务内对象：

```text
id=3
status=running
started_at 有值
```

回滚后重新查询：

```text
id=3
status=queued
started_at=None
```

结论：

> 即使 UPDATE 已发送到 PostgreSQL，只要事务没有 COMMIT，异常退出 `session.begin()` 就会回滚，不会留下部分状态。

---

### 11. 为什么并发任务不能共享 AsyncSession

`AsyncSession` 是有状态的工作单元，内部维护：

```text
当前数据库连接
当前事务
Identity Map
待 flush 对象
commit / rollback 状态
```

如果多个 Worker 共享 Session：

```text
Worker A 修改对象
Worker B flush，可能把 A 的修改一起发送
Worker A rollback，可能把 B 的操作一起回滚
```

正确方式：

```python
async def claim_one() -> AgentRun | None:
    async with test_session_factory() as session:
        return await claim_next_run(session)

results = await asyncio.gather(
    *(claim_one() for _ in range(5))
)
```

每个协程创建自己的 Session，因此各自拥有独立连接/事务执行流。

---

### 12. 并发自动化验证

测试场景：

```text
queued Run：3 条
并发 Worker：5 个
```

关键断言：

```python
claimed_ids = [run.id for run in results if run is not None]

assert len(claimed_ids) == 3
assert len(claimed_ids) == len(set(claimed_ids))
assert sum(run is None for run in results) == 2
```

含义：

- 只有 3 个 Worker 成功领取。
- 领取 ID 集合没有重复。
- 另外 2 个 Worker 正常返回 `None`，空队列不是异常。

已建立三个测试：

```text
test_concurrent_workers_do_not_claim_the_same_run
test_claim_rolls_back_when_later_work_fails
test_claim_returns_none_when_queue_is_empty
```

辅助执行结果：

```text
3 passed
```

该结果证明自动化代码当前通过；学习者仍需自行阅读测试的准备数据、并发 Session 和断言逻辑，不能只记住“3 passed”。

测试前后执行：

```sql
TRUNCATE TABLE users RESTART IDENTITY CASCADE;
```

它会通过外键级联清理测试业务数据，但不删除 `alembic_version`。因为 TRUNCATE 具有破坏性，执行前必须通过 `_test` 数据库名保护。

---

### 13. `FOR UPDATE` 与 `SKIP LOCKED` 的使用边界

领取任意下一条任务：

```python
.with_for_update(skip_locked=True)
```

如果第一条被锁，可以跳过并领取下一条。

根据指定 ID 执行状态转换：

```python
.with_for_update()
```

不能使用 `SKIP LOCKED`。否则返回 `None` 时无法区分：

```text
Run 不存在
Run 存在但暂时被其他事务锁住
```

指定 Run 的状态转换应等待锁释放，然后读取最新状态并重新验证前置状态。

Repository 已增加：

```python
async def get_run_for_update(
    session: AsyncSession,
    run_id: int,
) -> AgentRun | None:
    stmt = (
        select(AgentRun)
        .where(AgentRun.id == run_id)
        .with_for_update()
    )
    result = await session.execute(stmt)
    return result.scalar_one_or_none()
```

Repository 不把 `status == "running"` 放入 WHERE，因为返回 `None` 时 Service 需要区分“记录不存在”和“记录存在但状态非法”。

---

### 14. 业务异常：定义、判断与抛出

异常类只描述错误类型和携带的信息，不会自动进行业务判断：

```python
class RunNotFoundError(Exception):
    def __init__(self, run_id: int) -> None:
        self.run_id = run_id
        super().__init__(f"Run {run_id} does not exist")
```

仅创建对象不会报错：

```python
error = RunNotFoundError(123)
```

真正中断流程的是：

```python
raise RunNotFoundError(123)
```

未来 Service 中的完整职责：

```python
run = await get_run_for_update(session, run_id)

if run is None:
    raise RunNotFoundError(run_id)

if run.status != "running":
    raise InvalidRunTransitionError(
        run_id=run.id,
        current_status=run.status,
        target_status="completed",
    )
```

可以记成：

```text
if 判断  → 决定什么时候出错
异常类   → 描述出了什么错
raise    → 真正触发异常
```

Service 不抛 `HTTPException`，因为它也会被 Worker 和测试调用。Router 负责把业务异常转换为 HTTP 404/409。

---

### 15. 状态转换并发原则

当前计划允许：

```text
queued  → running
running → completed
running → failed
```

状态转换不能只写：

```python
run.status = "completed"
```

必须先锁行，再检查最新前置状态，否则可能产生：

```text
queued → completed
completed → running
cancelled → completed
```

这些记录会破坏运行历史，例如 completed 却没有 started_at 或实际执行过程。

一个事务不能回滚另一个事务。取消与完成竞争时，正确方式是：

```text
事务 A 获得 Run 行锁并完成转换
事务 B 等待
A 提交并释放锁
B 获得锁后读取最新状态
B 根据最新状态决定转换或拒绝
```

如果 A 先 completed，B 应拒绝 cancelled；如果 B 先 cancelled，A 应拒绝 completed。

数据库状态改成 cancelled 也不等于 Python 中正在执行的模型/工具调用会自动停止。执行层还需要取消信号和协作式中断，这是后续主题。

---

### 16. Windows 异步事件循环

Windows Python 默认可能使用 `ProactorEventLoop`，Psycopg 3 异步连接报错：

```text
Psycopg cannot use the 'ProactorEventLoop' to run in async mode
```

一次性脚本使用：

```python
asyncio.run(
    main(),
    loop_factory=asyncio.SelectorEventLoop,
)
```

pytest-asyncio 使用 `pytest_asyncio_loop_factories` hook 提供 Selector loop。每次连接失败都要区分：

```text
SQL / 事务错误
数据库连接错误
平台事件循环不兼容
```

本次问题发生在建立异步连接阶段，与 `SKIP LOCKED` SQL 本身无关。

---

### 17. Worker 领取查询的 EXPLAIN 与部分索引优化

#### 17.1 实验数据

测试表共 10000 条 Run：

```text
completed = 9500
queued    = 500
```

查询目标：

```sql
SELECT id
FROM agent_runs
WHERE status = 'queued'
ORDER BY created_at, id
FOR UPDATE SKIP LOCKED
LIMIT 1;
```

SQL 各部分对应的需求：

```text
WHERE status = 'queued'
    → 只领取等待中的任务

ORDER BY created_at, id
    → 先按创建时间领取；时间相同用 id 保证稳定顺序

FOR UPDATE SKIP LOCKED
    → 锁住候选任务；跳过其他 Worker 已锁住的任务

LIMIT 1
    → 每次最多领取一个任务
```

#### 17.2 无索引执行计划

```text
Limit  (actual time=0.451..0.451 rows=1)
  Buffers: shared hit=124
  -> LockRows  (actual time=0.450..0.450 rows=1)
       -> Sort  (actual time=0.437..0.438 rows=1)
            Sort Key: created_at, id
            Sort Method: quicksort  Memory: 44kB
            -> Seq Scan on agent_runs
                 (actual time=0.005..0.383 rows=500)
                 Filter: status = 'queued'
                 Rows Removed by Filter: 9500
                 Buffers: shared hit=122
Planning Time: 0.089 ms
Execution Time: 0.466 ms
```

执行计划显示顺序是从上到下，但理解数据流时从最内层向外读：

```text
Seq Scan
  → Sort
      → LockRows
          → Limit
```

实际工作：

```text
扫描 10000 行
→ 丢弃 9500 条非 queued
→ 保留 500 条 queued
→ 按 created_at、id 排序
→ 尝试锁住排序后的第一条
→ 返回 1 条
```

即使查询有 `LIMIT 1`，没有合适索引时也不能提前停止。数据库在扫描和排序完成前，无法证明后面不存在创建时间更早的 queued Run。

关键指标：

```text
rows=500
    → 优化器估算符合条件 500 条

actual rows=500
    → 实际也是 500 条，ANALYZE 后估算准确

Rows Removed by Filter=9500
    → 全表扫描时过滤掉 9500 条

shared hit=122
    → 122 个数据页已在 PostgreSQL shared_buffers 中
    → 不是 122 次磁盘读取

shared read
    → 表示页面需要读入 shared_buffers
    → 仍可能命中操作系统页缓存，不必然等于物理磁盘 I/O
```

父节点 Buffers 通常包含子节点贡献，不能把每层的 hit 相加。整条查询最终主要访问约 124 个共享缓冲页。

`cost` 是优化器内部相对成本，不是毫秒；`actual time` 才是实测毫秒。

#### 17.3 Heap 中的数据为什么需要全表扫描

heap 保存完整行，但物理排列不保证按 status 或 created_at 有序：

```text
数据页 1   [completed][completed][queued]...
数据页 2   [completed][queued][completed]...
...
数据页 122 [queued][completed]...
```

没有索引时，PostgreSQL不知道 queued 位于哪些数据页，也不知道哪条 queued 最早，只能逐行检查并在之后排序。

#### 17.4 部分 B-Tree 索引

实验索引：

```sql
CREATE INDEX idx_agent_runs_queued_created_id
ON agent_runs (created_at, id)
WHERE status = 'queued';
```

它同时利用两个设计：

```text
部分索引谓词 WHERE status = 'queued'
    → 索引只保存 500 条 queued
    → 9500 条 completed 不进入索引

B-Tree 键 (created_at, id)
    → 索引叶子项已经按领取顺序排列
```

索引叶子页可以概念化为：

```text
(created_at=最早, id=10000) → heap tuple 位置
(created_at=次早, id=9980)  → heap tuple 位置
(created_at=更晚, id=9960)  → heap tuple 位置
...
```

索引项保存排序键和指向 heap tuple 的位置，不保存整张业务行。

#### 17.5 索引后的执行计划

```text
Limit  (cost=0.27..0.77 rows=1)
       (actual time=0.074..0.074 rows=1)
  Buffers: shared hit=3 read=2
  -> LockRows
       (actual time=0.073..0.073 rows=1)
       -> Index Scan using idx_agent_runs_queued_created_id
            (actual time=0.067..0.067 rows=1)
            Filter: status = 'queued'
            Index Searches: 1
            Buffers: shared hit=1 read=2
Planning Time: 0.227 ms
Execution Time: 0.091 ms
```

新数据流：

```text
从部分 B-Tree 最左侧读取第一条 queued 候选
→ 根据索引中的 tuple 位置访问 heap
→ LockRows 尝试获取行锁
→ 成功后 Limit 返回一条
```

不再出现：

```text
Seq Scan
Sort
Rows Removed by Filter
```

计划仍显示 `Filter: status = 'queued'`，但没有 `Rows Removed by Filter`。部分索引本身不包含 completed，因此没有重新扫描和丢弃 9500 条记录。

#### 17.6 为什么不是 Index Only Scan

查询虽然只返回 id，但包含：

```sql
FOR UPDATE
```

PostgreSQL必须访问真实 heap tuple，才能检查 MVCC 可见性并获得行锁。因此使用 Index Scan，不能完全依靠索引完成 Index Only Scan。

#### 17.7 索引与 SKIP LOCKED 的配合

假设索引前几项是：

```text
Run 20 → Run 40 → Run 60
```

并发领取：

```text
Worker A
    → 从索引读取 Run 20
    → 访问 heap 并锁住 Run 20

Worker B
    → 也从索引读取 Run 20
    → heap 行已被 A 锁住
    → SKIP LOCKED 跳过
    → 沿索引读取 Run 40 并加锁
```

索引负责快速、有序地给出候选；`SKIP LOCKED` 负责跳过当前无法锁定的候选。

#### 17.8 优化前后对比

| 指标 | 无索引 | 部分索引 |
|------|--------|----------|
| 扫描方式 | Seq Scan | Index Scan |
| 扫描数据 | 10000 行 | 从 queued 索引开头取候选 |
| 过滤掉 | 9500 行 | 0 行 |
| 排序 | 500 行 quicksort | 无 Sort |
| 执行 Buffers | shared hit=124 | shared hit=3 read=2 |
| 执行时间 | 0.466 ms | 0.091 ms |

执行时间约降低到原来的五分之一，执行阶段访问页从约 124 降到约 5。更重要的是，算法从随表规模增长的全表扫描和排序，变成从较小的 queued 部分索引开头读取。

#### 17.9 索引写入成本

索引不是免费优化：

```text
INSERT queued
    → 写 heap、主键/唯一索引、queued 部分索引和 WAL

queued → running
    → 新版本不再满足部分索引谓词
    → 需要维护索引，旧索引项后续由 VACUUM 清理

running/failed/completed
    → 不在该部分索引中

恢复为 queued
    → 重新加入部分索引
```

收益针对高频 Worker 领取查询；代价主要发生在任务创建和状态离开/进入 queued 时。

#### 17.10 索引验收结论

该索引回答了五个问题：

```text
优化查询
    → queued + created_at/id + LIMIT 1 的 Worker 领取

过滤与排序
    → 部分谓词匹配 WHERE；键顺序匹配 ORDER BY

冗余性
    → 主键 id 和幂等键索引都不能同时支持该过滤与排序

写入成本
    → 增加 queued 状态相关索引维护、WAL、空间和 VACUUM 工作

效果证明
    → 保存了 EXPLAIN (ANALYZE, BUFFERS) 前后计划
```

索引已写入 Alembic revision：

```text
a5115b5cf9a2 add queued run claim index
```

可逆性验证结果：

```text
初始版本：1691672c5ae9，索引不存在
upgrade head：版本变为 a5115b5cf9a2，索引创建
downgrade -1：版本回到 1691672c5ae9，索引数量为 0
再次 upgrade head：版本恢复 a5115b5cf9a2，索引恢复
```

最终测试库状态：

```text
alembic_version = a5115b5cf9a2
index = idx_agent_runs_queued_created_id
```

ORM `AgentRun.__table_args__` 也声明了同名部分索引，避免未来 autogenerate 将数据库索引误判为模型之外的多余对象。

---

### 18. 状态机测试与时区感知默认值

状态机最终支持：

```text
queued  → running
running → completed
running → failed
```

并拒绝：

```text
queued    → completed
queued    → failed
completed → running
failed    → completed
```

`complete_run()` 和 `fail_run()` 都在 `session.begin()` 内使用 `get_run_for_update()` 锁住指定 Run，读取锁释放后的最新状态，再检查前置状态是否为 running。

最终测试覆盖：

```text
5 个 Worker 并发领取 3 条 Run，ID 无重复
领取后续失败时整笔事务回滚
空队列返回 None
running → completed 成功并持久化
不存在的 Run 完成时报 RunNotFoundError
queued → completed 报 InvalidRunTransitionError
running → failed 成功并保存错误原因
不存在的 Run 失败时报 RunNotFoundError
queued → failed 报 InvalidRunTransitionError
空白 error_message 被拒绝
```

最终结果：

```text
10 passed in 0.75s
```

原模型使用：

```python
default=datetime.utcnow
```

它返回没有 `tzinfo` 的 naive datetime，并在 Python 3.12 产生弃用警告。项目字段使用 PostgreSQL `TIMESTAMPTZ`，因此改为时区感知 UTC callable：

```python
from datetime import UTC, datetime


def utc_now() -> datetime:
    return datetime.now(UTC)
```

所有 ORM 时间默认值使用：

```python
default=utc_now
```

这里不能写 `default=utc_now()`，否则函数会在模块导入时立即执行，后续对象可能复用导入时刻。传入 callable 后，SQLAlchemy 在每次 INSERT 需要默认值时调用它。

修复后完整测试仍为：

```text
10 passed
0 warnings
```

---

## 遇到的问题

| 现象 | 根因 | 处理与验证 |
|------|------|------------|
| 测试库没有表 | Alembic 初始 revision 是空迁移 | 补全基础迁移，验证 `upgrade → downgrade → upgrade` |
| 创建 `agent_runs` 报 `conversations` 不存在 | 外键目标表未进入迁移链 | 按依赖顺序创建四张基础表 |
| Alembic 总是连接开发库 | `alembic.ini` 硬编码 URL | `migrations/env.py` 从 Settings 覆盖 URL |
| Mapper 找不到 `run_steps` | `AgentRun` 属性名与 `back_populates` 不一致 | 统一关系两端的属性名并重新验证 Mapper 配置 |
| psql 出现 `idle in transaction` | 实验窗口未结束事务 | 显式 ROLLBACK，并查询 `pg_stat_activity` 验证为 0 |
| 异步脚本找不到 `app` | 直接执行文件时 `scripts/` 成为导入起点 | 从项目根目录使用 `python -m scripts...` |
| Psycopg 拒绝 ProactorEventLoop | Windows 默认事件循环与异步 Psycopg 不兼容 | 使用 SelectorEventLoop |
| pytest 未安装 | dev 可选依赖尚未同步 | 执行 `uv sync --extra dev` |
| 测试出现 `datetime.utcnow()` 警告 | Python 3.12 弃用无时区 UTC API | 改为 `utc_now()` 时区感知 callable，测试警告归零 |

---

## 最终复盘

### 1. Worker 在 COMMIT 前后崩溃

如果 Worker 已经执行 UPDATE，但在 COMMIT 前连接断开：

```text
PostgreSQL 检测到连接消失
→ 当前未提交事务自动 ROLLBACK
→ 行锁释放
→ Run 恢复为原来的 queued
```

事务不会永久停留在 aborted。`aborted` 是连接仍存在但事务内语句失败时的会话状态；进程/连接消失后，数据库会清理并回滚该事务。

如果 Worker 在 COMMIT 后、真正执行 Agent 前崩溃：

```text
queued → running 已经持久化
→ Run 留在 running
→ 没有 Worker 继续执行
```

这类任务需要 Day 9 的心跳、超时扫描或租约恢复，不能依赖事务自动回滚。

### 2. 为什么两种 FOR UPDATE 策略不同

领取任意任务：

```sql
FOR UPDATE SKIP LOCKED
```

Run 1 被锁时，Worker 可以改领 Run 2，任务之间可以替代；跳过能避免排队等待。

更新指定 `run_id`：

```sql
FOR UPDATE
```

调用方要求操作的就是该 Run，不能用另一个 Run 替代。若使用 `SKIP LOCKED` 返回 None，Service 无法区分“Run 不存在”和“Run 暂时被锁”。因此应等待锁释放，读取最新状态，再验证转换是否合法。

### 3. 部分索引如何逐项匹配 SQL

```sql
CREATE INDEX ...
ON agent_runs (created_at, id)
WHERE status = 'queued';
```

对应：

```text
WHERE status = 'queued'
    → 匹配部分索引谓词；非 queued 不进入索引

ORDER BY created_at, id
    → 匹配 B-Tree 键顺序；无需额外 Sort

LIMIT 1
    → 从有序索引开头取得第一条可锁候选后停止
```

PostgreSQL称该访问方法为 B-Tree。理解时可以把叶子项看作按键排序并指向 heap tuple，但不必用其他数据库结构名称替代 PostgreSQL 文档术语。

### 4. Model、Migration 与 Alembic 版本链

Model 中的 `Index(...)` 只描述应用期望的 metadata，不会自动修改已有数据库。

Migration 的 `upgrade()` / `downgrade()` 才执行真实 DDL：

```text
upgrade   → CREATE INDEX
downgrade → DROP INDEX
```

`alembic current` 只读取并显示 `alembic_version`，不会执行迁移。

`alembic upgrade head` 的过程：

```text
读取数据库当前 version_num
→ 根据 revision/down_revision 找到 current 到 head 的路径
→ 依次执行缺失 revision 的 upgrade()
→ 成功后更新 alembic_version
```

`alembic downgrade -1` 调用当前 revision 的 `downgrade()`，成功后把版本号退回其 `down_revision`。

---

## 当前完成内容

```text
[x] 测试数据库隔离与安全检查
[x] 空数据库完整迁移验证
[x] 双会话 SKIP LOCKED
[x] 普通 FOR UPDATE 锁等待观察
[x] pg_blocking_pids 阻塞链观察
[x] queued → running 原子领取
[x] Repository / Service 分层
[x] 成功 COMMIT 实验
[x] 失败 ROLLBACK 实验
[x] 多 Session 并发测试
[x] 空队列返回 None
[x] Run 业务异常类型
[x] 指定 Run 的 get_run_for_update
[x] running → completed
[x] running → failed
[x] 非法状态转换测试
[x] EXPLAIN (ANALYZE, BUFFERS) 基线及索引对照
[x] 将有效的部分索引写入 Alembic migration，并验证 upgrade/downgrade
[x] 统一 Service 格式并清理尾随空白
[x] `datetime.utcnow()` 改为时区感知 UTC callable
[x] Day 8 最终复盘与 Git 提交
```

---

## 仍不理解或待深入内容

- [ ] `FOR UPDATE SKIP LOCKED` 是否保证严格 FIFO 和公平性
- [ ] running 任务的超时、租约、心跳与恢复
- [ ] Serializable SSI 与任务队列的关系
- [ ] PostgreSQL 队列在高吞吐下与 Redis / RabbitMQ 的边界
- [ ] 幂等约束从全局 key 调整为 `(conversation_id, idempotency_key)`
- [ ] 状态合法值 CHECK 与应用状态转换规则的职责边界

---

## Day 9 预习

- running 任务超时恢复
- retry_count、max_retries 与可重试异常
- Worker 心跳和优雅关闭
- 工具调用的幂等性与副作用边界
