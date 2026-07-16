---
title: "AgentLab 前七天学习进度与内容审计"
pubDate: 2026-07-16
description: "汇总 AgentLab 前七天的学习进度，审计数据库实验、API、迁移、复盘与自动化测试完成度，并明确 Day 8 的 Worker 队列计划。"
type: 项目复盘
tags: ["AgentLab", "FastAPI", "PostgreSQL", "学习复盘"]
featured: false
---

AgentLab 从 2026-07-10 开始，目前已完成第 7 天，第 8 天的 PostgreSQL 队列与 Worker 主题已经规划。部分内容已提前进入第 3 周的并发主题。

---

## 每日进度

| 天 | 日期 | 主题 | 笔记 | 提交 |
|----|------|------|------|------|
| 1 | 07-10 | Docker + psql + /health | Day 1 已完成 | 已提交 |
| 2 | 07-11 | Psycopg + 多表 + JOIN | Day 2 已完成 | 已提交 |
| 3 | 07-12 | Core + CTE + 窗口函数 | Day 3 已完成 | 已提交 |
| 4 | 07-13 | ORM + Model + Relationship | Day 4 已完成 | 已提交 |
| 5 | 07-14 | Alembic + 9 表 + 迁移 | Day 5 已完成 | 已提交 |
| 6 | 07-15 | 事务 + 隔离级别 + 并发实验 | Day 6 已完成 | 已提交 |
| 7 | 07-16 | MVCC 底层 + 死锁 + VACUUM + Run API | Day 7 已完成 | 已提交 |
| 8 | 07-17 | PostgreSQL 队列 + SKIP LOCKED + Worker | 已规划 | 待提交 |

---

## 前七天内容审计

审计依据是项目的每日输出、测试要求和 Definition of Done，以及仓库现有文件与 Git 历史。“已完成”表示有仓库证据，“部分完成”表示有内容但证据或验证不完整，“缺失”表示尚未完成。

| 天 | 学习笔记 | SQL / 数据库实验 | 面试题 | 可运行功能 | 问题与复盘 | Git 提交 | 自动化测试 |
|----|----------|------------------|--------|------------|------------|----------|------------|
| 1 | 已完成 | psql 基础 | 已完成 | `/health` | 已完成 | 已完成 | 缺失 |
| 2 | 已完成 | Psycopg / JOIN | 已完成 | Agent / Conversation API | 已补收尾 | 已完成 | 缺失 |
| 3 | 已完成 | CTE / 窗口函数 | 已完成 | Core API | 已补收尾 | 已完成 | 缺失 |
| 4 | 已完成 | ORM CRUD | 已完成 | ORM API | 已补收尾 | 已完成 | 缺失 |
| 5 | 已完成 | Alembic DDL，缺少保存的回滚输出 | 已完成 | 迁移链 | 已补收尾 | 已完成 | 缺失 |
| 6 | 已完成 | 双会话事务实验 | 已完成 | 事务实验脚本 | 已完成 | 已完成 | 缺失 |
| 7 | 已完成 | MVCC / 死锁 / VACUUM | 已完成 | Run API | 已补收尾 | 已完成 | 缺失 |

### 审计结论

- 前七天学习主线完整，学习顺序符合 `psql → Psycopg → Core → ORM → Alembic`。
- Day 2、3、4、5、7 原先缺少部分“仍不理解 / 已知问题 / 明日任务”栏目，现已根据仓库事实补齐。
- Day 5 的迁移文件存在，但没有留存 `upgrade → downgrade → upgrade` 的实际输出；已补验证清单，仍需重跑后填写结果。
- 七天均有 Git 提交和学习笔记，但仓库没有 `tests/`，因此所有自动化测试项仍为缺失，不能按 Definition of Done 认定相关功能完全完成。
- 尚未保存任何索引优化前后的 `EXPLAIN (ANALYZE, BUFFERS)` 对照；Day 8 先为 Worker 领取查询记录基线，不在小数据上盲目加索引。
- Day 7 Run API 的并发检查仍是“先查再写”，幂等约束范围、`IntegrityError` 映射、状态 CHECK、Service 事务边界均待完善。

---

## 数据表完成度

| 表 | 状态 |
|----|------|
| users | 已完成 |
| agents | 已完成 |
| conversations | 已完成 |
| messages | 已完成 |
| agent_runs | 已完成 |
| run_steps | 已完成 |
| tool_calls | 已完成 |
| tool_approvals | 已完成 |
| tools | 待完成 |
| agent_tools | 待完成 |
| knowledge_bases | 待完成 |
| documents | 待完成 |
| document_chunks | 待完成 |
| usage_records | 待完成 |
| worker_heartbeats | 待完成 |

---

## API 端点完成度

| 端点 | 状态 |
|------|------|
| GET /health | 已完成 |
| POST /agents | 已完成 |
| GET /agents | 已完成 |
| POST /conversations | 已完成 |
| GET /conversations | 已完成 |
| POST /conversations/{id}/messages | 待完成 |
| GET /conversations/{id}/messages | 待完成 |
| POST /conversations/{id}/runs | 已完成 |
| GET /runs/{id} | 已完成 |
| GET /runs/{id}/steps | 已完成 |
| POST /runs/{id}/cancel | 待完成 |
| WS /ws/runs/{id} | 待完成 |

---

## 迁移版本链

```text
<base>
  → 889d9c5fcf68 (init)
  → c1b5df9c9b22 (add agent_runs)
  → c42f05ea7485 (add run_steps)
  → b14a7dd570d1 (add tool_calls + tool_approvals)
  → 1691672c5ae9 (idempotency_key nullable)
```

---

## 下一步：Day 8

1. 在独立测试库准备 queued Run，并确认不会误连开发库。
2. 用两个 psql 会话观察 `FOR UPDATE SKIP LOCKED`、等待、COMMIT 和 ROLLBACK。
3. 实现同一事务内的“领取 + queued → running”，Repository 不 commit。
4. 建立最小状态机并注入失败验证原子回滚。
5. 编写多 Worker 并发测试，断言领取 ID 无重复。
6. 保存领取 SQL 的 `EXPLAIN (ANALYZE, BUFFERS)` 基线，完成复盘与 Git 提交。

### Day 8 暂不扩展

- 不接真实模型 SDK。
- 不实现完整重试、心跳和超时恢复；这些作为 Day 9 主题。
- 不在缺少数据量和执行计划证据时创建队列索引。
