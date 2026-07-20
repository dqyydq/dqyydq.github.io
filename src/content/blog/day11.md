---
title: "Day 11：心跳失败、异常分类与工具调用幂等性"
pubDate: 2026-07-19
description: "为 Worker 增加可重试与不可重试异常分类，保存 Agent 输出，设计 ToolCall 状态机和幂等键，并处理外部副作用与数据库事务无法共同回滚的边界。"
type: 学习日志
tags: ["PostgreSQL", "FastAPI", "SQLAlchemy", "幂等性", "ToolCall", "异常处理"]
featured: false
series: fastapi-postgres-learning
seriesOrder: 11
---

## 前言

Day 10 解决了 Worker 如何执行任务和优雅关闭，Day 11 开始处理执行结果的不确定性：哪些异常可以重试，哪些异常必须立即失败？Agent 输出如何与 Run、Message、RunStep 一起提交？工具已经产生外部副作用但数据库提交失败时，又该如何避免重复执行？

本文把这些问题落到代码和 PostgreSQL 约束上，覆盖 heartbeat 失败策略、异常分类、Agent 输出持久化、ToolCall 幂等键、原子领取、工具执行包装器、Registry、安全基础工具和 stale ToolCall recovery。核心结论是：数据库可以保证记录和状态转换的一致性，但不能替外部邮件、支付或发布操作提供 exactly-once 保证。

---

## 今日主题

Heartbeat 失败策略、Agent 异常分类、Run 重试，以及 Agent 输出保存。

## 今日进度

```text
[x] heartbeat 更新失败策略
[x] 可重试/不可重试异常分类
[x] 保存 Agent 输出到 Message / RunStep
[x] 工具调用幂等性与副作用保护
[x] Supervisor / Worker main
[x] 文档收尾与 Git 提交
```

## 一、Run 总体流程

```text
                         +--------------------+
                         | API 创建 Run        |
                         +---------+----------+
                                   |
                                   v
                         +--------------------+
                         | queued             |
                         +---------+----------+
                                   | Worker claim
                                   v
                         +--------------------+
                         | running            |
                         | retry_count += 1   |
                         +---------+----------+
                                   |
             +---------------------+---------------------+
             |                     |                     |
             | Agent 成功           | 可重试异常           | 不可重试/未知异常
             v                     v                     v
+------------------------+ +--------------------+ +--------------------+
| 保存 Message           | | retry_count        | | 保存错误            |
| 保存 RunStep           | | < max_retries      | | running -> failed   |
| running -> completed   | +---------+----------+ +--------------------+
+-----------+------------+           |
            |                        | 是
            |                        v
            |              +--------------------+
            |              | running -> queued  |
            |              | 等待下一次领取       |
            |              +---------+----------+
            |                        |
            |                        +------> Worker 再次领取
            v
    +---------------+
    | completed     |
    +---------------+

running
   |
   | Worker 崩溃，heartbeat 停止
   v
heartbeat_at 过期
   |
   v
recovery_loop
   |
   +-- 还有重试次数 ------> queued
   |
   +-- 达到重试上限 ------> failed
```

## 二、领取任务

Worker 使用 PostgreSQL 队列领取任务：

```sql
SELECT id
FROM agent_runs
WHERE status = 'queued'
  AND retry_count < max_retries
ORDER BY created_at, id
FOR UPDATE SKIP LOCKED
LIMIT 1;
```

领取和状态更新在同一个事务中完成：

```text
queued -> running
retry_count += 1
started_at = now()
heartbeat_at = now()
COMMIT
```

`retry_count` 表示已经开始过多少次执行尝试，而不是失败次数。

## 三、Heartbeat 流程

```text
running
   |
   v
heartbeat_loop 定期更新 heartbeat_at
   |
   +-- 更新成功 ----------------------> 继续下一轮
   |
   +-- 返回 None ---------------------> Run 已不是 running，退出
   |
   +-- 第 1/2 次普通异常 --------------> 记录日志，继续重试
   |
   +-- 第 3 次连续异常 ----------------> heartbeat_loop 退出
```

Heartbeat 只负责证明 Worker 仍然活跃：

```sql
UPDATE agent_runs
SET heartbeat_at = now()
WHERE id = :run_id
  AND status = 'running'
RETURNING ...;
```

Heartbeat 不负责执行：

```text
running -> queued
running -> failed
```

失联 Run 的恢复由 `recovery_loop()` 负责。

## 四、Agent 成功流程

```text
Agent 返回 output
       |
       v
停止 heartbeat
       |
       v
complete_run_with_output()
       |
       +-- SELECT Run FOR UPDATE
       +-- 插入 assistant Message
       +-- 插入 final_output RunStep
       +-- running -> completed
       +-- heartbeat_at = NULL
       +-- error_message = NULL
       |
       v
     COMMIT
```

成功完成时，Message、RunStep 和 Run 状态在同一个事务中保存：

```python
message = Message(
    conversation_id=run.conversation_id,
    role="assistant",
    content=output,
)

step = RunStep(
    run_id=run.id,
    step_type="final_output",
    step_order=1,
    output_data={"content": output},
    completed_at=datetime.now(UTC),
)
```

如果 Message 或 RunStep 保存失败，整个事务回滚，Run 不会变成 `completed`。

## 五、异常分类

项目使用自己的业务异常，避免 Worker 直接依赖模型厂商 SDK 的异常类型：

```text
AgentExecutionError
+-- RetryableAgentError
+-- NonRetryableAgentError
```

分类规则：

```text
503 Service Unavailable       -> RetryableAgentError
模型请求超时                  -> RetryableAgentError
HTTP 429 限流                 -> RetryableAgentError
PostgreSQL deadlock           -> RetryableAgentError

401 Unauthorized              -> NonRetryableAgentError
工具参数校验失败              -> NonRetryableAgentError
模型名称不存在                -> NonRetryableAgentError
Python AttributeError         -> 未知异常，默认不可重试
```

Worker 捕获顺序必须是从具体到一般：

```python
except RetryableAgentError:
    ...
except NonRetryableAgentError:
    ...
except Exception:
    ...
```

## 六、可重试异常流程

```text
Agent 抛出 RetryableAgentError
       |
       v
retry_or_fail_run()
       |
       +-- 锁定 running Run
       +-- 判断 retry_count < max_retries
       |
       +-- 是：running -> queued
       |       保存 error_message
       |       清空 started_at / heartbeat_at
       |
       +-- 否：running -> failed
               保存最终 error_message
               设置 completed_at
```

