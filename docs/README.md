# siyuan-agent

把思源（SiYuan）笔记知识库接入 Agent 与终端的基础项目：**一份工具定义真源，三条消费通道**。

- **45 条工具**（只读 19 + 写 26），覆盖笔记本（含配置读取）、文档树、块 kramdown、全文检索、标签、SQL 查询、Markdown 导出、日记，以及写入/修改/删除笔记与块。
- **零运行时依赖**：只用 Node 内置能力（原生 `fetch`、`node:` 模块）。
- **三条通道共用同一份真源**：`src/tools/definitions.ts` → Pi 工具 / VCP 命令 / CLI 子命令（详见 [ADR-0001](./adr/0001-single-tool-definition-source-and-channel-generation.md)）。

## 安装与使用

### 1. 作为 pi 包（Pi Coding Agent 扩展 + skill）

```bash
# 在本仓库目录下即可被 pi 发现：package.json 的 pi.extensions / pi.skills
# 或在其它项目里通过 npm/git 安装本包
```

安装后在 Pi 中 `/reload`，可用：

- 30 个工具，名称形如 `siyuan_notebook_list`、`siyuan_block_append`；
- skill `/skill:siyuan`（含命令表与写操作纪律）。

### 2. 作为 VCP 插件（VCPToolBox）

两种安装方式（详见 [`plugins/siyuan-agent/README.md`](../plugins/siyuan-agent/README.md)）：

1. **插件商店 registry 源**：把本仓库 `plugins.json` 的地址加入 `pluginStoreSources.json`。**用 ghproxy 前缀**（已实测：直连 `raw.githubusercontent.com` 在本机网络不通，加前缀返回 200，且与 VCPDeck / VCPPlugins 的 `downloadUrl` 惯例一致）：

   ```text
   https://ghproxy.net/https://raw.githubusercontent.com/xuzhen97/siyuan-agent/main/plugins.json
   ```
2. **插件中心按 GitHub 仓库安装**：仓库 `xuzhen97/siyuan-agent` + subpath `plugins/siyuan-agent`。

插件为 synchronous / stdio，制品 `plugins/siyuan-agent/index.cjs` 为零依赖单文件。

### 3. 作为 CLI

```bash
pnpm install
pnpm build:cli

node dist/cli.cjs version
node dist/cli.cjs notebook list --json
node dist/cli.cjs doc tree <笔记本ID> --depth 2
node dist/cli.cjs sql "SELECT id, hpath FROM blocks WHERE type = 'd' LIMIT 20"
node dist/cli.cjs block delete <块ID>          # 破坏型：不给 confirm 只返回预览
node dist/cli.cjs block delete <块ID> --confirm # 确认后执行
```

`node dist/cli.cjs --help`（或任意未知命令）会打印全部 45 条命令路径。

**从 stdin 读取内容**（对齐参考实现：参数写 `-` 即从标准输入读）：

```bash
cat note.md | node dist/cli.cjs doc create <笔记本ID> /从管道创建 --markdown -
echo "追加内容" | node dist/cli.cjs block insert <文档ID> -          # data 为 - 或省略时读 stdin
cat 新内容.md | node dist/cli.cjs block update <块ID> - --confirm
```

**交互式 REPL**（对齐参考实现的 `repl`）：不带参数运行，或 `node dist/cli.cjs repl`（需 TTY；管道/CI 下会改为打印用法）。

```text
$ node dist/cli.cjs
思源笔记 siyuan-agent v0.1.0 · 内核 127.0.0.1:6806
输入 help 查看命令，quit 退出。写操作仍需 confirm。
siyuan > notebook list
siyuan > doc create <笔记本ID> /新文档 --markdown "# 内容"
siyuan > sql SELECT id, hpath FROM blocks WHERE type = 'd' LIMIT 20
siyuan > status
siyuan > quit
```

REPL 支持全部 CLI 子命令（含 `--json` 与 `--confirm`），并把会话上下文（当前笔记本/当前文档）与命令历史持久化到 `~/.siyuan-agent/session.json`（历史保留最近 200 条）。**写操作在 REPL 里同样必须先 `confirm`**，不受交互模式影响。

## 配置

优先级：**显式参数（CLI 选项）> 环境变量 > 配置文件 > 默认值**。

