import type { ToolSpec } from "../tools/types.ts";
import { toVcpCommand } from "../tools/naming.ts";

export const GENERATED_BEGIN = "<!-- BEGIN GENERATED -->";
export const GENERATED_END = "<!-- END GENERATED -->";

export type VcpManifestMeta = {
  name: string;
  displayName: string;
  version: string;
  description: string;
  author: string;
};

/**
 * configSchema 的键名必须与 core 读取的环境变量完全一致：
 * VCP 运行时会把这些键按同名注入插件进程（Plugin.js::executePlugin），
 * 因此适配层不需要任何配置代码。
 */
const CONFIG_SCHEMA = {
  SIYUAN_HOST: { type: "string", description: "思源内核地址（默认 127.0.0.1）", default: "127.0.0.1" },
  SIYUAN_PORT: { type: "integer", description: "思源内核 API 端口（默认 6806）", default: 6806 },
  SIYUAN_TOKEN: {
    type: "string",
    description: "思源 API Token（思源 → 设置 → 关于 中查看；未开启鉴权可留空）",
    default: "",
  },
  SIYUAN_TIMEOUT_MS: { type: "integer", description: "请求超时（毫秒，默认 30000）", default: 30000 },
} as const;

const EXAMPLE_VALUES: Record<string, string> = {
  notebook: "20210817205410-2kvfpfn",
  path: "/笔记/甲",
  id: "20210817205410-2kvfpfn",
  stmt: "SELECT id, hpath FROM blocks WHERE type = 'd' LIMIT 20",
  query: "会议",
  k: "会议",
  maxChars: "2000",
  name: "我的新笔记本",
  data: "## 新内容",
  dataType: "markdown",
  parentID: "20210817205410-2kvfpfn",
  previousID: "20210817205410-2kvfpfn",
  nextID: "20210817205410-2kvfpfn",
  confirm: "true",
  dryRun: "true",
  expectedHash: "adbd55e",
  title: "新的文档标题",
  fromIDs: "20210917220056-yxtyl7i",
  toID: "20210817205410-2kvfpfn",
  attrs: '{"custom-status":"done"}',
  sort: "0",
  depth: "2",
};

const RISK_LABEL: Record<ToolSpec["risk"], string> = {
  read: "只读",
  additive: "增量型（只增不改）",
  destructive: "破坏型（必须传 confirm: true，不传只返回预览并拒绝执行）",
};

function exampleValue(paramName: string): string {
  return EXAMPLE_VALUES[paramName] ?? "值";
}

function renderExample(manifestName: string, command: string, spec: ToolSpec): string {
  const lines = [
    "<<<[TOOL_REQUEST]>>>",
    "maid:「始」Nova「末」,",
    `tool_name:「始」${manifestName}「末」,`,
    `command:「始」${command}「末」${Object.keys(spec.params)
      .map((param) => `,\n${param}:「始」${exampleValue(param)}「末」`)
      .join("")}`,
    "<<<[END_TOOL_REQUEST]>>>",
  ];
  return lines.join("\n");
}

function renderDescription(manifestName: string, spec: ToolSpec): string {
  const command = toVcpCommand(spec.name);
  const params = Object.entries(spec.params);
  const paramLines =
    params.length === 0
      ? ["参数: 无"]
      : [
          "参数:",
          ...params.map(([name, param]) => `- ${name}: (${param.required ? "必填" : "可选"}) ${param.description}`),
        ];

  return [
    `功能: ${spec.description}`,
    `风险: ${RISK_LABEL[spec.risk]}`,
    ...paramLines,
    `\`command\` 固定为 ${command}，不得填写 Shell 命令、路径或自然语言。`,
    "调用示例:",
    renderExample(manifestName, command, spec),
  ].join("\n");
}

export function buildVcpManifestJson(tools: readonly ToolSpec[], meta: VcpManifestMeta): string {
  const manifest = {
    manifestVersion: "2.0.0",
    name: meta.name,
    displayName: meta.displayName,
    version: meta.version,
    description: meta.description,
    author: meta.author,
    pluginType: "synchronous",
    entryPoint: { type: "nodejs", command: "node index.cjs" },
    communication: { protocol: "stdio", timeout: 120000 },
    configSchema: CONFIG_SCHEMA,
    capabilities: {
      invocationCommands: tools.map((spec) => ({
        command: toVcpCommand(spec.name),
        description: renderDescription(meta.name, spec),
        example: renderExample(meta.name, toVcpCommand(spec.name), spec),
      })),
    },
  };

  return `${JSON.stringify(manifest, null, 2)}\n`;
}

export function renderSkillCommandTable(tools: readonly ToolSpec[]): string {
  const rows = tools.map((spec) => {
    const params =
      Object.entries(spec.params)
        .map(([name, param]) => `${name}${param.required ? "" : "?"}`)
        .join(", ") || "—";
    return `| \`${spec.name}\` | \`${toVcpCommand(spec.name)}\` | ${params} | ${spec.title} |`;
  });
  return ["| 工具 | VCP command | 参数 | 说明 |", "| --- | --- | --- | --- |", ...rows].join("\n");
}

/** 只替换 GENERATED 标记之间的内容，手写段落永不被覆盖（幂等）。 */
export function insertGeneratedSkillTable(existing: string, tools: readonly ToolSpec[]): string {
  const begin = existing.indexOf(GENERATED_BEGIN);
  const end = existing.indexOf(GENERATED_END);

  if (begin === -1) throw new Error(`SKILL.md 缺少 ${GENERATED_BEGIN} 标记`);
  if (end === -1) throw new Error(`SKILL.md 缺少 ${GENERATED_END} 标记`);
  if (end < begin) throw new Error("SKILL.md 的 GENERATED 标记顺序颠倒");

  const table = renderSkillCommandTable(tools);
  return `${existing.slice(0, begin + GENERATED_BEGIN.length)}\n${table}\n${existing.slice(end)}`;
}
