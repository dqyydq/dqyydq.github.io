---
title: "Day 9：任务恢复、重试与 Worker 心跳"
pubDate: 2026-07-18
description: "处理 Worker 在提交前后崩溃的不同场景，使用 heartbeat_at 检测 stale Run，设计重试上限与恢复分支，并通过事务回滚、状态机和 18 项并发测试验证可靠性。"
type: 学习日志
tags: ["PostgreSQL", "FastAPI", "SQLAlchemy", "任务恢复", "重试", "Worker"]
featured: false
series: fastapi-postgres-learning
seriesOrder: 9
---

## 前言

Day 8 解决了 Worker 如何安全领取 queued Run，但任务在领取成功后仍可能遇到一个无法靠普通事务解决的问题：Worker 已经提交 `queued → running`，随后进程却崩溃了。此时任务不会自动回到队列，也不能无限停留在 `running`。

Day 9 围绕这个故障窗口实现恢复机制：用 `heartbeat_at` 判断 Worker 是否仍然存活，用 `retry_count` 和 `max_retries` 限制重试次数，在同一事务中把 stale Run 恢复为 `queued` 或终止为 `failed`，并用独立 Session 的并发测试验证回滚和状态转换。最终 18 项测试通过，心跳更新循环也已完成；独立 recovery worker / sweeper 的周期调度留作后续工作。

---

## 今日目标

- 理解 Worker 在 `COMMIT` 前后崩溃时的不同结果。
- 使用 `started_at` 检测运行时间过长的 `running` Run。
- 使用 `retry_count` 和 `max_retries` 防止任务无限重试。
- 使用 `CASE WHEN` 实现 stale Run 的恢复分支。
- 理解 `heartbeat_at` 的作用，以及恢复 Worker / sweeper 的职责。
- 为 Run 增加重试字段和 heartbeat 字段。
- 通过测试验证最大重试次数、事务回滚和 heartbeat 初始化。

## 今日完成情况

```text
[x] stale running Run 检测
[x] stale Run 原子恢复实验
[x] retry_count / max_retries migration
[x] 最大重试次数领取测试
[x] retryable / exhausted 两个恢复分支
[x] heartbeat_at migration
[x] 领取时初始化 heartbeat_at
[x] heartbeat 回滚测试
[x] 18 个 Worker 状态和并发测试通过
[x] 将恢复 SQL 抽象为正式 Repository / Service
[x] 实现 heartbeat loop
[x] 实现 heartbeat loop 测试
[x] 验证恢复事务中途失败时整体回滚
[ ] 实现 recovery worker / sweeper 调度循环
[x] Day 9 最终整理与 Git 提交
```

## 一、COMMIT 前后崩溃

领取任务的事务大致是：

```text
BEGIN
  SELECT ... FOR UPDATE SKIP LOCKED
  status = running
  retry_count = retry_count + 1
  started_at = now()
  heartbeat_at = now()
COMMIT
```

如果 Worker 在 COMMIT 前崩溃：

```text
连接断开
-> PostgreSQL 回滚未提交事务
-> status 仍为 queued
-> retry_count 不增加
-> started_at / heartbeat_at 不保存
-> 行锁释放
```

如果 Worker 在 COMMIT 后、执行 Agent 前崩溃：

```text
queued -> running 已经持久化
-> retry_count 已经增加
-> Worker 没有继续执行
-> Run 会一直停在 running
```

第二种情况不能依赖事务回滚解决，需要 recovery worker 根据 heartbeat 或租约发现任务失联。

`aborted` 是连接仍然存在但事务内语句失败后的事务状态。进程或连接消失后，PostgreSQL 会清理连接并回滚未提交事务，不会把数据库行永久保存为 aborted。

## 二、stale Run 检测

第一版使用 `started_at` 作为临时检测依据：

```sql
SELECT id, status, started_at
FROM agent_runs
WHERE status = 'running'
  AND started_at < now() - interval '5 minutes'
ORDER BY started_at, id
FOR UPDATE SKIP LOCKED;
```

