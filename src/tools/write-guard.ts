import type { SiYuanClient } from "../core/client.ts";
import { SiYuanError } from "../core/errors.ts";
import type { ToolSpec } from "./types.ts";

const PREVIEW_CHARS = 200;

/** 破坏型工具：覆盖或删除既有内容（ADR-0004）。 */
export function isDestructive(spec: ToolSpec): boolean {
  return spec.risk === "destructive";
}

export function previewBlock(kramdown: string, childCount: number): string {
  const head =
    kramdown.length > PREVIEW_CHARS
      ? `${kramdown.slice(0, PREVIEW_CHARS)}\n…（已截断，原文 ${kramdown.length} 字符）`
      : kramdown;
  return `子块数：${childCount}\n当前内容：\n${head || "（空块）"}`;
}

export function previewDoc(hPath: string | undefined, childCount: number): string {
  if (!hPath) return "目标文档不存在（可能已被删除或 ID 有误）";
  return `文档路径：${hPath}\n子块数：${childCount}`;
}

export async function buildBlockPreview(
  client: SiYuanClient,
  id: string,
): Promise<{ preview: string; exists: boolean }> {
  try {
    const { kramdown } = await client.getBlockKramdown(id);
    const children = await client.getChildBlocks(id).catch(() => []);
    return { preview: previewBlock(kramdown ?? "", children.length), exists: true };
  } catch {
    return { preview: "目标块不存在（可能已被删除或 ID 有误）", exists: false };
  }
}

export async function buildDocPreview(
  client: SiYuanClient,
  id: string,
): Promise<{ preview: string; exists: boolean }> {
  try {
    const hPath = await client.getHPathByID(id);
    const children = await client.getChildBlocks(id).catch(() => []);
    return { preview: previewDoc(hPath, children.length), exists: Boolean(hPath) };
  } catch {
    return { preview: previewDoc(undefined, 0), exists: false };
  }
}

/**
 * R1：破坏型工具必须显式 confirm: true。
 * 未确认时不执行任何写调用，而是抛 SIYUAN_CONFIRM_REQUIRED 并把预览带在消息里
 * —— 让 Agent 一次调用就能看到「将要发生什么」。
 */
export function requireConfirm(
  spec: ToolSpec,
  args: Record<string, unknown>,
  preview: string,
  exists: boolean,
): void {
  if (!isDestructive(spec)) return;

  if (!exists) {
    throw new SiYuanError("SIYUAN_NOT_FOUND", `目标不存在，已拒绝执行（${spec.name}）`, { hint: preview });
  }

  if (args.confirm !== true) {
    throw new SiYuanError(
      "SIYUAN_CONFIRM_REQUIRED",
      `破坏型操作未确认，已拒绝执行（${spec.name}）。\n--- 预览 ---\n${preview}`,
      { hint: "确认无误后请带 confirm: true 重新调用；只查看影响可用 dryRun: true。" },
    );
  }
}

/** R2：dryRun 只认字面 true，避免 "true" 这类字符串被误当开关。 */
export function shouldDryRun(args: Record<string, unknown>): boolean {
  return args.dryRun === true;
}

/** R4/R5：乐观并发校验（依据 blocks.hash，W9）。 */
export async function requireFreshHash(
  client: SiYuanClient,
  id: string,
  expectedHash?: string,
): Promise<void> {
  if (!expectedHash) return;

  const current = await client.getBlockHash(id);
  if (current === undefined) {
    throw new SiYuanError("SIYUAN_STALE_TARGET", `目标块已不存在（id=${id}），已拒绝执行`, {
      hint: "请重新定位目标后再试。",
    });
  }
  if (current !== expectedHash) {
    throw new SiYuanError(
      "SIYUAN_STALE_TARGET",
      `目标块已被修改（当前 hash=${current}，期望 ${expectedHash}），已拒绝执行`,
      { hint: "请先重新读取目标内容，确认后再执行。" },
    );
  }
}
