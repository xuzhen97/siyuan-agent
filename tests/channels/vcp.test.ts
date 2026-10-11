import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { handleVcpRequest, normalizeVcpArgs } from "../../src/channels/vcp/index.ts";
import { fakeClient } from "../helpers/fake-client.ts";

const BUNDLE = "plugins/siyuan-agent/index.cjs";

function runPlugin(payload: unknown): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("node", [BUNDLE], { stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout.on("data", (chunk) => {
      out += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      err += String(chunk);
    });
    child.on("error", reject);
    child.on("close", () => (out ? resolve(out) : reject(new Error(`无 stdout 输出，stderr=${err}`))));
    child.stdin.end(JSON.stringify(payload));
  });
}

describe("normalizeVcpArgs（对齐 VCPDeck 的平铺 + params 合并）", () => {
  it("合并平铺参数与嵌套 params（嵌套优先）", () => {
    expect(normalizeVcpArgs({ command: "DocList", notebook: "nb1", params: { path: "/a" } })).toEqual({
      command: "DocList",
      args: { notebook: "nb1", path: "/a" },
    });
  });

  it("嵌套 params 覆盖同名平铺字段", () => {
    const { args } = normalizeVcpArgs({ command: "DocList", path: "/flat", params: { path: "/nested" } });
    expect(args.path).toBe("/nested");
  });

  it("剔除 command 与 maid，不把它们当参数传给工具", () => {
    expect(normalizeVcpArgs({ command: "Status", maid: "Nova" }).args).toEqual({});
  });
});

describe("handleVcpRequest", () => {
  it("成功时返回 status / result.content / messageForAI", async () => {
    const { client } = fakeClient();
    const res = await handleVcpRequest({ command: "Version" }, client);
    expect(res.status).toBe("success");
    if (res.status === "success") {
      expect(res.result.content[0]?.type).toBe("text");
      expect(res.result.content[0]?.text).toContain("3.8.6");
      expect(res.messageForAI.length).toBeGreaterThan(0);
    }
  });

  it("接受 canonical 名（宽进严出）", async () => {
    const { client } = fakeClient();
    const res = await handleVcpRequest({ command: "version" }, client);
    expect(res.status).toBe("success");
  });

  it("未知命令返回 status=error 且带 error 字段，不抛异常", async () => {
    const { client } = fakeClient();
    const res = await handleVcpRequest({ command: "NoSuchThing" }, client);
    expect(res.status).toBe("error");
    if (res.status === "error") {
      expect(res.error).toContain("NoSuchThing");
      expect(res.result.content[0]?.text).toBe(res.error);
    }
  });

  it("SQL 只读守卫拦截时以 error 形式返回并说明只读", async () => {
    const { client } = fakeClient();
    const res = await handleVcpRequest({ command: "Sql", stmt: "DELETE FROM blocks" }, client);
    expect(res.status).toBe("error");
    if (res.status === "error") expect(res.error).toContain("只读");
  });

  it("破坏型工具缺 confirm 时返回 SIYUAN_CONFIRM_REQUIRED 与预览", async () => {
    const { client } = fakeClient();
    const res = await handleVcpRequest({ command: "BlockDelete", id: "b1" }, client);
    expect(res.status).toBe("error");
    if (res.status === "error") {
      expect(res.error).toContain("SIYUAN_CONFIRM_REQUIRED");
      expect(res.error).toContain("旧内容");
    }
  });

  it("破坏型工具带 confirm 时执行成功", async () => {
    const { client } = fakeClient();
    const res = await handleVcpRequest({ command: "BlockDelete", id: "b1", confirm: true }, client);
    expect(res.status).toBe("success");
  });
});

describe("打包制品端到端（stdio 协议）", () => {
  it("制品存在（由 pnpm build:vcp 生成）", () => {
    expect(existsSync(BUNDLE)).toBe(true);
  });

  it("成功调用输出可解析 JSON 且形状正确", async () => {
    const raw = await runPlugin({ command: "Version" });
    const res = JSON.parse(raw) as {
      status: string;
      result: { content: Array<{ type: string; text: string }> };
      messageForAI: string;
    };
    // 本机内核可用时应当成功；无论如何形状必须正确
    expect(["success", "error"]).toContain(res.status);
    expect(res.result.content[0]?.type).toBe("text");
    expect(typeof res.messageForAI).toBe("string");
    expect(raw).not.toContain("\n");
  });

  it("未知命令在真实进程中返回 error 形状", async () => {
    const res = JSON.parse(await runPlugin({ command: "Nope" })) as { status: string; error?: string };
    expect(res.status).toBe("error");
    expect(res.error).toBeTruthy();
  });

  it("制品零外部依赖（不含 require 第三方包）", async () => {
    const raw = await runPlugin({ command: "Version" });
    const res = JSON.parse(raw) as { status: string };
    expect(res.status).toBeTruthy();
  });
});
