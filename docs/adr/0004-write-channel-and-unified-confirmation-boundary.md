# ADR-0004：写通道与统一确认安全边界

- 状态：Accepted
- 日期：2026-10-11
- 决策者：项目维护者
- 关联：`docs/README.md`（项目说明，实施阶段创建）
- 取代：`docs/adr/0002-read-only-boundary-and-client-side-sql-guard.md`（仅取代其"一期只读"结论；其客户端 SQL 守卫与 `truncated` 保真两条继续有效）

## 背景

ADR-0002 把一期定为只读。实施开始后主人指出真实需求包含"往具体笔记里写内容"，只读版本对实际使用价值有限，因此本期需要把写操作纳入，并重新定义安全边界。

写操作的风险与只读完全不同：它会覆盖或删除主人真实的笔记内容。设计前已核实以下权威事实（来源为本机 `VCPSiyuan/examples/siyuan/` 的内核源码与官方 API 文档，以及本机内核的只读探测）：

1. 内核所有写路由都挂 `CheckAuth, CheckAdminRole, CheckReadonly`；`CheckReadonly` 在 `util.ReadOnly` 或只读角色 Token 下拒绝写入（`kernel/api/router.go`、`kernel/model/session.go:198-208`）。
2. 删文档并非直接抹除：`RemoveDoc` → `removeDoc()` 先用 `getHistoryDir(HistoryOpDelete)` 把文档文件复制到 history 目录再删除（`kernel/model/file.go:2027,2095-2113`）。
3. `createDocWithMd` 对同一 `path` 重复调用不会覆盖已有文档（天然幂等）。
4. `insertBlock` 的 `nextID`/`previousID`/`parentID` 至少一个有值，优先级 `nextID > previousID > parentID`。
5. `updateBlock` 是整体覆盖语义，带 `lockType`（解析后块类型与原类型不同是否拒绝，默认 `false`）。
6. 所有写操作返回 `doOperations` / `undoOperations`。
7. `setBlockAttrs` 的自定义属性必须以 `custom-` 前缀。
8. `blocks` 表有 `hash`（短哈希，如 `adbd55e`）与 `updated`（如 `20261010165512`），可用于乐观并发校验（本机只读 `PRAGMA` 实测）。
9. VCP 的 `requiresAdmin` 是**插件级**开关（`VCPToolBox/Plugin.js:1545-1552`），无法只对写工具细分授权；VCP stdio 插件是一次性进程，也没有交互确认能力。

## 决策

1. 一期开放 **26 条写工具**（加上只读 19 条 = 总工具数 **45**，与参考实现端点数量完全一致），按两个风险级分组：
   - **增量型（12 条，不要求 `confirm`）**：`notebook_create`、`notebook_open`、`notebook_close`、`doc_create`、`daily_note_create`、`block_append`、`block_prepend`、`block_insert`、`block_fold`、`block_unfold`、`block_attrs_set`、`export_resources`；
   - **破坏型（14 条，必填 `confirm`）**：`block_update`、`block_delete`、`block_move`、`doc_rename`、`doc_move`、`doc_remove`、`doc_rename_by_path`、`doc_remove_by_path`、`doc_move_by_path`、`notebook_rename`、`notebook_icon_set`、`notebook_conf_set`、`notebook_remove`、`find_replace`。

   分类口径：**破坏型 = 覆盖或删除既有内容**。因此即使只是改笔记本名称/图标/配置，也归为破坏型（“绘不静默覆盖”比“少一次确认”重要）。
2. 破坏型工具**必填 `confirm: boolean`**；缺失或为 `false` 时，工具**返回预览并以 `SIYUAN_CONFIRM_REQUIRED` 拒绝执行**。预览包含：目标是否存在（存在则给标题/hpath）、当前内容摘要（kramdown 前 200 字）、子块数量与影响范围。
3. 破坏型工具支持可选 `dryRun: boolean`；为 `true` 时只预览、不写内核。
4. `block_update` **固定发送 `lockType: true`**（不提供关闭入口：块类型被意外改变的风险高于收益）；`block_update` 与 `block_delete` 支持可选 `expectedHash`，与当前 `blocks.hash` 不一致时以 `SIYUAN_STALE_TARGET` 拒绝并返回当前 hash 与内容摘要。
5. **三通道统一只用 `confirm` 参数**作为确认机制，不引入通道差异化确认（Pi 侧 UI 二次确认、CLI `--yes` 等一律不做）。依据是 VCP 无交互能力且 `requiresAdmin` 只能插件级（背景第 9 条），差异化会让同一真源在三条通道语义分叉。
6. **SQL 继续只读**：ADR-0002 的客户端守卫（单条 `SELECT`/`WITH`）继续适用，不提供任何 SQL 写开关。理由：内核不限制语句语义，任意 SQL 写没有确认机制、没有 `doOperations` 级别的可核对性，也没有回滚语义。
7. 写工具把内核返回的 `doOperations` 作为"实际发生了什么"的证据回传，并提示是否带回 `undoOperations`。
8. 一期即对齐参考实现 `CLI-Anything/siyuan` 的**全部 45 个端点**，不再保留排除清单。唯一例外：`asset upload`（多模态/二进制上传）——参考实现的代码并未实现它（仅出现在其逆向分析文档中），且超出文本读写范围。
9. 记录但不依赖内核侧的第二道保险：主人可用只读模式启动内核或使用只读角色 Token，此时写入由内核拒绝。
10. **R9（最高风险操作的双确认）**：`notebook_remove` 除 `confirm: true` 外，还必须传 `confirmName`，其值须与笔记本当前名称**逐字一致**（容忍首尾空白，不做模糊匹配）；不一致时以 `SIYUAN_CONFIRM_MISMATCH` 拒绝并回报实际名称。预览必须给出名称与文档数，让调用方知道将毁掉什么。
11. **R10（批量替换必须限定 `ids`）**：`find_replace` 的 `ids` 经去空白、去重后必须非空（数组 / JSON 数组 / 逗号分隔皆可），从工具层杜绝「全库替换」；`k` 与 `r` 都必须非空（不提供删除式替换，避免误删文本）。