各部分含义：

```text
status = running
    -> 只检查正在执行的任务

started_at < now() - interval '5 minutes'
    -> 只检查运行超过阈值的任务

ORDER BY started_at, id
    -> 优先检查最早开始、最可能长期滞留的任务

FOR UPDATE SKIP LOCKED
    -> 锁定候选任务，并跳过其他恢复 Worker 已经锁住的任务
```

实验创建了两个 Run：

```text
一个 started_at 为 10 分钟前
一个 started_at 为 1 分钟前
```

检测查询只返回了超过 10 分钟的 Run，最近启动的 Run 没有被误判为 stale。

### started_at 的局限

`started_at` 只记录任务开始时间，不会随着 Worker 活动更新：

```text
任务执行 10 分钟，但 Worker 仍然活跃
-> started_at 仍然是 10 分钟前
-> 可能被错误恢复
```

因此正式实现应使用 `heartbeat_at`，而不是只依赖 `started_at`。

## 三、stale Run 恢复事务

实验脚本为：

```text
sql/day9_recover_stale_runs.sql
```

核心结构：

```sql
BEGIN;

WITH stale_runs AS (
    SELECT id
    FROM agent_runs
    WHERE status = 'running'
      AND started_at < now() - interval '5 minutes'
    ORDER BY started_at, id
    FOR UPDATE SKIP LOCKED
), recovered_runs AS (
    UPDATE agent_runs AS run
    SET ...
    FROM stale_runs
    WHERE run.id = stale_runs.id
    RETURNING
        run.id,
        run.status,
        run.retry_count,
        run.max_retries,
        run.started_at,
        run.completed_at,
        run.error_message
)
SELECT *
FROM recovered_runs
ORDER BY id;

COMMIT;
```

`stale_runs` 先在当前事务中选出并锁住候选行，`UPDATE` 只处理这些候选行。多个 recovery worker 并发执行时，同一条 Run 不会被重复恢复。

## 四、retry_count 与 max_retries

新增字段：

```sql
retry_count INTEGER NOT NULL DEFAULT 0
max_retries INTEGER NOT NULL DEFAULT 3
```

含义：

```text
retry_count
    已经开始执行过多少次

max_retries
    允许开始执行的最大次数
```

领取时检查：

```python
AgentRun.status == "queued"
AgentRun.retry_count < AgentRun.max_retries
```

领取成功后，在同一个事务中：

```python
run.status = "running"
run.retry_count += 1
run.started_at = now
run.heartbeat_at = now
```

达到上限的任务：

```text
retry_count = 3
max_retries = 3
3 < 3 = False
-> 不会被领取
```

这个条件必须放在数据库查询中，而不是先查出任务后再用 Python 判断。多个 Worker 并发时，条件判断、加锁和更新必须属于同一个事务。

## 五、stale 恢复分支

不能把 `retry_count >= max_retries` 的 stale Run 直接从查询中排除：

```sql
AND retry_count < max_retries
```

如果这样做，达到上限的 Run 会继续停留在 `running`，永远不会被处理。

应该先查询全部 stale running Run，再用 SQL `CASE` 分支：

```sql
SET status = CASE
                 WHEN run.retry_count < run.max_retries THEN 'queued'
                 ELSE 'failed'
             END,
    started_at = NULL,
    completed_at = CASE
                       WHEN run.retry_count < run.max_retries THEN NULL
                       ELSE now()
                   END,
    heartbeat_at = NULL,
    error_message = CASE
                        WHEN run.retry_count < run.max_retries THEN NULL
                        ELSE 'worker lease expired; max retries exceeded'
                    END
```

恢复规则：

```text
stale 且 retry_count < max_retries
    -> queued
    -> 等待再次领取
    -> completed_at = NULL
    -> error_message = NULL

stale 且 retry_count >= max_retries
    -> failed
    -> 停止重试
    -> completed_at = now()
    -> 保存失败原因
```

