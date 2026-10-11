import { describe, expect, it, vi } from "vitest";
import { findToolSpec } from "../../src/tools/definitions.ts";
import { callTool } from "../helpers/call-tool.ts";
import { captureError } from "../helpers/errors.ts";
import { fakeClient } from "../helpers/fake-client.ts";

const called = (calls: Array<{ fn: string }>, fn: string) => calls.filter((call) => call.fn === fn).length;

describe("增量型补充工具", () => {
  it("notebook_open / notebook_close 调用对应方法", async () => {
    const { client, calls } = fakeClient();
    await callTool("notebook_open", { notebook: "nb1" }, client);
    expect(called(calls, "openNotebook")).toBe(1);
    await callTool("notebook_close", { notebook: "nb1" }, client);
    expect(called(calls, "closeNotebook")).toBe(1);
  });

  it("export_resources 解析路径列表并返回 zip 路径", async () => {
    const { client, calls } = fakeClient();
    const result = await callTool("export_resources", { paths: '["/a","/b"]', name: "pack" }, client);
    expect(result.text).toContain("temp/export/x.zip");
    expect(calls.find((call) => call.fn === "exportResources")?.args).toEqual([["/a", "/b"], "pack"]);
  });

  it("export_resources 也接受逗号分隔，且拒绝空列表", async () => {
    const { client, calls } = fakeClient();
    await callTool("export_resources", { paths: "/a, /b" }, client);
    expect(calls.find((call) => call.fn === "exportResources")?.args).toEqual([["/a", "/b"], undefined]);

    await expect(callTool("export_resources", { paths: "  " }, client)).rejects.toThrowError(/paths 不能为空/);
  });

  it("block_fold / block_unfold 调用对应方法", async () => {
    const { client, calls } = fakeClient();
    await callTool("block_fold", { id: "b1" }, client);
    expect(called(calls, "foldBlock")).toBe(1);
    await callTool("block_unfold", { id: "b1" }, client);
    expect(called(calls, "unfoldBlock")).toBe(1);
  });
});

describe("notebook_remove：双确认（R1 + R9）", () => {
  it("缺 confirm 时只返回预览（含文档数），且不写", async () => {
    const { client, calls } = fakeClient();
    const err = await captureError(callTool("notebook_remove", { notebook: "nb1", confirmName: "沙盒" }, client));
    expect(err.code).toBe("SIYUAN_CONFIRM_REQUIRED");
    expect(err.message).toContain("文档数：");
    expect(called(calls, "removeNotebook")).toBe(0);
  });

  it("confirm 通过但 confirmName 不一致时抛 SIYUAN_CONFIRM_MISMATCH，且不写", async () => {
    const { client, calls } = fakeClient();
    const err = await captureError(
      callTool("notebook_remove", { notebook: "nb1", confirm: true, confirmName: "写错的名字" }, client),
    );
    expect(err.code).toBe("SIYUAN_CONFIRM_MISMATCH");
    expect(err.hint).toContain("沙盒");
    expect(called(calls, "removeNotebook")).toBe(0);
  });

  it("confirm + 名称逐字一致时才真正删除", async () => {
    const { client, calls } = fakeClient();
    const result = await callTool("notebook_remove", { notebook: "nb1", confirm: true, confirmName: "沙盒" }, client);
    expect(result.text).toContain("已删除笔记本「沙盒」");
    expect(called(calls, "removeNotebook")).toBe(1);
  });

  it("dryRun 只预览，即使 confirmName 正确也不写", async () => {
    const { client, calls } = fakeClient();
    const result = await callTool(
      "notebook_remove",
      { notebook: "nb1", confirm: true, confirmName: "沙盒", dryRun: true },
      client,
    );
    expect(result.text).toContain("预览");
    expect(called(calls, "removeNotebook")).toBe(0);
  });

  it("目标不存在时拒绝（即使 confirm/confirmName 都对）", async () => {
    const { client, calls } = fakeClient({
      getNotebookConf: vi.fn(async () => {
        throw new Error("nf");
      }),
    });
    const err = await captureError(
      callTool("notebook_remove", { notebook: "nope", confirm: true, confirmName: "沙盒" }, client),
    );
    expect(err.code).toBe("SIYUAN_NOT_FOUND");
    expect(called(calls, "removeNotebook")).toBe(0);
  });
});

