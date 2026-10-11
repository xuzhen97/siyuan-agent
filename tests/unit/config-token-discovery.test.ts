import { describe, expect, it } from "vitest";
import { resolveSiYuanConfig } from "../../src/core/config.ts";

const HOME = "C:/home/u";
const WIN_CONF = "C:/home/u/SiYuan/conf/conf.json";
const NIX_CONF = "C:/home/u/.config/siyuan/conf/conf.json";

/** 构造一个只认特定路径的 readFileSync（其它路径抛 ENOENT，模拟未安装）。 */
function readerFor(files: Record<string, string>, onRead?: (path: string) => void) {
  return (path: string): string => {
    onRead?.(path);
    if (path in files) return files[path] as string;
    throw new Error(`ENOENT: ${path}`);
  };
}

const siyuanConf = (token: string) => JSON.stringify({ api: { token } });

describe("Token 自动发现（对齐参考实现 utils/siyuan_backend.py::get_api_token_from_conf）", () => {
  it("Windows 下从 ~/SiYuan/conf/conf.json 读取 api.token", () => {
    const cfg = resolveSiYuanConfig(undefined, {
      env: {},
      homeDir: HOME,
      platform: "win32",
      readFileSync: readerFor({ [WIN_CONF]: siyuanConf("tok-from-siyuan") }),
    });
    expect(cfg.token).toBe("tok-from-siyuan");
    expect(cfg.tokenSource).toBe("siyuan-conf");
  });

  it("非 Windows 下从 ~/.config/siyuan/conf/conf.json 读取", () => {
    const cfg = resolveSiYuanConfig(undefined, {
      env: {},
      homeDir: HOME,
      platform: "linux",
      readFileSync: readerFor({ [NIX_CONF]: siyuanConf("tok-nix") }),
    });
    expect(cfg.token).toBe("tok-nix");
    expect(cfg.tokenSource).toBe("siyuan-conf");
  });

  it("优先级：显式参数 > 环境变量 > 本项目配置文件 > 思源 conf.json", () => {
    const files = { [WIN_CONF]: siyuanConf("tok-siyuan"), [`${HOME}/.siyuan-agent/config.json`]: JSON.stringify({ token: "tok-file" }) };
    const deps = { homeDir: HOME, platform: "win32", readFileSync: readerFor(files) };

    expect(resolveSiYuanConfig({ token: "tok-arg" }, { ...deps, env: { SIYUAN_TOKEN: "tok-env" } }).tokenSource).toBe("arg");
    expect(resolveSiYuanConfig(undefined, { ...deps, env: { SIYUAN_TOKEN: "tok-env" } }).tokenSource).toBe("env");
    expect(resolveSiYuanConfig(undefined, { ...deps, env: {} }).tokenSource).toBe("config-file");
    expect(
      resolveSiYuanConfig(undefined, {
        homeDir: HOME,
        platform: "win32",
        env: {},
        readFileSync: readerFor({ [WIN_CONF]: siyuanConf("tok-siyuan") }),
      }).tokenSource,
    ).toBe("siyuan-conf");
  });

  it("思源 conf.json 存在但没有 token 时回退为 none，且不抛异常", () => {
    const cfg = resolveSiYuanConfig(undefined, {
      env: {},
      homeDir: HOME,
      platform: "win32",
      readFileSync: readerFor({ [WIN_CONF]: JSON.stringify({ api: {} }) }),
    });
    expect(cfg.token).toBe("");
    expect(cfg.tokenSource).toBe("none");
  });

  it("思源 conf.json 是损坏 JSON / 读取失败时静默回退", () => {
    const broken = resolveSiYuanConfig(undefined, {
      env: {},
      homeDir: HOME,
      platform: "win32",
      readFileSync: readerFor({ [WIN_CONF]: "{oops" }),
    });
    expect(broken.token).toBe("");
    expect(broken.tokenSource).toBe("none");

    const unreadable = resolveSiYuanConfig(undefined, {
      env: {},
      homeDir: HOME,
      platform: "win32",
      readFileSync: () => {
        throw new Error("EACCES");
      },
    });
    expect(unreadable.tokenSource).toBe("none");
  });

  it("已有更高优先级 token 时不读取思源 conf.json（不做无谓 IO）", () => {
    const readPaths: string[] = [];
    resolveSiYuanConfig(undefined, {
      env: { SIYUAN_TOKEN: "tok-env" },
      homeDir: HOME,
      platform: "win32",
      readFileSync: readerFor({ [WIN_CONF]: siyuanConf("tok-siyuan") }, (path) => readPaths.push(path)),
    });
    // 项目配置文件本身会被读（它就是 config-file 这一级），但不能去碰思源的 conf.json
    expect(readPaths).not.toContain(WIN_CONF);
  });

  it("返回的 tokenSource 覆盖全部来源取值", () => {
    const deps = { homeDir: HOME, platform: "win32" as const, readFileSync: readerFor({}) };
    expect(resolveSiYuanConfig(undefined, { ...deps, env: {} }).tokenSource).toBe("none");
    expect(resolveSiYuanConfig({ token: "t" }, { ...deps, env: {} }).tokenSource).toBe("arg");
    expect(resolveSiYuanConfig(undefined, { ...deps, env: { SIYUAN_TOKEN: "t" } }).tokenSource).toBe("env");
  });
});