达到上限时使用严格小于判断：

```python
run.retry_count < run.max_retries
```

例如：

```text
retry_count = 1, max_retries = 3 -> queued
retry_count = 2, max_retries = 3 -> queued
retry_count = 3, max_retries = 3 -> failed
```

重试失败原因保存在 `error_message` 中。后续 RunStep 完善后，可以进一步保存每一次尝试的错误历史。

## 七、不可重试异常流程

```text
NonRetryableAgentError 或未知 Exception
       |
       v
fail_run()
       |
       +-- 锁定 running Run
       +-- running -> failed
       +-- 保存 error_message
       +-- 设置 completed_at
       +-- heartbeat_at = NULL
       |
       v
     COMMIT
```

未知异常默认不可重试，避免代码 Bug 被反复执行。

## 八、Worker 收尾

不论 Agent 成功、失败还是被取消，都执行：

```python
finally:
    stop_event.set()
    await heartbeat_task
```

因此不会遗留后台 heartbeat task。

## 九、事务边界

```text
领取事务：
    SELECT ... FOR UPDATE SKIP LOCKED
    queued -> running
    retry_count += 1
    COMMIT

成功完成事务：
    SELECT ... FOR UPDATE
    INSERT Message
    INSERT RunStep
    running -> completed
    COMMIT

可重试失败事务：
    SELECT ... FOR UPDATE
    判断重试次数
    running -> queued 或 failed
    保存 error_message
    COMMIT

事务异常：
    ROLLBACK
```

Repository 负责查询、加锁、修改和 `flush()`；Service 负责事务边界和业务状态判断。

## 十、ToolCall 幂等性与安全边界

### 10.1 风险场景

工具调用存在典型的“外部副作用成功，但数据库状态没有保存”窗口：

```text
Worker 调用 send_email
       |
       v
邮件服务发送成功
       |
       v
Worker 在保存 ToolCall.result 前崩溃
       |
       v
Run 被 recovery 重新排队
       |
       v
新 Worker 再次发送同一封邮件
```

`ToolCall.status = pending` 不能证明工具没有执行。数据库事务无法自动回滚已经发生的外部邮件、支付或发布操作。

### 10.2 工具风险分类

```text
calculator / 纯计算
    无副作用，可以安全重复执行

get_current_time / 查询
    一般可以重复执行，但结果可能随时间变化

save_learning_note / 数据库写入
    需要幂等键和数据库唯一约束

send_email / publish_learning_note
    需要幂等键、审批，以及外部服务的幂等支持或 Outbox

execute_sql
    高风险操作，默认禁止或严格限制权限、语句类型和作用范围
```

### 10.3 数据库结构

新增 migration：

```text
b1a59ec3bd17_add_tool_call_idempotency_key.py
```

`tool_calls` 增加：

```text
idempotency_key TEXT NOT NULL
UNIQUE (idempotency_key)
```

迁移兼容旧数据的顺序：

```text
nullable=True 添加字段
       |
       v
为旧记录填充不同 UUID
       |
       v
创建唯一约束 uq_tool_calls_idempotency_key
       |
       v
修改为 nullable=False
```

数据库唯一约束是并发下的最终防线。只在 Python 中“先查再插”不能保证唯一。

### 10.4 首次失败实验：TOCTOU 竞态

原始实现：

```text
SELECT idempotency_key
       |
       +-- 不存在 -> INSERT
```

两个 Worker 的实际时间线：

```text
Worker A                         Worker B
   |                               |
   | SELECT K1 -> None             | SELECT K1 -> None
   |                               |
   | INSERT K1                     | INSERT K1
   | 成功                           | 等待 A 提交
   | COMMIT                        |
   |                               | UNIQUE 冲突
   |                               | ROLLBACK
```

测试稳定复现：

```text
psycopg.errors.UniqueViolation
Key (idempotency_key)=(concurrent-tool-call-key) already exists
```

这是典型的 TOCTOU（Time Of Check To Time Of Use）问题：检查时不存在，不代表使用时仍然不存在。

### 10.5 PostgreSQL 原子冲突处理

Repository 改用：

```sql
INSERT INTO tool_calls (...)
VALUES (...)
ON CONFLICT ON CONSTRAINT uq_tool_calls_idempotency_key
DO NOTHING
RETURNING ...;
```

返回语义：

```text
返回 ToolCall
    -> 当前事务成功插入

返回 None
    -> INSERT 因唯一冲突被跳过，没有 RETURNING 行
```

Service 在返回 `None` 后重新查询已有 ToolCall：

```text
Worker A                         Worker B
   |                               |
   | INSERT K1 成功                | INSERT K1
   | COMMIT                        | 等待唯一约束结果
   |                               | ON CONFLICT DO NOTHING
   |                               | 返回 None
   |                               | 再次 SELECT K1
   |                               | 返回 A 创建的 ToolCall
```

在 PostgreSQL 默认 Read Committed 下，每条语句获得新快照。冲突事务提交后，后续 SELECT 可以看到已提交记录。

如果冲突后仍查不到记录，代码抛出 `RuntimeError`，因为这违反了“唯一冲突对应记录必须存在”的程序不变量。

### 10.6 相同 key 必须对应相同请求

只比较 idempotency key 仍有安全风险：

```text
第一次：
    key = K1
    tool = send_email
    arguments = {"to": "a@example.com"}

第二次：
    key = K1
    tool = delete_document
    arguments = {"id": 100}
```

正确规则：

```text
相同 key + 相同 step_id/tool_name/arguments
    -> 幂等重放，返回已有 ToolCall

相同 key + 不同请求数据
    -> ToolCallIdempotencyConflictError
```

校验必须覆盖两条复用路径：

```text
第一次 SELECT 直接查到已有记录
ON CONFLICT 后第二次 SELECT 查到并发记录
```

JSONB 读取为 Python dict 后可以结构化比较。字典键顺序不影响相等性，但 `None` 和 `{}` 被视为不同请求。

### 10.7 分层职责

```text
Repository
    get_tool_call_by_idempotency_key()
    create_tool_call()
    PostgreSQL INSERT ... ON CONFLICT
    execute / flush
    不 commit

Service
    校验输入
    管理事务
    判断已有请求能否复用
    不同请求抛业务冲突异常
```

