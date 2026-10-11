import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it } from "vitest";
import { registerSiYuanTools } from "../../src/channels/pi/index.ts";

const originalFetch = globalThis.fetch;
const originalToken = process.env.SIYUAN_TOKEN;

function recordingPi(): { pi: ExtensionAPI; tools: ToolDefinition[] } {
  const tools: ToolDefinition[] = [];
  const pi = {
    registerTool: (tool: ToolDefinition) => {
      tools.push(tool);
    },
  } as unknown as ExtensionAPI;
  return { pi, tools };
}

/** 收集每次请求的 Authorization 头，便于断言“用的是哪一级配置”。 */
function fakeFetchCollectingAuth(seen: string[]) {
  return async (_url: string, init: { headers: Record<string, string> }) => {
    seen.push(init.headers.Authorization ?? "(none)");
    return { ok: true, status: 200, text: async () => JSON.stringify({ code: 0, msg: "", data: "3.8.6" }) };
  };
}

describe("Pi 通道的配置热更新（主人要求：改了环境变量就该生效，不该要求 /reload）", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalToken === undefined) delete process.env.SIYUAN_TOKEN;
    else process.env.SIYUAN_TOKEN = originalToken;
    process.env.SIYUAN_HOST = "127.0.0.1";
  });

  it("环境变量在两次调用之间变化时，第二次调用即使用新 Token（不缓存配置）", async () => {
    const seen: string[] = [];
    // SAFETY: 测试用假 fetch 替换全局 fetch，仅收集请求头并返回内核信封形状，无网络访问。
    globalThis.fetch = fakeFetchCollectingAuth(seen) as unknown as typeof fetch;

    const { pi, tools } = recordingPi();
    registerSiYuanTools(pi); // 不注入 client → 每次调用都重新解析配置
    const versionTool = tools.find((tool) => tool.name === "siyuan_version");
    if (!versionTool) throw new Error("未找到 siyuan_version 工具");

    process.env.SIYUAN_TOKEN = "tok-1";
    await versionTool.execute("call-1", {}, undefined, undefined, {} as never);
    process.env.SIYUAN_TOKEN = "tok-2";
    await versionTool.execute("call-2", {}, undefined, undefined, {} as never);

    expect(seen).toEqual(["Token tok-1", "Token tok-2"]);
  });

  it("清空环境变量后回退到自动发现（不再沿用上一次的 Token）", async () => {
    const seen: string[] = [];
    // SAFETY: 同上，测试用假 fetch。
    globalThis.fetch = fakeFetchCollectingAuth(seen) as unknown as typeof fetch;

    const { pi, tools } = recordingPi();
    registerSiYuanTools(pi);
    const versionTool = tools.find((tool) => tool.name === "siyuan_version");
    if (!versionTool) throw new Error("未找到 siyuan_version 工具");

    process.env.SIYUAN_TOKEN = "tok-env";
    await versionTool.execute("call-1", {}, undefined, undefined, {} as never);

    delete process.env.SIYUAN_TOKEN;
    await versionTool.execute("call-2", {}, undefined, undefined, {} as never);

    expect(seen[0]).toBe("Token tok-env");
    // 环境变量消失后不应再发旧 Token；本机存在 SiYuan conf.json 时会自动发现，否则为空
    expect(seen[1]).not.toBe("Token tok-env");
  });
});
