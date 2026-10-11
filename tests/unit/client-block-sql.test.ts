import { describe, expect, it } from "vitest";
import { SiYuanClient } from "../../src/core/client.ts";
import { DEFAULT_CONFIG } from "../../src/core/config.ts";
import { apiFetch, bodyOf, okFetch, rawFetch, urlOf } from "../helpers/fake-fetch.ts";

const client = (f: Parameters<typeof bodyOf>[0]) => new SiYuanClient(DEFAULT_CONFIG, { fetch: f as never });

describe("block / attr / tag / sql", () => {
  it("getBlockKramdown 解包 id 与 kramdown", async () => {
    const f = okFetch({ id: "b1", kramdown: "内容" });
    await expect(client(f).getBlockKramdown("b1")).resolves.toEqual({ id: "b1", kramdown: "内容" });
    expect(bodyOf(f)).toEqual({ id: "b1" });
  });

  it("getChildBlocks 对 null 返回空数组", async () => {
    const f = okFetch(null);
    await expect(client(f).getChildBlocks("b1")).resolves.toEqual([]);
  });

  it("getBlockAttrs 对 null 返回空对象", async () => {
    const f = okFetch(null);
    await expect(client(f).getBlockAttrs("b1")).resolves.toEqual({});
  });

  it("fullTextSearchBlock 用 query 传参", async () => {
    const f = okFetch({ blocks: [{ id: "b1" }], matchedBlockCount: 1 });
    await expect(client(f).fullTextSearchBlock("会议")).resolves.toEqual({
      blocks: [{ id: "b1" }],
      matchedBlockCount: 1,
    });
    expect(bodyOf(f)).toEqual({ query: "会议" });
  });

  it("searchTag 解包 data.tags 且对 null 返回空数组", async () => {
    const f = okFetch({ tags: ["#a#", "#b#"] });
    await expect(client(f).searchTag("a")).resolves.toEqual(["#a#", "#b#"]);
    expect(bodyOf(f)).toEqual({ k: "a" });

    const f2 = rawFetch({ code: 0, msg: "", data: null });
    await expect(client(f2).searchTag("")).resolves.toEqual([]);
  });

  it("getTag 带 ignoreMaxListHint=true", async () => {
    const f = okFetch([{ name: "#a#", count: 2 }]);
    await expect(client(f).getTag()).resolves.toEqual([{ name: "#a#", count: 2 }]);
    expect(bodyOf(f)).toEqual({ ignoreMaxListHint: true });
  });

  it("querySql 保留 limit / truncated（ADR-0002/0004）", async () => {
    const f = apiFetch([{ id: "b1" }], { limit: 64, truncated: true });
    await expect(client(f).querySql("SELECT id FROM blocks")).resolves.toEqual({
      rows: [{ id: "b1" }],
      limit: 64,
      truncated: true,
    });
    expect(urlOf(f)).toBe("http://127.0.0.1:6806/api/query/sql");
    expect(bodyOf(f)).toEqual({ stmt: "SELECT id FROM blocks" });
  });

  it("querySql 在 truncated / limit 缺省时回退为 false / 0", async () => {
    const f = okFetch([]);
    await expect(client(f).querySql("SELECT 1")).resolves.toEqual({ rows: [], limit: 0, truncated: false });
  });

  it("querySql 对非数组 data 返回空 rows", async () => {
    const f = okFetch({ unexpected: true });
    const res = await client(f).querySql("SELECT 1");
    expect(res.rows).toEqual([]);
  });
});
