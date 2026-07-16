---
title: "Day 6：数据库事务与并发 —— 双窗口实验驱动的隔离级别理解"
pubDate: 2026-07-14
description: "用 psql 双窗口亲手验证 Read Committed、Repeatable Read、SELECT FOR UPDATE 的行为差异。从 ACID 到 MVCC 底层原理（xmin/xmax/ctid）、从死锁排查到乐观锁/悲观锁选型、从 PG 进程模型到 XID 回卷，系统梳理数据库事务与并发的面试核心考点。"
type: 学习日志
tags: ["PostgreSQL", "事务", "MVCC", "隔离级别", "并发", "面试"]
featured: false
series: fastapi-postgres-learning
seriesOrder: 6
---

## 前言

前五天我们从 Docker 搭建、Psycopg 写 SQL、SQLAlchemy 三层架构一路学到 Alembic 迁移管理。整个项目的数据库基础设施搭好了，但有一个问题始终没碰：**多个请求同时操作同一行数据时，会发生什么？**

今天就用 psql 双窗口动手验证——一个窗口模拟事务 A，另一个窗口模拟事务 B，亲眼看到 Read Committed 和 Repeatable Read 的行为差异。这种"动手验"的方式比背八股深刻得多。

---

## 1. ACID 四个字母

| 字母 | 含义 | 大白话 |
|------|------|--------|
| **A**tomicity | 原子性 | 要么全做，要么全不做 |
| **C**onsistency | 一致性 | 约束不坏（外键、UNIQUE、CHECK 始终有效） |
| **I**solation | 隔离性 | 事务之间不互相干扰——程度可调 |
| **D**urability | 持久性 | COMMIT 后的数据不丢（靠 WAL 保证） |

---

## 2. PostgreSQL 的事务模型

```
AUTOCOMMIT = ON（默认）
  每条 SQL 自动包裹在一个隐式事务中
  成功 → 自动 COMMIT
  失败 → 自动 ROLLBACK

AUTOCOMMIT = OFF（显式事务）
  BEGIN;  → 开始
  执行多条 SQL
  COMMIT; → 持久化（或 ROLLBACK → 回滚）
```

今天的所有实验都使用显式事务（`BEGIN;`），这样才能控制事务边界，观察并发行为。

---

## 3. 双窗口并发实验（今日核心）

以下 7 个实验用两个 psql 窗口模拟并发事务。窗口 A 和窗口 B 各自是一个独立的事务。

### 实验 1：事务报错 → aborted 状态

```sql
-- 窗口 A
BEGIN;
INSERT INTO agents (user_id, name) VALUES (1, 'test');  -- 成功
INSERT INTO agents (user_id, name) VALUES (99999, 'bad'); -- 外键冲突！
SELECT 'still alive';  -- ERROR: current transaction is aborted
ROLLBACK;  -- 只能回滚，无法恢复
```

**结论**：PostgreSQL 中，事务内任何一条语句失败 → 事务进入 `aborted` 状态 → 后续所有 SQL 被拒，直到 `ROLLBACK`。这是 PG 的"严格模式"设计——有错就别继续了。

> **MySQL 差异**：MySQL InnoDB 默认不进入 aborted 状态，语句失败后可以继续执行下一条（取决于 `sql_mode`）。PG 更严格，MySQL 更宽松。

### 实验 2：Read Committed —— 防脏读 ✅

| 步骤 | 窗口 A | 窗口 B |
|------|--------|--------|
| 1 | `BEGIN;` | |
| 2 | `UPDATE agents SET name='dirty' WHERE id=1;` | |
| 3 | | `SELECT name FROM agents WHERE id=1;` → **旧值** |
| 4 | `ROLLBACK;` | |
| 5 | | `SELECT name FROM agents WHERE id=1;` → **仍为旧值** |

✅ Read Committed 成功阻止了脏读——窗口 B 始终看不到 A 未提交的修改。

### 实验 3：Read Committed —— 不防不可重复读 ❌

| 步骤 | 窗口 A | 窗口 B |
|------|--------|--------|
| 1 | | `BEGIN;` |
| 2 | | `SELECT name FROM agents WHERE id=1;` → **old_name** |
| 3 | `BEGIN; UPDATE agents SET name='changed' WHERE id=1; COMMIT;` | |
| 4 | | `SELECT name FROM agents WHERE id=1;` → **changed** ← 变了！ |

