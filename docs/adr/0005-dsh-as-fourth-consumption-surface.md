# ADR-0005：DSH 作为第四消费面——技能 provider + CLI，零安装脚本可 GitHub 安装

- 状态：Accepted
- 日期：2026-10-11
- 决策者：项目维护者
- 关联：`README.md`（项目说明）、`skills/siyuan/SKILL.md`（Pi/DSH 共用的一份技能）、`dsh/`（本决策的产物，实施阶段创建）、`D:\VCPHub\pi-devflow`（同类双宿主包的可比先例）

## 背景

本项目把思源的读写能力做成「一份真源、三通道」（ADR-0001：Pi 扩展 / VCP 插件 / CLI）。主人日常还有一个消费面：**DSH（DeepSeek Harness）Web GUI**——2026-10-11 实测该 GUI 会话跑在 `desktop` profile（`DSH_PROFILE=desktop`）。

DSH 的三条扩展路径（2026-10-11 从 `app.asar` 抠出确切契约）：

1. **技能**：来自 provider 注册表（插件 `inject: ['skills']` + `ctx.skills.registerProvider`），或 `<DSH_HOME>/skills/<name>/SKILL.md` 的文件扫描（只扫一层；rank：项目 `.dsh/skills`=100 < `.agents/skills`=200 < custom=300 < `~/.dsh/skills`=400 < `~/.agents/skills`=500 < bundled=600）；
2. **原生工具**：Cordis 插件 `export const inject = ['tools']` + `ctx.tools.register({ name, description, parameters, output, execute })`；
3. **MCP**：配置型 bundle 插入 `@deepseek-ai/dsh-mcp-client`（`transport: stdio` / `streamable-http`），工具以 `mcp__<serverName>__<tool>` 呈现。

同类先例 pi-devflow 走的是「postinstall + `apply()` 时把技能**拷贝**到 `<DSH_HOME>/skills`」。实测代价明确：pnpm 会拦构建脚本，需要在 profile 的 `pnpm-workspace.yaml` 里按**绑定 commit 的 tarball key** 放行（本机 `web` profile 里就躺着 `pi-devflow@https://codeload.github.com/xuzhen97/pi-devflow/tar.gz/363c8fe4...: true`），上游一有新提交 key 即失效，换机器要重放。

而官方 `cordis-plugin-development/references/host-plugin.md` 写明：**纯 Host bundle 不需要依赖、安装脚本或构建工具**。

## 决策

1. **DSH 作为第四消费面，形态为「技能 + CLI」**：技能负责「何时用、怎么用」，具体调用走已有的 CLI（`node <包内 dist/cli.cjs> <命令> --json`）。**不新增工具定义**，工具真源仍是 `src/tools/definitions.ts`（ADR-0001 不变）。
2. **交付物是可分发的 DSH bundle**：包根 `dsh/cordis.patch.yml` 插入一行（`id: siyuan-agent-skills`、`name: siyuan-agent/dsh`）；`package.json` 声明 `dsh.bundle.patch`、`exports` 暴露 `./dsh`、`files` 包含 `dsh/`。安装方式是 `dsh plugin --profile <p> add github:xuzhen97/siyuan-agent`（或插件页的 `install_bundle`）。
3. **插件是零依赖 ESM**（`dsh/index.mjs`）：`export const name` / `export const inject = ['skills']` / `apply(ctx)` 内用 `ctx.skills.registerProvider` 注册 `siyuan` 技能；candidate 的 `resourceBase` 指向包内 `skills/siyuan/`；`get()` **每次重读** SKILL.md，并在正文后追加**运行时块**（CLI 的绝对路径，按安装位置计算）。
4. **不拷贝技能到 `<DSH_HOME>/skills`**、**不引入** `postinstall`/`prepare` 等安装脚本、**不依赖**任何 `@deepseek-ai/*`（profile 解析不到 asar 内的包；`rank` 常量 600 内联）。
5. `skills/siyuan/SKILL.md` 只补一节通用说明（同一份文件既供 Pi 直接读取、也供 DSH 通过 CLI 调用），**不写死路径**——Pi 侧 `pi.skills: ["./skills"]` 行为不变。

## 候选方案

