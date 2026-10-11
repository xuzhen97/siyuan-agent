import type { SiYuanClient } from "../../src/core/client.ts";

export type ToolParam = {
  type: "string" | "number" | "boolean";
  required?: boolean;
  description: string;
  default?: string | number | boolean;
};

export type Risk = "read" | "additive" | "destructive";

export type ToolResult = { text: string; data?: unknown };

/**
 * 工具定义真源（ADR-0001）。
 * 一份定义同时驱动 Pi 工具注册、VCP invocationCommands 与 CLI 子命令。
 */
export type ToolSpec = {
  name: string;
  title: string;
  description: string;
  /** 风险级（ADR-0004）：read 只读；additive 只增不改；destructive 覆盖或删除，必须 confirm。 */
  risk: Risk;
  params: Record<string, ToolParam>;
  invoke(client: SiYuanClient, args: Record<string, unknown>): Promise<ToolResult>;
};