❌ 同一事务内，两次读同一行，值不同。这就是**不可重复读**。

### 实验 4：Repeatable Read —— 快照隔离 ✅

| 步骤 | 窗口 A | 窗口 B |
|------|--------|--------|
| 1 | | `BEGIN ISOLATION LEVEL REPEATABLE READ;` |
| 2 | | `SELECT name FROM agents WHERE id=1;` → **old_name** |
| 3 | `BEGIN; UPDATE agents SET name='rr_test' WHERE id=1; COMMIT;` | |
| 4 | | `SELECT name FROM agents WHERE id=1;` → **old_name** ← 没变！ |

✅ 整个事务看到的是**事务开始时的快照**。即使别人 COMMIT 了，也影响不到本事务。

### 实验 5：Repeatable Read 直接 UPDATE —— 丢失更新 ⚠️

| 步骤 | 窗口 A | 窗口 B |
|------|--------|--------|
| 1 | | `BEGIN ISOLATION LEVEL REPEATABLE READ;` |
| 2 | | `UPDATE agents SET name='B_wins' WHERE id=1;` |
| 3 | `UPDATE agents SET name='A_wins' WHERE id=1;` → **卡住** | |
| 4 | | `COMMIT;` |
| 5 | → A 继续执行，且**A 覆盖了 B 的结果** | |

⚠️ A 的 UPDATE 覆盖了 B 刚提交的结果——**丢失更新**。Repeatable Read 的快照只保护 SELECT，不保护 UPDATE。

### 实验 6：Repeatable Read 先读后改 —— 冲突检测 ✅

| 步骤 | 窗口 A | 窗口 B |
|------|--------|--------|
| 1 | | `BEGIN ISOLATION LEVEL REPEATABLE READ;` |
| 2 | | `SELECT name FROM agents WHERE id=1;` — 读了值 `X` |
| 3 | `UPDATE agents SET name='conflict' WHERE id=1; COMMIT;` | |
| 4 | | `UPDATE agents SET name='should_fail' WHERE id=1;` — **报错！** |

```
ERROR: could not serialize access due to concurrent update
```

✅ 关键区别：**你一旦 SELECT 读了某行，PG 就认为"你对这行的状态有依赖"。** 如果之后别人改了这行，你再 UPDATE 它 → PG 检测到"你基于的快照已经过时" → 主动报错，防止静默覆盖。

> 这就是实验 5 和实验 6 的核心差异：纯 UPDATE（没读过）无法检测冲突；SELECT + UPDATE（读过再改）能检测到。

### 实验 7：SELECT FOR UPDATE —— 悲观锁

| 步骤 | 窗口 A | 窗口 B |
|------|--------|--------|
| 1 | `BEGIN;` | |
| 2 | `SELECT name FROM agents WHERE id=1 FOR UPDATE;` | |
| 3 | | `SELECT name FROM agents WHERE id=1 FOR UPDATE;` → **卡住** |
| 4 | `COMMIT;` | |
| 5 | | → 返回 A 提交后的最新数据 |

`FOR UPDATE` 对命中的行加**排他行锁**。其他事务的 `FOR UPDATE` 必须等待。但普通 SELECT（不加锁）不受影响——它可以读 MVCC 的旧版本。

---

## 4. 三个隔离级别对比

| 隔离级别 | 防脏读 | 防不可重复读 | 防丢失更新 | 实现方式 | 性能 |
|---------|:--:|:--:|:--:|---------|:--:|
| **Read Committed** | ✅ | ❌ | ❌ | 每条语句看到最新已提交快照 | 最高 |
| **Repeatable Read** | ✅ | ✅ | ⚠️ 先读后改会报错 | 整个事务共享一个快照 | 中 |
| **Serializable** | ✅ | ✅ | ✅ | SSI 冲突检测 | 最低 |

PostgreSQL 默认是 Read Committed。生产环境推荐对一致性要求高的场景用 Repeatable Read——比 RC 安全得多，性能损失很小。

---

## 5. 事务中报错：PG vs MySQL

