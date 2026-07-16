---
title: "Day 7：MVCC 底层探秘 —— 用 pageinspect 亲眼看到死元组，亲手制造死锁"
pubDate: 2026-07-16
description: "深入 PostgreSQL MVCC 底层：用 xmin/xmax/ctid 追踪行的版本链，用 pageinspect 扩展直接在数据页中观察死元组分布，亲手制造死锁并分析 PG 的检测机制，VACUUM 前后对比验证空间回收效果。附 19 道 MVCC/VACUUM/死锁高频面试题。"
type: 学习日志
tags: ["PostgreSQL", "MVCC", "VACUUM", "死锁", "pageinspect", "数据库内核"]
featured: false
series: fastapi-postgres-learning
seriesOrder: 7
---

## 前言

Day 6 在 psql 双窗口中验证了 Read Committed 和 Repeatable Read 的行为差异，但有一个根本问题没回答：**为什么 PG 能做到读不阻塞写？**

答案在 MVCC（多版本并发控制）。今天不止是理解概念——直接用 `pageinspect` 扩展看到数据页里的死元组堆积，亲手制造死锁看 PG 怎么检测和杀掉事务，再用 VACUUM 清理死元组验证空间回收效果。

---

## 1. 系统隐藏列：每行数据的"身份证"

PostgreSQL 每行数据都有 4 个隐藏系统列，普通 `SELECT *` 看不到它们，但可以显式查询：

| 隐藏列 | 含义 |
|--------|------|
| `xmin` | 创建这行的事务 ID |
| `xmax` | 删除/使这行过期的事务 ID（0 = 未删除，仍存活） |
| `ctid` | 物理位置 `(page_number, slot_offset)` |
| `cmin/cmax` | 同一事务内的命令序号 |

```sql
CREATE TEMP TABLE mvcc_test (id SERIAL PRIMARY KEY, value TEXT);
INSERT INTO mvcc_test (value) VALUES ('hello');

SELECT xmin, xmax, ctid, id, value FROM mvcc_test;
-- xmin | xmax | ctid  | id | value
--  829 |    0 | (0,1) |  1 | hello
```

解读：事务 829 创建了这一行，尚未被删除（xmax=0），物理位置在第 0 号数据页第 1 个槽位。

---

## 2. MVCC 核心：UPDATE = DELETE + INSERT

这是 PG MVCC 最核心的认知——**PG 从不原地修改数据**：

```sql
BEGIN;
UPDATE mvcc_test SET value = 'world' WHERE id = 1;
SELECT xmin, xmax, ctid, id, value FROM mvcc_test;
-- xmin | xmax | ctid  | id | value
--  830 |    0 | (0,2) |  1 | world
COMMIT;
```

旧版本 `(0,1)` 发生了什么？**xmax 被设为 830**（当前事务 ID）→ 标记为"已删除"。物理上还在磁盘，但对外不可见。新版本出现在 `(0,2)`。

**MVCC 三定律**：

```
INSERT  → 新 tuple: xmin=me, xmax=0
DELETE  → 旧 tuple: xmax=me
UPDATE  → 旧 tuple xmax=me + 新 tuple xmin=me
```

> PG 用**空间换并发**：多版本共存让读操作永远不需要等待写操作，回滚几乎零成本（xmax 标记为 aborted 就行）。

---

## 3. pageinspect：直接看到死元组

这是今天最震撼的实验——用 `pageinspect` 扩展直接读取数据页的物理内容，亲眼看到死元组堆积。

```sql
CREATE EXTENSION IF NOT EXISTS pageinspect;

-- 连续 UPDATE 5 次，制造死元组
UPDATE mvcc_test SET value = 'v1' WHERE id = 1;
UPDATE mvcc_test SET value = 'v2' WHERE id = 1;
UPDATE mvcc_test SET value = 'v3' WHERE id = 1;
UPDATE mvcc_test SET value = 'v4' WHERE id = 1;
UPDATE mvcc_test SET value = 'v5' WHERE id = 1;

-- 普通 SELECT 只能看到 1 行
SELECT xmin, xmax, ctid, value FROM mvcc_test;
-- xmin | xmax | ctid  | value
--  835 |    0 | (0,7) | v5

-- pageinspect 看到全部 7 行！
SELECT lp, t_xmin, t_xmax, t_ctid, t_data
FROM heap_page_items(get_raw_page('mvcc_test', 0));
```

pageinspect 输出揭示了真相：

