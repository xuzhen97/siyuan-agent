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

/**
 * 笔记本级预览：用于删除/重命名/改图标/改配置这类操作。
 * 删除整库必须能说清“将毁掉什么”，所以这里会把文档数一并算出来（只读 SQL 计数）。
 */
export async function buildNotebookPreview(
  client: SiYuanClient,
  notebook: string,
): Promise<{ preview: string; exists: boolean; name: string; icon: string; docCount: number }> {
  try {
    const { name, conf } = await client.getNotebookConf(notebook);
    const docCount = await countDocs(client, notebook);
    const icon = typeof conf.icon === "string" ? conf.icon : "";
    const preview = [
      `笔记本名称：${name}`,
      `图标：${icon || "(未设置)"}`,
      `当前状态：${conf.closed === true ? "已关闭" : "已打开"}`,
      `文档数：${docCount}`,
      `日记保存路径：${String(conf.dailyNoteSavePath ?? "(未配置)")}`,
    ].join("\n");
    return { preview, exists: true, name, icon, docCount };
  } catch {
    return {
      preview: "目标笔记本不存在（可能已被删除或 ID 有误）",
      exists: false,
      name: "",
      icon: "",
      docCount: 0,
    };
  }
}

async function countDocs(client: SiYuanClient, notebook: string): Promise<number> {
  try {
    const escaped = notebook.replace(/'/g, "''");
    const { rows } = await client.querySql(
      `SELECT COUNT(*) AS c FROM blocks WHERE box = '${escaped}' AND type = 'd'`,
    );
    const value = rows[0]?.c;
    const count = typeof value === "number" ? value : Number(value ?? 0);
    return Number.isFinite(count) ? count : 0;
  } catch {
    return 0;
  }
}

/**
 * R9：最高爆炸半径操作（整库删除）的二次确认。
 * 除 `confirm: true` 外，`confirmName` 必须与目标当前名称**逐字一致**（容忍首尾空白），
 * 不做模糊匹配 —— 目的是迫使调用方先真正读到目标的名称。
 */
export function requireConfirmName(args: Record<string, unknown>, currentName: string, what: string): void {
  const provided = typeof args.confirmName === "string" ? args.confirmName.trim() : "";
  if (currentName.length > 0 && provided === currentName) return;

  throw new SiYuanError("SIYUAN_CONFIRM_MISMATCH", `${what} 的 confirmName 与当前名称不一致，已拒绝执行。`, {
    hint: `当前名称是「${currentName}」。请把它原样填入 confirmName 再调用（这是整库删除的二次确认）。`,
  });
}

/**
 * R10：批量替换只允许限定到具体块 ID 列表，**绝不产生「全库替换」**。
 * 接受数组、JSON 数组字符串或逗号分隔字符串；去空白、去重后必须非空。
 */
export function requireIdList(args: Record<string, unknown>, key: string): string[] {
  const raw = args[key];
  let ids: string[] = [];

  if (Array.isArray(raw)) {
    ids = raw.map((value) => String(value).trim());
  } else if (typeof raw === "string") {
    const text = raw.trim();
    if (text.startsWith("[")) {
      try {
        const parsed: unknown = JSON.parse(text);
        if (Array.isArray(parsed)) ids = parsed.map((value) => String(value).trim());
      } catch {
        ids = [];
      }
    } else {
      ids = text.split(",").map((part) => part.trim());
    }
  }

  const unique = [...new Set(ids.filter((id) => id.length > 0))];
  if (unique.length === 0) {
    throw new SiYuanError(
      "SIYUAN_API_ERROR",
      `${key} 不能为空：批量替换必须限定到具体块 ID 列表（不允许全库替换）`,
      { hint: "先用 search_blocks 或 sql 找到目标块，再把它们的 ID 传给 ids（数组或逗号分隔）。" },
    );
  }
  return unique;
}
