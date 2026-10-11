import { describe, expect, it } from "vitest";
import type { SiYuanClient } from "../../src/core/client.ts";
import { findToolSpec, TOOL_SPECS } from "../../src/tools/definitions.ts";
import { toVcpCommand } from "../../src/tools/naming.ts";
import { callTool } from "../helpers/call-tool.ts";
import { captureError } from "../helpers/errors.ts";
import { fakeClient, type FakeCall } from "../helpers/fake-client.ts";

const WRITE_METHODS = [
  "createNotebook",
  "createDocWithMd",
  "appendBlock",
  "prependBlock",
  "insertBlock",
  "updateBlock",
  "deleteBlock",
  "moveBlock",
  "setBlockAttrs",
  "renameDocByID",
  "moveDocsByID",
  "removeDocByID",
];

const ADDITIVE = [
  "notebook_create",
  "doc_create",
  "daily_note_create",
  "block_append",
  "block_prepend",
  "block_insert",
  "block_attrs_set",
];

const DESTRUCTIVE = [
  "block_update",
  "block_delete",
  "block_move",
  "doc_rename",
  "doc_move",
  "doc_remove",
];

/**
 * 通过生产入口（dispatchTool）调用工具：参数校验与默认值填充由 coerceArgs 负责。
 * 直接调 spec.invoke 会绕过默认值（例如 dataType 默认 markdown），因此测试必须走这条路。
 */
const invoke = (name: string) => (client: SiYuanClient, args: Record<string, unknown>) =>
  callTool(name, args, client);

const writeCalls = (calls: FakeCall[]) => calls.filter((c) => WRITE_METHODS.includes(c.fn));

describe("写工具清单与风险级（ADR-0004）", () => {
  it("总数为 32，增量型 7 条、破坏型 6 条，名称正确", () => {
    expect(TOOL_SPECS).toHaveLength(32);
    expect(TOOL_SPECS.filter((s) => s.risk === "additive").map((s) => s.name)).toEqual(ADDITIVE);
    expect(TOOL_SPECS.filter((s) => s.risk === "destructive").map((s) => s.name)).toEqual(DESTRUCTIVE);
  });

  it("破坏型工具声明 confirm 参数：描述写明必须显式传 true，但 schema 层不拦（以便缺 confirm 时返回预览）", () => {
    for (const name of DESTRUCTIVE) {
      const confirm = findToolSpec(name)?.params.confirm;
      expect(confirm?.type).toBe("boolean");
      expect(confirm?.description).toContain("必须显式传 true");
      expect(confirm?.required).toBeUndefined();
    }
  });

  it("增量型工具不带 confirm 参数", () => {
    for (const name of ADDITIVE) {
      expect(findToolSpec(name)?.params.confirm).toBeUndefined();
    }
  });

  it("全部 30 条的 VCP 命令名互不冲突", () => {
    const commands = TOOL_SPECS.map((s) => toVcpCommand(s.name));
    expect(new Set(commands).size).toBe(commands.length);
  });
});

describe("增量型写工具", () => {
  it("notebook_create 返回新笔记本 id", async () => {
    const { client, calls } = fakeClient();
    const out = await invoke("notebook_create")(client, { name: "沙盒" });
    expect(out.text).toContain("nb9");
    expect(calls).toEqual([{ fn: "createNotebook", args: ["沙盒"] }]);
  });

  it("doc_create 透传 notebook/path/markdown 并回报新文档 ID", async () => {
    const { client, calls } = fakeClient();
    const out = await invoke("doc_create")(client, { notebook: "nb1", path: "/沙盒/甲", markdown: "# 甲" });
    expect(out.text).toContain("d9");
    expect(calls).toEqual([{ fn: "createDocWithMd", args: ["nb1", "/沙盒/甲", "# 甲"] }]);
  });

  it("block_append 回传 doOperations 作为证据（R6）", async () => {
    const { client } = fakeClient();
    const out = await invoke("block_append")(client, { parentID: "b1", data: "追加" });
    expect(out.text).toContain("insert");
    expect(out.text).toContain("b9");
  });

  it("block_prepend 走 prependBlock", async () => {
    const { client, calls } = fakeClient();
    await invoke("block_prepend")(client, { parentID: "b1", data: "前置" });
    expect(calls[0]).toEqual({ fn: "prependBlock", args: ["b1", "前置", "markdown"] });
  });

  it("block_insert 要求至少一个锚点", async () => {
    const { client } = fakeClient();
    await expect(invoke("block_insert")(client, { data: "x" })).rejects.toThrowError(/锚点|parentID|previousID|nextID/);
  });

  it("block_insert 透传锚点", async () => {
    const { client, calls } = fakeClient();
    await invoke("block_insert")(client, { data: "x", previousID: "b1" });
    expect(calls[0]).toEqual({
      fn: "insertBlock",
      args: [{ data: "x", dataType: "markdown", previousID: "b1" }],
    });
  });

  it("block_attrs_set 拒绝非 custom- 前缀（W8）且零调用", async () => {
    const { client, calls } = fakeClient();
    await expect(invoke("block_attrs_set")(client, { id: "b1", attrs: '{"color":"red"}' })).rejects.toThrowError(
      /custom-/,
    );
    expect(calls).toEqual([]);
  });

  it("block_attrs_set 接受 JSON 字符串并调用 setBlockAttrs", async () => {
    const { client, calls } = fakeClient();
    await invoke("block_attrs_set")(client, { id: "b1", attrs: '{"custom-a":"1"}' });
    expect(calls[0]).toEqual({ fn: "setBlockAttrs", args: ["b1", { "custom-a": "1" }] });
  });

  it("block_attrs_set 对非法 JSON 报错", async () => {
    const { client, calls } = fakeClient();
    await expect(invoke("block_attrs_set")(client, { id: "b1", attrs: "{oops" })).rejects.toThrowError(/JSON/);
    expect(calls).toEqual([]);
  });
});