记忆方式：

```text
Repository：数据怎么查、怎么写？
Service：查到以后，业务上应该怎么办？
```

### 10.8 不能夸大的保证

当前实现可以保证：

```text
同一个 idempotency_key 在 PostgreSQL 中最多一条 ToolCall
相同请求可以复用同一条 ToolCall
不同请求不能盗用同一 key
```

当前实现不能单独保证：

```text
send_email、支付、发布等外部副作用恰好执行一次
```

要进一步保护外部副作用，需要至少一种方案：

```text
1. 把同一 idempotency_key 传给支持幂等的外部服务。
2. 使用 Transactional Outbox，在数据库提交后由独立投递器发送。
3. 对高风险工具增加人工审批，并让审批操作本身幂等。
4. 保存外部请求 ID，恢复时先查询外部系统状态。
```

分布式系统通常追求“至少一次投递 + 幂等消费”，而不是轻易声称 exactly-once。

## 十一、面试题整理

### 11.1 为什么“先查再插”不能防止重复数据？

两个事务可能同时查询到不存在，然后同时插入。这是 TOCTOU 竞态。应用层检查用于友好提示，数据库唯一约束才是最终并发防线。

### 11.2 唯一约束和行锁有什么区别？

```text
唯一约束
    保证某个键不能出现两条记录
    适合幂等键和业务唯一性

SELECT ... FOR UPDATE
    锁定已经存在的行
    不能锁定一条尚不存在的普通记录
```

幂等键尚不存在时，单纯 `FOR UPDATE` 没有目标行可锁；需要唯一约束、原子 UPSERT 或更高层锁策略。

### 11.3 为什么不直接捕获 IntegrityError 后继续查询？

`flush()` 发生 `IntegrityError` 后当前事务进入失败状态，必须 rollback 后才能继续执行 SQL。可以使用 savepoint 或新事务处理，但 PostgreSQL `ON CONFLICT DO NOTHING` 更直接，也避免把预期竞争当成异常路径。

### 11.4 `ON CONFLICT DO NOTHING RETURNING` 为什么可能返回 None？

唯一冲突时 PostgreSQL 跳过 INSERT，因此没有新行可供 RETURNING 返回。这个 None 表示“本事务没有插入”，不表示数据库里没有冲突记录。

### 11.5 为什么相同 key 还要比较请求参数？

否则调用者可能用相同 key 提交不同工具或参数，并错误复用旧结果。幂等键标识的是同一个逻辑请求，不是绕过业务校验的通行证。

### 11.6 数据库唯一约束能保证外部邮件只发送一次吗？

不能。数据库事务和外部邮件服务之间没有共同的原子事务。Worker 可能在邮件发送成功后、保存结果前崩溃。需要外部服务幂等键、Outbox、状态查询或人工审批等机制。

### 11.7 PostgreSQL 与 MySQL 如何实现类似 UPSERT？

```text
PostgreSQL
    INSERT ... ON CONFLICT DO NOTHING / DO UPDATE

MySQL / InnoDB
    INSERT IGNORE
    INSERT ... ON DUPLICATE KEY UPDATE
```

它们用途类似，但语义和错误处理并不完全相同。`INSERT IGNORE` 可能忽略的错误范围比唯一冲突更广，不能机械等同于 PostgreSQL `ON CONFLICT DO NOTHING`。

### 11.8 Read Committed 在这个并发流程中起什么作用？

PostgreSQL Read Committed 为每条语句获取新快照。`ON CONFLICT` 等待竞争事务提交后，下一条 SELECT 可以在新快照中看到已提交的 ToolCall。Repeatable Read 的快照行为不同，不能直接照搬这个结论。

## 十二、ToolCall 状态机与执行权

### 12.1 状态机

```text
pending
   |
   | 原子领取执行权
   v
running
   |
   +-- 工具成功 -> completed
   |
   +-- 工具失败 -> failed
```

当前只允许：

```text
pending -> running
running -> completed
running -> failed
```

`waiting_approval` 和 `rejected` 留到审批阶段实现。

### 12.2 唯一记录不等于唯一执行

```text
UNIQUE(idempotency_key)
    -> 同一个逻辑调用最多一条 ToolCall 记录

UPDATE ... WHERE status = 'pending'
    -> 最多一个 Worker 获得工具执行权
```

即使数据库只有一条 ToolCall，两个 Worker 仍可能同时读取到 `pending`。因此领取使用一条原子 SQL：

```sql
UPDATE tool_calls
SET status = 'running',
    started_at = now()
WHERE id = :tool_call_id
  AND status = 'pending'
RETURNING ...;
```

并发时间线：

```text
Worker A                         Worker B
   |                               |
   | UPDATE pending -> running     | UPDATE pending -> running
   | 更新 1 行                      | 等待行锁
   | COMMIT                        |
   |                               | 重新检查 WHERE
   |                               | status 已是 running
   |                               | 更新 0 行，返回 None
```

只有获得 RETURNING 结果的 Worker 可以执行工具。

### 12.3 为什么最终状态使用普通 FOR UPDATE

完成和失败针对指定 ToolCall ID，必须区分：

```text
记录不存在
记录存在但状态非法
记录正在被另一事务修改
```

Repository 使用：

```sql
SELECT *
FROM tool_calls
WHERE id = :tool_call_id
FOR UPDATE;
```

不使用 `SKIP LOCKED`。如果跳过被锁住的指定记录，Service 会把“正在修改”误判为“不存在”。普通 `FOR UPDATE` 会等待并读取最新状态。

成功和失败并发竞争：

```text
Worker A                         Worker B
   |                               |
   | SELECT FOR UPDATE             | SELECT FOR UPDATE
   | 获得锁                         | 等待
   | running -> completed          |
   | COMMIT                        |
   |                               | 读取最新 completed
   |                               | 拒绝 completed -> failed
```

这防止最后提交者覆盖先前结果。

### 12.4 最终状态字段

成功：

```text
status = completed
result = 工具结果
error_message = NULL
completed_at = now()
```

失败：

```text
status = failed
result = NULL
error_message = 失败原因
completed_at = now()
```

Model 和 migration `18339483a999` 新增：

