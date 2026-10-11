import { existsSync } from "node:fs";
import { mkdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  discoverAndLoadExtensions,
  type ExtensionAPI,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { registerSiYuanTools, toJsonSchema } from "../../src/channels/pi/index.ts";
import { TOOL_SPECS } from "../../src/tools/definitions.ts";
import { fakeClient } from "../helpers/fake-client.ts";

const AGENT_DIR = ".tmp/pi-agent-dir";

function recordingPi(): { pi: ExtensionAPI; tools: ToolDefinition[] } {
  const tools: ToolDefinition[] = [];
  const pi = {
    registerTool: (tool: ToolDefinition) => {
      tools.push(tool);
    },
  } as unknown as ExtensionAPI;
  return { pi, tools };
}

describe("toJsonSchema", () => {
  it("映射类型、必填、描述与默认值", () => {
    expect(
      toJsonSchema({
        notebook: { type: "string", required: true, description: "笔记本 ID" },
        maxChars: { type: "number", description: "上限", default: 20000 },
        dryRun: { type: "boolean", description: "预览" },
      }),
    ).toEqual({
      type: "object",
      properties: {
        notebook: { type: "string", description: "笔记本 ID" },
        maxChars: { type: "number", description: "上限", default: 20000 },
        dryRun: { type: "boolean", description: "预览" },
      },
      required: ["notebook"],
      additionalProperties: false,
    });
  });

  it("无参数时 required 为空数组", () => {
    expect(toJsonSchema({})).toEqual({
      type: "object",
      properties: {},
      required: [],
      additionalProperties: false,
    });
  });
});

describe("registerSiYuanTools", () => {
  it("注册 32 条工具且名称带 siyuan_ 前缀", () => {
    const { pi, tools } = recordingPi();
    const { client } = fakeClient();
    const count = registerSiYuanTools(pi, { client });

    expect(count).toBe(TOOL_SPECS.length);
    expect(count).toBe(32);
    expect(tools).toHaveLength(32);
    for (const tool of tools) expect(tool.name.startsWith("siyuan_")).toBe(true);
    expect(tools.map((t) => t.name)).toContain("siyuan_notebook_list");
    expect(tools.map((t) => t.name)).toContain("siyuan_block_delete");
  });

  it("每条工具的 label / description / schema 与真源一致", () => {
    const { pi, tools } = recordingPi();
    const { client } = fakeClient();
    registerSiYuanTools(pi, { client });

    for (const [index, tool] of tools.entries()) {
      const spec = TOOL_SPECS[index];
      if (!spec) throw new Error(`第 ${index} 条缺少 spec`);
      expect(tool.label).toBe(spec.title);
      expect(tool.description).toBe(spec.description);
      expect(tool.parameters).toMatchObject({ type: "object", additionalProperties: false });
    }
  });

  it("只读工具标记 readOnlyHint，破坏型工具标记 destructiveHint", () => {
    const { pi, tools } = recordingPi();
    const { client } = fakeClient();
    registerSiYuanTools(pi, { client });

    for (const [index, tool] of tools.entries()) {
      const risk = TOOL_SPECS[index]?.risk;
      expect(tool.annotations?.readOnlyHint).toBe(risk === "read");
      expect(tool.annotations?.destructiveHint).toBe(risk === "destructive");
      expect(tool.annotations?.idempotentHint).toBe(risk === "read");
    }
  });

  it("execute 走生产分发路径并返回 content/details", async () => {
    const { pi, tools } = recordingPi();
    const { client } = fakeClient();
    registerSiYuanTools(pi, { client });

    const versionTool = tools.find((t) => t.name === "siyuan_version");
    const result = await versionTool?.execute("call-1", {}, undefined, undefined, {} as never);
    expect(result?.content[0]).toMatchObject({ type: "text" });
    expect(result?.details).toBeTruthy();
  });

  it("execute 在失败时返回 isError 与错误文本（不抛异常）", async () => {
    const { pi, tools } = recordingPi();
    const { client } = fakeClient();
    registerSiYuanTools(pi, { client });

    const deleteTool = tools.find((t) => t.name === "siyuan_block_delete");
    const result = await deleteTool?.execute("call-2", { id: "b1" } as never, undefined, undefined, {} as never);
    expect(result?.isError).toBe(true);
    expect(JSON.stringify(result?.content)).toContain("SIYUAN_CONFIRM_REQUIRED");
  });
});

describe("验证任务 V2：pi 加载器接受本扩展（跨目录 TS 导入）", () => {
  it("extensions/index.ts 存在", () => {
    expect(existsSync("extensions/index.ts")).toBe(true);
  });

  it("discoverAndLoadExtensions 无错误且注册 30 条工具", async () => {
    mkdirSync(AGENT_DIR, { recursive: true });
    const result = await discoverAndLoadExtensions(["extensions/index.ts"], process.cwd(), AGENT_DIR);

    expect(result.errors).toEqual([]);
    const names = result.extensions.flatMap((extension) => [...extension.tools.keys()]);
    expect(names).toHaveLength(32);
    expect(names).toContain("siyuan_notebook_list");
  }, 30000);
});
