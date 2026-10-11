import type { ToolParam } from "../../tools/types.ts";

/**
 * ToolParam → JSON Schema。
 * Pi 的 registerTool 期望 TypeBox 的 TSchema；TypeBox 的 schema 本身就是 JSON Schema
 * 结构，因此这里产出标准 JSON Schema 由调用方做类型转换，避免为 typebox 增加依赖。
 */
export function toJsonSchema(params: Record<string, ToolParam>): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  for (const [name, param] of Object.entries(params)) {
    const property: Record<string, unknown> = { type: param.type, description: param.description };
    if (param.default !== undefined) property.default = param.default;
    properties[name] = property;
    if (param.required) required.push(name);
  }

  return { type: "object", properties, required, additionalProperties: false };
}
