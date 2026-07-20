---
title: "Day 12：模型无关的 Agent 执行层与工具协议"
pubDate: 2026-07-20
description: "构建模型无关的 Agent Runner、Provider Client Registry 和 OpenAI-compatible Adapter，隔离数据库 Session 与模型 HTTP 请求，并为工具 Schema、消息协议、RunStep 顺序和安全执行边界打基础。"
type: 学习日志
tags: ["PostgreSQL", "FastAPI", "SQLAlchemy", "Agent", "模型适配器", "工具调用"]
featured: false
series: fastapi-postgres-learning
seriesOrder: 12
---

## 前言

Day 11 已经建立了 ToolCall 的幂等记录、状态机和执行安全边界，Day 12 将模型接入 Worker，但仍然把模型厂商 SDK 隔离在 Adapter 后面。目标不是马上实现完整工具循环，而是先把上下文、模型请求、Provider Client、工具协议和数据库事务边界固定下来。

本日完成了真实模型文本输出的 PostgreSQL 端到端链路、Provider Client Registry、OpenAI-compatible 异常翻译、模型可见的工具 Schema 和工具消息协议预备，并验证了 RunStep 顺序约束与迁移可逆性。工具请求的持久化和下一轮模型调用明确留到 Day 13/14，避免在边界未稳定时扩张范围。

---

## 今日主题

模型无关的 Agent 执行层、Provider Client Registry、OpenAI-compatible Adapter，以及真实模型 Runner 与 Worker 的接线。

## 今日进度

```text
[x] RunContext、ModelRequest、ModelResponse、ModelClientProtocol
[x] 运行中 Run 的 PostgreSQL 上下文加载
[x] Provider TOML 配置与惰性 API Key 读取
[x] ModelClientRegistry 缓存、关闭与 Worker 组合根
[x] OpenAI-compatible Adapter 与异常分类
[x] 模型最终文本的 PostgreSQL 端到端链路
[x] 模型可见的 Tool Schema 与工具消息协议预备
[x] RunStep 顺序唯一约束与动态顺序分配
[x] 测试库迁移 upgrade -> downgrade -> upgrade
[x] Day 12 文档、问题记录与每日计划
```

## 一、模型执行总体流程

```text
Worker 领取 queued Run
        |
        v
execute_claimed_run(run_id, runner)
        |
        v
ModelAgentRunner.run(run_id)
        |
        +-- _load_run_context(run_id)
        |       |
        |       +-- 短生命周期 AsyncSession
        |       +-- 查询 Agent / Conversation / Message
        |       +-- 只允许 status = running 的 Run
        |       +-- 关闭 Session
        |
        +-- ModelClientRegistry.get(model_provider)
        |       |
        |       +-- 惰性读取对应 API Key
        |       +-- 返回缓存或新建的 Provider Client
        |
        +-- _build_model_request(context, turn_number=1)
        |
        +-- await client.generate(request)
        |
        +-- ModelResponse.final_text
        |
        v
complete_run_with_output()
        |
        +-- INSERT assistant Message
        +-- INSERT final_output RunStep
        +-- running -> completed
        |
        v
      COMMIT
```

第一版只支持模型直接返回最终文本。模型返回 `tool_requests` 时，当前会明确拒绝继续执行，避免将工具请求误保存为最终回答。

## 二、为什么 Context、Request 和 Provider 要分开

```text
RunContext
    AgentLab 内部业务数据
    包含 run_id、conversation_id、model_provider、model、历史消息

ModelRequest
    已选定模型 Client 后发送给模型的数据
    包含 model、system_instruction、messages、available_tools

model_provider
    不是聊天内容，也不是模型参数
    它只用于决定请求发往哪个 Provider Client
```

例如：

```text
Agent A
    model_provider = openai
    model = gpt-4o

Agent B
    model_provider = deepseek
    model = deepseek-chat
```

Worker 必须先读取 `RunContext.model_provider`，再调用：

```python
client = model_clients.get(context.model_provider)
```

最后才把 `ModelRequest` 发送给该 Client。

## 三、数据库 Session 与模型 HTTP 的边界

错误做法：

```text
打开 AsyncSession
    -> 查询对话历史
    -> 等待模型 HTTP 请求数秒
    -> 保存结果
    -> 关闭 AsyncSession
```

问题：

```text
- 长时间占用数据库连接池连接。
- 事务和 MVCC 快照持续时间过长。
- 模型 Provider 慢时，数据库资源也被无意义占用。
```

当前实现：

```text
短 Session：
    查询 RunContext
    关闭 Session

事务外：
    调用模型 HTTP API

短 Session：
    保存 Message、RunStep、Run 状态
```

因此 `RunContext` 必须是纯数据，不能携带 ORM 对象或 `AsyncSession`。

## 四、Provider 配置、Registry 与密钥

Provider 配置保存在：

```text
config/model_providers.toml
```

配置只保存公开信息：