| | PostgreSQL | MySQL (InnoDB) |
|--|-----------|----------------|
| 语句失败后事务状态 | **aborted**，后续全部被拒 | 可以继续执行 |
| 必须 ROLLBACK | ✅ 必须 | ❌ 可以不 |
| 设计理念 | 严格：有错就别继续 | 宽松：你自己决定 |

---

## 6. Psycopg 事务代码

```python
conn = psycopg.connect(CONN_STR)
conn.autocommit = False  # 关闭自动提交

try:
    conn.execute("INSERT INTO ...")
    conn.commit()          # 持久化
except Exception:
    conn.rollback()        # 回滚
finally:
    conn.close()
```

---

## 7. 踩坑：ORM `default` vs 数据库 `DEFAULT`

当直接用 psycopg 插入数据时，`created_at` 报 NOT NULL 错误。原因：

```python
# ORM 模型只设了 Python 侧默认值——直接 SQL 插入时不生效
created_at: Mapped[datetime] = mapped_column(
    DateTime(timezone=True),
    default=datetime.utcnow  # ← 只在 ORM 层生效
)

# 正确做法：加数据库级别的 DEFAULT
created_at: Mapped[datetime] = mapped_column(
    DateTime(timezone=True),
    default=datetime.utcnow,
    server_default=func.now()  # ← 数据库层 DDL: DEFAULT NOW()
)
```

`server_default` 会在 Alembic 生成的 DDL 中加上 `DEFAULT NOW()`，无论用 ORM 还是原生 SQL 插入，都能拿到正确的默认值。

---

## 8. 面试题速查

### 基础必答

**什么是 ACID？数据库如何实现？**

| 特性 | 实现机制 |
|------|----------|
| Atomicity | Undo Log：回滚时恢复旧版本 |
| Consistency | 由 A + I + D 共同保证，约束做最后防线 |
| Isolation | MVCC（快照读）+ 锁机制（写） |
| Durability | WAL / Redo Log：先写日志再写数据 |

**脏读、不可重复读、幻读的区别？**

| 现象 | 定义 | 触发操作 |
|------|------|---------|
| 脏读 | 读到未提交的数据 | 别人 INSERT/UPDATE 但未 COMMIT |
| 不可重复读 | 同一行两次读值不同 | 别人 UPDATE 了同一行 |
| 幻读 | 同一条件两次读行数不同 | 别人 INSERT/DELETE |

**PG 和 MySQL 默认隔离级别为什么不同？**

PG 默认 Read Committed——依赖 MVCC 快照，RC 足够安全且性能最高。MySQL 默认 Repeatable Read——历史原因（Statement-Based Replication 需要 RR 保证主从一致），同时依赖 Next-Key Lock 防幻读。

### MVCC 原理

**PG 的 MVCC 怎么实现？**

每行数据有三个隐藏字段：`xmin`（创建该版本的事务 ID）、`xmax`（删除该版本的事务 ID）、`ctid`（物理位置）。UPDATE = 打旧行的 xmax + INSERT 新行。事务通过快照（`pg_current_snapshot()`）判断哪些版本可见：xmin 已提交且不在活跃列表 → 可见。

**PG MVCC vs MySQL InnoDB MVCC？**

| 维度 | PostgreSQL | MySQL |
|------|-----------|-------|
| 旧版本存储 | 数据页（heap table） | Undo Log |
| UPDATE 操作 | DELETE + INSERT（新 tuple） | 原地更新 + Undo 记旧值 |
| 清理机制 | VACUUM | Purge 线程 |
| 回滚开销 | 几乎为零（标记即可） | 需要从 Undo Log 重建 |

**什么是死元组？为什么表会膨胀？**

死元组是旧版本数据（xmax 已提交，不再被任何事务需要）。一条数据 UPDATE 100 次 = 同页 100 个 tuple 版本，实际只需要 1 行。VACUUM 标记死元组空间为可复用，VACUUM FULL 重写整表归还磁盘（但会阻塞读写）。

### 锁机制

**`FOR UPDATE SKIP LOCKED` 和 `NOWAIT` 的区别？**

