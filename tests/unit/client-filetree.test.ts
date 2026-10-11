import { describe, expect, it } from "vitest";
import { SiYuanClient } from "../../src/core/client.ts";
import { DEFAULT_CONFIG } from "../../src/core/config.ts";
import { bodyOf, okFetch, urlOf } from "../helpers/fake-fetch.ts";

const client = (f: Parameters<typeof bodyOf>[0]) =>
  new SiYuanClient(DEFAULT_CONFIG, { fetch: f as never });

describe("Trace 4：filetree / export / search 请求形状", () => {
  it("listDocsByPath 带 notebook / path / maxListCount=0，并解包 data.files", async () => {
    // 内核 3.8.6 实测：data = { box, path, files, effectiveSortMode }
    const f = okFetch({ box: "nb1", path: "/", files: [{ id: "d1", name: "A" }], effectiveSortMode: 15 });
    await expect(client(f).listDocsByPath("nb1", "/")).resolves.toEqual([{ id: "d1", name: "A" }]);
    expect(urlOf(f)).toBe("http://127.0.0.1:6806/api/filetree/listDocsByPath");
    expect(bodyOf(f)).toEqual({ notebook: "nb1", path: "/", maxListCount: 0 });
  });

  it("listDocsByPath 对缺失 files 字段返回空数组", async () => {
    const f = okFetch({ box: "nb1", path: "/" });
    await expect(client(f).listDocsByPath("nb1", "/x")).resolves.toEqual([]);
  });

  it("listDocTree 带 maxDepth / sort，并解包 data.tree", async () => {
    // 内核 3.8.6 实测：data = { tree: [...] }，且 path 必须是文档路径或 ID
    const f = okFetch({ tree: [{ id: "d1" }] });
    await expect(client(f).listDocTree("nb1", "/20261009104613-x.sy", 2, 1)).resolves.toEqual([{ id: "d1" }]);
    expect(bodyOf(f)).toEqual({ notebook: "nb1", path: "/20261009104613-x.sy", maxDepth: 2, sort: 1 });
  });

  it("getHPathByID 返回裸字符串 data", async () => {
    const f = okFetch("/笔记/甲");
    await expect(client(f).getHPathByID("b1")).resolves.toBe("/笔记/甲");
    expect(bodyOf(f)).toEqual({ id: "b1" });
  });

  it("getPathByID 解包 data 的 notebook/path", async () => {
    const f = okFetch({ notebook: "nb1", path: "/20260419/x.sy" });
    await expect(client(f).getPathByID("b1")).resolves.toEqual({ notebook: "nb1", path: "/20260419/x.sy" });
  });

  it("getIDsByHPath 对 null data 返回空数组", async () => {
    const f = okFetch(null);
    await expect(client(f).getIDsByHPath("nb1", "/笔记/甲")).resolves.toEqual([]);
    expect(bodyOf(f)).toEqual({ notebook: "nb1", path: "/笔记/甲" });
  });

  it("exportMdContent 解包 hPath/content", async () => {
    const f = okFetch({ hPath: "/甲", content: "# 甲" });
    await expect(client(f).exportMdContent("d1")).resolves.toEqual({ hPath: "/甲", content: "# 甲" });
    expect(bodyOf(f)).toEqual({ id: "d1" });
  });

  it("searchDocs 用 k 传参并对 null data 返回空数组", async () => {
    const f = okFetch(null);
    await expect(client(f).searchDocs("会议")).resolves.toEqual([]);
    expect(bodyOf(f)).toEqual({ k: "会议" });
  });
});
