import { describe, expect, it } from "vitest";
import { configFilePath, resolveSiYuanConfig, DEFAULT_CONFIG } from "../../src/core/config.ts";

const noFile = {
  readFileSync: () => {
    throw new Error("ENOENT");
  },
  homeDir: "C:/home/u",
};

describe("resolveSiYuanConfig", () => {
  it("无任何来源时返回默认值", () => {
    expect(resolveSiYuanConfig(undefined, { env: {}, ...noFile })).toEqual(DEFAULT_CONFIG);
  });

  it("环境变量覆盖文件", () => {
    const cfg = resolveSiYuanConfig(undefined, {
      env: { SIYUAN_HOST: "10.0.0.2", SIYUAN_PORT: "7000", SIYUAN_TOKEN: "tok-env" },
      readFileSync: () => JSON.stringify({ host: "1.1.1.1", port: 1111, token: "tok-file" }),
      homeDir: "C:/home/u",
    });
    expect(cfg).toEqual({ host: "10.0.0.2", port: 7000, token: "tok-env", timeoutMs: 30000 });
  });

  it("显式参数优先于环境变量与文件", () => {
    const cfg = resolveSiYuanConfig(
      { host: "127.0.0.9", port: 9999, token: "tok-arg" },
      { env: { SIYUAN_HOST: "10.0.0.2", SIYUAN_PORT: "7000", SIYUAN_TOKEN: "tok-env" }, ...noFile },
    );
    expect(cfg).toEqual({ host: "127.0.0.9", port: 9999, token: "tok-arg", timeoutMs: 30000 });
  });

  it("配置文件可带 BOM", () => {
    const cfg = resolveSiYuanConfig(undefined, {
      env: {},
      readFileSync: () => "\uFEFF" + JSON.stringify({ host: "2.2.2.2", port: 2222, token: "t" }),
      homeDir: "C:/home/u",
    });
    expect(cfg.host).toBe("2.2.2.2");
    expect(cfg.port).toBe(2222);
  });

  it("非法 JSON 与非法端口回退到下一优先级，不抛异常", () => {
    expect(
      resolveSiYuanConfig(undefined, { env: {}, readFileSync: () => "{oops", homeDir: "C:/home/u" }),
    ).toEqual(DEFAULT_CONFIG);
    expect(resolveSiYuanConfig(undefined, { env: { SIYUAN_PORT: "abc" }, ...noFile }).port).toBe(6806);
    expect(
      resolveSiYuanConfig(undefined, {
        env: {},
        readFileSync: () => JSON.stringify({ port: -1 }),
        homeDir: "C:/home/u",
      }).port,
    ).toBe(6806);
  });

  it("configPath 覆盖默认路径", () => {
    const seen: string[] = [];
    resolveSiYuanConfig(
      { configPath: "D:/cfg/sy.json" },
      {
        env: {},
        readFileSync: (p) => {
          seen.push(p);
          return JSON.stringify({ token: "from-custom" });
        },
        homeDir: "C:/home/u",
      },
    );
    expect(seen).toEqual(["D:/cfg/sy.json"]);
  });

  it("configFilePath 指向家目录下的 .siyuan-agent/config.json", () => {
    expect(configFilePath("C:/home/u").replace(/\\/g, "/")).toBe("C:/home/u/.siyuan-agent/config.json");
  });
});