```text
Provider 名称
base_url
API Key 环境变量名称
timeout
SDK retry 配置
```

真实 API Key 不写入：

```text
代码
Git
TOML
.env.example
测试快照
日志
```

Registry 的惰性行为：

```text
Worker 启动
    -> 读取 Provider Profile
    -> 不读取任何 API Key
    -> 不创建 HTTP Client

首次执行 deepseek Agent
    -> getenv("DEEPSEEK_API_KEY")
    -> 创建 OpenAICompatibleModelClient
    -> 缓存 Client

下一次执行 deepseek Agent
    -> 直接复用缓存 Client 和 HTTP 连接池
```

关闭时：

```text
ModelClientRegistry.aclose()
    -> 清空缓存
    -> 并发调用全部 cached Client.aclose()
    -> 即使一个 Client close 失败，其余 Client 仍获得关闭机会
```

## 五、OpenAI-compatible Adapter 与异常分类

Adapter 把厂商 SDK 异常翻译为项目自己的业务异常：

```text
APITimeoutError
APIConnectionError
RateLimitError (429)
InternalServerError / 5xx
    -> RetryableAgentError

AuthenticationError (401)
PermissionDeniedError
BadRequestError
NotFoundError
UnprocessableEntityError
其他 4xx
    -> NonRetryableAgentError
```

Worker 已有的状态机据此工作：

```text
RetryableAgentError
    -> retry_or_fail_run()
    -> running -> queued 或 failed

NonRetryableAgentError
    -> fail_run()
    -> running -> failed
```

`CancelledError` 不被 Adapter 捕获：

```text
CancelledError
    -> 向上传播
    -> Worker 停止 heartbeat
    -> 保留 running 状态给 stale recovery 处理
```

SDK 自动重试保持为 `0`。重试计数由 Worker 管理，避免 SDK 重试与 Worker 重试叠加，造成不可见的重复模型成本。

## 六、真实 Worker 接线

Worker 进程现在不再使用 `FakeAgentRunner`：

```text
进程
    |
    +-- 一个 ModelClientRegistry
    +-- 一个 ToolRegistry
    |
    +-- Agent Worker #1
    |       -> ModelAgentRunner #1
    |
    +-- Agent Worker #2
            -> ModelAgentRunner #2
```

每个 Worker 有独立的 `ModelAgentRunner`，但共享：

```text
AsyncSessionLocal
ModelClientRegistry
ToolRegistry
```

关闭顺序：

```text
Supervisor 停止 Worker
        |
        v
ModelClientRegistry.aclose()
        |
        v
async_engine.dispose()
```

即使关闭模型 Client 时抛错，外层 `finally` 仍会释放数据库 Engine。

## 七、模型工具协议预备

当前已经完成“让模型看见工具”和“表示工具结果”的数据契约，但还没有实现持久化工具循环。

`ToolDefinition` 现在分为两类元数据：

```text
发给模型：
    name
    description
    parameters_schema

给 AgentLab 执行层：
    retry_policy
    timeout_seconds
    requires_approval
```

默认工具直接复用 Pydantic 参数模型的 JSON Schema：

```python
CalculatorArguments.model_json_schema()
CurrentTimeArguments.model_json_schema()
```

模型请求中有可用工具时，Adapter 发送：

```text
tools=[
    {
        type: function,
        function: {
            name,
            description,
            parameters,
        },
    },
]
```

没有工具时不发送 `tools=[]`，避免不同 OpenAI-compatible Provider 对空数组的兼容性差异。

工具循环第二轮需要三种消息：

```text
ChatMessage
    普通 user / assistant 文本

AssistantToolCallsMessage
    assistant 请求一个或多个 ToolCall

ToolResultMessage
    tool_call_id 对应的工具结果
```

Provider 消息顺序：

```text
user:      "计算 2 + 2"
assistant: tool_calls=[calculator]
tool:      tool_call_id=call_1, content={"value":4}
assistant: "2 + 2 = 4"
```

JSON Schema 不是安全边界。模型返回 arguments 后，Tool Executor 仍必须使用 Pydantic 进行运行时校验。

## 八、RunStep 顺序与数据库约束

工具循环会产生多个 RunStep，因此最终输出不能继续硬编码：

```python
step_order=1
```

新增约束：

```sql
UNIQUE (run_id, step_order)
```

最终输出步骤现在遵循：

```text
SELECT agent_runs ... FOR UPDATE
        |
        v
SELECT COALESCE(MAX(run_steps.step_order), 0)
        |
        v
next_step_order = max + 1
        |
        v
INSERT final_output RunStep
```

Run 行锁让同一 Run 的步骤创建串行化；数据库唯一约束是最终防线。

## 九、问题记录

### 9.1 Windows 迁移命令错误升级开发库

现象：

```text
内联 PowerShell 命令中的 $line、$_、$env:DATABASE_URL
被外层 Bash 提前展开。
Alembic 回退到 Settings().database_url，错误升级 agentlab_dev。
```