| 键 | 环境变量 | 默认 | 说明 |
|---|---|---|---|
| host | `SIYUAN_HOST` | `127.0.0.1` | 思源内核地址 |
| port | `SIYUAN_PORT` | `6806` | 内核 API 端口 |
| token | `SIYUAN_TOKEN` | 空 | 思源 → 设置 → 关于 中查看 |
| timeoutMs | `SIYUAN_TIMEOUT_MS` | `30000` | 请求超时 |

配置文件：`~/.siyuan-agent/config.json`（`{ "host": "...", "port": 6806, "token": "..." }`）。

连接为**直连**指定 host/port，不读取代理环境变量。VCP 通道通过 `configSchema` 声明同名键，由 VCP 运行时注入为环境变量，因此三通道共用同一套解析逻辑。

## 安全边界（写操作必读）

见 [ADR-0004：写通道与统一确认安全边界](./adr/0004-write-channel-and-unified-confirmation-boundary.md)。

- **增量型写工具**（`notebook_create` / `notebook_open` / `notebook_close` / `doc_create` / `daily_note_create` / `block_append` / `block_prepend` / `block_insert` / `block_fold` / `block_unfold` / `block_attrs_set` / `export_resources`）可直接调用。
- **破坏型写工具**（`block_update` / `block_delete` / `block_move` / `doc_rename` / `doc_move` / `doc_remove` / `doc_rename_by_path` / `doc_remove_by_path` / `doc_move_by_path` / `notebook_rename` / `notebook_icon_set` / `notebook_conf_set` / `notebook_remove` / `find_replace`）**必须显式传 `confirm: true`**；不传时只返回**预览**并拒绝执行（`SIYUAN_CONFIRM_REQUIRED`）。其中 `notebook_remove`（删整库）还须传 `confirmName` 且与笔记本当前名称逐字一致（`SIYUAN_CONFIRM_MISMATCH`）；`find_replace` 的 `ids` 不允许为空（禁止全库替换）。
- 可选 `dryRun: true` 只预览不写；`block_update` / `block_delete` 支持 `expectedHash` 做乐观并发校验（不匹配报 `SIYUAN_STALE_TARGET`）；`block_update` 默认 `lockType: true`（块类型变化即拒绝）。
- **SQL 永远只读**：仅单条 `SELECT` / `WITH`，其余一律拦为 `SIYUAN_READONLY_BLOCKED`。
- 删文档会在内核侧先写入数据历史（可在思源「数据历史」回滚，受历史保留设置限制）。
- 想要硬性只读：使用只读角色 Token，或以只读模式启动内核（内核写路由挂 `CheckReadonly`）。

## 开发

```bash
pnpm install
pnpm typecheck        # tsc --noEmit
pnpm test             # 单元 + 通道 + 契约（真实内核相关用例默认按开关跳过）
pnpm generate         # 由真源重新生成 plugin-manifest.json 与 SKILL.md 命令表
pnpm generate:check   # 漂移门：生成物必须与真源一致
pnpm build:vcp        # 生成 plugins/siyuan-agent/index.cjs
pnpm build:cli        # 生成 dist/cli.cjs
```

真实内核相关的用例：

- 只读契约测试：`SIYUAN_E2E=1 pnpm test`
- 写路径实机验证：`SIYUAN_E2E_WRITE=1`（**需先单独授权**，会在真实知识库中创建沙盒笔记本）

临时材料（Spec / Plan / 探针）统一放在 `.tmp/`，已在 `.gitignore` 中。

## 目录

```text
src/core/          纯库：配置解析、HTTP 客户端、错误映射、文本渲染
src/tools/         工具真源（definitions.ts）、命名派生、SQL 守卫、写安全原语、分发
src/channels/      三通道：pi / vcp / cli
src/generators/    真源 → VCP manifest / skill 命令表
extensions/        pi 包入口
skills/siyuan/     skill 与 SQL 配方
plugins/siyuan-agent/  VCP 制品（plugin-manifest.json、index.cjs）
docs/adr/          架构决策记录
```

## 二期路线

`notebook_open` / `notebook_close`、多实例 profile、`notebook_remove` / `notebook_rename`、`find_replace`、资产上传、块 fold/unfold、Pi 侧 `tool_call` UI 二次确认。
