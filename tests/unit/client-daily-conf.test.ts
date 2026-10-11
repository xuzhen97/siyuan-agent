import { describe, expect, it } from "vitest";
import { SiYuanClient } from "../../src/core/client.ts";
import { DEFAULT_CONFIG } from "../../src/core/config.ts";
import { bodyOf, okFetch, urlOf } from "../helpers/fake-fetch.ts";

const client = (f: Parameters<typeof bodyOf>[0]) => new SiYuanClient(DEFAULT_CONFIG, { fetch: f as never });

/**
 * 两个补充端点（对齐参考实现 CLI-Anything/siyuan）。
 * 期望形状来自实测/内核源码，不是假设：
 *  - getNotebookConf → data = { box, name, conf: {...} }（官方 API 文档 + 本机实测）
 *  - createDailyNote → data = { id }（kernel/api/filetree.go:createDailyNote；日记已存在时返回既有文档 ID）
 */
describe("notebook_conf_get 的客户端契约", () => {
  it("以 notebook 传参并返回 box/name/conf", async () => {
    const f = okFetch({
      box: "nb1",
      name: "N",
      conf: { name: "N", closed: false, dailyNoteSavePath: "/daily note/{{now | date \"2006/01\"}}" },
    });
    const conf = await client(f).getNotebookConf("nb1");
    expect(conf.box).toBe("nb1");
    expect(conf.name).toBe("N");
    expect(conf.conf.dailyNoteSavePath).toContain("/daily note/");
    expect(urlOf(f)).toBe("http://127.0.0.1:6806/api/notebook/getNotebookConf");
    expect(bodyOf(f)).toEqual({ notebook: "nb1" });
  });

  it("conf 缺失时回退为空对象，不抛异常", async () => {
    const f = okFetch({ box: "nb1", name: "N" });
    await expect(client(f).getNotebookConf("nb1")).resolves.toEqual({ box: "nb1", name: "N", conf: {} });
  });
});

describe("daily_note_create 的客户端契约", () => {
  it("以 notebook 传参并返回新日记文档 ID", async () => {
    const f = okFetch({ id: "20261011120000-daily01" });
    await expect(client(f).createDailyNote("nb1")).resolves.toBe("20261011120000-daily01");
    expect(urlOf(f)).toBe("http://127.0.0.1:6806/api/filetree/createDailyNote");
    expect(bodyOf(f)).toEqual({ notebook: "nb1" });
  });

  it("可选 app 参数仅在提供时发送（内核用它决定是否广播事件）", async () => {
    const f = okFetch({ id: "d1" });
    await client(f).createDailyNote("nb1", "siyuan-agent");
    expect(bodyOf(f)).toEqual({ notebook: "nb1", app: "siyuan-agent" });

    const f2 = okFetch({ id: "d1" });
    await client(f2).createDailyNote("nb1");
    expect(bodyOf(f2)).toEqual({ notebook: "nb1" });
  });

  it("缺 id 时返回空字符串（不让 undefined 泄漏给 Agent）", async () => {
    const f = okFetch({});
    await expect(client(f).createDailyNote("nb1")).resolves.toBe("");
  });
});
