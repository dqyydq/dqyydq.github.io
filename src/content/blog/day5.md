---
title: "Day 5：Alembic 数据库迁移 —— 像管理代码一样管理表结构"
pubDate: 2026-07-14
description: "深入 Alembic 数据库迁移：alembic_version 版本追踪机制、autogenerate 原理与四大局限、upgrade/downgrade 对称设计、生产环境零停机 Expand-Contract 模式、Multiple Heads 合并策略、迁移测试与 CI/CD 集成。"
type: 学习日志
tags: ["Alembic", "PostgreSQL", "SQLAlchemy", "数据库迁移", "DevOps"]
featured: false
series: fastapi-postgres-learning
seriesOrder: 5
---

## 前言

前四天我们建了 8 张表——users、agents、conversations、messages、agent_runs、run_steps、tool_calls、tool_approvals。每张表都是手写 SQL 或用 ORM 模型定义的。但这里有一个根本问题：**换一台机器怎么复现？**

你得记住"上次在 psql 里建了什么表、改了哪个字段、加了哪个索引"。这显然不靠谱。Alembic 解决的就是这个问题——用版本化的方式管理 DDL 变更，就像 Git 管理代码一样。

---

## 1. Alembic = Git for Database

| Git（代码） | Alembic（数据库） |
|------------|-----------------|
| `git commit` | `alembic revision -m "..."` |
| `git push` | `alembic upgrade head` |
| `git log` | `alembic history` |
| `git diff` | autogenerate 对比模型与数据库 |
| 代码变更可追踪、可回滚 | DDL 变更加可追踪、可回滚 |

核心价值一句话：**新环境 → 拉代码 → `alembic upgrade head` → 数据库和代码完全同步**。不需要记住任何手动操作。

---

## 2. Alembic 的三样东西

### (1) 账单表 —— `alembic_version`

```sql
SELECT * FROM alembic_version;
-- 889d9c5fcf68
```

就一行一列，记录当前数据库在哪个迁移版本。**每个环境的数据库独立维护自己的版本号**——开发库是 `889d9c5f…`，测试库可能是 `c1b5d…`，生产库可能是另一个。

### (2) 补丁文件 —— `migrations/versions/*.py`

每个文件 = 一个版本，链式串联：

```
None → 889d9c5fcf68 (init)
     → c1b5df9c9b22 (add agent_runs)
     → c42f05ea7485 (add run_steps)
     → b14a7dd570d1 (head, add tool_calls and tool_approvals)
```

每个文件包含两个函数：`upgrade()`（前进）和 `downgrade()`（回退）。

### (3) 执行命令 —— `alembic upgrade head`

Alembic 的升级逻辑：

```
1. 查 alembic_version → 当前是 889d9c5fcf68
2. 扫 versions/ 目录 → head（最新）是 b14a7dd570d1
3. 有差距（差 3 个版本）→ 按链依次跑 upgrade() → 更新 alembic_version
```

每次只跑"还没应用的"迁移，已应用的跳过。

---

## 3. 初始化配置：两个必须手动改的地方

```bash
uv pip install alembic
alembic init migrations
```

初始化后的目录结构：

```
migrations/
├── alembic.ini          # 数据库连接串
├── env.py               # 迁移执行环境（核心配置文件）
├── script.py.mako       # 迁移文件模板
└── versions/            # 迁移文件目录
```

### 必须改的两个地方

**`alembic.ini`** —— 数据库连接串：

```ini
sqlalchemy.url = postgresql+psycopg://agentlab:agentlab@127.0.0.1:15432/agentlab_dev
```

**`migrations/env.py`** —— 设置 `target_metadata`：

```python
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.models import Base
target_metadata = Base.metadata  # ← Alembic 的「眼睛」
```

`target_metadata` 是 Alembic 感知模型变化的关键。没有它，autogenerate 什么也检测不到——Alembic 不知道你的 ORM 模型长什么样。

---

## 4. 迁移工作流与 autogenerate 原理

### 标准四步工作流

```
1. 修改 app/models.py（加新模型/新字段）
2. alembic revision --autogenerate -m "描述"
3. 人工检查生成的迁移文件 ← 这步不能省！
4. alembic upgrade head
```

