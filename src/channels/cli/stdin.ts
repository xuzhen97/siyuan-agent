import { readFileSync } from "node:fs";
import type { ToolSpec } from "../../tools/types.ts";

/** stdin 哨兵：对齐参考实现（参数为 `-` 时从标准输入读取内容）。 */
export const STDIN_SENTINEL = "-";

/**
 * 该工具哪些参数支持从 stdin 读取（对齐参考实现 siyuan_cli.py 的 `_read_stdin` 约定）：
 *  - `doc_create` 的 `markdown`（写法 `--md -` / `--markdown -`）
 *  - `block_insert` / `block_update` 的 `data`（参数为 `-` **或省略**，见参考实现 SIYUAN.md）
 */
export function stdinParams(spec: ToolSpec): string[] {
  if (spec.name === "doc_create") return ["markdown"];
  if (spec.name === "block_insert" || spec.name === "block_update") return ["data"];
  return [];
}

/** 只有显式 `-` 才读 stdin 的参数：doc create 省略 markdown 时应创建空文档，而不是阻塞等输入。 */
const EXPLICIT_SENTINEL_ONLY = new Set(["markdown"]);

export type StdinReader = () => string;

/**
 * 把 `-`（以及 block 写操作的「省略」）替换为 stdin 内容。
 * 纯函数式：读入由调用方注入，便于测试且不在工具层触碰进程 IO。
 */
export function resolveStdinArgs(
  spec: ToolSpec,
  args: Record<string, unknown>,
  readStdin: StdinReader,
): Record<string, unknown> {
  const params = stdinParams(spec);
  if (params.length === 0) return args;

  const next = { ...args };
  for (const param of params) {
    const value = next[param];
    const omitted = value === undefined || value === "";
    const wantsStdin = value === STDIN_SENTINEL || (omitted && !EXPLICIT_SENTINEL_ONLY.has(param));
    if (wantsStdin) next[param] = readStdin();
  }
  return next;
}

/** 从进程 fd 0 读取全部 stdin（管道场景）。TTY 下无输入时会阻塞等待，与参考实现行为一致。 */
export function readStdinText(): string {
  try {
    return readFileSync(0, "utf-8");
  } catch {
    return "";
  }
}
