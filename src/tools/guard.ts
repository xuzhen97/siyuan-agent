import { SiYuanError } from "../core/errors.ts";

export const SQL_FORBIDDEN_KEYWORDS: readonly string[] = [
  "PRAGMA",
  "ATTACH",
  "DETACH",
  "INSERT",
  "UPDATE",
  "DELETE",
  "DROP",
  "ALTER",
  "CREATE",
  "REPLACE",
  "VACUUM",
  "REINDEX",
  "ANALYZE",
  "TRUNCATE",
];

/** 去掉行注释与块注释，使注释夹带的绕过写法失效。 */
function stripComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
}

/**
 * 去掉单引号字符串字面量（SQL 里 '' 表示转义的单引号）。
 * 返回 null 表示引号不闭合 —— 视为可疑，直接拒绝。
 */
function stripStringLiterals(sql: string): string | null {
  let out = "";
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i];
    if (ch !== "'") {
      out += ch;
      i += 1;
      continue;
    }
    i += 1;
    let closed = false;
    while (i < sql.length) {
      if (sql[i] === "'") {
        if (sql[i + 1] === "'") {
          i += 2;
          continue;
        }
        closed = true;
        i += 1;
        break;
      }
      i += 1;
    }
    if (!closed) return null;
    out += " '' ";
  }
  return out;
}

/**
 * 一期只读保证（ADR-0002 / ADR-0004）。
 * 内核 /api/query/sql 不限制语句类型（实测 PRAGMA 可执行），因此这里是唯一防线：
 * 单条语句 + 首关键字为 SELECT/WITH + 不得出现变更类关键字。
 */
export function assertReadOnlySql(stmt: string): void {
  function refuse(reason: string): never {
    throw new SiYuanError(
      "SIYUAN_READONLY_BLOCKED",
      `SQL 被拒绝：${reason}。本工具一期只读，仅允许单条 SELECT / WITH 查询。`,
      { hint: "改用 SELECT 查询；写操作请使用 typed 写工具（带 confirm 确认）。" },
    );
  }

  const withoutComments = stripComments(stmt).trim();
  if (withoutComments.length === 0) refuse("语句为空");

  const withoutLiterals = stripStringLiterals(withoutComments);
  if (withoutLiterals === null) refuse("单引号不闭合");

  const firstWord = /^([A-Za-z]+)/.exec(withoutLiterals)?.[1]?.toUpperCase();
  if (firstWord !== "SELECT" && firstWord !== "WITH") {
    refuse(`不支持的语句类型 ${firstWord ?? "(未知)"}`);
  }

  const semicolon = withoutLiterals.indexOf(";");
  if (semicolon !== -1) {
    const trailing = withoutLiterals.slice(semicolon + 1).trim();
    // 单个尾随分号只是语句终结符，不多语句；分号后仍有内容才算多语句。
    if (trailing.length > 0) refuse("检测到多语句");
  }

  for (const keyword of SQL_FORBIDDEN_KEYWORDS) {
    if (new RegExp(`\\b${keyword}\\b`, "i").test(withoutLiterals)) {
      refuse(`包含变更关键字 ${keyword}`);
    }
  }
}
