export const TEXT_PREVIEW_LIMIT = 50;
export const DEFAULT_MAX_CHARS = 20000;

function renderItem(item: unknown): string {
  if (item !== null && typeof item === "object" && !Array.isArray(item)) {
    return Object.entries(item as Record<string, unknown>)
      .filter(([, v]) => v !== undefined && v !== null && v !== "")
      .map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
      .join(" | ");
  }
  return String(item);
}

/**
 * 统一的 LLM 可见文本渲染（ADR-0001/0004 的上下文经济学）：
 * 数组 → 总数 + 前 N 条；对象 → 键值对；标量 → 原样。永不 dump 完整 JSON。
 */
export function renderText(value: unknown, options?: { previewLimit?: number }): string {
  if (value === null || value === undefined) return "无数据";
  const previewLimit = options?.previewLimit ?? TEXT_PREVIEW_LIMIT;

  if (Array.isArray(value)) {
    if (value.length === 0) return "共 0 条";
    const shown = value.slice(0, previewLimit);
    const lines = shown.map((item, i) => `${i + 1}. ${renderItem(item)}`);
    if (value.length > previewLimit) {
      lines.push(`… 共 ${value.length} 条，已显示前 ${previewLimit} 条（取全量请用 --json 或读取 data 字段）`);
    } else {
      lines.unshift(`共 ${value.length} 条`);
    }
    return lines.join("\n");
  }

  if (typeof value === "object") return renderItem(value);
  return String(value);
}

export function truncateText(text: string, maxChars: number = DEFAULT_MAX_CHARS): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n\n⚠️ 已截断：原文 ${text.length} 字符，仅显示前 ${maxChars} 字符`;
}

const DEFAULT_SQL_ROW_CAP = 64;

/**
 * 把内核的 truncated / limit 语义翻译成 Agent 可执行的分页提示。
 * 依据实测：无显式 LIMIT 时内核默认上限 64 行并置 truncated: true。
 */
export function renderSqlNotice(limit: number, truncated: boolean): string {
  if (!truncated) return "";
  const cap = limit > 0 ? limit : DEFAULT_SQL_ROW_CAP;
  return `⚠️ 结果被截断：内核默认上限 ${cap} 行。请加显式 LIMIT/OFFSET 分页，或改用聚合/过滤条件。`;
}