```text
started_at TIMESTAMPTZ NULL
completed_at TIMESTAMPTZ NULL
error_message TEXT NULL
```

测试数据库已验证：

```text
upgrade b1a59ec3bd17 -> 18339483a999
downgrade 18339483a999 -> b1a59ec3bd17
upgrade -> 18339483a999 (head)
```

### 12.5 回滚证据

测试在 Service 已修改 ORM 对象后注入 `flush()` 异常：

```text
SELECT FOR UPDATE
内存中 running -> completed
flush 抛出 RuntimeError
事务 ROLLBACK
重新查询数据库
status 仍为 running
result 仍为 NULL
completed_at 仍为 NULL
```

这证明 ORM 对象赋值不等于数据库提交。`flush()` 发送 SQL，`commit()` 才使事务结果对其他事务持久可见；事务异常会回滚本次修改。

### 12.6 面试题

#### 为什么唯一约束后仍需要条件 UPDATE？

唯一约束只防止重复记录，不能阻止多个 Worker同时读取同一条 pending 记录。条件 UPDATE 把状态检查和修改合并为原子 SQL，只有返回更新行的 Worker获得执行权。

#### 条件 UPDATE 和 SELECT FOR UPDATE 如何选择？

```text
try-claim 语义：
    没抢到是正常结果
    使用 UPDATE ... WHERE 前置状态 RETURNING

指定对象状态转换：
    需要区分不存在和非法状态
    使用 SELECT FOR UPDATE 后校验状态
```

#### 为什么完成指定 ToolCall 不使用 SKIP LOCKED？

因为不能换一条 ToolCall 完成，也不能把被锁行当成不存在。普通 FOR UPDATE 等待锁后读取最新状态，才能正确验证状态机。

#### flush 之后发生异常，数据一定写入数据库了吗？

SQL 可能已经发送到数据库，但仍处于未提交事务。异常离开事务上下文后会 rollback，其他事务看不到最终持久化结果。flush 不等于 commit。

## 十三、工具执行包装器

### 13.1 工具协议

`ToolExecutorProtocol` 隔离 Worker 与具体工具实现：

```python
async def execute(
    *,
    tool_name: str,
    arguments: dict | None,
    idempotency_key: str,
) -> dict | None:
    ...
```

Worker 不直接判断 calculator、send_email 等具体工具。带副作用的 Executor 应把同一 idempotency key 传给外部服务。

### 13.2 三段式事务

```text
短事务一：
    pending -> running
    COMMIT
    释放行锁和数据库连接
       |
       v
事务外：
    await executor.execute(...)
    外部 HTTP 可以耗时，但不持有 PostgreSQL 事务
       |
       v
短事务二：
    running -> completed / failed
    COMMIT
```

需要避免的是长事务、长时间持有行锁和执行外部 I/O 时占用数据库连接。连接池保持物理长连接本身不是问题。

错误写法：

```text
BEGIN
SELECT FOR UPDATE
await 外部 HTTP 30 秒
UPDATE completed
COMMIT
```

这会让行锁和事务持续覆盖整个网络等待时间。

### 13.3 执行路径

```text
未获得执行权
    -> ToolCallNotClaimedError
    -> executor 不被调用

执行成功
    -> 保存 result
    -> running -> completed

普通异常
    -> 保存 error_message
    -> running -> failed
    -> 原异常继续抛出

CancelledError
    -> 不当作普通失败
    -> ToolCall 保持 running
    -> 等待恢复策略判断外部副作用
```

无消息异常使用：

```python
str(exc) or exc.__class__.__name__
```

避免空错误消息覆盖真实异常类型。

### 13.4 外部成功、本地保存失败

失败窗口：

```text
外部工具成功
       |
       v
complete_tool_call() 数据库失败
       |
       v
外部副作用已经发生
PostgreSQL ToolCall 仍为 running
```

不能直接标记 failed，因为 failed 暗示外部操作明确失败，自动重试可能重复发送邮件、支付或发布内容。当前保持 running，后续应通过：

```text
相同外部幂等键重试或查询
外部请求 ID 对账
unknown / reconciliation_required 状态
Transactional Outbox
人工介入
```

Outbox 保证本地业务变化和“待发送意图”原子提交，但投递通常仍是 at-least-once，消费者或外部服务仍需幂等。

### 13.5 面试口述

> 为什么外部 HTTP 调用不放进数据库事务？

数据库事务只能原子控制数据库内部操作，不能回滚外部 HTTP 副作用。把慢网络调用放进事务会长期占用连接和行锁，增加锁等待、死锁和连接池耗尽风险。通常使用短事务记录 running，事务外调用外部服务，再用另一个短事务保存最终结果；跨系统一致性通过幂等键、Outbox、重试和对账处理。

> 工具成功但数据库保存失败，为什么不能标记 failed？

因为外部副作用可能已经成功，数据库失败只表示结果未持久化。标记 failed 后自动重试可能产生重复副作用。应进入不确定状态，并通过相同幂等键、外部状态查询、对账或人工处理恢复。

## 十四、Tool Registry 与安全基础工具

### 14.1 pi 工具架构参考

pi 内置工具主要包括：

```text
read
bash
write
edit
grep
find
ls
```

pi 扩展工具通过 `registerTool()` 定义：

```text
name / label / description
parameters Schema
execute(toolCallId, params, signal, onUpdate, context)
结构化 content / details
可选权限拦截、进度更新、超时取消和自定义渲染
```

AgentLab 的 Python 映射：

```text
pi parameters Schema       -> Pydantic 参数模型
pi name/description        -> ToolDefinition
pi execute                 -> ToolExecutorProtocol
pi signal/timeout          -> asyncio timeout / cancellation
pi tool_call permission    -> requires_approval / fail-closed
pi content/details         -> ToolCall result / RunStep
pi dynamic registration    -> ToolRegistry
```

没有照搬 pi 的 TypeScript 和 TUI 渲染层，因为 AgentLab 是 FastAPI/Python 后端；保留了工具定义、参数验证、执行隔离、取消、安全策略和结构化结果这些核心边界。

### 14.2 ToolDefinition

```text
name
retry_policy: safe / idempotent / manual
timeout_seconds
requires_approval
```

`frozen=True` 防止运行时修改安全策略，`slots=True` 防止动态添加拼错属性。空名称和非正超时在构造阶段拒绝。

### 14.3 Registry 安全规则