```
lp  t_xmin  t_xmax  t_ctid  含义
1   829     830     (0,2)   "hello" → 被事务 830 删了
2   830     831     (0,3)   "world" → 被事务 831 删了
3   831     832     (0,4)   "v1"   → 被事务 832 删了
4   832     833     (0,5)   "v2"   → 被事务 833 删了
5   833     834     (0,6)   "v3"   → 被事务 834 删了
6   834     835     (0,7)   "v4"   → 被事务 835 删了
7   835     0       (0,7)   "v5"   ← 唯一活着的行
```

**7 行物理存在，SELECT 只能看到 1 行。** 前 6 行是**死元组**——xmax 有值且对应事务已提交。这就是**表膨胀**的根源：一条逻辑行占用了 7 个物理槽位。

---

## 4. 死锁实验：亲手制造循环等待

两个 psql 窗口，交叉锁 agent id=1 和 id=13：

| 步骤 | 窗口 A | 窗口 B |
|------|--------|--------|
| 1 | `BEGIN;` | `BEGIN;` |
| 2 | `UPDATE agents SET name='a_lock_1' WHERE id=1;` | `UPDATE agents SET name='b_lock_13' WHERE id=13;` |
| 3 | `UPDATE agents SET name='a_wants_13' WHERE id=13;` → **卡住** | |
| 4 | | `UPDATE agents SET name='b_wants_1' WHERE id=1;` → **💀 死锁！** |

B 立即报错：

```
ERROR:  deadlock detected
DETAIL:  Process 43 waits for ShareLock on transaction 837;
         blocked by process 2138.
         Process 2138 waits for ShareLock on transaction 838;
         blocked by process 43.
```

死锁环路：

```
       持有1              持有13
    A ────────→ 等13
    ↑              │
    │              ↓
    └── 等1 ────  B  ← 被 PG 杀掉
```

关键发现：

| 问题 | 答案 |
|------|------|
| PG 多久检测到死锁？ | 约 200ms（`deadlock_timeout` 默认 1s） |
| 谁被杀了？ | **代价更小的那个事务**（B，修改行数少） |
| B 被杀后 A 怎么办？ | A 拿到锁，继续执行成功 |
| 如何预防？ | **统一资源访问顺序**——都按 id 升序操作 |

---

## 5. VACUUM：死元组清道夫

### 两种 VACUUM

| | VACUUM | VACUUM FULL |
|--|--------|------------|
| 做什么 | 标记死元组空间为可复用 | 重写整个表，**归还磁盘** |
| 阻塞读写 | ❌ 不阻塞 | ✅ 阻塞（排他锁） |
| 什么时候用 | 日常自动（autovacuum） | 极少数维护窗口 |

### pageinspect 前后对比

```sql
VACUUM mvcc_test;

SELECT lp, t_xmin, t_xmax, t_data
FROM heap_page_items(get_raw_page('mvcc_test', 0));
```

```
VACUUM 前：lp 1-6 → 死元组（xmax 有值，数据还在）
VACUUM 后：lp 1-6 → 空槽位（数据已清空，可复用）
           lp 7   → 活元组不变
```

7 个槽位仍在，但前 6 个已清空。**磁盘空间未归还**——只是标记"下次 INSERT 可以覆盖这里"。归还磁盘需要 `VACUUM FULL`（但会锁表，生产慎用）或 `pg_repack`。

### 什么情况 VACUUM 清理不了死元组？

- **长事务**：持有旧快照 → 死元组的 xmax 在快照中仍算"未提交"
- **未关闭的游标**：`WITH HOLD` 游标持有快照
- **复制槽滞留**：逻辑复制槽未消费 → xmin 无法推进
- **PREPARED TRANSACTION**：两阶段提交悬挂

---

## 6. MVCC 完整生命周期

```
INSERT 'hello'
  → lp=1: xmin=829, xmax=0

UPDATE → 'world'
  → lp=1: xmax=830（死）
  → lp=2: xmin=830, xmax=0（活）

UPDATE × 5 ...
  → lp=1~6: 全部死元组
  → lp=7: 活元组

VACUUM
  → lp=1~6: 清空（可复用）
  → lp=7: 不受影响
```

---

## 7. Run API 端点

今天还完成了 Agent 运行引擎的第一批 API 端点：

| 端点 | 方法 | 功能 |
|------|------|------|
| `/conversations/{id}/runs` | POST | 创建 Run（status=queued） |
| `/runs/{run_id}` | GET | 查 Run 状态 |
| `/runs/{run_id}/steps` | GET | 查 RunStep 列表 |

三个关键设计决策：

1. **并发保护**：创建前检查同一 Conversation 是否已有 `queued`/`running` 的 Run → 有则 409
2. **幂等**：`idempotency_key` UNIQUE 约束，重复请求不会创建多个 Run
3. **状态机**：只允许从 `queued` 出发（Worker 后续改为 `running`）

---

## 8. 面试题速查

### MVCC 基础