### autogenerate 原理

```
扫描 Base.metadata（ORM 模型）
       ↓
  连接数据库，反射当前实际结构
       ↓
  对比两者差异
       ↓
  生成 upgrade() 和 downgrade() 函数
```

### autogenerate 的四大局限

| 能检测 | 不能检测 |
|--------|---------|
| 新增表、新增列 | 列重命名（被当成「删旧列 + 增新列」→ 数据丢失！） |
| 新增外键、新增约束 | 索引变更 |
| 字段类型变更 | 默认值变更（部分场景） |
| 字段可空性变更 | 匿名约束的修改 |

> 列重命名的正确处理方式：不要用 autogenerate，手动写 `op.alter_column('table', 'old_name', new_column_name='new_name')`。

**核心原则：autogenerate 后的迁移文件是草稿，不是终稿。** 必须人工审查每一行，确保它生成的是你想要的 DDL。

---

## 5. 命令速查

```bash
alembic upgrade head          # 升到最新
alembic upgrade +2            # 向前 2 个版本
alembic downgrade -1          # 回退 1 个版本
alembic downgrade base        # 回退全部（危险！生产禁用）
alembic current               # 当前数据库在哪个版本
alembic history               # 查看完整迁移链
alembic heads                 # 查看所有分支头（检查 Multiple Heads）
alembic check                 # CI/CD 用：检查是否有未应用的迁移
alembic revision --autogenerate -m "msg"  # 生成新迁移
alembic upgrade --sql head    # 生成 SQL 预览（不执行，给 DBA 审查用）
```

---

## 6. 本次新增的迁移版本链

今天建了 4 张新表的完整迁移链：

```
<base> → 889d9c5fcf68 (init)
       → c1b5df9c9b22 (add agent_runs)
       → c42f05ea7485 (add run_steps)
       → b14a7dd570d1 (head, add tool_calls + tool_approvals)
```

| 表 | 迁移版本 | 关键列 |
|----|---------|--------|
| `agent_runs` | `c1b5df9c9b22` | `id PK`, `conversation_id FK`, `status`, `idempotency_key UNIQUE` |
| `run_steps` | `c42f05ea7485` | `id PK`, `run_id FK`, `step_type`, `step_order`, `input_data JSONB`, `output_data JSONB` |
| `tool_calls` | `b14a7dd570d1` | `id PK`, `step_id FK`, `tool_name`, `arguments JSONB`, `result JSONB`, `status` |
| `tool_approvals` | `b14a7dd570d1` | `id PK`, `tool_call_id FK`, `status`, `approved_by`, `approved_at` |

最终完整的表关系：

```
users
  ├── agents
  ├── conversations
  │     ├── messages
  │     └── agent_runs
  │           ├── run_steps
  │           │     └── tool_calls
  │           │           └── tool_approvals
  └── (via agents → conversations → agent_runs → ...)
```

---

## 7. 生产环境零停机迁移：Expand-Contract 模式

这是 Alembic 面试中最能体现「工程能力」的话题。核心问题：**如何在不锁表、不停服的情况下修改生产数据库 Schema？**

答案是 **Expand-Contract（先扩后缩）模式**，分五个阶段：

| 阶段 | 操作 | 说明 |
|------|------|------|
| **1. Expand** | `ADD COLUMN`（nullable） | 新增可空列，PostgreSQL 上这是瞬时操作 |
| **2. Dual Write** | 代码变更 | 部署同时写入新旧两列的代码 |
| **3. Backfill** | 分批 UPDATE | 填充历史数据，每批 10,000 行，分批提交避免长事务 |
| **4. Swap** | 加 NOT NULL、换约束 | 新列就绪后切换 |
| **5. Contract** | `DROP COLUMN` | 确认旧代码完全下线后（数天/数周后）再删旧列 |

**核心原则**：永远不要在同一个部署周期中「删旧列 + 加新列」。旧代码还在跑，删列直接崩。

---

## 8. Multiple Heads 问题：团队协作的必经之路

当两个开发者从同一个父版本各建一个迁移时，两个迁移都指向同一个 `down_revision`：

