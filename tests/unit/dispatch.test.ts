import { describe, expect, it } from "vitest";
import type { SiYuanClient } from "../../src/core/client.ts";
import { SiYuanError } from "../../src/core/errors.ts";
import { coerceArgs, dispatchCommand, dispatchTool } from "../../src/tools/dispatch.ts";
import type { ToolSpec } from "../../src/tools/types.ts";

const spec: ToolSpec = {
  name: "doc_list",
  title: "列出文档",
  description: "列出某笔记本路径下的文档",
  risk: "read",
  params: {
    notebook: { type: "string", required: true, description: "笔记本 ID" },
    path: { type: "string", description: "路径", default: "/" },
    limit: { type: "number", description: "上限" },
  },
  invoke: async (_client, args) => ({
    text: `path=${String(args.path)} limit=${String(args.limit)}`,
    data: args,
  }),
};

const client = {} as SiYuanClient;

describe("coerceArgs", () => {
  it("填充默认值", () => {
    expect(coerceArgs(spec, { notebook: "nb1" }).path).toBe("/");
  });

  it("字符串数字转为 number", () => {
    expect(coerceArgs(spec, { notebook: "nb1", limit: "5" }).limit).toBe(5);
  });

  it("布尔字符串按 spec 类型转换", () => {
    const s: ToolSpec = { ...spec, params: { on: { type: "boolean", description: "开关" } } };
    expect(coerceArgs(s, { on: "true" }).on).toBe(true);
    expect(coerceArgs(s, { on: "false" }).on).toBe(false);
    expect(coerceArgs(s, { on: true }).on).toBe(true);
  });

  it("缺失必填抛错并指出参数名", () => {
    expect(() => coerceArgs(spec, {})).toThrowError(/notebook/);
  });

  it("类型不符抛错并指出参数名", () => {
    expect(() => coerceArgs(spec, { notebook: "nb1", limit: "abc" })).toThrowError(/limit/);
  });

  it("部分可解析的字符串被拒绝，而不是静默截断（回归：parseInt 会把 10abc 变成 10）", () => {
    expect(() => coerceArgs(spec, { notebook: "nb1", limit: "10abc" })).toThrowError(/limit/);
    expect(coerceArgs(spec, { notebook: "nb1", limit: "10" }).limit).toBe(10);
  });

  it("布尔参数收到非法值时报错", () => {
    const s: ToolSpec = { ...spec, params: { on: { type: "boolean", description: "开关" } } };
    expect(() => coerceArgs(s, { on: "maybe" })).toThrowError(/on/);
  });

  it("空字符串视为未提供（必填则报错，可选则用默认值）", () => {
    expect(() => coerceArgs(spec, { notebook: "" })).toThrowError(/notebook/);
    expect(coerceArgs(spec, { notebook: "nb1", path: "" }).path).toBe("/");
  });
});

describe("dispatchTool", () => {
  it("成功时返回 invoke 结果", async () => {
    const out = await dispatchTool(spec, { notebook: "nb1" }, client);
    expect(out).toEqual({
      ok: true,
      result: { text: "path=/ limit=undefined", data: { notebook: "nb1", path: "/" } },
    });
  });

  it("参数错误以 DispatchOutcome 返回而不是抛异常", async () => {
    const out = await dispatchTool(spec, {}, client);
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.error.message).toContain("notebook");
      expect(out.error.code).toBe("SIYUAN_API_ERROR");
    }
  });

  it("invoke 抛 SiYuanError 时保留 code 与 hint", async () => {
    const failing: ToolSpec = {
      ...spec,
      invoke: async () => {
        throw new SiYuanError("SIYUAN_API_ERROR", "内核错误", { hint: "检查内核" });
      },
    };
    const out = await dispatchTool(failing, { notebook: "nb1" }, client);
    expect(out).toEqual({ ok: false, error: { code: "SIYUAN_API_ERROR", message: "内核错误", hint: "检查内核" } });
  });

  it("invoke 抛非 SiYuanError 时归一化为 SIYUAN_API_ERROR", async () => {
    const failing: ToolSpec = {
      ...spec,
      invoke: async () => {
        throw new Error("炸了");
      },
    };
    const out = await dispatchTool(failing, { notebook: "nb1" }, client);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error.code).toBe("SIYUAN_API_ERROR");
  });
});

describe("dispatchCommand", () => {
  it("接受 canonical 名", async () => {
    const out = await dispatchCommand("doc_list", { notebook: "nb1" }, client, [spec]);
    expect(out.ok).toBe(true);
  });

  it("接受 PascalCase 名（宽进严出）", async () => {
    const out = await dispatchCommand("ListDocs", { notebook: "nb1" }, client, [{ ...spec, name: "list_docs" }]);
    expect(out.ok).toBe(true);
  });

  it("未知命令返回错误并列出可用命令，而不是抛异常", async () => {
    const out = await dispatchCommand("Nope", {}, client, [spec]);
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.error.message).toContain("Nope");
      expect(out.error.hint).toContain("doc_list");
    }
  });
});
