const PI_PREFIX = "siyuan_";

/** canonical → Pi 工具名（加前缀，避开内置工具命名空间）。 */
export function toPiToolName(canonical: string): string {
  return `${PI_PREFIX}${canonical}`;
}

/** canonical → VCP command（PascalCase）。 */
export function toVcpCommand(canonical: string): string {
  return canonical
    .split("_")
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

/**
 * canonical → CLI 子命令路径：两级（组 + 剩余部分）。
 * 例：notebook_list → [notebook, list]；doc_ids_by_hpath → [doc, ids_by_hpath]；sql → [sql]。
 * 不做完全拆分：否则 `doc ids by hpath` 既难读也难判断命令行到哪里结束。
 */
export function toCliPath(canonical: string): string[] {
  const parts = canonical.split("_");
  if (parts.length <= 1) return parts;
  return [parts[0]!, parts.slice(1).join("_")];
}

/**
 * VCP dispatch 宽进严出：同时接受 PascalCase 与 canonical，
 * 统一还原为 canonical 后再查表。
 */
export function fromVcpCommand(command: string): string {
  if (command.includes("_")) return command;
  return command
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
    .toLowerCase();
}