恢复时不增加 `retry_count`，因为计数已经在每次领取时增加，表示一次执行尝试已经开始。

实验脚本：

```text
sql/day9_retry_recovery_experiment.sql
```

实验数据：

```text
day9-retryable-1
    retry_count = 2
    max_retries = 3

 day9-exhausted-1
    retry_count = 3
    max_retries = 3
```

恢复结果：

```text
day9-retryable-1
    status = queued
    completed_at = NULL

 day9-exhausted-1
    status = failed
    completed_at = 2026-07-18 02:57:59.165716+00
    error_message = worker lease expired; max retries exceeded
```

## 六、heartbeat_at

新增字段：

```sql
heartbeat_at TIMESTAMPTZ NULL
```

不同状态的预期值：

```text
queued
    heartbeat_at = NULL

领取任务
    heartbeat_at = now()

Worker 正常执行
    定期更新 heartbeat_at

completed / failed
    heartbeat_at = NULL

恢复为 queued 或 failed
    heartbeat_at = NULL
```

心跳由执行 Worker 定期更新，恢复 Worker / sweeper 周期性检查：

```sql
SELECT id
FROM agent_runs
WHERE status = 'running'
  AND heartbeat_at IS NOT NULL
  AND heartbeat_at < now() - interval '30 seconds'
FOR UPDATE SKIP LOCKED;
```

例如：

```text
heartbeat interval = 10 秒
stale timeout = 30 秒
```

只要 heartbeat 是 5 秒前更新，任务就不应被恢复。heartbeat 超过 30 秒没有更新，才进入 stale 候选。

恢复 Worker 不能只在启动时扫描一次，因为启动后仍然可能有新的 Worker 崩溃。它应该持续运行：

```text
while not stopping:
    recover_stale_runs()
    sleep(10)
```

## 七、Alembic 迁移

Day 9 新增迁移链：

```text
a5115b5cf9a2
    -> queued 部分索引

5ff12f6206f4
    -> retry_count
    -> max_retries

3f513b8d44eb
    -> heartbeat_at
```

迁移验证：

```text
测试库原版本：5ff12f6206f4
执行 upgrade head
最终版本：3f513b8d44eb
heartbeat_at 类型：timestamp with time zone
heartbeat_at 可空：YES
```

曾经误把 `heartbeat_at` 添加到已经执行过的 retry migration，随后修正为新的 revision。结论：

```text
已经执行的 migration 是历史事实，不应修改
新的数据库变化必须创建新的 migration
```

## 八、测试结果

Worker 状态、重试和并发测试最终结果：

```text
18 passed
```

新增测试覆盖：

```text
[x] retry_count 从 0 增加到 1
[x] retry_count >= max_retries 的 Run 不会被领取
[x] 领取成功后 heartbeat_at 不为空
[x] heartbeat_at 与 started_at 使用同一个领取时间
[x] 领取事务回滚后 heartbeat_at 仍为空
[x] 5 个 Worker 并发领取不重复
[x] 空队列返回 None
[x] stale 恢复 queued / failed 两个分支的 SQL 实验
[x] recovery Service 的 queued / failed 分支
[x] recovery Service 中途失败时整体回滚
[x] heartbeat loop 更新并在 stop_event 后退出
```

## 九、当前遗留问题

```text
- [ ] 将 heartbeat loop 接入完整 Agent 执行包装器
- [ ] 实现独立 recovery worker / sweeper 调度循环
- [ ] 设计 heartbeat 更新失败时的处理
- [ ] 设计 retryable / non-retryable 异常分类
- [ ] 完善工具调用的幂等性，避免恢复后产生重复副作用
- [ ] 更新 docs/progress.md
- [ ] Day 9 最终 Git 提交
```

## Day 10 预习

- Worker 事件循环和优雅关闭。
- heartbeat 更新循环。
- recovery worker 的周期调度。
- 可重试异常和不可重试异常。
- 工具调用幂等性。