- **pi-devflow 式 postinstall 拷贝**：技能对**所有** profile 可见（DSH_HOME 级），但要在每个新环境重放 commit 绑定的 `allowBuilds` key，并自行处理写入 DSH_HOME 的 manifest 记账与同名冲突。为一份技能承担这种长期维护成本与安装失败面，不划算。
- **MCP server + `@deepseek-ai/dsh-mcp-client` 配置行**：能拿到 45 条**结构化**工具（参数 JSON Schema，强于 VCP 的散文式描述），且能被其它宿主复用；但要新增一个通道与构建制品，相对「先让 DSH 会用思源」的目标属超额投入。若日后要结构化工具，应另立 ADR **新增**该通道，不构成对本决策的推翻。
- **Cordis 原生注册 45 条工具**：最原生、可拿到 `ctx`（日志/配置/权限联动），但要把 45 条 `ToolSpec` 适配成 DSH 的 `ToolDefinition`（含 `output.schema` 与 `render`）并跟随 DSH 版本演进，维护面最大。
- **不做适配**：DSH 里要手工 clone 仓库、自己拼 CLI 路径，且没有技能提示「何时该用」，等于把负担推给每次会话。

## 后果

正面：

- 任何新环境一条命令装完；**不需要 `allowBuilds`**、不写 DSH_HOME；`remove` 会立刻清掉 `dependencies` 与 `dsh.profile.bundles` 里的记录、技能当场从会话目录消失（实测；仅 `node_modules` 里的 Junction 会残留，无功能影响）。
- `skills/siyuan/SKILL.md` 仍是 Pi 与 DSH **共用的一份**，命令表由真源生成（ADR-0001 的生成物），不会出现「两个宿主各自维护一份技能」。
- 改 SKILL.md 即时生效（provider 每次 `get()` 重读文件），无需重启。

负面与约束：

- **provider 注册是 profile 级**：技能只在装了该 bundle 的 profile 可见；`web` profile 想用需再 `add` 一次。
- git spec **绑定 commit**：后续更新要重新 `add` 才会解析到新提交。
- 改 `dsh/index.mjs` 需**重启**才加载新的模块代际（改 SKILL.md 不必）。
- 命令依赖 PATH 上的 `node`：Electron 打包态 `process.execPath` 不是真正的 node，故运行时块只给脚本路径、不写解释器路径。
- 插件**不得 import 任何 `@deepseek-ai/*`**（asar 内，profile 解析不到），需要常量就内联、需要可调项就自校验。
- 本决策**不提供结构化工具**：DSH 侧仍是「模型拼命令行」，参数校验与调用延迟不如原生工具；这是有意的最小起步，不是遗漏。

## 验证与退出条件

验证（2026-10-11 已在 `desktop` profile 实测）：

- `dsh plugin --profile desktop add <本地绝对目录>` 成功（exit 0），**并自动**把包名写进 `dsh.profile.bundles`；本地目录是 **Junction 链接**（改仓库即生效，但改 `dsh/index.mjs` 仍需重启）。
- **技能当场出现在运行中的会话技能目录里**——这是本决策最关键的验收证据：该技能不在任何文件型技能根中（`~/.dsh/skills` 与项目 `.dsh/skills` 都没有它），故只能是 provider 注册生效。
- `node <profile>/node_modules/siyuan-agent/dist/cli.cjs version --json` → `{"version":"3.8.6"}`（只读调用，未触碰任何笔记数据）。
- `remove` 后**立即**：`dependencies` 与该 `bundles` 行均恢复干净，且技能从会话技能目录消失（实测收到目录变更）。两处**残留/时延**需知悉：① `node_modules/siyuan-agent` 这个 Junction 未被 pnpm 删除（不影响加载，因为 bundles 行已移除）；② 重新 `add` 后技能会重新出现，但**非瞬时**（本次实测需等一次技能目录失效，数十秒内完成；无需重启）。
- 未能按原计划验证：`dsh --profile desktop --dump-config` 在本机失败——**PATH 上的 `dsh`（npm 全局）与 GUI 是两个不同的 DSH 安装**，前者不带 `@deepseek-ai/dsh-experimental-schedule-bundle`，而该行在本决策之前就已在 `bundles` 里。故层叠树的核对改用「运行时会话技能目录出现 `siyuan`」替代。
- 远端安装路径（`github:xuzhen97/siyuan-agent`）待推送后补验，并确认没有触发 `ERR_PNPM_IGNORED_BUILDS`（本包无安装脚本，预期不会）。

退出条件（出现其一即另立 ADR supersede 本决策）：

- DSH 官方把技能统一收敛到 MCP，或强制 bundle 只能走 `plugin_manager` 且不再支持纯 Host bundle；
- 主人需要结构化工具、或需要把破坏型 `confirm` 接到 DSH 的审批流（届时走 MCP 或原生工具注册路线）；
- provider 注册被证明无法在目标 DSH 版本上稳定工作（例如 skill 契约字段变更）。
