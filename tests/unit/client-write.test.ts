import { describe, expect, it } from "vitest";
import { SiYuanClient } from "../../src/core/client.ts";
import { DEFAULT_CONFIG } from "../../src/core/config.ts";
import { apiFetch, bodyOf, okFetch, urlOf } from "../helpers/fake-fetch.ts";

const client = (f: Parameters<typeof bodyOf>[0]) => new SiYuanClient(DEFAULT_CONFIG, { fetch: f as never });

describe("写方法请求形状（ADR-0004）", () => {
  it("createNotebook 以 name 传参并返回 data", async () => {
    const f = okFetch({ notebook: { id: "nb9", name: "X" } });
    await expect(client(f).createNotebook("X")).resolves.toEqual({ id: "nb9", name: "X" });
    expect(bodyOf(f)).toEqual({ name: "X" });
    expect(urlOf(f)).toBe("http://127.0.0.1:6806/api/notebook/createNotebook");
  });

  it("createDocWithMd 以 notebook/path/markdown 传参并返回新文档 ID", async () => {
    const f = okFetch("20260419120000-aaaaaaa");
    await expect(client(f).createDocWithMd("nb1", "/沙盒/甲", "# 甲")).resolves.toBe("20260419120000-aaaaaaa");
    expect(urlOf(f)).toBe("http://127.0.0.1:6806/api/filetree/createDocWithMd");
    expect(bodyOf(f)).toEqual({ notebook: "nb1", path: "/沙盒/甲", markdown: "# 甲" });
  });

  it("appendBlock 解包 doOperations 并发送 parentID/data/dataType", async () => {
    const f = okFetch([{ doOperations: [{ action: "insert", id: "b9" }], undoOperations: null }]);
    await expect(client(f).appendBlock("b1", "追加", "markdown")).resolves.toEqual({
      doOperations: [{ action: "insert", id: "b9" }],
      undoOperations: null,
    });
    expect(bodyOf(f)).toEqual({ parentID: "b1", data: "追加", dataType: "markdown" });
    expect(urlOf(f)).toBe("http://127.0.0.1:6806/api/block/appendBlock");
  });

  it("prependBlock 使用同一形状", async () => {
    const f = okFetch([{ doOperations: [{ action: "insert", id: "b8" }], undoOperations: null }]);
    await expect(client(f).prependBlock("b1", "前置", "markdown")).resolves.toEqual({
      doOperations: [{ action: "insert", id: "b8" }],
      undoOperations: null,
    });
    expect(bodyOf(f)).toEqual({ parentID: "b1", data: "前置", dataType: "markdown" });
  });

  it("insertBlock 只透传已提供锚点", async () => {
    const f = okFetch([{ doOperations: [], undoOperations: null }]);
    await client(f).insertBlock({ data: "x", dataType: "markdown", previousID: "b1" });
    expect(bodyOf(f)).toEqual({ data: "x", dataType: "markdown", previousID: "b1" });
    expect(urlOf(f)).toBe("http://127.0.0.1:6806/api/block/insertBlock");
  });

  it("updateBlock 发送 lockType", async () => {
    const f = okFetch([{ doOperations: [{ action: "update", id: "b1" }], undoOperations: null }]);
    await client(f).updateBlock("b1", "改后", "markdown", true);
    expect(bodyOf(f)).toEqual({ id: "b1", data: "改后", dataType: "markdown", lockType: true });
  });

  it("deleteBlock / moveBlock / setBlockAttrs / renameDocByID / moveDocsByID / removeDocByID 字段名正确", async () => {
    const f = okFetch([{ doOperations: [{ action: "delete", id: "b1" }], undoOperations: null }]);
    const cli = client(f);

    await cli.deleteBlock("b1");
    expect([urlOf(f, 0), bodyOf(f, 0)]).toEqual(["http://127.0.0.1:6806/api/block/deleteBlock", { id: "b1" }]);

    await cli.moveBlock("b1", { parentID: "b2" });
    expect([urlOf(f, 1), bodyOf(f, 1)]).toEqual([
      "http://127.0.0.1:6806/api/block/moveBlock",
      { id: "b1", parentID: "b2" },
    ]);

    await cli.moveBlock("b1", { previousID: "b3" });
    expect(bodyOf(f, 2)).toEqual({ id: "b1", previousID: "b3" });

    await cli.setBlockAttrs("b1", { "custom-a": "1" });
    expect([urlOf(f, 3), bodyOf(f, 3)]).toEqual([
      "http://127.0.0.1:6806/api/attr/setBlockAttrs",
      { id: "b1", attrs: { "custom-a": "1" } },
    ]);

    await cli.renameDocByID("d1", "新标题");
    expect([urlOf(f, 4), bodyOf(f, 4)]).toEqual([
      "http://127.0.0.1:6806/api/filetree/renameDocByID",
      { id: "d1", title: "新标题" },
    ]);

    await cli.moveDocsByID(["d1"], "d2");
    expect([urlOf(f, 5), bodyOf(f, 5)]).toEqual([
      "http://127.0.0.1:6806/api/filetree/moveDocsByID",
      { fromIDs: ["d1"], toID: "d2" },
    ]);

    await cli.removeDocByID("d1");
    expect([urlOf(f, 6), bodyOf(f, 6)]).toEqual([
      "http://127.0.0.1:6806/api/filetree/removeDocByID",
      { id: "d1" },
    ]);
  });

  it("getBlockHash 用只读 SQL 取 hash，未命中返回 undefined", async () => {
    const f = apiFetch([{ hash: "adbd55e" }]);
    await expect(client(f).getBlockHash("b1")).resolves.toBe("adbd55e");
    expect(bodyOf(f)).toEqual({ stmt: "SELECT hash FROM blocks WHERE id = 'b1'" });

    const miss = apiFetch([]);
    await expect(client(miss).getBlockHash("nope")).resolves.toBeUndefined();
  });

  it("getBlockHash 对单引号做转义，避免 SQL 注入式拼接", async () => {
    const f = apiFetch([]);
    await client(f).getBlockHash("a'b");
    expect(bodyOf(f)).toEqual({ stmt: "SELECT hash FROM blocks WHERE id = 'a''b'" });
  });
});
