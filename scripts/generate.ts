import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { buildVcpManifestJson, insertGeneratedSkillTable } from "../src/generators/vcpManifest.ts";
import { TOOL_SPECS } from "../src/tools/definitions.ts";

const MANIFEST_PATH = "plugins/siyuan-agent/plugin-manifest.json";
const SKILL_PATH = "skills/siyuan/SKILL.md";

/**
 * 生成物的唯一入口（ADR-0001）。
 * 真源改了却没重跑生成 → `--check` 会失败，CI 因此能拦住漂移。
 */
const meta = {
  name: "SiYuanAgent",
  displayName: "思源笔记读写桥",
  version: "0.1.0",
  description:
    "读写思源（SiYuan）笔记知识库：笔记本、文档树、块内容、全文检索、SQL 查询、Markdown 导出，" +
    "以及写入/修改/删除笔记与块（破坏型操作强制 confirm 确认）。30 条工具，同步 stdio 架构，零 npm 依赖。",
  author: "xuzhen97",
};

const manifest = buildVcpManifestJson(TOOL_SPECS, meta);
const skill = insertGeneratedSkillTable(readFileSync(SKILL_PATH, "utf-8"), TOOL_SPECS);
const targets: Array<[string, string]> = [
  [MANIFEST_PATH, manifest],
  [SKILL_PATH, skill],
];

const check = process.argv.includes("--check");
let drift = 0;

for (const [path, content] of targets) {
  const current = existsSync(path) ? readFileSync(path, "utf-8") : undefined;
  if (current === content) continue;

  if (check) {
    drift += 1;
    console.error(`[drift] ${path} 与真源不一致（${current === undefined ? "文件缺失" : "内容不同"}）`);
  } else {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content, "utf-8");
    console.log(`[write] ${path}`);
  }
}

if (check && drift > 0) {
  console.error(`[drift] 共 ${drift} 个生成物与真源不一致，请运行 pnpm generate`);
  process.exit(1);
}
if (check) console.log("[ok] 生成物与真源一致");
