import { describe, expect, it } from "vitest";
import { SiYuanClient } from "../../src/core/client.ts";
import { DEFAULT_CONFIG } from "../../src/core/config.ts";
import { bodyOf, okFetch, urlOf } from "../helpers/fake-fetch.ts";

const client = (f: Parameters<typeof bodyOf>[0]) => new SiYuanClient(DEFAULT_CONFIG, { fetch: f as never });

/**
 * 对齐参考实现时补齐的 13 个端点的请求形状。
 * 契约来源：官方 API 文档（openNotebook/closeNotebook/removeNotebook/renameNotebook/setNotebookConf/
 * exportResources/foldBlock/unfoldBlock/renameDoc/removeDoc/moveDocs）+ 内核源码（setNotebookIcon、findReplace）。
 */
describe("笔记本级写方法", () => {
  it("openNotebook / closeNotebook / removeNotebook 只传 notebook", async () => {
    const f = okFetch(null);
    const c = client(f);

    await c.openNotebook("nb1");
    expect([urlOf(f, 0), bodyOf(f, 0)]).toEqual(["http://127.0.0.1:6806/api/notebook/openNotebook", { notebook: "nb1" }]);

    await c.closeNotebook("nb1");
    expect([urlOf(f, 1), bodyOf(f, 1)]).toEqual([
      "http://127.0.0.1:6806/api/notebook/closeNotebook",
      { notebook: "nb1" },
    ]);

    await c.removeNotebook("nb1");
    expect([urlOf(f, 2), bodyOf(f, 2)]).toEqual([
      "http://127.0.0.1:6806/api/notebook/removeNotebook",
      { notebook: "nb1" },
    ]);
  });

  it("renameNotebook 传 notebook + name", async () => {
    const f = okFetch(null);
    await client(f).renameNotebook("nb1", "新名字");
    expect(bodyOf(f)).toEqual({ notebook: "nb1", name: "新名字" });
  });

  it("setNotebookIcon 传 notebook + icon（内核源码：icon 非必填）", async () => {
    const f = okFetch(null);
    await client(f).setNotebookIcon("nb1", "1f4d6");
    expect([urlOf(f), bodyOf(f)]).toEqual([
      "http://127.0.0.1:6806/api/notebook/setNotebookIcon",
      { notebook: "nb1", icon: "1f4d6" },
    ]);
  });

  it("setNotebookConf 传 notebook + conf，并返回内核回显的 conf", async () => {
    const f = okFetch({ name: "N", closed: false, dailyNoteSavePath: "/daily note/x" });
    const conf = await client(f).setNotebookConf("nb1", { dailyNoteSavePath: "/daily note/x" });
    expect(bodyOf(f)).toEqual({ notebook: "nb1", conf: { dailyNoteSavePath: "/daily note/x" } });
    expect(conf.dailyNoteSavePath).toBe("/daily note/x");
  });
});

describe("导出与折叠", () => {
  it("exportResources 传 paths（可选 name），返回 zip 路径", async () => {
    const f = okFetch({ path: "temp/export/zip-file-name.zip" });
    await expect(client(f).exportResources(["/conf/appearance/boot"], "zip-file-name")).resolves.toBe(
      "temp/export/zip-file-name.zip",
    );
    expect(bodyOf(f)).toEqual({ paths: ["/conf/appearance/boot"], name: "zip-file-name" });

    const f2 = okFetch({});
    await expect(client(f2).exportResources(["/a"])).resolves.toBe("");
    expect(bodyOf(f2)).toEqual({ paths: ["/a"] });
  });

  it("foldBlock / unfoldBlock 传 id", async () => {
    const f = okFetch(null);
    const c = client(f);
    await c.foldBlock("b1");
    expect([urlOf(f, 0), bodyOf(f, 0)]).toEqual(["http://127.0.0.1:6806/api/block/foldBlock", { id: "b1" }]);
    await c.unfoldBlock("b1");
    expect([urlOf(f, 1), bodyOf(f, 1)]).toEqual(["http://127.0.0.1:6806/api/block/unfoldBlock", { id: "b1" }]);
  });
});

describe("按路径的文档操作与批量替换", () => {
  it("renameDoc 传 notebook + path + title", async () => {
    const f = okFetch(null);
    await client(f).renameDoc("nb1", "/a.sy", "新标题");
    expect(bodyOf(f)).toEqual({ notebook: "nb1", path: "/a.sy", title: "新标题" });
  });

  it("removeDoc 传 notebook + path", async () => {
    const f = okFetch(null);
    await client(f).removeDoc("nb1", "/a.sy");
    expect(bodyOf(f)).toEqual({ notebook: "nb1", path: "/a.sy" });
  });

  it("moveDocs 传 fromPaths + toNotebook + toPath", async () => {
    const f = okFetch(null);
    await client(f).moveDocs(["/a.sy", "/b.sy"], "nb2", "/dest");
    expect(bodyOf(f)).toEqual({ fromPaths: ["/a.sy", "/b.sy"], toNotebook: "nb2", toPath: "/dest" });
  });

  it("findReplace 传 k + r + ids，可选 replaceTypes 仅在提供时发送", async () => {
    const f = okFetch(null);
    await client(f).findReplace("旧", "新", ["b1", "b2"]);
    expect([urlOf(f), bodyOf(f)]).toEqual([
      "http://127.0.0.1:6806/api/search/findReplace",
      { k: "旧", r: "新", ids: ["b1", "b2"] },
    ]);

    const f2 = okFetch(null);
    await client(f2).findReplace("旧", "新", ["b1"], { text: true });
    expect(bodyOf(f2)).toEqual({ k: "旧", r: "新", ids: ["b1"], replaceTypes: { text: true } });
  });
});
