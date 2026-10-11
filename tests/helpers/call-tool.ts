import type { SiYuanClient } from "../../src/core/client.ts";
import { SiYuanError } from "../../src/core/errors.ts";
import { dispatchTool } from "../../src/tools/dispatch.ts";
import { findToolSpec } from "../../src/tools/definitions.ts";
import type { ToolResult } from "../../src/tools/types.ts";

/**
 * 通过生产入口（dispatchTool）调用工具：先做参数校验与默认值填充，再执行 invoke。
 * 测试必须走这条路，否则会绕过 coerceArgs —— 而默认值正是在那里填充的。
 * 失败时还原为 SiYuanError 抛出，便于断言 code / hint。
 */
export async function callTool(
  name: string,
  args: Record<string, unknown>,
  client: SiYuanClient,
): Promise<ToolResult> {
  const spec = findToolSpec(name);
  if (!spec) throw new Error(`未找到工具 ${name}`);

  const outcome = await dispatchTool(spec, args, client);
  if (outcome.ok) return outcome.result;

  throw new SiYuanError(outcome.error.code, outcome.error.message, { hint: outcome.error.hint });
}
