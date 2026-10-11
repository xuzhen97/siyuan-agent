import { SiYuanClient } from "../../core/client.ts";
import { resolveSiYuanConfig } from "../../core/config.ts";
import { describeError } from "../../core/errors.ts";
import { dispatchCommand } from "../../tools/dispatch.ts";
import { TOOL_SPECS } from "../../tools/definitions.ts";

export type VcpRequest = {
  command: string;
  params?: Record<string, unknown>;
  maid?: string;
  [key: string]: unknown;
};

export type VcpContent = Array<{ type: "text"; text: string }>;

export type VcpResponse =
  | { status: "success"; result: { content: VcpContent }; messageForAI: string }
  | { status: "error"; error: string; result: { content: VcpContent }; messageForAI: string };

/**
 * VCP 内核把工具调用参数平铺写入 stdin；成熟插件按 `{command, params?, ...flat}` 解析，
 * 且嵌套 params 覆盖平铺字段（对齐 VCPDeck/packages/vcp-plugin 的 dispatcher）。
 */
export function normalizeVcpArgs(req: VcpRequest): { command: string; args: Record<string, unknown> } {
  const { command, params: nested, maid: _maid, ...flat } = req;
  return { command: String(command ?? ""), args: { ...flat, ...(nested ?? {}) } };
}

export function errorResponse(message: string): VcpResponse {
  return {
    status: "error",
    error: message,
    result: { content: [{ type: "text", text: message }] },
    messageForAI: message,
  };
}

export async function handleVcpRequest(req: VcpRequest, client: SiYuanClient): Promise<VcpResponse> {
  const { command, args } = normalizeVcpArgs(req);
  const outcome = await dispatchCommand(command, args, client, TOOL_SPECS);

  if (outcome.ok) {
    return {
      status: "success",
      result: { content: [{ type: "text", text: outcome.result.text }] },
      messageForAI: outcome.result.text,
    };
  }

  const { code, message, hint } = outcome.error;
  return errorResponse(`[${code}] ${message}${hint ? `\n提示：${hint}` : ""}`);
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk as Uint8Array));
  return Buffer.concat(chunks).toString("utf-8");
}

export async function main(): Promise<void> {
  let response: VcpResponse;
  try {
    const raw = await readStdin();
    if (raw.trim().length === 0) {
      response = errorResponse("[SIYUAN_API_ERROR] 未收到 VCP 请求（stdin 为空）");
    } else {
      const req = JSON.parse(raw) as VcpRequest;
      const client = new SiYuanClient(resolveSiYuanConfig());
      response = await handleVcpRequest(req, client);
    }
  } catch (err) {
    const described = describeError(err);
    response = errorResponse(
      `[${described.code}] ${described.message}${described.hint ? `\n提示：${described.hint}` : ""}`,
    );
  }
  process.stdout.write(JSON.stringify(response));
}

const entry = process.argv[1] ?? "";
const isDirectRun = entry.endsWith("index.ts") || entry.endsWith("index.cjs") || entry.endsWith("index.js");
if (isDirectRun) void main();