describe("find_replace：必须限定 ids（R10）", () => {
  it("缺 ids / 空 ids 时拒绝且不写", async () => {
    const { client, calls } = fakeClient();
    for (const ids of ["", "[]"]) {
      const err = await captureError(
        callTool("find_replace", { k: "旧", r: "新", ids, confirm: true }, client),
      );
      // 空字符串会被 coerceArgs 视为未提供（缺少必填参数），"[]" 会命中 R10
      expect(["SIYUAN_API_ERROR"]).toContain(err.code);
    }
    expect(called(calls, "findReplace")).toBe(0);
  });

  it("缺 confirm 时只返回预览（含目标块数），且不写", async () => {
    const { client, calls } = fakeClient();
    const err = await captureError(
      callTool("find_replace", { k: "旧", r: "新", ids: ["b1", "b2"] }, client),
    );
    expect(err.code).toBe("SIYUAN_CONFIRM_REQUIRED");
    expect(err.message).toContain("2 个块");
    expect(called(calls, "findReplace")).toBe(0);
  });

  it("confirm 后执行，并把替换类型透传", async () => {
    const { client, calls } = fakeClient();
    await callTool(
      "find_replace",
      { k: "旧", r: "新", ids: "b1, b2", replaceTypes: '{"text":true}', confirm: true },
      client,
    );
    expect(calls.find((call) => call.fn === "findReplace")?.args).toEqual(["旧", "新", ["b1", "b2"], { text: true }]);
  });

  it("不传 replaceTypes 时默认只替换普通文本（内核按类型 opt-in，不传等于什么都不替换）", async () => {
    const { client, calls } = fakeClient();
    const result = await callTool("find_replace", { k: "旧", r: "新", ids: ["b1"], confirm: true }, client);
    expect(calls.find((call) => call.fn === "findReplace")?.args).toEqual(["旧", "新", ["b1"], { text: true }]);
    expect(result.text).toContain("普通文本");
  });

  it('传 {"all":true} 时展开为全部类型', async () => {
    const { client, calls } = fakeClient();
    await callTool(
      "find_replace",
      { k: "旧", r: "新", ids: ["b1"], replaceTypes: '{"all":true}', confirm: true },
      client,
    );
    const types = calls.find((call) => call.fn === "findReplace")?.args[3] as Record<string, boolean>;
    expect(Object.keys(types)).toHaveLength(25);
    expect(types.text).toBe(true);
    expect(types.codeBlock).toBe(true);
  });

  it("replaceTypes 是非法 JSON 时报错且不写", async () => {
    const { client, calls } = fakeClient();
    await expect(
      callTool("find_replace", { k: "旧", r: "新", ids: ["b1"], replaceTypes: "{oops", confirm: true }, client),
    ).rejects.toThrowError(/JSON/);
    expect(called(calls, "findReplace")).toBe(0);
  });

  it("r 为空时拒绝（不提供删除式替换，避免误删文本）", async () => {
    const { client, calls } = fakeClient();
    await expect(callTool("find_replace", { k: "旧", r: "", ids: ["b1"], confirm: true }, client)).rejects.toThrowError(
      /r/,
    );
    expect(called(calls, "findReplace")).toBe(0);
  });
});

describe("笔记本元数据写入：绝不静默覆盖", () => {
  it("notebook_rename / notebook_icon_set / notebook_conf_set 都要求 confirm", async () => {
    const { client, calls } = fakeClient();
    for (const [name, args] of [
      ["notebook_rename", { notebook: "nb1", name: "新名" }],
      ["notebook_icon_set", { notebook: "nb1", icon: "1f4d6" }],
      ["notebook_conf_set", { notebook: "nb1", conf: '{"dailyNoteSavePath":"/x"}' }],
    ] as Array<[string, Record<string, unknown>]>) {
      const err = await captureError(callTool(name, args, client));
      expect(err.code).toBe("SIYUAN_CONFIRM_REQUIRED");
    }
    expect(calls.filter((call) => ["renameNotebook", "setNotebookIcon", "setNotebookConf"].includes(call.fn))).toEqual([]);
  });

  it("confirm 后分别调用对应方法", async () => {
    const { client, calls } = fakeClient();
    await callTool("notebook_rename", { notebook: "nb1", name: "新名", confirm: true }, client);
    expect(calls.find((call) => call.fn === "renameNotebook")?.args).toEqual(["nb1", "新名"]);

    await callTool("notebook_icon_set", { notebook: "nb1", icon: "1f4d6", confirm: true }, client);
    expect(calls.find((call) => call.fn === "setNotebookIcon")?.args).toEqual(["nb1", "1f4d6"]);

    await callTool("notebook_conf_set", { notebook: "nb1", conf: '{"dailyNoteSavePath":"/x"}', confirm: true }, client);
    expect(calls.find((call) => call.fn === "setNotebookConf")?.args).toEqual(["nb1", { dailyNoteSavePath: "/x" }]);
  });

  it("notebook_conf_set 的 conf 非法 JSON 时报错且不写", async () => {
    const { client, calls } = fakeClient();
    await expect(
      callTool("notebook_conf_set", { notebook: "nb1", conf: "{oops", confirm: true }, client),
    ).rejects.toThrowError(/JSON/);
    expect(called(calls, "setNotebookConf")).toBe(0);
  });
});

