---
title: "Day 10：Worker 生命周期与优雅关闭"
pubDate: 2026-07-18
description: "从 AgentRunnerProtocol 到 Worker 主循环，串起 heartbeat、成功/失败状态持久化、Recovery Sweeper 和优雅关闭，并用 Fake Runner 验证异步任务的生命周期与取消传播。"
type: 学习日志
tags: ["PostgreSQL", "FastAPI", "SQLAlchemy", "异步", "Worker", "优雅关闭"]
featured: false
series: fastapi-postgres-learning
seriesOrder: 10
---

## 前言

Day 9 已经能检测并恢复失联的 running Run，但 Worker 还缺少完整的执行生命周期：谁调用 Agent，谁更新心跳，任务成功或失败后怎样保存状态，服务收到关闭信号时如何停止领取并完成当前任务？

Day 10 用 `AgentRunnerProtocol` 隔离具体模型实现，完成 Agent 执行包装器、heartbeat 后台任务、Worker 主循环和 Recovery Sweeper。测试重点放在 `CancelledError`、`finally`、独立 `AsyncSession` 以及共享测试数据库造成的并行污染上。

---

## 今日目标

- 定义与模型厂商解耦的 `AgentRunnerProtocol`。
- 将 Agent 执行、heartbeat、完成和失败串成一个执行包装器。
- 实现 Worker 主循环。
- 理解 `shutdown_event`、`CancelledError` 和 `finally` 的作用。
- 观察空队列轮询、任务异常和优雅关闭行为。
- 使用 Fake Runner 验证 Worker 生命周期。

## 今日完成情况

```text
[x] AgentRunnerProtocol
[x] FakeAgentRunner 基础单元测试
[x] heartbeat loop
[x] execute_claimed_run()
[x] worker_loop()
[x] Agent 成功时 completed
[x] Agent 异常时 failed
[x] finally 停止 heartbeat
[x] shutdown_event 停止领取新任务
[x] Worker 生命周期测试
[x] recovery_loop 周期调度
[x] recovery_loop 停止信号
[ ] 可重试异常与不可重试异常分类
[ ] 工具调用幂等性
[x] Day 10 最终 Git 提交
```

## 一、AgentRunnerProtocol

文件：

```text
app/agents/runner.py
```

协议：

```python
from typing import Protocol


class AgentRunnerProtocol(Protocol):
    async def run(self, run_id: int) -> str:
        ...
```

协议只描述调用约定：

```text
输入：run_id
输出：异步字符串结果
```

业务 Worker 不依赖具体模型 SDK，而依赖这个协议。以后可以替换：

```text
FakeAgentRunner
OpenAIAgentRunner
AnthropicAgentRunner
本地模型 Runner
```

Fake Runner 用于测试：

```python
class FakeAgentRunner:
    async def run(self, run_id: int) -> str:
        return f"fake result for run {run_id}"
```

Fake Runner 不负责修改数据库状态。状态仍由 Run Service 管理。

## 二、execute_claimed_run

文件：

```text
app/workers/runner.py
```

函数：

```python
async def execute_claimed_run(
    session_factory: async_sessionmaker[AsyncSession],
    run_id: int,
    agent_runner: AgentRunnerProtocol,
    interval_seconds: float = 10.0,
) -> str:
    ...
```

它假设 Run 已经由 `claim_next_run()` 改为：

```text
status = running
```

包装器职责：

```text
启动 heartbeat_loop
→ 执行 AgentRunner
→ 成功调用 complete_run
→ 普通异常调用 fail_run
→ finally 停止 heartbeat_loop
```

它不负责：

```text
从 queued 领取任务
创建 Run
实现具体模型调用
保存最终消息内容
```

### 成功路径

```text
AgentRunner.run() 返回结果
→ complete_run()
→ status = completed
→ completed_at = now()
→ heartbeat_at = NULL
→ finally 停止 heartbeat
```

### 普通异常路径

```text
AgentRunner.run() 抛出 Exception
→ fail_run()
→ status = failed
→ completed_at = now()
→ error_message 保存异常文本
→ heartbeat_at = NULL
→ raise 继续抛出原异常
→ finally 停止 heartbeat
```

`raise` 不能省略。数据库状态已经保存为 failed，但 Worker 上层仍然需要知道执行发生了异常。

### 取消路径

`asyncio.CancelledError` 不属于普通 `Exception` 处理路径。Worker 被取消时：

```text
不调用普通 fail_run
→ 进入 finally
→ stop_event.set()
→ heartbeat_loop 退出
→ CancelledError 继续向上传播
```

服务关闭不一定表示 Agent 业务失败，因此取消和普通业务异常需要区分。

## 三、heartbeat 与主任务并发

执行包装器会创建后台任务：

```python
stop_event = asyncio.Event()

heartbeat_task = asyncio.create_task(
    heartbeat_loop(
        session_factory,
        run_id,
        interval_seconds,
        stop_event,
    )
)
```

此时有两个异步任务：

```text
主任务：agent_runner.run(run_id)
后台任务：heartbeat_loop(...)
```

