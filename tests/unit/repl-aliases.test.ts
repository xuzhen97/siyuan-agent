import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { applyReplAliases, runRepl } from "../../src/channels/cli/repl.ts";
import { fakeClient } from "../helpers/fake-client.ts";

describe("applyReplAliases（参考实现 REPL 语法兼容层）", () => {
  it("sql：把剩余 token 拼回语句（REPL 里不必加引号）", () => {
    expect(applyReplAliases(["sql", "SELECT", "id", "FROM", "blocks"])).toEqual(["sql", "SELECT id FROM blocks"]);
  });

  it("search <query> → search blocks <query>（参考实现的 search 就是全文搜块）", () => {
    expect(applyReplAliases(["search", "会议", "记录"])).toEqual(["search", "blocks", "会议 记录"]);
  });

  it("search blocks <query> 也把剩余 token 拼回关键词", () => {
    expect(applyReplAliases(["search", "blocks", "会议", "记录"])).toEqual(["search", "blocks", "会议 记录"]);
  });

  it("search docs / search tag 不被改写（本项目已有的两个检索命令）", () => {
    expect(applyReplAliases(["search", "docs", "会议"])).toEqual(["search", "docs", "会议"]);
    expect(applyReplAliases(["search", "tag", "a", "b"])).toEqual(["search", "tag", "a", "b"]);
  });

  it("export md <doc-id> → doc export_md <doc-id>", () => {
    expect(applyReplAliases(["export", "md", "d1"])).toEqual(["doc", "export_md", "d1"]);
  });

  it("doc get <id> → doc path_by_id <id>", () => {
    expect(applyReplAliases(["doc", "get", "d1"])).toEqual(["doc", "path_by_id", "d1"]);
  });

  it("doc export <doc-id> → doc export_md <doc-id>（参考实现的另一种写法）", () => {
    expect(applyReplAliases(["doc", "export", "d1"])).toEqual(["doc", "export_md", "d1"]);
  });

  it("block child <id> → block children <id>（参考实现用单数）", () => {
    expect(applyReplAliases(["block", "child", "b1"])).toEqual(["block", "children", "b1"]);
  });

  it("block insert <parent> <data> → insert <data> --parentID <parent>（本项目参数顺序不同）", () => {
    expect(applyReplAliases(["block", "insert", "b1", "新内容"])).toEqual([
      "block",
      "insert",
      "新内容",
      "--parentID",
      "b1",
    ]);
  });

  it("--md 转成本项目的 --markdown", () => {
    expect(applyReplAliases(["doc", "create", "nb1", "/x", "--md", "正文"])).toEqual([
      "doc",
      "create",
      "nb1",
      "/x",
      "--markdown",
      "正文",
    ]);
  });

  it("无关命令原样透传", () => {
    expect(applyReplAliases(["notebook", "list"])).toEqual(["notebook", "list"]);
    expect(applyReplAliases(["version"])).toEqual(["version"]);
  });
});

describe("REPL 内的别名与拼接真的生效", () => {
  async function run(lines: string[], stateDir: string, overrides: Record<string, unknown> = {}) {
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
    // 注意：out 必须在 await 之后读取（属性求值顺序会让提前解构拿到空字符串）
    return { out, code, calls };
  }

  it("不带引号的 sql 会整句执行（真实内核冒烟里曾因此报 incomplete input）", async () => {
    const { calls, out } = await run(
      ["sql SELECT id FROM blocks LIMIT 2", "quit"],
      ".tmp/repl-alias-state",
    );
    const sqlCall = calls.find((call) => call.fn === "querySql");
    expect(sqlCall?.args).toEqual(["SELECT id FROM blocks LIMIT 2"]);
    expect(out).not.toContain("incomplete");
  });

  it("block insert <parent> <data> 按参考实现语法可用", async () => {
    const { calls } = await run(["block insert b1 新内容", "quit"], ".tmp/repl-alias-state");
    const call = calls.find((item) => item.fn === "insertBlock");
    expect(call?.args).toEqual([{ data: "新内容", dataType: "markdown", parentID: "b1" }]);
  });

  it("export md <id> 可用", async () => {
    const { calls, out } = await run(["export md d1", "quit"], ".tmp/repl-alias-state");
    expect(calls.some((call) => call.fn === "exportMdContent")).toBe(true);
    expect(out).toContain("# 甲");
  });

  it("doc export <id> 与 block child <id> 也能跑通（参考实现的写法）", async () => {
    const { calls, out } = await run(["doc export d1", "block child b1", "quit"], ".tmp/repl-alias-state");
    expect(calls.some((call) => call.fn === "exportMdContent")).toBe(true);
    expect(calls.some((call) => call.fn === "getChildBlocks")).toBe(true);
    expect(out).not.toContain("未知命令");
  });
});