## 候选方案

- **维持只读一期**：主人已明确否决，真实需求包含写入具体笔记；
- **开放 SQL 写通道（`SIYUAN_ALLOW_SQL_WRITE`）**：被拒绝。内核不做语句语义校验，任意写 SQL 无法给出一致的预览、`expectedHash` 校验与 `doOperations` 证据，且缺少目标存在性与影响范围描述；typed 写工具才是可控通道；
- **破坏型默认 `dryRun: true`**：被拒绝。会让正常写入变成两次调用，且 Agent 容易把"预览成功"误读成"已执行"；改为"缺 `confirm` 即返回预览"，同样达到"先看后做"的效果但语义无歧义；
- **按工具粒度要求 VCP 管理员权限**：不可行，VCP `requiresAdmin` 是插件级（背景第 9 条）；
- **Pi 侧额外做 UI 确认**：推迟到二期作为"额外一层"，避免一期三通道语义分叉。

## 后果

正面：写操作有统一、可被 Agent 理解的确认语义（缺 `confirm` 即得预览）；覆盖类操作有 `lockType` 与 `expectedHash` 两层并发保护；删除类操作依赖内核已有的数据历史，具备回滚可能；`doOperations` 让每次写入可核对。

负面：工具面涨到 45（19 只读 + 26 写），破坏半径与提示词成本都上升（后者由 `{{VCPDynamicTools}}` 与 skill 的按需加载缓解）；`confirm` 是**软约束**——Agent 只要传 `confirm: true` 就会执行，因此真正的防线是"预览先出现 + skill 文档要求先读后写 + 主人可用只读 Token 硬性只读"；写路径必须实机验证（沙盒笔记本）才可声称可用。

风险：写操作误伤真实笔记。缓解为 `confirm` 强制 + 预览 + `lockType` + `expectedHash` + 删除可回滚 + 验证仅限沙盒 + 可切换只读 Token。

## 验证与退出条件

- 单元层：破坏型工具缺 `confirm` 时返回 `SIYUAN_CONFIRM_REQUIRED` 与预览，且**断言零写调用**；`dryRun: true` 同样不写；`expectedHash` 不匹配返回 `SIYUAN_STALE_TARGET`；`block_attrs_set` 拒绝非 `custom-` 前缀；`block_update` 固定发送 `lockType: true`；`notebook_remove` 的 `confirmName` 不匹配时返回 `SIYUAN_CONFIRM_MISMATCH` 且零写调用；`find_replace` 的 `ids` 为空时拒绝且零写调用。
- 实机层：在沙盒笔记本跑完整写链（建笔记 → 追加 → 覆盖 → 删除块 → 删文档），核对 `doOperations` 形状与 `removeDoc` 的数据历史行为。该验证属写操作，需主人单独授权，且默认开关（如 `SIYUAN_E2E_WRITE=1`）永不默认开启。

若未来需要开放本 ADR 排除的写能力（特别是 `notebook_remove`、`find_replace`、SQL 写），必须以新 ADR 定义其确认与回滚边界，并 supersede 本 ADR 的相应结论。

---

- 修订：2026-10-11 经项目维护者批准，将 `lockType` 措辞由“默认 `true`”改为“**固定为 `true`（不提供关闭入口）**”以对齐已实现行为；决策结论未变。
- 修订：2026-10-11 经项目维护者要求「完全对齐参考实现」，补齐原第 8 条排除清单的全部端点（工具数 32 → 45），并新增 R9（`notebook_remove` 的 `confirmName` 双确认）与 R10（`find_replace` 必须限定 `ids`）；分类口径明确为“破坏型 = 覆盖或删除既有内容”。