```
889d9c5fcf68 (init)
    ├── c1b5df9c9b22 (张三的迁移)
    └── d2c6e0a0a0a1 (李四的迁移)
```

Alembic 发现 `head` 有两个 → `upgrade head` 直接报错：

```
ERROR: Multiple head revisions are present for given argument 'head'
```

### 三种解决方案

| 方案 | 操作 | 优缺点 |
|------|------|--------|
| `alembic merge heads` | 生成一条空的合并迁移，把两个 head 连起来 | 简单，但会产生「疤痕」合并文件 |
| 手动 rebase | 编辑其中一条迁移的 `down_revision`，指向另一条的版本号 | 可行但脆弱，rebase 过程中 head 可能再次变动 |
| CI 拦截 | 在 CI 中跑 `alembic check`，发现多 head 就阻断合并 | 预防胜于治疗，推荐 |

**团队最佳实践**：
- CI 中集成 `alembic check`——有未应用的迁移或多 head 就报红
- 要求迁移 PR 合并前必须 rebase 到最新 main
- 生产环境永远不要手动删迁移文件

---

## 9. 迁移测试：不只是"能跑就行"

```python
def test_migration_upgrade_downgrade(alembic_cfg):
    """测试迁移的完整往返"""
    # 升级到最新
    command.upgrade(alembic_cfg, "head")

    # 验证 Schema 符合预期
    engine = create_engine(alembic_cfg.get_main_option("sqlalchemy.url"))
    with engine.connect() as conn:
        columns = {row[0] for row in conn.execute(
            text("SELECT column_name FROM information_schema.columns WHERE table_name='agent_runs'")
        )}
        assert "idempotency_key" in columns

    # 回退 → 再升级 → 验证幂等性
    command.downgrade(alembic_cfg, "-1")
    command.upgrade(alembic_cfg, "head")
```

测试迁移的三个维度：

| 测试类型 | 断言什么 |
|----------|---------|
| **Upgrade** | 升级后 Schema 包含预期的列、索引、约束 |
| **Downgrade** | 回退后数据不丢失、不产生孤立记录 |
| **幂等性** | upgrade → downgrade → upgrade 结果一致 |

---

## 10. 常见报错与排查

| 错误 | 原因 | 解决 |
|------|------|------|
| `FAILED: Target database is not up to date` | current 落后于 head | `alembic upgrade head` |
| `Can't locate revision identified by 'xxx'` | 数据库记录的版本号在 versions/ 中找不到（迁移文件被删了） | 不要删已应用的迁移文件。若已删，手动修正 `alembic_version` 表 |
| 执行 upgrade 报"表已存在" | 数据库中已有该表，但迁移脚本还在 CREAT | 检查 migration 的 `downgrade()` 是否正确删除了表 |
| autogenerate 不生成任何迁移 | ① 没设 `target_metadata`；② 模型忘记继承 `Base`；③ 数据库已经和模型一致 |
| autogenerate 想把 TIMESTAMPTZ 改成 TIMESTAMP | `DateTime()` 默认无时区 | 显式写 `DateTime(timezone=True)` |

---

## 11. 面试题速查

### 基础题

**数据库迁移是什么？为什么需要 Alembic？**

用代码管理 DDL 变更。可追踪（谁改了什么）、可回滚（改错了能退）、可复现（新环境一键同步）。不用记"上次在 psql 里手动建了什么表"。

**`alembic_version` 表的作用？**

记录当前数据库在哪个迁移版本。每个环境的数据库独立维护自己的版本号。Alembic 通过查这个表决定哪些迁移还没应用。

**autogenerate 的原理和局限？**

原理：对比 `Base.metadata`（模型定义）和数据库实际结构（反射获取），生成差异脚本。局限：① 列重命名被识别为删旧+增新（数据丢失）；② 不检测索引变更；③ 不检测部分默认值变更；④ SQLite 不支持 ALTER TABLE。

**upgrade/downgrade 的对称性要求？**

`upgrade()` 建了什么，`downgrade()` 必须对称地删掉。如果 upgrade 里 ADD COLUMN + CREATE INDEX，downgrade 里要 DROP INDEX + DROP COLUMN。不对称 = 回滚失败 = 生产事故。