处理：

```text
1. 立即将 agentlab_dev 降回 18339483a999。
2. 修改 migrations/env.py：优先使用 Alembic Config 显式 URL。
3. 由 Windows Python 进程直接读取 Settings().test_database_url，
   以编程方式执行测试库迁移。
```

知识点：

```text
迁移目标数据库是安全边界。
跨 Bash、cmd、PowerShell 传递环境变量时，必须验证变量真正到达目标进程。
```

### 9.2 Day 12 任务范围膨胀

现象：

```text
工具持久化、唤醒、模型第二轮、审批和恢复被误列为同一天剩余任务。
```

处理：

```text
创建 docs/study-plan.md。
每一天固定目标、范围外内容、验收标准和次日停车区。
Day 13 只实现 ToolRequest 原子持久化。
Day 14 才实现 ToolCall 完成后的唤醒和模型下一轮。
```

知识点：

```text
范围控制是工程可靠性的一部分。
没有明确停止条件的功能，会持续吞噬测试、文档和学习时间。
```

## 十、测试与实际结果

```text
全量测试：
192 passed in 7.62s
```

```text
agentlab_test 迁移验证：
e8f9a0b1c2d3
-> f9a0b1c2d3e4
-> e8f9a0b1c2d3
-> f9a0b1c2d3e4
```

```text
agentlab_dev 恢复后的 revision：
18339483a999
```

## 十一、Git 收尾

```text
本次提交只包含 Day 12 的模型 Adapter、Provider Registry、
工具协议预备、RunStep 顺序约束、迁移、测试和学习文档。

Day 11、API、Schema、Compose、SQL 实验等既有未提交修改保持在工作区，
没有纳入本次提交。
```

## 十二、当前限制

```text
- ModelResponse.tool_requests 尚未持久化为 RunStep 和 ToolCall。
- waiting_tools 已被 API 视为进行中的 Run，但尚未有 Worker 状态转换使用它。
- Tool Worker 可以执行 pending ToolCall，但尚未安全唤醒父 Run。
- 自动化测试没有发起真实 Provider 请求。
- API Key 仅保存在本机环境，不在文档、代码和 Git 中出现。
```

## 十三、补充理解：模型如何调用工具

模型不会直接运行 Python 函数，也不应该直接访问数据库、文件或网络。模型只能输出结构化请求，由 AgentLab 后端决定是否允许执行。

以 `calculator` 为例，先把工具说明发送给模型：

```text
名称：calculator
作用：计算数学表达式
参数：
    expression: 字符串，必填
```

用户提问：

```text
帮我计算 2 + 2
```

完整流程：

```text
1. AgentLab 把用户消息和工具菜单发送给模型。

2. 模型不直接回答，而是返回：
   "请调用 calculator，参数是 expression = 2 + 2"。

3. AgentLab 创建并执行 ToolCall。
   Pydantic 再次校验 expression 是否合法。

4. 工具返回：
   {"value": 4}

5. AgentLab 把工具结果连同原始 tool_call_id 发回模型。

6. 模型根据工具结果生成最终回答：
   "2 + 2 = 4。"
```

`tool_call_id` 是一次工具请求的唯一关联号：

```text
模型请求：call_1 -> calculator(expression="2 + 2")
工具结果：call_1 -> {"value": 4}
```

因此一个模型回合请求多个工具时，结果不会混淆。

当前 Day 12 已完成第 1、2 和消息协议部分：模型能看到工具、能返回工具请求，Adapter 能表示工具结果。Day 13 才把第 3 步的 ToolCall 原子写入 PostgreSQL，Day 14 再让工具结果触发下一轮模型调用。

### 13.1 本次直接修改的代码对应关系

```text
app/agents/tools/registry.py
    ToolDefinition 新增 description 和 parameters_schema。

app/agents/tools/defaults.py
    calculator 和 get_current_time 使用各自 Pydantic 参数模型生成 JSON Schema。

app/agents/model_client.py
    新增 ToolRequest、AssistantToolCallsMessage、ToolResultMessage、ModelMessage。

app/agents/openai_compatible.py
    _build_tools_parameter()：内部 ToolDefinition -> Provider tools 参数。
    _build_provider_message()：三种内部消息 -> Provider messages 参数。

app/agents/model_runner.py
    available_tools=self._registry.definitions() 已传入第一轮 ModelRequest。
    但 response.final_text 为 None 时仍抛出异常，尚未执行工具。
```

## 十四、明日固定任务

Day 13 只做：

```text
persist_model_tool_requests(...)
    -> 锁定一个 running Run
    -> 创建有序 RunStep 和 pending ToolCall
    -> 使用 response_id + tool_call_id 生成稳定幂等键
    -> running -> waiting_tools
    -> 一个事务提交
```

Day 13 不做：

```text
ToolCall 唤醒
模型 turn 2
审批
WebSocket
知识库
```
