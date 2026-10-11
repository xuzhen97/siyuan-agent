import { describe, expect, it } from "vitest";
import {
  buildVcpManifestJson,
  GENERATED_BEGIN,
  GENERATED_END,
  insertGeneratedSkillTable,
  renderSkillCommandTable,
} from "../../src/generators/vcpManifest.ts";
import { TOOL_SPECS } from "../../src/tools/definitions.ts";

const meta = {
  name: "SiYuanAgent",
  displayName: "思源笔记读写桥",
  version: "0.1.0",
  description: "读写访问思源知识库",
  author: "xuzhen97",
};

const json = buildVcpManifestJson(TOOL_SPECS, meta);
const parsed = JSON.parse(json) as {
  manifestVersion: string;
  name: string;
  pluginType: string;
  entryPoint: { type: string; command: string };
  communication: { protocol: string };
  configSchema: Record<string, unknown>;
  capabilities: { invocationCommands: Array<{ command: string; description: string; example: string }> };
};

describe("buildVcpManifestJson", () => {
  it("是可解析 JSON 且以换行结尾", () => {
    expect(json.endsWith("\n")).toBe(true);
  });

  it("声明 manifestVersion / 入口 / stdio 协议（对齐 VCP 插件体系）", () => {
    expect(parsed.manifestVersion).toBe("2.0.0");
    expect(parsed.name).toBe("SiYuanAgent");
    expect(parsed.pluginType).toBe("synchronous");
    expect(parsed.entryPoint).toEqual({ type: "nodejs", command: "node index.cjs" });
    expect(parsed.communication.protocol).toBe("stdio");
  });

  it("configSchema 键名与 core 环境变量一致（VCP 会按同名注入 env）", () => {
    expect(Object.keys(parsed.configSchema).sort()).toEqual([
      "SIYUAN_HOST",
      "SIYUAN_PORT",
      "SIYUAN_TIMEOUT_MS",
      "SIYUAN_TOKEN",
    ]);
  });

  it("invocationCommands 覆盖全部 45 条且命令名为 PascalCase", () => {
    const commands = parsed.capabilities.invocationCommands.map((c) => c.command);
    expect(commands).toHaveLength(45);
    expect(commands).toContain("NotebookList");
    expect(commands).toContain("Sql");
    expect(commands).toContain("BlockAppend");
  });

  it("命令名全局唯一", () => {
    const commands = parsed.capabilities.invocationCommands.map((c) => c.command);
    expect(new Set(commands).size).toBe(commands.length);
  });

  it("每条描述含功能、参数、command 护栏与调用示例", () => {
    const listDocs = parsed.capabilities.invocationCommands.find((c) => c.command === "DocList");
    expect(listDocs?.description).toContain("功能:");
    expect(listDocs?.description).toContain("参数:");
    expect(listDocs?.description).toContain(
      "`command` 固定为 DocList，不得填写 Shell 命令、路径或自然语言",
    );
    expect(listDocs?.description).toContain("<<<[TOOL_REQUEST]>>>");
    expect(listDocs?.example).toContain("tool_name:「始」SiYuanAgent「末」");
  });

  it("example 只包含调用示例块本身（不含功能说明）", () => {
    for (const command of parsed.capabilities.invocationCommands) {
      expect(command.example.startsWith("<<<[TOOL_REQUEST]>>>")).toBe(true);
      expect(command.example).not.toContain("功能:");
    }
  });

  it("破坏型工具的描述里强调 confirm", () => {
    const removeDoc = parsed.capabilities.invocationCommands.find((c) => c.command === "DocRemove");
    expect(removeDoc?.description).toContain("confirm");
  });

  it("两次生成逐字节一致（确定性，供漂移门使用）", () => {
    expect(buildVcpManifestJson(TOOL_SPECS, meta)).toBe(json);
  });
});

describe("skill 命令表", () => {
  it("表格含 canonical 名、VCP command 与参数列", () => {
    const table = renderSkillCommandTable(TOOL_SPECS);
    expect(table).toContain("| 工具 | VCP command | 参数 | 说明 |");
    expect(table).toContain("`notebook_list`");
    expect(table).toContain("`NotebookList`");
    expect(table).toContain("`block_delete`");
  });

  it("参数列用 ? 标注可选参数", () => {
    const table = renderSkillCommandTable(TOOL_SPECS);
    expect(table).toContain("path?");
    expect(table).toContain("notebook");
  });

  it("GENERATED 区块被替换且不影响手写内容", () => {
    const before = `---\nname: siyuan\n---\n\n手写段落\n\n${GENERATED_BEGIN}\n${GENERATED_END}\n\n手写尾部\n`;
    const after = insertGeneratedSkillTable(before, TOOL_SPECS);
    expect(after).toContain("手写段落");
    expect(after).toContain("手写尾部");
    expect(after).toContain("`NotebookList`");
    expect(after.indexOf(GENERATED_BEGIN)).toBeLessThan(after.indexOf("手写尾部"));
  });

  it("重复插入结果稳定（幂等）", () => {
    const once = insertGeneratedSkillTable(
      `头\n${GENERATED_BEGIN}\n${GENERATED_END}\n尾\n`,
      TOOL_SPECS,
    );
    expect(insertGeneratedSkillTable(once, TOOL_SPECS)).toBe(once);
  });

  it("缺少标记对时抛错而不是静默追加", () => {
    expect(() => insertGeneratedSkillTable("没有标记", TOOL_SPECS)).toThrowError(/BEGIN GENERATED/);
  });

  it("标记顺序颠倒时抛错", () => {
    expect(() => insertGeneratedSkillTable(`${GENERATED_END}\n${GENERATED_BEGIN}`, TOOL_SPECS)).toThrowError(/顺序/);
  });
});
