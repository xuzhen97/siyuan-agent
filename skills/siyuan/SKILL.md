---
name: siyuan
description: 读写思源（SiYuan）笔记知识库：列出笔记本与文档树、读取块 kramdown、全文检索、SQL 查询、导出 Markdown，以及写入/修改/删除笔记与块（破坏型操作强制 confirm 确认，不传只返回预览）。当用户提到思源、SiYuan、笔记、知识库、块引用、反链，或要求在其笔记中查找、记录、修改内容时使用本技能。
compatibility: 需要本机或可访问的思源内核在运行（默认 http://127.0.0.1:6806）；内核开启鉴权时需配置 SIYUAN_TOKEN。
---

# 思源笔记读写访问

本技能通过思源内核 HTTP API 读写知识库。读操作随时可用；**写操作分两级**：增量型（`notebook_create`/`doc_create`/`block_append`/`block_prepend`/`block_insert`/`block_attrs_set`）可直接调用；破坏型（`block_update`/`block_delete`/`block_move`/`doc_rename`/`doc_move`/`doc_remove`）**必须显式传 `confirm: true`**，不传时工具只返回预览并拒绝执行。SQL 仅允许单条 `SELECT` / `WITH`。

## 定位链条（先想清楚再调用）

1. `notebook_list` 拿笔记本 id 与名称（同时给出 `closed` 状态）。
2. 定位文档：已知人类可读路径用 `doc_ids_by_hpath`；列举某一层的文档用 `doc_list`；`doc_tree` 只用于**以某篇文档为根**列子树（内核不接受根路径，必须给文档路径或 ID）。
3. 读取内容：`block_get` 拿 kramdown 源文本；`doc_export_md` 拿整篇 Markdown；`block_children` 拿子块。
4. 找不到确切位置时：`search_docs` 搜文档名，`search_blocks` 全文搜内容，`search_tag` / `tag_list` 走标签。
5. 以上都表达不了时用 `sql`（唯一逃生通道，见 `references/sql-recipes.md`）。

## 常见工作流

**浏览某个笔记本的结构**

1. `notebook_list` → 取目标 `notebook` id
2. `doc_tree` with `notebook`, `depth: 2`
3. 对感兴趣的文档 `block_get` 或 `doc_export_md`

**按内容找笔记**

1. `search_blocks` with `query`
2. 命中结果里取 `id`，用 `doc_hpath_by_id` 还原人类可读位置
3. 需要上下文时用 `block_get` 读取该块

**统计与聚合**

1. `sql` with `SELECT COUNT(*) AS c FROM blocks WHERE type = 'd'`
2. 需要明细时加显式 `LIMIT` 与 `OFFSET` 分页

**把内容写进具体笔记（写操作标准链）**

1. 定位：`doc_ids_by_hpath`（已知路径）或 `search_docs`（只记得标题）拿到文档 ID；要追加到已有块则 `block_get` 取 `id`。
2. **先读后写**：`block_get` 确认当前内容；需要防并发覆盖时记下它并用只读 SQL 取 `hash` 作为 `expectedHash`。
3. 写入：整篇新建用 `doc_create`；追加到文档末尾用 `block_append`（`parentID` 用文档 ID）；改写已有块用 `block_update`（破坏型）。
4. **破坏型必传 `confirm: true`**；不确定时先不传或 `dryRun: true` 看预览，确认后再调一次。
5. 核对：写工具返回的 `doOperations` 就是内核实际执行的动作（含新块 `id`）；把它回报给用户，别只说"已完成"。

## 边界与坑（务必遵守）

