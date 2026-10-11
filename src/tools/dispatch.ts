import type { SiYuanClient } from "../core/client.ts";
import { describeError, SiYuanError, type SiYuanErrorCode } from "../core/errors.ts";
import { fromVcpCommand } from "./naming.ts";
import type { ToolSpec } from "./types.ts";
import type { ToolResult } from "./types.ts";

export type DispatchOutcome =
  | { ok: true; result: ToolResult }
  | { ok: false; error: { code: SiYuanErrorCode; message: string; hint?: string } };

/**
 * 参数校验与归一化：补齐默认值、按声明类型转换、缺失必填即报错。
 * 空字符串视为「未提供」，避免 CLI/VCP 传来的参数字符串污染默认值。
 */
export function coerceArgs(spec: ToolSpec, args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};

  for (const [name, param] of Object.entries(spec.params)) {
    const raw = args[name];

    if (raw === undefined || raw === null || raw === "") {
      if (param.required) {
        throw new SiYuanError("SIYUAN_API_ERROR", `缺少必填参数 ${name}（${param.description}）`, {
          hint: `调用 ${spec.name} 时必须提供 ${name}`,
        });
      }
      if (param.default !== undefined) out[name] = param.default;
      continue;
    }

    if (param.type === "number") {
      // 严格解析：拒绝 "10abc" 这类部分可解析的输入，避免静默截断成 10。
      const text = typeof raw === "number" ? String(raw) : String(raw).trim();
      const n = text === "" ? Number.NaN : Number(text);
      if (!Number.isFinite(n)) {
        throw new SiYuanError("SIYUAN_API_ERROR", `参数 ${name} 需要数字，收到 ${String(raw)}`, {
          hint: `为 ${name} 提供数字（例如 ${name}=10）`,
        });
      }
      out[name] = n;
    } else if (param.type === "boolean") {
      if (typeof raw === "boolean") {
        out[name] = raw;
      } else if (String(raw).toLowerCase() === "true") {
        out[name] = true;
      } else if (String(raw).toLowerCase() === "false") {
        out[name] = false;
      } else {
        throw new SiYuanError("SIYUAN_API_ERROR", `参数 ${name} 需要 true/false，收到 ${String(raw)}`, {
          hint: `为 ${name} 提供布尔值`,
        });
      }
    } else {
      out[name] = String(raw);
    }
  }

  return out;
}

/** 校验 → 执行 → 统一错误包装（三条通道共用同一出口语义）。 */
export async function dispatchTool(
  spec: ToolSpec,
  args: Record<string, unknown>,
  client: SiYuanClient,
): Promise<DispatchOutcome> {
  try {
    const coerced = coerceArgs(spec, args);
    return { ok: true, result: await spec.invoke(client, coerced) };
  } catch (err) {
    return { ok: false, error: describeError(err) };
  }
}

/** 按命令名分发：同时接受 canonical 与 VCP PascalCase（宽进严出）。 */
export async function dispatchCommand(
  command: string,
  args: Record<string, unknown>,
  client: SiYuanClient,
  specs: readonly ToolSpec[],
): Promise<DispatchOutcome> {
  const trimmed = command.trim();
  const canonical = fromVcpCommand(trimmed);
  const spec = specs.find((s) => s.name === canonical || s.name === trimmed);

  if (!spec) {
    return {
      ok: false,
      error: {
        code: "SIYUAN_API_ERROR",
        message: `未知命令 ${command}`,
        hint: `可用命令：${specs.map((s) => s.name).join(", ")}`,
      },
    };
  }

  return dispatchTool(spec, args, client);
}
