import { vi } from "vitest";
import type { SiYuanClient } from "../../src/core/client.ts";

export type FakeCall = { fn: string; args: unknown[] };
export type FakeClient = { client: SiYuanClient; calls: FakeCall[] };

/**
 * 记录调用的假客户端（只读 + 写全套方法），供工具层测试断言「调了哪个方法、带什么参数」。
 * 写方法的默认返回值都带 doOperations，便于断言 R6（回传实际发生的动作）。
 */
export function fakeClient(overrides: Record<string, unknown> = {}): FakeClient {
  const calls: FakeCall[] = [];
  const rec = (fn: string, ret: unknown) =>
    vi.fn(async (...args: unknown[]) => {
      calls.push({ fn, args });
      return ret;
    });

  const client = {
    config: { host: "127.0.0.1", port: 6806, token: "", timeoutMs: 30000 },
    // 只读
    version: rec("version", "3.8.6"),
    currentTime: rec("currentTime", 1_700_000_000_000),
    ping: rec("ping", true),
    listNotebooks: rec("listNotebooks", [{ id: "nb1", name: "N", closed: false }]),
    getNotebookInfo: rec("getNotebookInfo", { name: "N" }),
    listDocsByPath: rec("listDocsByPath", [{ id: "d1", name: "A" }]),
    listDocTree: rec("listDocTree", [{ id: "d1", name: "A" }]),
    getPathByID: rec("getPathByID", { notebook: "nb1", path: "/x.sy" }),
    getHPathByID: rec("getHPathByID", "/沙盒/甲"),
    getIDsByHPath: rec("getIDsByHPath", ["d1"]),
    exportMdContent: rec("exportMdContent", { hPath: "/甲", content: "# 甲" }),
    getBlockKramdown: rec("getBlockKramdown", { id: "b1", kramdown: "旧内容" }),
    getChildBlocks: rec("getChildBlocks", [{ id: "c1" }, { id: "c2" }]),
    getBlockAttrs: rec("getBlockAttrs", { "custom-a": "1" }),
    fullTextSearchBlock: rec("fullTextSearchBlock", { blocks: [{ id: "b1" }], matchedBlockCount: 1 }),
    searchDocs: rec("searchDocs", [{ id: "d1", hPath: "/甲" }]),
    searchTag: rec("searchTag", ["#a#"]),
    getTag: rec("getTag", [{ name: "#a#", count: 1 }]),
    querySql: rec("querySql", { rows: [{ id: "b1" }], limit: 64, truncated: true }),
    getBlockHash: rec("getBlockHash", "curhash"),
    // 写
    createNotebook: rec("createNotebook", { id: "nb9", name: "沙盒" }),
    createDocWithMd: rec("createDocWithMd", "d9"),
    appendBlock: rec("appendBlock", { doOperations: [{ action: "insert", id: "b9" }], undoOperations: null }),
    prependBlock: rec("prependBlock", { doOperations: [{ action: "insert", id: "b8" }], undoOperations: null }),
    insertBlock: rec("insertBlock", { doOperations: [{ action: "insert", id: "b7" }], undoOperations: null }),
    updateBlock: rec("updateBlock", {
      doOperations: [{ action: "update", id: "b1" }],
      undoOperations: { action: "update" },
    }),
    deleteBlock: rec("deleteBlock", { doOperations: [{ action: "delete", id: "b1" }], undoOperations: null }),
    moveBlock: rec("moveBlock", { doOperations: [{ action: "move", id: "b1" }], undoOperations: null }),
    setBlockAttrs: rec("setBlockAttrs", undefined),
    renameDocByID: rec("renameDocByID", undefined),
    moveDocsByID: rec("moveDocsByID", undefined),
    removeDocByID: rec("removeDocByID", undefined),
    ...overrides,
  };

  return { client: client as unknown as SiYuanClient, calls };
}
