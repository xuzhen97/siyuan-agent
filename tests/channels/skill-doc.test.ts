import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { GENERATED_BEGIN, GENERATED_END } from "../../src/generators/vcpManifest.ts";

const skill = readFileSync("skills/siyuan/SKILL.md", "utf-8");
const recipes = readFileSync("skills/siyuan/references/sql-recipes.md", "utf-8");

describe("skills/siyuan/SKILL.md", () => {
  it("frontmatter 含 name / description 并在 Agent Skills 长度限制内", () => {
    const frontmatter = /^---\n([\s\S]*?)\n---/.exec(skill)?.[1] ?? "";
    const name = /^name:\s*(.+)$/m.exec(frontmatter)?.[1]?.trim();
    const description = /^description:\s*(.+)$/m.exec(frontmatter)?.[1]?.trim() ?? "";
    expect(name).toBe("siyuan");
    expect(description.length).toBeGreaterThan(30);
    expect(description.length).toBeLessThanOrEqual(1024);
  });

  it("description 同时点明读与写，便于路由", () => {
    const description = /^description:\s*(.+)$/m.exec(skill)?.[1] ?? "";
    expect(description).toContain("读写");
    expect(description).toContain("confirm");
  });

  it("含 GENERATED 标记对且顺序正确", () => {
    const begin = skill.indexOf(GENERATED_BEGIN);
    const end = skill.indexOf(GENERATED_END);
    expect(begin).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(begin);
  });

  it("声明写操作纪律与只读 SQL 边界", () => {
    expect(skill).toContain("confirm: true");
    expect(skill).toContain("SIYUAN_CONFIRM_REQUIRED");
    expect(skill).toContain("SIYUAN_READONLY_BLOCKED");
    expect(skill).toContain("truncated");
  });

  it("指向 references/sql-recipes.md", () => {
    expect(skill).toContain("references/sql-recipes.md");
  });
});

describe("skills/siyuan/references/sql-recipes.md", () => {
  it("记录内核版本与实测表清单", () => {
    expect(recipes).toContain("3.8.6");
    expect(recipes).toContain("sqlite_master");
    expect(recipes).toContain("blocks_fts");
  });

  it("记录 64 行截断语义与分页写法", () => {
    expect(recipes).toContain("64");
    expect(recipes).toContain("truncated");
    expect(recipes).toContain("OFFSET");
  });

  it("给出 blocks 表实测列", () => {
    for (const column of ["parent_id", "root_id", "hpath", "hash", "updated", "ial"]) {
      expect(recipes).toContain(column);
    }
  });

  it("明确 SQL 只读", () => {
    expect(recipes).toContain("只读");
    expect(recipes).toContain("SIYUAN_READONLY_BLOCKED");
  });
});
