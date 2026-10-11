import { describe, expect, it } from "vitest";
import { assertReadOnlySql } from "../../src/tools/guard.ts";

const allowed = [
  "SELECT id FROM blocks",
  "  select id from blocks limit 10",
  "-- 找块\nSELECT id FROM blocks",
  "/* c */ SELECT 1",
  "WITH t AS (SELECT 1 AS a) SELECT a FROM t",
  "SELECT 'drop table blocks'",
  "SELECT content FROM blocks WHERE content LIKE '%delete%'",
  "SELECT 1 /* 注释里的 ' 单引号 */",
  "SELECT 1;",
  "select id from blocks limit 5;",
];

const blocked = [
  "PRAGMA table_info(blocks)",
  "INSERT INTO blocks (id) VALUES ('x')",
  "UPDATE blocks SET content='x'",
  "DELETE FROM blocks",
  "DROP TABLE blocks",
  "ALTER TABLE blocks ADD COLUMN x TEXT",
  "ATTACH DATABASE 'x.db' AS x",
  "CREATE TABLE t (a INT)",
  "REPLACE INTO blocks (id) VALUES ('x')",
  "VACUUM",
  "SELECT 1; DROP TABLE blocks",
  "SELECT 1;;",
  "SELECT 'x'; DELETE FROM blocks",
  "/* c */ DELETE FROM blocks",
  "-- x\nDELETE FROM blocks",
  "  insert into blocks (id) values ('x')",
  "SELECT 'unterminated",
  "   ",
];

describe("assertReadOnlySql（ADR-0002/0004）", () => {
  it.each(allowed)("放行: %s", (stmt) => {
    expect(() => assertReadOnlySql(stmt)).not.toThrow();
  });

  it.each(blocked)("拦截: %s", (stmt) => {
    expect(() => assertReadOnlySql(stmt)).toThrowError(/只读|拒绝/);
  });

  it("拦截时错误码为 SIYUAN_READONLY_BLOCKED 且带可操作提示", () => {
    try {
      assertReadOnlySql("DELETE FROM blocks");
      throw new Error("应当被拦截");
    } catch (err) {
      const e = err as { code: string; hint?: string };
      expect(e.code).toBe("SIYUAN_READONLY_BLOCKED");
      expect(e.hint).toContain("SELECT");
    }
  });

  it("大小写混写的变更关键字同样被拦截", () => {
    expect(() => assertReadOnlySql("Update blocks SET content='x'")).toThrow();
  });
});
