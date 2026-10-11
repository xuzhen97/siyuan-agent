import { describe, expect, it } from "vitest";
import { SiYuanClient } from "../../src/core/client.ts";
import { resolveSiYuanConfig } from "../../src/core/config.ts";
import { callTool } from "../helpers/call-tool.ts";

/**
 * L2 只读契约层（Spec §8.1）：对**真实内核**断言响应形状与截断语义。
 * 默认跳过 —— 只有显式 `SIYUAN_E2E=1` 时才跑，避免 CI 依赖本机内核。
 */
const enabled = process.env.SIYUAN_E2E === "1";
const TIMEOUT = 30000;

describe.skipIf(!enabled)("只读契约（真实内核，SIYUAN_E2E=1）", () => {
  const client = new SiYuanClient(resolveSiYuanConfig());

  it(
    "version 返回语义化版本号",
    async () => {
      const result = await callTool("version", {}, client);
      expect(result.text).toMatch(/\d+\.\d+\.\d+/);
    },
    TIMEOUT,
  );

  it(
    "status 汇总连接信息",
    async () => {
      const result = await callTool("status", {}, client);
      expect(result.text).toContain("连接：");
    },
    TIMEOUT,
  );

  it(
    "notebook_list 返回 id/name 形状的数组",
    async () => {
      const result = await callTool("notebook_list", {}, client);
      expect(Array.isArray(result.data)).toBe(true);
      for (const notebook of result.data as Array<Record<string, unknown>>) {
        expect(typeof notebook.id).toBe("string");
        expect(typeof notebook.name).toBe("string");
      }
    },
    TIMEOUT,
  );

  it(
    "无 LIMIT 的 SELECT 保留 limit=64 且 truncated=true（截断保真）",
    async () => {
      const result = await callTool("sql", { stmt: "SELECT id FROM blocks" }, client);
      expect(result.data).toMatchObject({ limit: 64, truncated: true });
      expect(result.text).toContain("结果被截断");
    },
    TIMEOUT,
  );

  it(
    "显式 LIMIT 时不截断",
    async () => {
      const result = await callTool("sql", { stmt: "SELECT id FROM blocks LIMIT 3" }, client);
      expect(result.data).toMatchObject({ limit: 0, truncated: false });
    },
    TIMEOUT,
  );

  it(
    "只读守卫在真实工具路径上拦截 PRAGMA（不触达内核）",
    async () => {
      await expect(callTool("sql", { stmt: "PRAGMA table_info(blocks)" }, client)).rejects.toThrowError(/只读/);
    },
    TIMEOUT,
  );

  it(
    "tag_list 返回标签数组",
    async () => {
      const result = await callTool("tag_list", {}, client);
      expect(Array.isArray(result.data)).toBe(true);
    },
    TIMEOUT,
  );
});
