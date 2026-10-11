import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { REPL_COMMANDS, runRepl } from "../../src/channels/cli/repl.ts";
import { fakeClient } from "../helpers/fake-client.ts";

let stateDir: string;

beforeEach(() => {
  stateDir = mkdtempSync(join(tmpdir(), "siyuan-agent-repl-"));
});

afterEach(() => {
  rmSync(stateDir, { recursive: true, force: true });
});

/** 用内存流跑一次 REPL，返回输出与退出码。 */
async function run(lines: string[], overrides: Record<string, unknown> = {}) {
  const input = new PassThrough();
  const output = new PassThrough();
  let out = "";
  output.on("data", (chunk) => {
    out += String(chunk);
  });

  const { client, calls } = fakeClient(overrides);
  const done = runRepl({ input, output, client, stateDir, color: false });
  input.end(`${lines.join("\n")}\n`);
  const code = await done;
  return { out, code, calls };
}

describe("REPL 命令表（对齐参考实现 _build_repl_commands）", () => {
  it("包含参考实现声明的全部命令", () => {
    for (const key of [
      "notebook list",
      "notebook create <name>",
      "notebook rename <id> <name>",
      "notebook remove <id>",
      "doc create <notebook> <path>",
      "doc list <notebook> <path>",
      "doc tree <notebook> <文档路径或ID>",
      "doc get <id>",
      "block insert <parent> <data>",
      "block update <id> <data>",
      "block delete <id>",
      "block get <id>",
      "sql <stmt>",
      "search <query>",
      "export md <doc-id>",
      "status",
      "help",
      "quit",
    ]) {
      expect(Object.keys(REPL_COMMANDS)).toContain(key);
    }
  });
});

describe("REPL 基本交互", () => {
  it("打印 banner 与提示符，并在 quit 后优雅退出", async () => {
    const { out, code } = await run(["quit"]);
    expect(out).toContain("siyuan");
    expect(code).toBe(0);
    expect(out).toMatch(/退出|Bye|再见/i);
  });

  it("EOF（没有 quit）也能正常结束", async () => {
    const { code } = await run([]);
    expect(code).toBe(0);
  });

  it("help 打印命令表", async () => {
    const { out } = await run(["help", "quit"]);
    expect(out).toContain("notebook list");
    expect(out).toContain("sql <stmt>");
  });

  it("未知命令给出提示而不是崩溃", async () => {
    const { out, code } = await run(["nope nope", "quit"]);
    expect(out).toMatch(/未知|Unknown/);
    expect(code).toBe(0);
  });

  it("status 会同时显示连接状态与会话上下文", async () => {
    const { out } = await run(["status", "quit"]);
    expect(out).toContain("3.8.6");
    expect(out).toMatch(/当前笔记本|Notebook/);
  });
});

describe("REPL 执行真实工具（走同一套校验与安全规则）", () => {
  it("version 调用工具并输出结果", async () => {
    const { out, calls } = await run(["version", "quit"]);
    expect(out).toContain("3.8.6");
    expect(calls.some((call) => call.fn === "version")).toBe(true);
  });

  it("--json 在 REPL 内生效", async () => {
    const { out } = await run(["version --json", "quit"]);
    expect(out).toContain('"version"');
  });

  it("破坏型操作在 REPL 内同样必须先 confirm（安全规则不被绕过）", async () => {
    const { out, calls } = await run(["block delete b1", "quit"]);
    expect(out).toContain("SIYUAN_CONFIRM_REQUIRED");
    expect(calls.filter((call) => call.fn === "deleteBlock")).toEqual([]);
  });

  it("带 confirm 时破坏型操作可执行", async () => {
    const { calls } = await run(["block delete b1 --confirm", "quit"]);
    expect(calls.filter((call) => call.fn === "deleteBlock")).toHaveLength(1);
  });

  it("REPL 内拒绝 `-` 读 stdin（不吞掉会话输入），并给出替代做法", async () => {
    const { out, calls } = await run(["doc create nb1 /x --markdown -", "quit"]);
    expect(out).toContain("不支持 `-`");
    expect(out).toContain("--markdown");
    expect(calls.filter((call) => call.fn === "createDocWithMd")).toEqual([]);
  });

  it("写成功后更新会话上下文（当前文档）并落盘", async () => {
    await run(["doc create nb1 /甲", "quit"]);
    const state = JSON.parse(readFileSync(join(stateDir, "session.json"), "utf-8")) as {
      currentDocId: string;
      currentDocPath: string;
    };
    expect(state.currentDocId).toBe("d9");
    expect(state.currentDocPath).toBe("/甲");
  });

  it("notebook create 成功后记录当前笔记本", async () => {
    await run(["notebook create 我的新库", "quit"]);
    const state = JSON.parse(readFileSync(join(stateDir, "session.json"), "utf-8")) as {
      currentNotebookId: string;
      currentNotebookName: string;
    };
    expect(state.currentNotebookId).toBe("nb9");
    expect(state.currentNotebookName).toBe("沙盒");
  });

  it("多行输入逐条执行，且历史被记录（上限 200）", async () => {
    await run(["version", "status", "quit"]);
    const state = JSON.parse(readFileSync(join(stateDir, "session.json"), "utf-8")) as { history: string[] };
    expect(state.history).toContain("version");
    expect(state.history.length).toBeLessThanOrEqual(200);
  });
});