```text
重复工具名
    -> 启动阶段失败，不允许静默覆盖安全策略

未知工具
    -> 默认拒绝，fail-closed

缺失 executor
    -> ToolExecutorNotRegisteredError

requires_approval=True
    -> ToolApprovalRequiredError
    -> executor 不执行

超过 timeout_seconds
    -> 取消执行并抛 TimeoutError
```

Registry 本身实现 `ToolExecutorProtocol`，因此可以直接传给 ToolCall 执行包装器。

### 14.4 Calculator 参数 Schema

使用 Pydantic：

```text
expression 必须是字符串
去除首尾空白后不能为空
最大长度 200
拒绝额外参数
```

使用 `simpleeval` 解析，不使用 Python `eval()`。允许：

```text
+  -  *  /  //  %
一元正负号
括号
```

明确禁止：

```text
任意函数调用
变量和属性访问
文件访问
__import__
幂运算
非数值结果
```

禁止幂运算和限制长度不仅防止代码执行，也防止超大整数、深层表达式带来的 CPU/内存拒绝服务。

### 14.5 Get Current Time

`get_current_time` 使用 Python 标准库 `zoneinfo`，不访问外部网络。参数 Schema：

```text
timezone 可选，默认 UTC
必须是字符串
去除空白后不能为空
最大长度 64
拒绝额外参数
必须是可识别的 IANA 时区名称
```

结果使用带时区偏移的 ISO 8601：

```json
{
  "datetime": "2026-07-19T17:30:00+00:00",
  "timezone": "UTC"
}
```

它属于 safe 工具，因为没有外部副作用，可以重新执行；但重试结果可能随时间变化。safe 表示“重复执行不会产生危险副作用”，不表示结果必然完全相同。

### 14.6 端到端流程

```text
pending ToolCall
       |
       v
原子领取 -> running
       |
       v
ToolRegistry 查找 calculator
       |
       +-- 检查审批策略
       +-- 检查 executor
       +-- 应用 timeout
       |
       v
CalculatorArguments 参数校验
       |
       v
simpleeval 受限运算
       |
       v
{"value": 42}
       |
       v
running -> completed
保存 ToolCall.result
```

### 14.7 面试题

#### 为什么不能使用 eval 实现 calculator？

`eval()` 会执行 Python 表达式，不可信输入可能导入模块、访问文件或执行系统命令，形成远程代码执行。应使用受限解析器并对参数、运算符、函数、名称和结果类型做白名单校验。

#### 使用安全解析器后是否绝对安全？

不是。即使不能执行任意代码，超长输入、超大指数和深层嵌套仍可能消耗 CPU 和内存。安全还包括资源限制、超时、取消和结果大小控制。

#### 为什么未知工具要 fail-closed？

工具可能包含高风险副作用。配置缺失时默认放行会绕过审批和重试策略，因此未知工具、缺失 executor 和未审批工具都应默认拒绝。

#### 为什么重复注册不能覆盖？

后注册定义可能把 `send_email` 从 manual/需审批改成 safe/无需审批。启动时拒绝重复名称可以尽早暴露配置错误，避免安全降级。

## 十五、Stale ToolCall Recovery

### 15.1 锁查询

```sql
SELECT *
FROM tool_calls
WHERE tool_name = :tool_name
  AND status = 'running'
  AND started_at IS NOT NULL
  AND started_at < :stale_before
ORDER BY started_at, id
FOR UPDATE SKIP LOCKED;
```

Recovery 扫描任意 stale 任务，因此使用 `SKIP LOCKED` 允许多个 Sweeper 分摊工作。完成指定 ToolCall 仍使用普通 `FOR UPDATE`，因为指定记录被锁时必须等待而不能误判不存在。

### 15.2 每工具超时

```text
stale_before = current_time - definition.timeout_seconds
```

Recovery 遍历 Registry 的只读 definitions 快照。不同工具可以使用不同 timeout，测试通过注入固定 `now` 精确验证边界：

```text
started_at < stale_before  -> stale
started_at = stale_before  -> 暂不恢复
started_at > stale_before  -> fresh
```

### 15.3 策略分支

```text
SAFE stale running
    -> pending
    -> 清理 started_at/result/error
    -> 可以重新执行

IDEMPOTENT stale running
    -> pending
    -> 保留相同 idempotency_key
    -> 外部重试必须复用该 key

MANUAL stale running
    -> waiting_approval
    -> 不自动重试
    -> error_message 标记结果不确定和人工对账
```

`waiting_approval` 当前同时承载执行前审批和执行后结果不确定两种语义。长期应考虑增加 `reconciliation_required`，避免批准与对账概念混淆。

### 15.4 并发时间线

```text
Recovery A                         Recovery B
    |                                  |
    | SELECT ... SKIP LOCKED           |
    | 锁住 ToolCall 1/2/3              |
    |                                  | SELECT ... SKIP LOCKED
    |                                  | 跳过 1/2/3，返回空
    | SAFE -> pending                  |
    | flush + commit                   |
    |                                  |
    v                                  v
处理 3 条                         处理 0 条
```

并发测试使用两个独立 AsyncSession 和屏障，确保两个数据库事务同时保持打开。处理数量为 `3 + 0`，没有重复恢复。

### 15.5 回滚证据

注入 `session.flush()` 故障后：

```text
内存中 running -> pending
        |
        v
flush 抛异常
        |
        v
session.begin() rollback
        |
        v
数据库仍为 running
```

这证明 Service 是同一事务内的 all-or-nothing 修改。

### 15.6 Tool Recovery Loop

Worker 层新增周期调度：

```text
while shutdown_event 未设置
    |
    +-- 创建独立 AsyncSession
    +-- 调用 recover_stale_tool_calls
    +-- 普通异常记录日志，下一轮继续
    +-- CancelledError 立即传播
    +-- wait_for(shutdown_event, poll_interval)
```

没有使用固定 `asyncio.sleep()`，因此 shutdown_event 设置后可以立即唤醒，不必等待完整轮询间隔。

测试证明：

```text
恢复成功后可以停止
单轮 RuntimeError 不会杀死长期循环
CancelledError 不会被普通异常分支吞掉
启动前已经 shutdown 时不会扫描数据库
```

每轮创建独立 AsyncSession，避免与 Worker、Heartbeat 或其他 Recovery 协程共享非并发安全的 Session。