两者共享：

```text
run_id
stop_event
```

两者不共享：

```text
AsyncSession
```

每次 heartbeat 创建自己的 Session 和事务，符合 SQLAlchemy AsyncSession 不能被多个并发任务共享的规则。

主任务无论成功、失败还是取消，都会执行：

```python
finally:
    stop_event.set()
    await heartbeat_task
```

如果没有 `finally`，Agent 抛异常时 heartbeat 任务可能继续运行，造成后台任务泄漏。

## 四、worker_loop

函数：

```python
async def worker_loop(
    session_factory: async_sessionmaker[AsyncSession],
    agent_runner: AgentRunnerProtocol,
    shutdown_event: asyncio.Event,
    poll_interval_seconds: float = 1.0,
) -> None:
    ...
```

主循环：

```text
while 没有 shutdown_event:
    领取一条 queued Run
    没有任务时等待
    有任务时执行
    当前任务结束后继续领取
```

领取阶段使用独立 Session：

```python
async with session_factory() as session:
    run = await claim_next_run(session)
```

队列为空时不能立即重试，否则会产生忙循环：

```text
查询数据库
→ 立即再次查询
→ 持续占用 CPU 和数据库
```

因此使用：

```python
await asyncio.wait_for(
    shutdown_event.wait(),
    timeout=poll_interval_seconds,
)
```

结果有两种：

```text
超时
    → 继续检查队列

shutdown_event 被设置
    → 退出 worker_loop
```

### 单个任务失败不应杀死 Worker

```python
try:
    await execute_claimed_run(...)
except asyncio.CancelledError:
    raise
except Exception:
    logger.exception(...)
```

普通任务异常已经由 `execute_claimed_run()` 写入 failed，Worker 记录日志后继续领取下一条任务。

`CancelledError` 则继续向上传播，让优雅关闭能够真正结束 Worker。

## 五、优雅关闭

`shutdown_event` 只负责停止领取新任务：

```text
收到关闭信号
→ 不再领取新任务
→ 当前已经领取的任务继续执行
→ 当前任务完成或失败
→ worker_loop 退出
```

这是一种“等待当前任务完成”的优雅关闭策略。

当前策略不会自动取消正在执行的 Agent。如果未来需要强制关闭，需要额外设计：

```text
执行超时
任务取消信号
模型请求取消
工具调用取消
```

不能只取消 Python 协程而忽略外部模型请求或工具副作用。

## 六、Recovery Sweeper

`recovery_loop()` 周期性计算 stale 边界并调用现有 Service：

```text
计算 stale_before
→ recover_stale_runs()
→ 等待下一轮或 shutdown_event
→ 重复
```

默认参数：

```text
stale_timeout_seconds = 30
poll_interval_seconds = 10
```

每轮使用新的 AsyncSession。普通恢复异常会记录日志并进入下一轮，`CancelledError` 会继续向上传播。等待期间收到 `shutdown_event` 时，sweeper 会立即退出，不需要等完整轮询间隔。

## 七、测试结果

Day 10 新增 Worker 生命周期测试：

```text
tests/unit/test_agent_runner.py
tests/concurrency/test_worker_runner.py
```

测试覆盖：

```text
[x] Fake Runner 返回异步结果
[x] Agent 成功时 Run 变为 completed
[x] Agent 异常时 Run 变为 failed
[x] 原始 Agent 异常继续抛出
[x] 成功和失败后 heartbeat 被清空
[x] shutdown_event 触发后 Worker 停止领取
```

与 Day 8、Day 9 测试合计：

```text
23 passed
```

### 测试数据库并行问题

曾经并行运行多个 PostgreSQL 集成测试进程，出现了两个看似随机的失败。根因不是业务代码，而是所有测试共用 `agentlab_test`，fixture 每个测试都会执行：

```sql
TRUNCATE TABLE users RESTART IDENTITY CASCADE;
```

并行测试之间会互相清理数据，导致：

```text
一个测试刚创建 Run
另一个测试执行 TRUNCATE
第一个测试随后查不到 Run
```

因此当前测试必须顺序执行：

```bat
python -m pytest -q
```

如果未来需要并行测试，应为每个 worker 分配独立数据库或独立 schema，不能继续共享同一个会被清理的测试数据库。

## 八、当前未完成内容

```text
- [x] recovery worker / sweeper 周期调用 recover_stale_runs
- [x] 将 recovery sweeper 接入 shutdown_event
- [x] 可重试异常与不可重试异常分类
- [ ] heartbeat 更新失败时的错误策略
- [ ] Agent 输出保存到 Message / RunStep
- [ ] 工具调用幂等性与副作用保护
- [ ] 完善 AgentRunner 的真实实现
- [x] Day 10 最终 Git 提交
```

## Day 11 预习

- recovery sweeper 周期调度。
- Worker 心跳失败处理。
- retryable / non-retryable 异常分类。
- Agent 输出保存和 RunStep 记录。
- 工具调用幂等键和副作用边界。
