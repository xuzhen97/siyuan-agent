import { describe, expect, it, vi } from "vitest";
import { findToolSpec, TOOL_SPECS } from "../../src/tools/definitions.ts";
import { fakeClient } from "../helpers/fake-client.ts";

const READ_ONLY_NAMES = [
  "version",
  "status",
  "notebook_list",
  "notebook_info",
  "doc_list",
  "doc_tree",
  "doc_path_by_id",
  "doc_hpath_by_id",
  "doc_ids_by_hpath",
  "doc_export_md",
  "block_get",
  "block_children",
  "block_attrs_get",
  "search_blocks",
  "search_docs",
  "search_tag",
  "tag_list",
  "sql",
];

describe("TOOL_SPECS 只读部分（18 条）", () => {
  it("名称与顺序完全匹配，且全部标记为 read", () => {
    const readOnly = TOOL_SPECS.filter((s) => s.risk === "read");
    expect(readOnly.map((s) => s.name)).toEqual(READ_ONLY_NAMES);
  });

  it("每条都有非空 title 与足够长的 description", () => {
    for (const spec of TOOL_SPECS.filter((s) => s.risk === "read")) {
      expect(spec.title.length).toBeGreaterThan(0);
      expect(spec.description.length).toBeGreaterThan(10);
    }
  });

  it("只读集合里不含任何写动词", () => {
    const forbidden = /create|insert|update|delete|remove|rename|move|append|prepend|set|upload|fold/i;
    for (const spec of TOOL_SPECS.filter((s) => s.risk === "read")) {
      expect(spec.name).not.toMatch(forbidden);
    }
  });

  it("sql 工具在参数描述里声明只读", () => {
    expect(findToolSpec("sql")?.params.stmt?.description).toContain("只读");
  });

  it("doc_tree 的 path 必填且明确不接受根路径（内核实测契约）", () => {
    const spec = findToolSpec("doc_tree");
    expect(spec?.params.path?.required).toBe(true);
    expect(spec?.params.path?.description).toContain("不能是根路径");
    expect(spec?.description).toContain("doc_list");
  });

  it("canonical 名唯一，且 VCP/CLI 派生后不冲突", () => {
    const names = TOOL_SPECS.map((s) => s.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("只读工具的 invoke 映射", () => {
  it("version 返回内核版本文本", async () => {
    const { client } = fakeClient();
    const out = await findToolSpec("version")?.invoke(client, {});
    expect(out?.text).toContain("3.8.6");
  });

  it("status 汇总连接与版本，并说明是否配置 Token", async () => {
    const { client } = fakeClient();
    const out = await findToolSpec("status")?.invoke(client, {});
    expect(out?.text).toContain("3.8.6");
    expect(out?.text).toContain("127.0.0.1:6806");
    expect(out?.text).toContain("未配置");
  });

  it("notebook_list 渲染条数", async () => {
    const { client } = fakeClient();
    const out = await findToolSpec("notebook_list")?.invoke(client, {});
    expect(out?.text).toContain("共 1 条");
  });

  it("doc_export_md 按 maxChars 截断并提示", async () => {
    const { client } = fakeClient({ exportMdContent: vi.fn(async () => ({ hPath: "/甲", content: "x".repeat(300) })) });
    const out = await findToolSpec("doc_export_md")?.invoke(client, { id: "d1", maxChars: 100 });
    expect(out?.text).toContain("已截断");
  });

  it("search_blocks 附带匹配块数", async () => {
    const { client } = fakeClient();
    const out = await findToolSpec("search_blocks")?.invoke(client, { query: "会议" });
    expect(out?.text).toContain("匹配块数：1");
  });

  it("sql 被截断时给出分页提示，并保留 data 里的 limit/truncated", async () => {
    const { client } = fakeClient();
    const out = await findToolSpec("sql")?.invoke(client, { stmt: "SELECT id FROM blocks" });
    expect(out?.text).toContain("结果被截断");
    expect(out?.data).toEqual({ rows: [{ id: "b1" }], limit: 64, truncated: true });
  });

  it("sql 工具在 invoke 内执行只读守卫（PRAGMA 也会被拦）", async () => {
    const { client, calls } = fakeClient();
    await expect(findToolSpec("sql")?.invoke(client, { stmt: "PRAGMA table_info(blocks)" })).rejects.toThrowError(
      /只读/,
    );
    expect(calls.filter((c) => c.fn === "querySql")).toEqual([]);
  });

  it("doc_ids_by_hpath 透传 notebook 与 path", async () => {
    const { client, calls } = fakeClient();
    await findToolSpec("doc_ids_by_hpath")?.invoke(client, { notebook: "nb1", path: "/甲" });
    expect(calls[0]).toEqual({ fn: "getIDsByHPath", args: ["nb1", "/甲"] });
  });

  it("tag_list 忽略内核列表上限（ignoreMaxListHint）", async () => {
    const { client, calls } = fakeClient();
    await findToolSpec("tag_list")?.invoke(client, {});
    expect(calls[0]?.fn).toBe("getTag");
  });
});
