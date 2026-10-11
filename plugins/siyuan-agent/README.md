# SiYuanAgent — 思源笔记读写桥（VCP 插件）

通过思源（SiYuan）内核 HTTP API 读写知识库的 VCP 插件（synchronous / stdio，**零 npm 依赖**）。

- 产物：`plugin-manifest.json` + `index.cjs`（esbuild 单文件，除 `node:` 内置外无 external）
- 工具数：**32** 条（只读 19 + 写 13）
- 来源真源：仓库 `src/tools/definitions.ts`；`plugin-manifest.json` 由 `pnpm generate` 生成，**不要手改**

## 安装方式

### 方式一：插件商店 registry 源（推荐）

把本仓库的 `plugins.json` 作为 registry 源加入 VCPToolBox 的 `pluginStoreSources.json`：

```json
{
  "id": "src_siyuan_agent",
  "name": "siyuan-agent",
  "url": "https://raw.githubusercontent.com/xuzhen97/siyuan-agent/main/plugins.json",
  "type": "registry",
  "builtin": false
}
```

之后在 AdminPanel 的插件中心即可看到「思源笔记读写桥」并一键安装/更新。

### 方式二：插件中心直接按 GitHub 仓库安装

在插件中心填入仓库地址（`pluginStore.js` 支持仓库 + subpath）：

```text
https://github.com/xuzhen97/siyuan-agent
subpath: plugins/siyuan-agent
```

## 配置

在插件中心填写（对应 `configSchema`），或参照 `config.env.example`：

| 键 | 说明 | 默认 |
|---|---|---|
| `SIYUAN_HOST` | 思源内核地址 | `127.0.0.1` |
| `SIYUAN_PORT` | 内核 API 端口 | `6806` |
| `SIYUAN_TOKEN` | 思源 API Token（设置 → 关于） | 空 |
| `SIYUAN_TIMEOUT_MS` | 请求超时（毫秒） | `30000` |

> VCP 运行时会按同名把这些键注入插件进程的环境变量，因此与 CLI / Pi 通道共用同一套配置解析。

**不要提交 `config.env`**（含 Token）。

## 工具与安全边界

- **只读（19 条）**：笔记本/笔记本配置/文档树/块/检索/标签/`sql`（仅单条 `SELECT`/`WITH`）/`version`/`status`。
- **增量型写（7 条）**：`notebook_create`、`doc_create`、`daily_note_create`、`block_append`、`block_prepend`、`block_insert`、`block_attrs_set`（属性名必须 `custom-` 前缀）。
- **破坏型写（6 条）**：`block_update`、`block_delete`、`block_move`、`doc_rename`、`doc_move`、`doc_remove`。
  - **必须显式传 `confirm: true`**；不传（或传 `false`）时只返回**预览**并拒绝执行，错误码 `SIYUAN_CONFIRM_REQUIRED`。
  - 可选 `dryRun: true` 只预览不写；`block_update`/`block_delete` 支持 `expectedHash` 做乐观并发校验（不匹配报 `SIYUAN_STALE_TARGET`）。
  - `doc_remove` 会先在内核侧写入数据历史，可在思源「数据历史」回滚（受历史保留设置限制）。
- **SQL 永远只读**：变更类语句与多语句一律拦为 `SIYUAN_READONLY_BLOCKED`；要改内容请用写工具。
- 想让整个插件**硬性只读**：用只读角色 Token，或以只读模式启动思源内核（内核写路由挂 `CheckReadonly`，会直接拒绝写入）。

## 本地构建

```bash
pnpm build:vcp        # 重新生成 index.cjs
pnpm generate         # 重新生成 plugin-manifest.json（改真源后必须跑）
pnpm generate:check   # 校验生成物是否与真源一致（CI 门）
```
