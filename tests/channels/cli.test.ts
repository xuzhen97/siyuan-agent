import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { parseCliArgs, runCli, usage } from "../../src/channels/cli/index.ts";
import { fakeClient } from "../helpers/fake-client.ts";

const BUNDLE = "dist/cli.cjs";

function runCliProcess(args: string[]): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn("node", [BUNDLE, ...args], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

describe("parseCliArgs", () => {
  it("把 notebook list 解析为 notebook_list", () => {
    expect(parseCliArgs(["notebook", "list"]).tool).toBe("notebook_list");
  });

  it("把 doc ids_by_hpath <nb> <path> 解析为 doc_ids_by_hpath 与位置参数", () => {
    const parsed = parseCliArgs(["doc", "ids_by_hpath", "nb1", "/笔记/甲"]);
    expect(parsed.tool).toBe("doc_ids_by_hpath");
    expect(parsed.args).toEqual({ notebook: "nb1", path: "/笔记/甲" });
  });

  it("把 sql 的语句作为 stmt 参数", () => {
    expect(parseCliArgs(["sql", "SELECT 1"]).args).toEqual({ stmt: "SELECT 1" });
  });

  it("识别全局 --json / --port / --token / --config", () => {
    const parsed = parseCliArgs(["--json", "--port", "7000", "--token", "t", "--config", "D:/c.json", "version"]);
    expect(parsed.global).toMatchObject({ json: true, port: 7000, token: "t", configPath: "D:/c.json" });
  });

  it("命名选项覆盖位置参数（忽略大小写与连字符）", () => {
    const parsed = parseCliArgs(["doc", "create", "nb1", "/a", "--markdown", "# 甲"]);
    expect(parsed.args.markdown).toBe("# 甲");
    expect(parsed.args.notebook).toBe("nb1");
  });

  it("--dry-run 与 --dryRun 等价", () => {
    expect(parseCliArgs(["block", "delete", "b1", "--dry-run"]).args.dryRun).toBe(true);
    expect(parseCliArgs(["block", "delete", "b1", "--dryRun"]).args.dryRun).toBe(true);
  });

  it("参考实现的短选项名（--parent/--previous/--next/--data-type）与本项目写法都收", () => {
    expect(parseCliArgs(["block", "insert", "x", "--parent", "b1"]).args.parentID).toBe("b1");
    expect(parseCliArgs(["block", "insert", "x", "--parentID", "b1"]).args.parentID).toBe("b1");
    expect(parseCliArgs(["block", "insert", "x", "--previous", "b2"]).args.previousID).toBe("b2");
    expect(parseCliArgs(["block", "insert", "x", "--next", "b3"]).args.nextID).toBe("b3");
    expect(parseCliArgs(["block", "insert", "x", "--data-type", "dom"]).args.dataType).toBe("dom");
    expect(parseCliArgs(["block", "insert", "x", "--dataType", "dom"]).args.dataType).toBe("dom");
  });

  it("布尔旗标只需出现即为 true，也接受显式 false", () => {
    expect(parseCliArgs(["block", "delete", "b1", "--confirm"]).args.confirm).toBe(true);
    expect(parseCliArgs(["block", "delete", "b1", "--confirm", "false"]).args.confirm).toBe(false);
  });

  it("全局选项在子命令之前时不会吞掉子命令（回归）", () => {
    const withJson = parseCliArgs(["--json", "status"]);
    expect(withJson.tool).toBe("status");
    expect(withJson.global.json).toBe(true);

    const withHost = parseCliArgs(["--host", "10.0.0.1", "version"]);
    expect(withHost.tool).toBe("version");
    expect(withHost.global.host).toBe("10.0.0.1");
  });

  it("全局选项与工具参数混用时各归各位（--json 不当作 stmt）", () => {
    const parsed = parseCliArgs(["sql", "--json", "SELECT 1"]);
    expect(parsed.tool).toBe("sql");
    expect(parsed.args.stmt).toBe("SELECT 1");
    expect(parsed.global.json).toBe(true);
  });

  it("未被识别的多余位置参数被忽略而不是抛异常", () => {
    expect(() => parseCliArgs(["version", "extra"])).not.toThrow();
  });

  it("未知工具返回空 tool", () => {
    expect(parseCliArgs(["nope", "nope"]).tool).toBe("");
  });
});

describe("runCli", () => {
  it("成功时写 stdout 并返回 0", async () => {
    const { client } = fakeClient();
    const out = vi.fn();
    const code = await runCli(["version"], { client, stdout: out, stderr: vi.fn() });
    expect(code).toBe(0);
    expect(out.mock.calls[0]?.[0]).toContain("3.8.6");
  });

  it("--json 输出可解析 JSON", async () => {
    const { client } = fakeClient();
    let captured = "";
    const code = await runCli(["version", "--json"], {
      client,
      stdout: (text) => {
        captured += text;
      },
      stderr: vi.fn(),
    });
    expect(code).toBe(0);
    expect(JSON.parse(captured)).toEqual({ version: "3.8.6" });
  });

  it("未知子命令返回非 0 并写 stderr", async () => {
    const { client } = fakeClient();
    const err = vi.fn();
    const code = await runCli(["nope", "nope"], { client, stdout: vi.fn(), stderr: err });
    expect(code).toBe(1);
    expect(String(err.mock.calls[0]?.[0])).toMatch(/未知/);
  });

  it("工具报错时返回 1、stderr 带错误码与提示，且不写 stdout", async () => {
    const { client } = fakeClient();
    const out = vi.fn();
    const err = vi.fn();
    const code = await runCli(["block", "delete", "b1"], { client, stdout: out, stderr: err });
    expect(code).toBe(1);
    expect(String(err.mock.calls[0]?.[0])).toContain("SIYUAN_CONFIRM_REQUIRED");
    expect(out).not.toHaveBeenCalled();
  });

  it("写工具经 CLI 也能带上 confirm 执行", async () => {
    const { client, calls } = fakeClient();
    const code = await runCli(["block", "delete", "b1", "--confirm"], { client, stdout: vi.fn(), stderr: vi.fn() });
    expect(code).toBe(0);
    expect(calls.filter((c) => c.fn === "deleteBlock")).toHaveLength(1);
  });
});

describe("CLI 制品端到端（真实进程退出码，由 pnpm build:cli 生成）", () => {
  it("制品存在", () => {
    expect(existsSync(BUNDLE)).toBe(true);
  });

  it("成功调用时 stderr 无 libuv 断言且退出码属于 {0,1}", async () => {
    const { code, stdout, stderr } = await runCliProcess(["version"]);
    expect(stderr).not.toContain("UV_HANDLE_CLOSING");
    expect(stdout.trim().length).toBeGreaterThan(0);
    expect([0, 1]).toContain(code);
  }, 30000);

  it("破坏型工具缺 confirm 时退出码为 1 且 stderr 带错误码（回归：曾因 process.exit 竞态变成 127）", async () => {
    const { code, stderr } = await runCliProcess(["block", "delete", "20260419184156-0yw56ke"]);
    expect(code).toBe(1);
    expect(stderr).toContain("SIYUAN_CONFIRM_REQUIRED");
  }, 30000);

  it("未知子命令退出码为 1 并输出用法", async () => {
    const { code, stderr } = await runCliProcess(["nope", "nope"]);
    expect(code).toBe(1);
    expect(stderr).toContain("未知子命令");
  }, 30000);
});

describe("usage", () => {
  it("列出全部 45 条工具的命令路径", () => {
    const text = usage();
    expect(text).toContain("siyuan-agent notebook list");
    expect(text).toContain("siyuan-agent sql");
    expect(text).toContain("siyuan-agent block delete");
    expect(text.split("\n").filter((line) => line.startsWith("siyuan-agent "))).toHaveLength(45);
  });
});
