/**
 * siyuan-agent 的 DSH（DeepSeek Harness）侧适配层 —— ADR-0005。
 *
 * 只做一件事：把包内的 `skills/siyuan/SKILL.md` 注册成 DSH 技能，并在正文后追加
 * 一段**运行时块**，告诉模型本机上 CLI 制品的确切绝对路径（照 `@deepseek-ai/dsh-skill-office`
 * 注入 "Installed LibreOffice Kit" 的同一手法）。
 *
 * 铁律（ADR-0005）：
 * - 零依赖：**不得** import 任何 `@deepseek-ai/*`（它们在 app.asar 内，profile 的 node_modules
 *   解析不到，import 即激活失败）。rank 常量内联。
 * - 零安装脚本：本包没有 postinstall/prepare，因此 `dsh plugin add` 不会触发 pnpm 的
 *   allowBuilds 拦截，也不需要任何 commit 绑定的放行 key。
 * - 不拷贝技能到 <DSH_HOME>/skills：技能目录始终指回包内，避免写用户目录与同名冲突记账。
 */
import { readFileSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** 内联常量：`@deepseek-ai/dsh-skill` 的 BUNDLED_SKILL_RANK。 */
const BUNDLED_SKILL_RANK = 600;
const PROVIDER_NAME = "siyuan-agent";
const SKILL_NAME = "siyuan";

const packageRoot = fileURLToPath(new URL("../", import.meta.url));
const skillDir = join(packageRoot, "skills", SKILL_NAME);
const skillPath = join(skillDir, "SKILL.md");
const defaultCliPath = join(packageRoot, "dist", "cli.cjs");

/** YAML frontmatter 只取 `description`：不引入 YAML 解析器（零依赖）。 */
const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u;

/**
 * 拆出 frontmatter 与正文。
 * @param raw - SKILL.md 全文
 * @param path - 用于报错定位
 */
function parseSkill(raw, path) {
  const match = FRONTMATTER.exec(raw);
  if (match?.[1] === undefined) throw new Error(`siyuan-agent: ${path} 缺少 YAML frontmatter`);
  const line = /^description:[ \t]*(.*)$/mu.exec(match[1]);
  const description = (line?.[1] ?? "").trim().replace(/^["'](.*)["']$/u, "$1");
  if (description.length === 0) throw new Error(`siyuan-agent: ${path} 的 frontmatter 缺少 description`);
  return { description, body: raw.slice(match[0].length).trim() };
}

/** 追加给模型的运行时信息块：CLI 绝对路径按安装位置计算，因此装到哪台机器都对。 */
function runtimeBlock(nodeExe, cliPath) {
  return [
    "",
    "",
    "## 已安装的 siyuan-agent CLI（DSH 侧）",
    "",
    "本机已装好 siyuan-agent 的 CLI 制品。**在 DSH 里请用下面这组绝对路径调用**（不要假定 `siyuan-agent` 在 PATH 上）：",
    "",
    "```json",
    JSON.stringify({ siyuanAgent: { node: nodeExe, cli: cliPath, packageDir: packageRoot } }, undefined, 2),
    "```",
    "",
    `- 只读查询：\`${nodeExe} "${cliPath}" notebook list --json\``,
    `- 全部命令：\`${nodeExe} "${cliPath}" --help\``,
    "- 写操作纪律与上文一致：破坏型必须带 `--confirm`，增量型可直接调用；SQL 仅单条 `SELECT`/`WITH`。",
  ].join("\n");
}

export const name = "siyuan-agent-skills";
export const inject = ["skills"];

/**
 * 注册技能 provider。
 * @param ctx - 携带 skills 注册表的 Cordis 上下文
 * @param config - 可选覆盖：`{ node?: string, cli?: string }`（打包态或非 PATH 环境用得上）
 */
export function apply(ctx, config = {}) {
  const nodeExe = typeof config.node === "string" && config.node.length > 0 ? config.node : "node";
  const cliPath = typeof config.cli === "string" && config.cli.length > 0 ? config.cli : defaultCliPath;

  // 激活即校验：路径不对要当场炸给主人看，而不是等模型调用时才失败。
  if (!statSync(skillPath).isFile()) throw new Error(`siyuan-agent: 技能文件缺失：${skillPath}`);
  if (!statSync(cliPath).isFile()) {
    throw new Error(
      `siyuan-agent: CLI 制品缺失：${cliPath}（本仓库需先跑 pnpm build:cli，且 package.json 的 files 必须包含 dist/）`,
    );
  }

  const provider = {
    name: PROVIDER_NAME,
    list() {
      // 每次 list 重读：改 SKILL.md 的 description 无需重启。
      const { description } = parseSkill(readFileSync(skillPath, "utf8"), skillPath);
      return Promise.resolve([
        {
          name: SKILL_NAME,
          description,
          invocation: { modelInvocable: true, userInvocable: true },
          provider: PROVIDER_NAME,
          source: PROVIDER_NAME,
          rank: BUNDLED_SKILL_RANK,
          resourceBase: { kind: "directory", path: skillDir },
          locator: skillPath,
        },
      ]);
    },
    async get(candidate, options) {
      const { rank: _rank, locator, ...summary } = candidate;
      const raw = await readFile(locator, { encoding: "utf8", signal: options?.signal });
      return { ...summary, content: `${parseSkill(raw, locator).body}${runtimeBlock(nodeExe, cliPath)}` };
    },
  };

  ctx.skills.registerProvider(() => provider);
}