describe("破坏型写工具的确认与保护（R1–R5）", () => {
  it("缺 confirm 时抛 SIYUAN_CONFIRM_REQUIRED、带预览，且零写调用", async () => {
    const { client, calls } = fakeClient();
    const err = await captureError(invoke("block_delete")(client, { id: "b1" }));
    expect(err.code).toBe("SIYUAN_CONFIRM_REQUIRED");
    expect(err.message).toContain("旧内容");
    expect(writeCalls(calls)).toEqual([]);
    expect(calls.map((c) => c.fn).sort()).toEqual(["getBlockKramdown", "getChildBlocks"]);
  });

  it("dryRun: true 时只预览不写", async () => {
    const { client, calls } = fakeClient();
    const out = await invoke("block_delete")(client, { id: "b1", confirm: true, dryRun: true });
    expect(out.text).toContain("预览");
    expect(writeCalls(calls)).toEqual([]);
  });

  it("confirm: true 时真正执行并回传操作证据", async () => {
    const { client, calls } = fakeClient();
    const out = await invoke("block_delete")(client, { id: "b1", confirm: true });
    expect(out.text).toContain("delete");
    expect(calls.filter((c) => c.fn === "deleteBlock")).toHaveLength(1);
  });

  it("block_update 默认 lockType: true（W5）", async () => {
    const { client, calls } = fakeClient();
    await invoke("block_update")(client, { id: "b1", data: "新内容", confirm: true });
    const call = calls.find((c) => c.fn === "updateBlock");
    expect(call?.args).toEqual(["b1", "新内容", "markdown", true]);
  });

  it("expectedHash 不一致时抛 SIYUAN_STALE_TARGET 且不写", async () => {
    const { client, calls } = fakeClient();
    const err = await captureError(
      invoke("block_delete")(client, { id: "b1", confirm: true, expectedHash: "oldhash" }),
    );
    expect(err.code).toBe("SIYUAN_STALE_TARGET");
    expect(writeCalls(calls)).toEqual([]);
  });

  it("expectedHash 一致时放行", async () => {
    const { client, calls } = fakeClient();
    await invoke("block_delete")(client, { id: "b1", confirm: true, expectedHash: "curhash" });
    expect(calls.filter((c) => c.fn === "deleteBlock")).toHaveLength(1);
  });

  it("block_move 要求至少一个锚点", async () => {
    const { client } = fakeClient();
    await expect(invoke("block_move")(client, { id: "b1", confirm: true })).rejects.toThrowError(/锚点|parentID|previousID/);
  });

  it("block_move 带锚点时可执行", async () => {
    const { client, calls } = fakeClient();
    await invoke("block_move")(client, { id: "b1", confirm: true, parentID: "b2" });
    expect(calls.find((c) => c.fn === "moveBlock")?.args).toEqual(["b1", { parentID: "b2" }]);
  });

  it("doc_rename 预览文档信息后执行", async () => {
    const { client, calls } = fakeClient();
    const out = await invoke("doc_rename")(client, { id: "d1", title: "新标题", confirm: true });
    expect(out.text).toContain("新标题");
    expect(calls.find((c) => c.fn === "renameDocByID")?.args).toEqual(["d1", "新标题"]);
  });

  it("doc_move 解析逗号分隔的 fromIDs", async () => {
    const { client, calls } = fakeClient();
    await invoke("doc_move")(client, { fromIDs: "d1, d2", toID: "d3", confirm: true });
    expect(calls.find((c) => c.fn === "moveDocsByID")?.args).toEqual([["d1", "d2"], "d3"]);
  });

  it("doc_remove 在目标不存在时拒绝执行", async () => {
    const { client } = fakeClient({
      getHPathByID: async () => {
        throw new Error("nf");
      },
    });
    const err = await captureError(invoke("doc_remove")(client, { id: "d9", confirm: true }));
    expect(["SIYUAN_NOT_FOUND", "SIYUAN_STALE_TARGET"]).toContain(err.code);
  });

  it("doc_remove 正常执行并提示数据历史可回滚（W2）", async () => {
    const { client, calls } = fakeClient();
    const out = await invoke("doc_remove")(client, { id: "d1", confirm: true });
    expect(out.text).toContain("数据历史");
    expect(calls.filter((c) => c.fn === "removeDocByID")).toHaveLength(1);
  });
});