| 选项 | 遇到被锁定的行 |
|------|-------------|
| 默认 FOR UPDATE | **等待**直到锁释放 |
| SKIP LOCKED | **跳过**被锁的行，返回未锁的 |
| NOWAIT | **立即报错**，不等待 |

经典多 Worker 任务队列模式：

```sql
BEGIN;
SELECT id FROM tasks
WHERE status = 'queued'
ORDER BY created_at
FOR UPDATE SKIP LOCKED
LIMIT 1;

UPDATE tasks SET status = 'processing' WHERE id = :id;
COMMIT;
```

**乐观锁 vs 悲观锁？**

| | 悲观锁 | 乐观锁 |
|--|--------|--------|
| 实现 | `SELECT FOR UPDATE` | `UPDATE ... WHERE version = ?` |
| 冲突处理 | 等待 | 重试 |
| 适用 | 冲突概率高（库存扣减） | 冲突概率低（用户信息修改） |

**死锁怎么预防？**

四个条件缺一不可：互斥、持有并等待、不可抢占、循环等待。预防方法：① 统一资源访问顺序（都按主键升序操作）；② 缩短事务；③ 设置 `lock_timeout`；④ 应用层加重试。PostgreSQL 会自动检测死锁；锁等待超过 `deadlock_timeout` 后触发检查，常见默认值为 1 秒，以实例配置为准。检测到环路后，其中一个事务收到死锁错误并回滚，不能概括为固定选择“代价最小”的事务。

### 场景题

**如何用数据库实现任务队列，不重复消费？**

核心：`FOR UPDATE SKIP LOCKED` + 事务内 SELECT + UPDATE。SELECT 拿锁，SKIP LOCKED 跳过已被拿的任务，事务保证原子性。还需考虑 Worker 崩溃后的超时恢复。

**库存扣减怎么不超卖？**

`UPDATE product SET stock = stock - 1 WHERE id = 1 AND stock >= 1` — 有 WHERE 保护不会减到负数。高并发下用乐观锁（加 version 字段）或悲观锁（`SELECT FOR UPDATE`），取决于冲突概率。

**一条 UPDATE 从执行到落盘经历了什么？**

解析器（语法树）→ 重写器（应用规则）→ 优化器（选择 Index Scan 还是 Seq Scan）→ 执行器（获取行锁）→ 写 WAL Buffer → 修改 Buffer Pool 中的数据页 → COMMIT → WAL 刷盘 → Checkpoint 时 dirty page 写入数据文件。

### 加分题

**什么是 XID 回卷？**

PG 事务 ID 是 32 位的（约 42 亿），用完回卷。如果 autovacuum 没及时冻结旧数据的事务 ID，数据库会进入保护模式拒绝写入。MySQL 没有这个问题（基于回滚段而非事务 ID）。

**PG 进程模型 vs MySQL 线程模型？**

PG 用 fork 子进程（独立内存，隔离好但开销大），MySQL 用 thread（共享内存，省资源但一个崩可能影响全体）。

---

## 踩坑记录

| 问题 | 原因 | 解决 |
|------|------|------|
| psycopg 插入 `created_at` 报 NOT NULL | ORM `default` 只在 Python 层生效 | SQL 中手动加 `NOW()` 或模型加 `server_default=func.now()` |
| 事务内报错后所有 SQL 被拒 | PG 的 aborted 状态 | 必须 `ROLLBACK` 后重新开始 |
| Repeatable Read 下纯 UPDATE 覆盖了别人的提交 | 没先 SELECT → PG 无法检测冲突 | 先 SELECT 再 UPDATE 可触发冲突检测 |

---

## 仍不理解的内容

- [x] MVCC 底层：xmin、xmax、ctid、tuple 版本链（Day 7 已完成基础实验）
- [ ] Serializable 的 SSI 实现原理
- [x] 死锁实验：A 锁行 1 等行 2，B 锁行 2 等行 1（Day 7 已复现）
- [x] VACUUM 基础实操（Day 7 已完成）
- [ ] VACUUM FULL 与 autovacuum 参数实验

---

## 明日任务

Day 7 深入 MVCC 底层：xmin、xmax、ctid、HOT Update、VACUUM 原理，以及 Agent 运行引擎的核心 API（POST /runs、GET /runs/{id}）。
