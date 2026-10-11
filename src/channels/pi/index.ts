import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { SiYuanClient } from "../../core/client.ts";
import { resolveSiYuanConfig } from "../../core/config.ts";
import { dispatchTool } from "../../tools/dispatch.ts";
import { TOOL_SPECS } from "../../tools/definitions.ts";
import { toPiToolName } from "../../tools/naming.ts";
import type { Risk } from "../../tools/types.ts";
import { toJsonSchema } from "./schema.ts";

export { toJsonSchema } from "./schema.ts";

/** Pi 侧参数 schema 类型从公开 API 推导，避免为本项目引入 typebox 依赖。 */
type PiToolDefinition = Parameters<ExtensionAPI["registerTool"]>[0];

let cachedClient: SiYuanClient | undefined;

function defaultClient(): SiYuanClient {
  cachedClient ??= new SiYuanClient(resolveSiYuanConfig());
  return cachedClient;
}

const RISK_SNIPPET: Record<Risk, string> = {
  read: "只读",
  additive: "写入·增量型",
  destructive: "写入·破坏型（必须 confirm）",
};

/**
 * 把工具真源逐条注册为 Pi 工具（ADR-0001）。
 * 名称加 `siyuan_` 前缀；只读/破坏型通过 annotations 暴露给宿主，便于 UI 与策略判断。
 */
export function registerSiYuanTools(pi: ExtensionAPI, deps?: { client?: SiYuanClient }): number {
  for (const spec of TOOL_SPECS) {
    const tool: PiToolDefinition = {
      name: toPiToolName(spec.name),
      label: spec.title,
      description: spec.description,
      promptSnippet: `思源笔记·${RISK_SNIPPET[spec.risk]}：${spec.title}`,
      annotations: {
        readOnlyHint: spec.risk === "read",
        destructiveHint: spec.risk === "destructive",
        openWorldHint: true,
        // 只读调用天然幂等；写工具重复执行可能有额外副作用。
        idempotentHint: spec.risk === "read",
      },
      // SAFETY: toJsonSchema 产出标准 JSON Schema，与 TypeBox TSchema 的结构兼容；此处只做类型转换，无运行期改写。
      parameters: toJsonSchema(spec.params) as unknown as PiToolDefinition["parameters"],
      execute: async (_toolCallId, params) => {
        const client = deps?.client ?? defaultClient();
        const outcome = await dispatchTool(spec, (params ?? {}) as Record<string, unknown>, client);

        if (outcome.ok) {
          return {
            content: [{ type: "text", text: outcome.result.text }],
            details: outcome.result.data ?? null,
          };
        }

        const { code, message, hint } = outcome.error;
        return {
          content: [{ type: "text", text: `[${code}] ${message}${hint ? `\n提示：${hint}` : ""}` }],
          details: { code, message, hint },
          isError: true,
        };
      },
    };

    pi.registerTool(tool);
  }

  return TOOL_SPECS.length;
}

export default function siyuanExtension(pi: ExtensionAPI): void {
  registerSiYuanTools(pi);
}