### 进阶题

**如何处理列重命名？（高频陷阱题）**

autogenerate 不能可靠识别“重命名”这一业务意图，通常会生成删旧列和增新列，存在数据丢失风险。必须人工审查，并改成适合当前 Alembic 与 PostgreSQL 版本的重命名操作。

**生产环境如何零停机执行迁移？**

用 Expand-Contract 模式：先加新列（nullable）→ 双写代码部署 → 分批回填历史数据 → 切换约束 → 等旧代码完全下线后再删旧列。核心原则：永远不要在同一个部署中加列又删列。

**Multiple Heads 怎么处理？**

`alembic merge heads` 生成合并迁移，或在 CI 中用 `alembic check` 提前拦截。团队协作中最好的策略是要求迁移 PR 先 rebase 到最新 main。

**如何加索引不锁表？**

PostgreSQL 用 `CREATE INDEX CONCURRENTLY`——不阻塞写入。Alembic 中需要在 autocommit 模式下执行：

```python
def upgrade():
    with op.get_context().autocommit_block():
        op.create_index('idx_name', 'table', ['column'],
                        postgresql_concurrently=True)
```

**`alembic check` 在 CI/CD 中的作用？**

检测是否有未应用的迁移或多 head。放在 CI 流水线中，发现数据库 Schema 和迁移版本不一致就阻断部署——防止"代码部署了但迁移忘了跑"的生产事故。

---

## 踩坑记录

| 问题 | 原因 | 解决 |
|------|------|------|
| `alembic` 命令不存在 | 没装包 | `uv pip install alembic` |
| autogenerate 想把 TIMESTAMPTZ 改成 TIMESTAMP | `DateTime()` 默认无时区 | 模型里写 `DateTime(timezone=True)` |
| `target_metadata = None` → 不生成迁移 | env.py 没导入 Base | 手动改 env.py，import Base + 设 target_metadata |
| autogenerate 生成"删旧+增新"而非 rename | 列重命名是 autogenerate 的首个局限 | 手动写 `op.alter_column(..., new_column_name=...)` |

---

## SQL / 迁移实验补记

当日的核心实验是 DDL 迁移，而不是业务查询。仓库中的迁移链可以证明建表变更已被版本化；以下命令用于重新验证，执行结果未在当日笔记中留存，不能视为已有自动化测试。

```bash
alembic current
alembic history
alembic upgrade head
alembic downgrade -1
alembic upgrade head
```

验证重点：

1. `upgrade head` 后四张表、外键和唯一约束存在。
2. `downgrade -1` 只撤销最后一个 revision，版本号同步回退。
3. 再次 `upgrade head` 能恢复结构且不依赖 `create_all()`。
4. 使用 `\d+ agent_runs` 和 `\d+ run_steps` 核对 `TIMESTAMPTZ`、NULL、默认值与模型是否一致。

---

## 仍不理解的内容

- [ ] 生产环境中含数据列变更如何做到兼容发布和可回滚
- [ ] Alembic 异步 `env.py` 与同步迁移执行之间的关系
- [ ] CHECK、部分唯一索引等约束何时应手写迁移而不是依赖 autogenerate

---

## 已知问题

- 没有保存 upgrade / downgrade 的终端输出，也没有迁移测试。
- `agent_runs` 的幂等约束当前是全局 `UNIQUE(idempotency_key)`；项目目标要求评估并改为 `(conversation_id, idempotency_key)`。
- Run 和 ToolCall 状态目前主要是文本默认值，缺少数据库 CHECK 约束与应用状态机验证。

---

## 明日任务

- 学习 ACID、PostgreSQL 默认 Read Committed 和 Repeatable Read。
- 用两个 psql 会话复现不可重复读、写冲突和 `SELECT FOR UPDATE`。
- 复习迁移链、TIMESTAMPTZ、nullable 与 Python 类型标注的一致性。

有了 Alembic 的基础，之后每次新增业务表都走 `alembic revision --autogenerate` + `alembic upgrade head` 的标准工作流，不再手动管理 DDL。