- **写操作纪律**：破坏型工具（`block_update`/`block_delete`/`block_move`/`doc_rename`/`doc_move`/`doc_remove`）**必须传 `confirm: true`**；不传时工具会返回预览并以 `SIYUAN_CONFIRM_REQUIRED` 拒绝——这是设计行为，不是故障。先读后写：改/删前先用 `block_get` 看当前内容；拿到 `doOperations` 后回报实际变化。`SIYUAN_STALE_TARGET` 表示目标在读取后被改过，必须重新读取再试。
- **SQL 仍然只读**：不要用 SQL 变通写入（`INSERT`/`UPDATE`/`PRAGMA` 等一律被拦为 `SIYUAN_READONLY_BLOCKED`）；要改内容请用写工具，而不是 SQL。
- **删除的可回滚性**：删文档前内核会先把文件写入数据历史（可在思源「数据历史」回滚，受历史保留设置限制）；但**不要把它当保险**，删前仍应先预览确认。
- **截断**：`sql` 无显式 `LIMIT` 时内核只返回 64 行并置 `truncated: true`；工具文本会提示"结果被截断"。**看到该提示必须分页或改聚合**，不要把结果当全量。
- **closed 笔记本**：`notebook_list` 中 `closed: true` 的笔记本可能无法读取内容；此时请用户先在思源中打开该笔记本再重试。
- **ID 形状**：块/文档 ID 形如 `20210817205410-2kvfpfn`（时间戳 + 随机后缀），不要自行构造。
- **连接失败**：`SIYUAN_UNREACHABLE` 表示内核未启动或地址端口不对；`SIYUAN_AUTH` 表示 Token 缺失或错误。
- **Windows Git Bash**：以 `/` 开头的参数会被 MSYS 改写成 Windows 路径（例如 `/2026…sy` 变成 `C:\Program Files\Git\…`），传给 `doc_tree` 会得到内核报错。在 Git Bash 下优先用**文档 ID** 而不是带 `/` 的路径（或设 `MSYS_NO_PATHCONV=1`）。

## 命令表

<!-- BEGIN GENERATED -->
| 工具 | VCP command | 参数 | 说明 |
| --- | --- | --- | --- |
| `version` | `Version` | — | 内核版本 |
| `status` | `Status` | — | 连接状态 |
| `notebook_list` | `NotebookList` | — | 列出笔记本 |
| `notebook_info` | `NotebookInfo` | notebook | 笔记本信息 |
| `doc_list` | `DocList` | notebook, path? | 列出文档 |
| `doc_tree` | `DocTree` | notebook, path, depth?, sort? | 文档子树 |
| `doc_path_by_id` | `DocPathById` | id | 文档存储路径 |
| `doc_hpath_by_id` | `DocHpathById` | id | 文档人类可读路径 |
| `doc_ids_by_hpath` | `DocIdsByHpath` | notebook, path | 按路径取文档 ID |
| `doc_export_md` | `DocExportMd` | id, maxChars? | 导出文档 Markdown |
| `block_get` | `BlockGet` | id, maxChars? | 读取块 kramdown |
| `block_children` | `BlockChildren` | id | 读取子块 |
| `block_attrs_get` | `BlockAttrsGet` | id | 读取块属性 |
| `search_blocks` | `SearchBlocks` | query | 全文检索块 |
| `search_docs` | `SearchDocs` | k | 检索文档名 |
| `search_tag` | `SearchTag` | k? | 检索标签 |
| `tag_list` | `TagList` | — | 列出全部标签 |
| `sql` | `Sql` | stmt | SQL 查询（只读） |
| `notebook_create` | `NotebookCreate` | name | 创建笔记本 |
| `doc_create` | `DocCreate` | notebook, path, markdown? | 创建文档 |
| `block_append` | `BlockAppend` | parentID, data, dataType? | 追加块 |
| `block_prepend` | `BlockPrepend` | parentID, data, dataType? | 前置块 |
| `block_insert` | `BlockInsert` | data, dataType?, parentID?, previousID?, nextID? | 插入块 |
| `block_attrs_set` | `BlockAttrsSet` | id, attrs | 设置块属性 |
| `block_update` | `BlockUpdate` | id, data, dataType?, confirm?, dryRun?, expectedHash? | 改写块（破坏型） |
| `block_delete` | `BlockDelete` | id, confirm?, dryRun?, expectedHash? | 删除块（破坏型） |
| `block_move` | `BlockMove` | id, confirm?, parentID?, previousID?, dryRun? | 移动块（破坏型） |
| `doc_rename` | `DocRename` | id, title, confirm?, dryRun? | 重命名文档（破坏型） |
| `doc_move` | `DocMove` | fromIDs, toID, confirm?, dryRun? | 移动文档（破坏型） |
| `doc_remove` | `DocRemove` | id, confirm?, dryRun? | 删除文档（破坏型） |
<!-- END GENERATED -->
