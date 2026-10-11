# ADR-0003：零运行时依赖、Node ≥20 与制品提交进仓库

- 状态：Accepted
- 日期：2026-10-11
- 决策者：项目维护者
- 关联：`README.md`（项目说明）、`D:\VCPHub\VCPDeck`（插件制品与打包惯例）

## 背景

三条消费通道都要求"装上即可用"，且安装过程尽量不引入失败点与供应链面：

- **VCP 插件商店**：安装路径会对带 `package.json` 的插件自动执行 `npm install --omit=dev`，并流式回传安装日志（`VCPToolBox/routes/admin/pluginStore.js`）；registry 源与 GitHub subpath 安装都直接从仓库取用制品。
- **Pi 包**：经 npm 或 git 分发扩展与 skill。
- **CLI**：需要在主人与用户的机器上直接可执行。

此外，本仓库一期体量是一个包：core 库 + 三个薄通道 + 生成器，不存在多个独立运行时需要分别发布。

## 决策

1. **运行时零依赖**：只用原生 `fetch` 与 `node:` 内置模块。
2. **Node ≥ 20**：原生 `fetch`、ESM 与 `--check` 生态的前提。
3. TypeScript strict + ESM。
4. 用 esbuild 产出两类制品：VCP 插件 `plugins/siyuan-agent/index.cjs`（`format=cjs`、`bundle`、`platform=node`、除 `node:*` 外零 external）与 CLI `dist/cli.cjs`。
5. **两类制品随源码提交进仓库**，对齐 `VCPDeck/plugins/vcpdeck/` 的既有惯例，使 registry 源与 GitHub subpath 安装可直接取用，无需构建步骤。
6. 本仓库**不建 pnpm workspace**。

## 候选方案

- **引入 axios / commander / zod 等成熟依赖**：开发更省力，但违背零依赖目标，扩大安装面与供应链面，且 VCP 商店安装阶段会多出依赖解析与失败可能；
- **只发布源码、由使用方自行构建**：插件商店的 registry 与 GitHub 安装拿不到可直接运行的入口，破坏"装上即可用"；
- **建 workspace 多包（core / pi / vcp / cli）**：本仓库只有一个包，拆包会引入跨包版本与链接复杂度；VCPDeck 拆包是因为它确实存在 8 个独立运行时包。

## 后果

正面：安装零 npm 依赖、零供应链面；VCP 商店安装与 pi 包安装都不再有依赖安装失败点；制品与源码同仓，安装路径与调试路径一致。

负面：HTTP 客户端、CLI 解析、参数校验都需自写薄封装，不能引入第三方；能力上限受 `node:` 内置能力约束；制品必须与源码同步提交，并受生成物漂移门与打包脚本约束。

## 验证与退出条件

验证方式：在不执行任何 `npm install` 的前提下，`plugins/siyuan-agent/` 可被 VCP 内核直接调用；pi 包安装后扩展与 skill 可正常加载。

若未来某项能力必须依赖第三方库（例如必须处理自签证书链或需要复杂 schema 校验），应以新 ADR 评估是否**局部**放宽零依赖原则并说明边界，而不是默认引入依赖。