### 15.7 Supervisor

Supervisor 使用 Python 3.12 `asyncio.TaskGroup` 管理任务树：

```text
Supervisor
    |
    +-- Agent Worker 1 -> 独立 AgentRunner
    +-- Agent Worker 2 -> 独立 AgentRunner
    +-- ...
    +-- Run Recovery
    +-- ToolCall Recovery
```

`AgentRunnerFactory` 为每个 Worker 创建独立实例，避免多个并发 Worker 共享可能包含对话上下文、SDK client 状态或当前 Run 状态的可变 Runner。

TaskGroup 提供结构化并发：

```text
shutdown_event 设置
    -> 所有长期循环自行返回
    -> TaskGroup 等待全部任务结束

任一子任务抛未处理异常
    -> TaskGroup 取消兄弟任务
    -> 等待取消清理
    -> 通过 ExceptionGroup 向上传播
```

测试创建 3 个 Worker，证明获得 3 个不同 Runner，并检查任务名、非正 worker_count 校验、正常 shutdown 和一个 Worker 故障后其余三个任务被取消。

### 15.8 当前限制

```text
未知、未注册的 tool_name 不会被当前 Registry 遍历扫描
ToolCall 没有独立 retry_count / max_retries
重试上限当前依赖外层 AgentRun
MANUAL 尚无完整人工对账工作流
```

未知工具保持 running 是 fail-closed，但必须增加监控或单独的未知工具扫描，否则可能永久滞留。

### 15.9 面试题

#### `SKIP LOCKED` 会不会造成饥饿？

可能。某条记录如果长期被事务持锁，每轮扫描都会跳过它。应保持事务短小，并监控长事务、stale 数量和锁等待。

#### SAFE 与 IDEMPOTENT 有什么区别？

SAFE 表示重复执行本身没有危险副作用，例如 calculator；结果不一定相同，例如当前时间。IDEMPOTENT 表示可能存在外部副作用，但外部系统能够通过相同幂等键把重复请求收敛为一次逻辑操作。

#### 为什么 MANUAL 超时不能直接标记 failed？

超时只能证明本地没有拿到确定结果，不能证明外部副作用没有发生。直接 failed 会制造错误确定性，自动重试还可能重复发送邮件或扣款，因此进入人工对账状态。

## 十六、异步 Worker 系统设计

### 16.1 进程与任务树

Worker Main 是 Composition Root，只负责组装依赖和进程生命周期：

```text
OS / Docker
    |
    | SIGINT / SIGTERM
    v
Worker Main
    |
    +-- shutdown_event
    +-- AsyncSessionLocal
    +-- AgentRunnerFactory
    +-- ToolRegistry
    |
    v
Supervisor (asyncio.TaskGroup)
    |
    +-- Agent Worker 1
    |      |
    |      +-- claim_next_run 短事务
    |      +-- execute_claimed_run
    |             |
    |             +-- AgentRunner.run
    |             +-- Heartbeat Task
    |             +-- complete / retry / fail 短事务
    |
    +-- Agent Worker 2
    |      +-- 同上，使用独立 AgentRunner
    |
    +-- Run Recovery Loop
    |      +-- stale running -> queued / failed
    |
    +-- Tool Recovery Loop
           +-- SAFE / IDEMPOTENT -> pending
           +-- MANUAL -> waiting_approval
```

Main 不包含 Run、ToolCall 或数据库业务规则；Supervisor 不直接操作数据库；Loop 只负责调度；Service 决定事务边界；Repository 执行 SQL 和锁。

### 16.2 并发所有权

```text
对象                         所有者
---------------------------------------------------------
一个 AsyncSession            一个协程、一个业务事务
一个 AgentRunner             一个 Worker
一个 claimed Run             获得数据库执行权的 Worker
一个 running ToolCall        条件 UPDATE 成功的执行协程
一个 heartbeat task          当前 execute_claimed_run
一个 shutdown_event          整个 Supervisor 任务树共享
一个 ToolRegistry            只读定义可安全共享
```

`AsyncSession` 不支持多个并发任务共享。Heartbeat、Worker、Run Recovery 和 Tool Recovery 都通过 `session_factory()` 创建独立 Session。

Registry 在启动阶段完成注册，运行期间只读取不可变 `ToolDefinition`。如果未来支持动态注册，需要锁、copy-on-write 或不可变快照，不能假设当前 dict 写入是并发安全协议。

### 16.3 Worker 并发与背压

每个 Worker 一次只执行一个 Run：

```text
worker_count = 2
    -> 最多两个 Run 在 Agent 执行阶段并发
    -> 每个 Worker 内部顺序消费
```

数据库队列使用：

```sql
FOR UPDATE SKIP LOCKED
```

多个 Worker 可以跳过已锁 Run，但 `asyncio.TaskGroup` 本身不提供跨进程互斥。即使启动多个 Worker 进程，最终唯一领取仍由 PostgreSQL 行锁、条件状态转换和唯一约束保证。

当前使用 polling：

```text
无任务 -> wait_for(shutdown_event, poll_interval)
```

优点是简单、可恢复、不依赖额外基础设施；缺点是存在轮询延迟和空查询。后续可以研究 PostgreSQL `LISTEN/NOTIFY` 作为唤醒提示，但数据库状态仍必须作为事实来源，因为通知可能丢失或在订阅前发生。

### 16.4 事务与外部 I/O

```text
短事务 1                    无数据库事务                    短事务 2
claim queued -> running  -> Agent / Tool 外部执行       -> completed/failed
commit 并释放行锁            Heartbeat 独立 Session          commit
```

外部模型或工具执行不放在长数据库事务中，否则会长期占用：

```text
数据库连接
行锁
MVCC snapshot
连接池容量
```

代价是外部成功与本地提交之间存在故障窗口，所以系统需要幂等键、Heartbeat、Recovery、人工对账，必要时增加 Transactional Outbox。不能宣称 exactly-once。

### 16.5 取消传播

取消是控制流，不是普通业务失败：

```text
CancelledError
    |
    +-- Heartbeat Loop -> 传播
    +-- Worker Loop -> 传播
    +-- Recovery Loops -> 传播
    +-- TaskGroup -> 取消兄弟任务并等待清理
```