describe("按路径的文档操作", () => {
  it("doc_rename_by_path 要求 confirm，且预览里带解析出的文档 ID", async () => {
    const { client, calls } = fakeClient();
    const err = await captureError(
      callTool("doc_rename_by_path", { notebook: "nb1", path: "/a.sy", title: "新标题" }, client),
    );
    expect(err.code).toBe("SIYUAN_CONFIRM_REQUIRED");
    expect(err.message).toContain("d1");
    expect(called(calls, "renameDoc")).toBe(0);

    await callTool("doc_rename_by_path", { notebook: "nb1", path: "/a.sy", title: "新标题", confirm: true }, client);
    expect(calls.find((call) => call.fn === "renameDoc")?.args).toEqual(["nb1", "/a.sy", "新标题"]);
  });

  it("doc_remove_by_path confirm 后调用 removeDoc 并提示数据历史", async () => {
    const { client, calls } = fakeClient();
    const result = await callTool("doc_remove_by_path", { notebook: "nb1", path: "/a.sy", confirm: true }, client);
    expect(result.text).toContain("数据历史");
    expect(calls.find((call) => call.fn === "removeDoc")?.args).toEqual(["nb1", "/a.sy"]);
  });

  it("doc_remove_by_path 在路径解析不到文档时拒绝执行", async () => {
    const { client, calls } = fakeClient({ getIDsByHPath: vi.fn(async () => []) });
    const err = await captureError(
      callTool("doc_remove_by_path", { notebook: "nb1", path: "/nope.sy", confirm: true }, client),
    );
    expect(err.code).toBe("SIYUAN_NOT_FOUND");
    expect(called(calls, "removeDoc")).toBe(0);
  });

  it("存储路径兜底：hpath 查不到时用父目录列表匹配（实测 doc_list 返回的是存储路径 /<docId>.sy）", async () => {
    const { client, calls } = fakeClient({
      getIDsByHPath: vi.fn(async () => []),
      listDocsByPath: vi.fn(async () => [{ id: "d-storage", path: "/d-storage.sy", name: "文档" }]),
    });
    await callTool("doc_remove_by_path", { notebook: "nb1", path: "/d-storage.sy", confirm: true }, client);
    expect(calls.find((call) => call.fn === "removeDoc")?.args).toEqual(["nb1", "/d-storage.sy"]);
  });

  it("子目录下的存储路径也能兜底（父目录取自路径本身）", async () => {
    const listStub = vi.fn(async () => [{ id: "d-sub", path: "/子目录/d-sub.sy", name: "子目录文档" }]);
    const { client } = fakeClient({ getIDsByHPath: vi.fn(async () => []), listDocsByPath: listStub });
    await callTool("doc_remove_by_path", { notebook: "nb1", path: "/子目录/d-sub.sy", confirm: true }, client);
    expect(listStub).toHaveBeenCalledWith("nb1", "/子目录");
  });

  it("两条路径都解析不到时仍然拒绝执行（不静默放行）", async () => {
    const { client, calls } = fakeClient({
      getIDsByHPath: vi.fn(async () => []),
      listDocsByPath: vi.fn(async () => []),
    });
    const err = await captureError(
      callTool("doc_rename_by_path", { notebook: "nb1", path: "/nope.sy", title: "x", confirm: true }, client),
    );
    expect(err.code).toBe("SIYUAN_NOT_FOUND");
    expect(called(calls, "renameDoc")).toBe(0);
  });

  it("doc_move_by_path 在目标目录不存在时给出可操作提示（内核只报晦涩的 OS 错误）", async () => {
    const { client, calls } = fakeClient({
      listDocsByPath: vi.fn(async () => {
        throw new Error("The system cannot find the file specified.");
      }),
    });
    const err = await captureError(
      callTool(
        "doc_move_by_path",
        { fromPaths: "/a.sy", toNotebook: "nb2", toPath: "/不存在", confirm: true },
        client,
      ),
    );
    expect(err.code).toBe("SIYUAN_NOT_FOUND");
    expect(err.hint).toContain("根目录用 /");
    expect(called(calls, "moveDocs")).toBe(0);
  });

  it("列表参数以 [ 开头但不是合法 JSON 时明确报错（不再静默退化为逗号切分）", async () => {
    const { client, calls } = fakeClient();
    await expect(callTool("export_resources", { paths: '["/a"' }, client)).rejects.toThrowError(/JSON 数组格式非法/);
    expect(called(calls, "exportResources")).toBe(0);
  });

  it("doc_move_by_path 要求 confirm 且 fromPaths 非空", async () => {
    const { client, calls } = fakeClient();
    await expect(
      callTool("doc_move_by_path", { fromPaths: "  ", toNotebook: "nb2", toPath: "/x", confirm: true }, client),
    ).rejects.toThrowError(/fromPaths 不能为空/);

    await callTool(
      "doc_move_by_path",
      { fromPaths: "/a.sy,/b.sy", toNotebook: "nb2", toPath: "/x", confirm: true },
      client,
    );
    expect(calls.find((call) => call.fn === "moveDocs")?.args).toEqual([["/a.sy", "/b.sy"], "nb2", "/x"]);
  });
});

describe("清单完整性", () => {
  it("这 13 条工具都已在真源中注册", () => {
    const names = [
      "notebook_open",
      "notebook_close",
      "export_resources",
      "block_fold",
      "block_unfold",
      "doc_rename_by_path",
      "doc_remove_by_path",
      "doc_move_by_path",
      "notebook_rename",
      "notebook_icon_set",
      "notebook_conf_set",
      "notebook_remove",
      "find_replace",
    ];
    for (const name of names) expect(findToolSpec(name)).toBeTruthy();
  });
});
