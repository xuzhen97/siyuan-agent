import { describe, expect, it, vi } from "vitest";
import { runCli } from "../../src/channels/cli/index.ts";
import { STDIN_SENTINEL, resolveStdinArgs, stdinParams } from "../../src/channels/cli/stdin.ts";
import { findToolSpec } from "../../src/tools/definitions.ts";
import { fakeClient } from "../helpers/fake-client.ts";

function spec(name: string) {
  const found = findToolSpec(name);
  if (!found) throw new Error(`未找到工具 ${name}`);
  return found;
}

const reader = (): string => "# 来自 stdin 的内容";

describe("stdinParams（对齐参考实现 siyuan_cli.py 的 `-` 约定）", () => {
  it("doc create 的 markdown、block insert/update 的 data 支持 stdin", () => {
    expect(stdinParams(spec("doc_create"))).toEqual(["markdown"]);
    expect(stdinParams(spec("block_insert"))).toEqual(["data"]);
    expect(stdinParams(spec("block_update"))).toEqual(["data"]);
  });

  it("其它工具不支持（避免误读 stdin 阻塞）", () => {
    for (const name of ["notebook_list", "block_delete", "doc_remove", "sql", "export_resources"]) {
      expect(stdinParams(spec(name))).toEqual([]);
    }
  });
});

describe("resolveStdinArgs", () => {
  it("doc create：只有显式 `-` 才读 stdin（省略时创建空文档，不该阻塞等输入）", () => {
    const withSentinel = resolveStdinArgs(spec("doc_create"), { notebook: "nb1", path: "/x", markdown: STDIN_SENTINEL }, reader);
    expect(withSentinel.markdown).toBe("# 来自 stdin 的内容");

    const omitted = resolveStdinArgs(spec("doc_create"), { notebook: "nb1", path: "/x" }, reader);
    expect(omitted.markdown).toBeUndefined();
  });

  it("block insert：`-` 与省略都读 stdin（对齐 SIYUAN.md）", () => {
    expect(resolveStdinArgs(spec("block_insert"), { parentID: "b1", data: STDIN_SENTINEL }, reader).data).toBe(
      "# 来自 stdin 的内容",
    );
    expect(resolveStdinArgs(spec("block_insert"), { parentID: "b1" }, reader).data).toBe("# 来自 stdin 的内容");
  });

  it("block update：`-` 读 stdin，且不修改其它参数", () => {
    const resolved = resolveStdinArgs(spec("block_update"), { id: "b1", data: STDIN_SENTINEL, confirm: true }, reader);
    expect(resolved).toEqual({ id: "b1", data: "# 来自 stdin 的内容", confirm: true });
  });

  it("无 stdin 参数的工具完全不调用读取器", () => {
    const spy = vi.fn(reader);
    resolveStdinArgs(spec("notebook_list"), {}, spy);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("CLI 端到端（注入 stdin）", () => {
  it("doc create --markdown - 把管道内容写进 markdown 参数", async () => {
    const { client, calls } = fakeClient();
    const code = await runCli(["doc", "create", "nb1", "/x", "--markdown", "-"], {
      client,
      stdin: () => "# 管道内容",
      stdout: () => {},
      stderr: () => {},
    });
    expect(code).toBe(0);
    expect(calls.find((call) => call.fn === "createDocWithMd")?.args).toEqual(["nb1", "/x", "# 管道内容"]);
  });

  it("block update <id> - 用管道内容作为新内容", async () => {
    const { client, calls } = fakeClient();
    const code = await runCli(["block", "update", "b1", "-", "--confirm"], {
      client,
      stdin: () => "改写自 stdin",
      stdout: () => {},
      stderr: () => {},
    });
    expect(code).toBe(0);
    expect(calls.find((call) => call.fn === "updateBlock")?.args).toEqual(["b1", "改写自 stdin", "markdown", true]);
  });

  it("block insert --parentID <id> - 用管道内容插入", async () => {
    const { client, calls } = fakeClient();
    const code = await runCli(["block", "insert", "-", "--parentID", "b1"], {
      client,
      stdin: () => "插入自 stdin",
      stdout: () => {},
      stderr: () => {},
    });
    expect(code).toBe(0);
    expect(calls.find((call) => call.fn === "insertBlock")?.args).toEqual([
      { data: "插入自 stdin", dataType: "markdown", parentID: "b1" },
    ]);
  });

  it("doc create 不带 --markdown 时不读 stdin（不阻塞）", async () => {
    const { client, calls } = fakeClient();
    const stdin = vi.fn(() => "# 不该被读");
    await runCli(["doc", "create", "nb1", "/x"], { client, stdin, stdout: () => {}, stderr: () => {} });
    expect(stdin).not.toHaveBeenCalled();
    expect(calls.find((call) => call.fn === "createDocWithMd")?.args).toEqual(["nb1", "/x", ""]);
  });
});
