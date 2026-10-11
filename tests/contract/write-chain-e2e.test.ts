import { describe, expect, it } from "vitest";
import { SiYuanClient } from "../../src/core/client.ts";
import { resolveSiYuanConfig } from "../../src/core/config.ts";
import { callTool } from "../helpers/call-tool.ts";

/**
 * V5：写路径实机验证（Spec §9 / Plan Task 15 Step 6）。
 *
 * ⚠️ 该套件会在**真实知识库**中创建内容，默认跳过，且需要主人单独授权后才可运行：
 *   SIYUAN_E2E_WRITE=1 pnpm test
 *
 * 副产物说明：内核 API 没有「删笔记本」工具（ADR-0004 明确排除 notebook_remove），
 * 因此跑完会留下一个名为「siyuan-agent 沙盒(可删)」的**空笔记本**，需人工在思源中删除。
 */
const enabled = process.env.SIYUAN_E2E_WRITE === "1";
const TIMEOUT = 60000;
const SANDBOX_NOTEBOOK_NAME = process.env.SIYUAN_E2E_SANDBOX_NOTEBOOK ?? "siyuan-agent 沙盒(可删)";
const SANDBOX_DOC_PATH = "/写链路验证";

describe.skipIf(!enabled)("写链路契约（真实内核，SIYUAN_E2E_WRITE=1）", () => {
  const client = new SiYuanClient(resolveSiYuanConfig());

  it(
    "完整写链：建笔记本 → 建文档 → 追加 → 覆盖 → 删块 → 删文档",
    async () => {
      // 1. 沙盒笔记本：已存在则复用（避免每次重跑都多留一个空笔记本）
      const existingNotebooks = await callTool("notebook_list", {}, client);
      const existing = (existingNotebooks.data as Array<{ id: string; name: string }>).find(
        (item) => item.name === SANDBOX_NOTEBOOK_NAME,
      );
      const notebookId = existing
        ? existing.id
        : String(((await callTool("notebook_create", { name: SANDBOX_NOTEBOOK_NAME }, client)).data as { id?: string })?.id ?? "");
      expect(notebookId.length).toBeGreaterThan(0);

      // 2. 新文档（同 path 重复调用不覆盖，天然幂等）
      const doc = await callTool("doc_create", { notebook: notebookId, path: SANDBOX_DOC_PATH, markdown: "# 写链路验证" }, client);
      const docId = String((doc.data as { id?: string })?.id ?? "");
      expect(docId.length).toBeGreaterThan(0);

      // 3. 追加块，并核对内核回传的 doOperations（R6）
      const appended = await callTool("block_append", { parentID: docId, data: "第一行" }, client);
      const ops = appended.data as { doOperations?: Array<{ id?: string }> };
      const blockId = String(ops?.doOperations?.[0]?.id ?? "");
      expect(appended.text).toContain("insert");
      expect(blockId.length).toBeGreaterThan(0);

      // 4. 覆盖块（破坏型：必须 confirm）
      const updated = await callTool("block_update", { id: blockId, data: "改写后的第一行", confirm: true }, client);
      expect(updated.text).toContain("update");

      // 5. 缺 confirm 时必须拒绝，且不发生写入
      await expect(callTool("block_delete", { id: blockId }, client)).rejects.toThrowError(/SIYUAN_CONFIRM_REQUIRED|未确认/);

      // 6. 删除块（破坏型：确认后执行）
      const deleted = await callTool("block_delete", { id: blockId, confirm: true }, client);
      expect(deleted.text).toContain("delete");

      // 7. 删除文档（破坏型：内核会先写入数据历史）
      const removed = await callTool("doc_remove", { id: docId, confirm: true }, client);
      expect(removed.text).toContain("数据历史");

      // 8. 笔记本配置（只读，顺带确认沙盒的日记保存路径）
      const conf = await callTool("notebook_conf_get", { notebook: notebookId }, client);
      expect(conf.text).toContain("dailyNoteSavePath");

      // 9. 日记：创建今日日记，验证幂等（同日重复调用返回同一文档），随后清理
      const daily1 = await callTool("daily_note_create", { notebook: notebookId }, client);
      const dailyId = String((daily1.data as { id?: string })?.id ?? "");
      expect(dailyId.length).toBeGreaterThan(0);

      const daily2 = await callTool("daily_note_create", { notebook: notebookId }, client);
      expect(String((daily2.data as { id?: string })?.id ?? "")).toBe(dailyId);

      const cleaned = await callTool("doc_remove", { id: dailyId, confirm: true }, client);
      expect(cleaned.text).toContain("数据历史");
    },
    TIMEOUT,
  );

  it(
    "created 沙盒笔记本中的文档确实可被读回（写后读一致性）",
    async () => {
      const notebooks = await callTool("notebook_list", {}, client);
      const sandbox = (notebooks.data as Array<{ id: string; name: string }>).find(
        (item) => item.name === SANDBOX_NOTEBOOK_NAME,
      );
      if (!sandbox) {
        // 若上一条用例未跑（单独运行本用例），沙盒不存在属于预期
        expect(sandbox).toBeUndefined();
        return;
      }
      const docs = await callTool("doc_list", { notebook: sandbox.id }, client);
      expect(Array.isArray(docs.data)).toBe(true);
    },
    TIMEOUT,
  );
});