普通异常可以在长期循环边界记录日志并继续下一轮；`CancelledError` 必须单独重新抛出。吞掉取消会导致 TaskGroup、应用关闭和测试超时无法可靠结束。

工具或 Agent 在取消时可能已经产生外部副作用，因此取消后持久化的 running 状态由 stale recovery 处理，而不是武断写成 failed。

### 16.6 优雅关闭时间线

```text
SIGINT / SIGTERM
      |
      v
signal callback 只执行 shutdown_event.set()
      |
      +-- 空闲 Worker / Recovery 立即唤醒
      +-- Supervisor 开始等待 TaskGroup
      |
      v
30 秒 graceful shutdown 宽限期
      |
      +-- 全部任务按时结束 -> 正常返回
      |
      +-- AgentRunner 等任务仍挂起
              |
              v
      supervisor_task.cancel()
              |
              v
      TaskGroup 取消 Worker / Heartbeat / Recovery
              |
              v
      gather 等待 cancellation cleanup
      |
      v
async_main finally
      |
      v
async_engine.dispose()
      |
      v
asyncio.run 关闭事件循环
```

`asyncio.wait()` 同时监控 Supervisor 和 shutdown waiter：Supervisor 提前失败时立即传播；收到关闭信号后才启动宽限期。`wait_for(shield(supervisor_task))` 避免 timeout 隐式取消，由代码记录日志后显式承担取消责任。

测试覆盖正常宽限期、超时强制取消、Supervisor 提前失败、非法 timeout，以及正常和异常路径都调用 `engine.dispose()`。

### 16.7 Windows 事件循环兼容性

第一次真实开发库实验失败：

```text
psycopg.InterfaceError:
Psycopg cannot use the 'ProactorEventLoop' to run in async mode
```

Windows 默认 ProactorEventLoop 适合部分异步 I/O，但 Psycopg 3 异步连接要求兼容的 SelectorEventLoop。pytest 使用的事件循环没有暴露该差异。

Worker Main 增加平台 event loop factory：

```text
Windows
    -> SelectorEventLoop(SelectSelector)

其他平台
    -> asyncio.new_event_loop()
```

启动方式保持：

```text
asyncio.run(async_main(), loop_factory=create_compatible_event_loop)
```

Windows 的 `loop.add_signal_handler` 仍可能不支持，因此信号注册继续使用 `signal.signal + call_soon_threadsafe` 回退。事件循环兼容与信号兼容是两个不同问题。

### 16.8 故障传播矩阵

```text
故障位置                         当前行为
----------------------------------------------------------------
单次 Run 执行异常                状态落库，Worker 记录后继续
单次 Recovery 异常               记录日志，下一轮继续
Heartbeat 单次异常               记录并继续
Heartbeat 连续三次异常           Heartbeat Task 退出，Recovery 接管
长期 Loop 未处理异常              TaskGroup 取消全部兄弟并向上传播
Supervisor 异常                  async_main / asyncio.run 向上传播
进程崩溃                         PostgreSQL 保留 running，Recovery 接管
```

这个分层避免一个坏 Run 杀死整个 Worker，同时让基础设施级未知异常能够终止进程并由 Docker 等外部 Supervisor 重启。

### 16.9 PostgreSQL 才是并发最终防线

```text
asyncio Lock
    -> 只在单进程、单事件循环有效

PostgreSQL row lock / conditional UPDATE / UNIQUE
    -> 跨协程
    -> 跨 Worker
    -> 跨进程
    -> 跨容器
```

因此不能用 Python 内存锁代替数据库队列锁，也不能因为使用 TaskGroup 就声称 Run 或 ToolCall 不会重复执行。

### 16.10 当前关闭限制

当前已实现进程级 30 秒宽限期和超时取消，但取消不能证明外部模型或工具没有产生副作用。running 状态仍需由 Recovery、幂等键和人工对账处理。

尚未实现：

```text
模型 HTTP 请求级 timeout
不同任务类型的独立关闭宽限期
关闭期间拒绝 API 创建新 queued Run
真实模型客户端的 close / aclose
Docker stop_grace_period 对齐
```

进程级 timeout 是最后防线，不能替代模型 SDK 和 HTTP client 自身更短、更明确的请求 timeout。

### 16.11 当前开发 Runner

Worker Main 当前注入 `FakeAgentRunner`，只能验证：

```text
队列领取
Heartbeat 生命周期
Run 状态和输出持久化
Supervisor 与信号关闭
```

它不代表真实模型调用。真实 Adapter 必须实现 `AgentRunnerProtocol`，并把模型厂商 SDK 隔离在 `app/agents/` 内，API Key 只能从环境变量读取。

### 16.12 开发库生命周期实验

可复现实验：

```bat
python -m scripts.verify_worker_lifecycle
```

脚本只允许 `agentlab_dev`，并在启动前拒绝存在 queued/running Run 的非空队列。成功证据：

```text
run_id=9
status=completed
retry_count=0->1
assistant_message=fake result for run 9
run_step=final_output:{'content': 'fake result for run 9'}
shutdown=graceful
cleanup=completed
```

实验验证真实 PostgreSQL 中的领取、状态更新、assistant Message、final_output RunStep、Supervisor shutdown 和逆序清理。

第一次实验没有先检查队列，Worker 按 `created_at, id` 先消费了开发库原有 queued Run `id=4`，写入 Fake assistant Message 和 final_output。该既有数据没有擅自回滚。这个失败说明：

```text
Worker 不知道哪条记录是“实验数据”
数据库队列中的 queued 就是可消费契约
集成实验必须隔离数据库或验证队列前置条件
```

正式自动化测试继续只使用 `agentlab_test`；开发库脚本的 idle preflight 只是额外保护，不能替代独立测试数据库。

### 16.13 面试口述

#### asyncio.TaskGroup 解决了什么问题？

它提供结构化并发：父作用域明确拥有所有子任务，退出前等待清理；一个子任务失败时取消兄弟任务，并以 ExceptionGroup 汇总异常。它解决任务生命周期和异常传播，不解决数据库分布式互斥。

#### 为什么每个 Worker 要独立 AgentRunner？

Runner 未来可能保存 SDK client、当前上下文、流式状态或临时工具状态。共享可变 Runner 会产生数据竞争和会话串线。独立实例把状态所有权限制在单个 Worker；真正可安全共享的连接池应由底层客户端明确保证。