**MVCC 的核心目标？**

读不阻塞写，写不阻塞读。PG 通过 xmin/xmax/ctid + 事务快照 + 可见性判断三层机制实现。

**UPDATE 为什么产生死元组？**

PG 从不原地修改——UPDATE = DELETE（旧行 xmax=当前事务）+ INSERT（新行 xmin=当前事务）。旧行成为死元组，等待 VACUUM 清理。

**xmin、xmax、ctid 三种操作下的变化？**

| 字段 | INSERT | DELETE | UPDATE |
|------|--------|--------|--------|
| xmin | = 当前 XID | 不变 | 新版本 = 当前 XID |
| xmax | = 0 | = 当前 XID | 旧版本 = 当前 XID |
| ctid | 新位置 | 不变 | 新版本 → 新位置 |

### 死元组与 VACUUM

**死元组有什么危害？**

表膨胀（1GB 数据可能占 5GB）、查询变慢（扫描时跳过大量死元组）、索引退化、VACUUM 负担加重。

**VACUUM vs VACUUM FULL vs pg_repack？**

| | VACUUM | VACUUM FULL | pg_repack |
|--|--------|------------|-----------|
| 空间回收 | 标记可复用 | **归还磁盘** | **归还磁盘** |
| 锁 | 不阻塞读写 | 全程排他锁 | 仅切换时短暂锁 |
| 生产环境 | ✅ 随时 | ❌ 慎用 | ✅ 推荐 |

**线上表 n_dead_tup 500 万，怎么办？**

① 查长事务（`idle in transaction`）；② 查复制槽滞留；③ 查悬挂的 PREPARED TRANSACTION；④ 解阻塞后手动 `VACUUM`；⑤ 空间急需回收用 `pg_repack`（不是 VACUUM FULL）；⑥ 调 autovacuum 参数（降低 `scale_factor`，提高 `cost_limit`）。

### 死锁

**死锁怎么排查和预防？**

排查：`SELECT * FROM pg_locks WHERE NOT granted` 找未获得的锁，`pg_blocking_pids(pid)` 找阻塞链。预防：① 统一资源访问顺序（都按 id 升序）；② 缩短事务；③ 设 `lock_timeout`；④ 应用层重试。

**`deadlock_timeout` 和 `lock_timeout` 的区别？**

`deadlock_timeout` 是检查死锁的间隔（默认 1s），`lock_timeout` 是等待锁的最大时间（超时就报错，默认 0=无限等）。

### PG vs MySQL MVCC 对比

| 维度 | PostgreSQL | MySQL InnoDB |
|------|-----------|-------------|
| 旧版本存储 | 表中（多版本共存在数据页） | Undo Log 中 |
| UPDATE 操作 | DELETE + INSERT 新 tuple | 原地更新 + Undo 记旧值 |
| 清理机制 | VACUUM / autovacuum | Purge 线程 |
| 回滚开销 | 几乎为零（xmax 标记即可） | 需从 Undo Log 重建 |
| 表膨胀 | 高（需 VACUUM 管理） | 低（表本身不膨胀） |

> 记忆口诀：PG **空间换时间**（多版本占空间但无 undo 回溯），InnoDB **时间换空间**（表紧凑但读老版本要回溯 undo 链）。

**长事务的后果对比？**

| | PostgreSQL | MySQL |
|--|-----------|-------|
| 数据膨胀 | **表膨胀**（死元组无法清理） | 表不膨胀 |
| 日志膨胀 | WAL 不膨胀 | **Undo Log 膨胀** |
| 额外风险 | XID 回卷 | Purge 滞后 |

### XID 回卷（加分题）

PG 事务 ID 是 32 位（约 42 亿），用完回卷。如果旧数据没冻结而新事务 ID 已回卷 → 可见性判断反转 → 数据丢失。当 `age(datfrozenxid)` 接近 20 亿，数据库**强制只读**。MySQL 不存在这个问题——InnoDB 基于 Undo Log 和 ReadView，没有事务 ID 回卷。

---

## 踩坑记录

| 问题 | 原因 | 解决 |
|------|------|------|
| `idempotency_key` IntegrityError | 模型写成 `Mapped[str]` (NOT NULL) 但允许为空 | 改为 `Mapped[Optional[str]]` + 新迁移 |
| pageinspect 扩展不存在 | 未安装 | `CREATE EXTENSION IF NOT EXISTS pageinspect` |
| VACUUM 后空间没变小 | VACUUM 只标记不归还磁盘 | 用 `VACUUM FULL` 或 `pg_repack` |

---

## 下一步

Day 8 继续深入——HOT Update（Heap-Only Tuple）原理、autovacuum 参数调优、以及 Run Worker 的后台消费逻辑实现。
