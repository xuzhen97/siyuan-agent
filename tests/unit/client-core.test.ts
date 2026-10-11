import { describe, expect, it, vi } from "vitest";
import { SiYuanClient } from "../../src/core/client.ts";
import { SiYuanError, describeError } from "../../src/core/errors.ts";
import { captureError } from "../helpers/errors.ts";
import { DEFAULT_CONFIG } from "../../src/core/config.ts";
import { bodyOf, failingFetch, initOf, okFetch, rawFetch, urlOf } from "../helpers/fake-fetch.ts";

const cfg = { ...DEFAULT_CONFIG, token: "tok-1" };

describe("SiYuanClient.call", () => {
  it("POST 到 <base><endpoint> 并带 Token 头与 JSON Content-Type", async () => {
    const fetchImpl = okFetch("3.8.6");
    const client = new SiYuanClient(cfg, { fetch: fetchImpl });
    await expect(client.version()).resolves.toBe("3.8.6");

    expect(urlOf(fetchImpl)).toBe("http://127.0.0.1:6806/api/system/version");
    const init = initOf(fetchImpl);
    expect(init.method).toBe("POST");
    expect(init.headers["Content-Type"]).toBe("application/json");
    expect(init.headers.Authorization).toBe("Token tok-1");
    expect(init.body).toBe("{}");
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("无 Token 时不发送 Authorization 头", async () => {
    const fetchImpl = okFetch(1);
    await new SiYuanClient({ ...cfg, token: "" }, { fetch: fetchImpl }).currentTime();
    expect(initOf(fetchImpl).headers.Authorization).toBeUndefined();
  });

  it("连接失败映射为 SIYUAN_UNREACHABLE 并给可操作提示", async () => {
    const fetchImpl = failingFetch(new TypeError("fetch failed"));
    const err = await captureError(new SiYuanClient(cfg, { fetch: fetchImpl }).version());
    expect(err).toBeInstanceOf(SiYuanError);
    expect(err.code).toBe("SIYUAN_UNREACHABLE");
    expect(err.hint).toContain("127.0.0.1:6806");
  });

  it("AbortError / 超时映射为 SIYUAN_TIMEOUT", async () => {
    const fetchImpl = failingFetch(Object.assign(new Error("aborted"), { name: "AbortError" }));
    const err = await captureError(new SiYuanClient(cfg, { fetch: fetchImpl }).version());
    expect(err.code).toBe("SIYUAN_TIMEOUT");
  });

  it("401/403 映射为 SIYUAN_AUTH", async () => {
    const err = await captureError(
      new SiYuanClient(cfg, { fetch: rawFetch({ code: -1, msg: "unauthorized" }, 401) }).version(),
    );
    expect(err.code).toBe("SIYUAN_AUTH");
  });

  it("其它非 200 映射为 SIYUAN_HTTP_<status>", async () => {
    const err = await captureError(new SiYuanClient(cfg, { fetch: rawFetch({}, 500) }).version());
    expect(err.code).toBe("SIYUAN_HTTP_500");
  });

  it("code != 0 映射为 SIYUAN_API_ERROR 并保留内核 msg", async () => {
    const err = await captureError(
      new SiYuanClient(cfg, { fetch: rawFetch({ code: 1, msg: "no such table: x" }) }).call("/api/query/sql", {
        stmt: "SELECT 1",
      }),
    );
    expect(err.code).toBe("SIYUAN_API_ERROR");
    expect(err.message).toContain("no such table: x");
  });

  it("非 JSON 响应体映射为 SIYUAN_API_ERROR 而不是抛原生 SyntaxError", async () => {
    const err = await captureError(new SiYuanClient(cfg, { fetch: rawFetch("<html>500</html>", 200) }).version());
    expect(err.code).toBe("SIYUAN_API_ERROR");
  });

  it("ping 在不可达时返回 false 而不抛异常", async () => {
    const fetchImpl = failingFetch(new TypeError("fetch failed"));
    await expect(new SiYuanClient(cfg, { fetch: fetchImpl }).ping()).resolves.toBe(false);
  });

  it("listNotebooks 取 data.notebooks", async () => {
    const fetchImpl = okFetch({ notebooks: [{ id: "nb1", name: "N", closed: false }] });
    await expect(new SiYuanClient(cfg, { fetch: fetchImpl }).listNotebooks()).resolves.toEqual([
      { id: "nb1", name: "N", closed: false },
    ]);
    expect(urlOf(fetchImpl)).toBe("http://127.0.0.1:6806/api/notebook/lsNotebooks");
  });

  it("listNotebooks 对缺失 notebooks 字段返回空数组", async () => {
    const fetchImpl = okFetch({});
    await expect(new SiYuanClient(cfg, { fetch: fetchImpl }).listNotebooks()).resolves.toEqual([]);
  });

  it("getNotebookInfo 以 notebook 字段传参，并解包 data.boxInfo", async () => {
    const fetchImpl = okFetch({ boxInfo: { name: "N" } });
    await expect(new SiYuanClient(cfg, { fetch: fetchImpl }).getNotebookInfo("nb1")).resolves.toEqual({
      name: "N",
    });
    expect(bodyOf(fetchImpl)).toEqual({ notebook: "nb1" });
  });

  it("describeError 对非 SiYuanError 也能给出可读结果", () => {
    expect(describeError(new Error("boom")).message).toBe("boom");
    const d = describeError(new SiYuanError("SIYUAN_NOT_FOUND", "文档不存在", { hint: "检查 id" }));
    expect(d).toEqual({ code: "SIYUAN_NOT_FOUND", message: "文档不存在", hint: "检查 id" });
  });

  it("describeError 对非 Error 值也能给出字符串消息", () => {
    expect(describeError("崩了").message).toBe("崩了");
  });

  it("fetch 未被注入时使用全局 fetch", () => {
    const spy = vi.spyOn(globalThis, "fetch");
    expect(() => new SiYuanClient(cfg)).not.toThrow();
    spy.mockRestore();
  });
});
