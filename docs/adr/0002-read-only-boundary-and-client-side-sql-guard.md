# ADR-0002：一期只读边界与客户端 SQL 守卫

- 状态：Superseded by ADR-0004（仅“一期只读”结论被取代；本文第 2、4 条即客户端 SQL 守卫与 `truncated` 保真继续有效）
- 日期：2026-10-11
- 决策者：项目维护者
- 关联：`docs/README.md`（项目说明，实施阶段创建）、`examples/CLI-Anything/siyuan/core/client.py`（Python 参考实现）

## 背景

本期目标是让思源笔记知识库可被 Agent 与人工只读访问。两处实测事实决定了边界的可行性：

1. **内核不提供只读兜底**：`POST /api/query/sql` 不做语句类型限制。实测 `PRAGMA table_info(blocks)` 被正常执行；`INSERT INTO __no_such_table__` 仅因表不存在而失败，说明变更语句本身是会被执行的。
2. **内核默认截断且参考实现会丢掉该信息**：无显式 `LIMIT` 时服务端默认上限为 64 行并置 `truncated: true`（实测：3396 个块的库执行 `SELECT id FROM blocks` 只返回 64 行）；显式 `LIMIT n` 时返回 n 行且 `limit: 0`、`truncated: false`。上游参考实现的 `query_sql()` 只取 `data` 字段，丢弃 `limit` 与 `truncated`，会让 Agent 把不完整结果当作全量事实。

同时，写操作的安全边界（dry-run、确认、权限）在本期尚未设计。

## 决策

1. 一期只暴露 18 条只读工具，不含任何写操作，也不含 `notebook_open` / `notebook_close` / `export_resources`。
2. `sql` 工具在**客户端**执行只读守卫：仅放行单条以 `SELECT` 或 `WITH` 开头的语句；出现多语句、注释夹带或变更关键字（`PRAGMA` `ATTACH` `DETACH` `INSERT` `UPDATE` `DELETE` `DROP` `ALTER` `CREATE` `REPLACE` `VACUUM` `REINDEX` `ANALYZE` `TRUNCATE`）一律拦截并报 `SIYUAN_READONLY_BLOCKED`。
3. **不提供写开关**（如 `SIYUAN_ALLOW_SQL_WRITE`）。
4. 保留内核返回的 `limit` 与 `truncated`；`truncated === true` 时在文本输出中强制提示分页建议；**不自动改写** SQL（会改变语义）。

## 候选方案

- **依赖内核自身限制**：实测不成立（见背景第 1 条），无服务端兜底；
- **提供写开关，由使用方自担风险**：半吊子边界比明确边界更危险，且会掩盖二期尚未设计的确认机制；
- **一期直接实现全量读写**：写操作的安全边界未设计，风险最高；
- **只做只读且连 SQL 也不暴露**：失去唯一的逃生通道，Agent 在未覆盖场景下无解，18 条只读工具的表达力大幅下降。

## 后果

正面：只读期风险面最小；错误码与 `truncated` 语义成为对外契约，Agent 可据此自愈（遇截断改用分页或聚合）；对上游参考实现的截断缺陷做了实质修正。

负面：写需求推迟到二期；SQL 逃生通道被有意削权（连只读 `PRAGMA` 也不可用）；closed 笔记本的读取可用性尚未验证，若被阻塞，二期可能需要重新讨论是否放开 `notebook_open`。

## 验证与退出条件

通过三层验证：单元层守卫矩阵（白名单 `SELECT`/`WITH`、黑名单关键字、注释夹带、多语句、大小写混写）、契约层对真实内核断言 `SELECT` 放行与截断提示、以及 closed 笔记本是否阻塞 `doc_list` / `doc_tree` 的专项验证。

二期引入写操作时，必须先以新 ADR 定义 dry-run、确认流程与权限边界，并同时 supersede 本 ADR 的只读结论。