#### 优雅关闭为什么不能只调用 task.cancel()？

立即取消可能中断状态持久化、HTTP 清理和连接归还。通常先停止领取新任务，给当前任务宽限期完成，再在超时后取消。取消后仍要依赖幂等和 stale recovery 处理不确定状态。

#### 异步是否意味着数据库查询同时执行得更多？

异步允许等待 I/O 时切换任务，但实际数据库并发受 Worker 数、连接池大小、PostgreSQL 连接数、锁竞争和查询耗时共同限制。异步不会让单条 SQL 本身自动变快。

## 十七、验证结果

```text
本次 ToolCall Recovery 文件 git diff --check：通过
全局 git diff --check：被早期无关文件的行尾空格阻断
ToolDefinition / Registry / 基础工具单元测试：47 passed
工具执行包装器集成测试：8 passed
ToolCall Recovery 与 Loop 专项测试：8 passed
Supervisor 单元测试：4 passed
Worker Main 与优雅关闭单元测试：12 passed
开发库 migration：18339483a999 (head)
开发库 Worker 生命周期实验：通过并完成临时数据清理
全量测试：121 passed
```

测试覆盖：

```text
[x] 可重试异常未达到上限 -> queued
[x] 可重试异常达到上限 -> failed
[x] 不可重试异常 -> failed
[x] heartbeat 在成功/失败后停止
[x] 首次创建 pending ToolCall
[x] 相同 key + 相同请求返回同一 ToolCall
[x] 并发相同 key 最终只有一条记录
[x] 不同 tool_name 拒绝复用 key
[x] 不同 arguments 拒绝复用 key
[x] 不同 step_id 拒绝复用 key
[x] 并发相同 key + 不同参数：一个成功、一个冲突
[x] 两个 Worker 领取同一 pending ToolCall：只有一个成功
[x] running -> completed 保存 result
[x] running -> failed 保存 error_message
[x] pending 不能直接 completed / failed
[x] 重复完成被状态机拒绝
[x] completed / failed 并发竞争只有一个提交
[x] flush 故障后事务完整回滚
[x] 工具成功后持久化 result
[x] 工具异常后持久化 failed 并重新抛出
[x] 空异常消息保存异常类名
[x] 未获得执行权时 executor 不被调用
[x] CancelledError 后 ToolCall 保持 running
[x] 外部成功但本地完成失败时保持 running
[x] ToolDefinition frozen / slots / 参数不变量
[x] Registry 重复名称拒绝且不覆盖原策略
[x] 未知工具和缺失 executor fail-closed
[x] 审批工具在 executor 前被阻断
[x] Registry 工具超时
[x] calculator 正常算术和优先级
[x] calculator 严格参数 Schema
[x] calculator 拒绝代码注入、文件访问和未知变量
[x] calculator 拒绝幂运算、除零和非数值结果
[x] pending -> Registry -> calculator -> completed 端到端流程
[x] get_current_time 默认 UTC 和 ISO 8601 时区结果
[x] get_current_time 拒绝未知时区、额外参数和非法输入
[x] pending -> Registry -> get_current_time -> completed 端到端流程
[x] stale 查询按 tool_name、status、started_at 过滤并稳定排序
[x] 两个 Sweeper 使用 SKIP LOCKED 不等待和不重复处理
[x] SAFE stale -> pending
[x] IDEMPOTENT stale -> pending 且保留幂等键
[x] MANUAL stale -> waiting_approval
[x] 每工具 timeout 和等于阈值的边界
[x] 未注册工具不自动恢复
[x] recovery flush 故障整体 rollback
[x] Tool Recovery Loop 单轮成功并停止
[x] Tool Recovery Loop 普通异常后继续
[x] Tool Recovery Loop 传播 CancelledError
[x] shutdown 已设置时不扫描数据库
[x] Supervisor 启动指定数量 Worker 和两个 Recovery
[x] 每个 Worker 使用独立 AgentRunner
[x] 非正 worker_count 在创建任务前拒绝
[x] shutdown 后等待全部任务结束
[x] 子任务异常传播并取消兄弟任务
[x] SIGINT / SIGTERM handler 设置 shutdown_event
[x] Windows signal fallback 使用 call_soon_threadsafe
[x] async_main 正确组装 Session、Runner、Registry 和 Supervisor
[x] Supervisor 异常传播到进程入口
[x] main 使用 asyncio.run 和平台兼容 loop factory
[x] Windows 使用 SelectorEventLoop 兼容 Psycopg 3
[x] 正常宽限期内完成关闭
[x] 宽限期超时后取消 Supervisor 任务树
[x] Supervisor 提前失败立即传播
[x] 非正 graceful shutdown timeout 被拒绝
[x] 正常和异常路径都调用 async_engine.dispose()
[x] 开发库 queued -> completed + Message + RunStep
[x] 开发实验 shutdown 和临时数据逆序清理
[x] 开发实验队列非空时 fail-closed
```

## 十八、当前已知问题

```text
1. RunStep.step_order 当前固定为 1，只适合当前 final_output 最小流程。
2. recover_stale_runs() 的 queued 分支仍会清空 error_message，和 retry_or_fail_run() 的策略需要统一。
3. 已实现 calculator、get_current_time 和 Registry，但 Agent Runner 尚未生成真实 ToolCall 请求。
4. ToolCall Recovery 已实现，但 ToolCall 没有独立 retry_count / max_retries。
5. 未注册工具保持 running，尚未实现独立扫描、告警或人工处理。
6. waiting_approval 暂时混合执行前审批和执行后人工对账语义。
7. 审批目前是 fail-closed 阻断，尚未实现批准后的恢复执行。
8. 外部工具副作用还没有 Outbox 或外部服务幂等适配器。
9. Worker Main 已有 30 秒宽限期、强制取消和 engine.dispose()，但模型 HTTP 请求尚无独立 timeout。
10. Worker Main 当前使用 FakeAgentRunner，尚无真实模型 Runner adapter。
11. 第一次开发实验消费了既有 queued Run id=4；保留该事实，未擅自回滚用户数据。
```

## 十九、下一步

```text
1. 实现真实模型无关的 AgentRunner adapter 和上下文加载边界。
2. 为模型 HTTP 请求增加 timeout、取消和 client close。
3. 为高风险工具设计审批与副作用保护。
4. 设计未知工具告警和人工对账状态。
```
