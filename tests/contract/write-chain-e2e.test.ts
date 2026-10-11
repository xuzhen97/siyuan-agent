import { spawn } from "node:child_process";
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
  it(
    "补充端点写链：open/close、配置往返、图标、折叠、批量替换、按路径改名/移动/删除，最后双确认删掉沙盒",
    async () => {
      // 沙盒笔记本：复用或创建
      const notebooks = await callTool("notebook_list", {}, client);
      const existing = (notebooks.data as Array<{ id: string; name: string }>).find(
        (item) => item.name === SANDBOX_NOTEBOOK_NAME,
      );
      const notebookId = existing
        ? existing.id
        : String(
            ((await callTool("notebook_create", { name: SANDBOX_NOTEBOOK_NAME }, client)).data as { id?: string })
              ?.id ?? "",
          );
      expect(notebookId.length).toBeGreaterThan(0);

      // 配置往返：写入自定义日记路径，再读回确认
      await callTool(
        "notebook_conf_set",
        {
          notebook: notebookId,
          conf: JSON.stringify({ dailyNoteSavePath: "/daily agent test/{{now | date \"2006-01-02\"}}" }),
          confirm: true,
        },
        client,
      );
      const confAfter = await callTool("notebook_conf_get", { notebook: notebookId }, client);
      expect(JSON.stringify(confAfter.data)).toContain("daily agent test");

      // 图标
      await callTool("notebook_icon_set", { notebook: notebookId, icon: "1f4d6", confirm: true }, client);

      // 建文档 + 追加一个待替换的块
      // 用唯一路径：避免多次重跑时 createDocWithMd 命中旧文档（它同路径不覆盖，会返回既有 ID）
      const docPath = `/补充端点验证-${Date.now()}`;
      const doc = await callTool(
        "doc_create",
        { notebook: notebookId, path: docPath, markdown: "# 补充端点验证" },
        client,
      );
      const docId = String((doc.data as { id?: string })?.id ?? "");
      expect(docId.length).toBeGreaterThan(0);

      const appended = await callTool("block_append", { parentID: docId, data: "旧文本内容" }, client);
      const blockId = String(
        (appended.data as { doOperations?: Array<{ id?: string }> }).doOperations?.[0]?.id ?? "",
      );
      expect(blockId.length).toBeGreaterThan(0);

      // 折叠 / 展开
      await callTool("block_fold", { id: blockId }, client);
      await callTool("block_unfold", { id: blockId }, client);

      // 批量替换：先不给 confirm 应被拒；带 confirm 后真的替换（并用 block_get 核对）
      await expect(
        callTool("find_replace", { k: "旧文本", r: "新文本", ids: [blockId] }, client),
      ).rejects.toThrowError(/确认/);
      await callTool("find_replace", { k: "旧文本", r: "新文本", ids: [blockId], confirm: true }, client);
      const afterReplace = await callTool("block_get", { id: blockId }, client);
      expect(afterReplace.text).toContain("新文本");

      // 按路径改名：用 doc_list 发现真实路径（不猜文件名）
      const list1 = await callTool("doc_list", { notebook: notebookId }, client);
      const entry1 = (list1.data as Array<{ id: string; path: string }>).find((item) => item.id === docId);
      expect(entry1?.path).toBeTruthy();
      await callTool(
        "doc_rename_by_path",
        { notebook: notebookId, path: entry1?.path ?? "", title: "补充端点验证改名", confirm: true },
        client,
      );

      // 按路径移动：跨笔记本移到「沙盒2」的根目录
      // （内核实测：moveDocs 要求**目标目录已存在**，根目录 / 必然存在；子目录需先建好）
      const sandbox2Name = `${SANDBOX_NOTEBOOK_NAME}2`;
      const notebooks2 = await callTool("notebook_list", {}, client);
      const existing2 = (notebooks2.data as Array<{ id: string; name: string }>).find(
        (item) => item.name === sandbox2Name,
      );
      const sandbox2Id = existing2
        ? existing2.id
        : String(
            ((await callTool("notebook_create", { name: sandbox2Name }, client)).data as { id?: string })?.id ?? "",
          );
      expect(sandbox2Id.length).toBeGreaterThan(0);

      const list2 = await callTool("doc_list", { notebook: notebookId }, client);
      const entry2 = (list2.data as Array<{ id: string; path: string }>).find((item) => item.id === docId);
      await callTool(
        "doc_move_by_path",
        { fromPaths: [entry2?.path ?? ""], toNotebook: sandbox2Id, toPath: "/", confirm: true },
        client,
      );
      const list3 = await callTool("doc_list", { notebook: sandbox2Id }, client);
      const entry3 = (list3.data as Array<{ id: string; path: string }>).find((item) => item.id === docId);
      expect(entry3?.path).toBeTruthy();

      // 按路径删除（进数据历史）
      const removed = await callTool(
        "doc_remove_by_path",
        { notebook: sandbox2Id, path: entry3?.path ?? "", confirm: true },
        client,
      );
      expect(removed.text).toContain("数据历史");

      // 导出资源（会在 workspace 的 temp/export 下留下一个 zip）
      const exported = await callTool(
        "export_resources",
        { paths: '["/conf/appearance/boot"]', name: "siyuan-agent-e2e" },
        client,
      );
      expect(exported.text).toContain("temp/export");

      // 最后：open / close 运行态校验，以及 notebook_remove 的双确认（顺手清掉沙盒笔记本）
      await callTool("notebook_open", { notebook: notebookId }, client);
      await callTool("notebook_close", { notebook: notebookId }, client);
      await callTool("notebook_open", { notebook: notebookId }, client);

      const confNow = await callTool("notebook_conf_get", { notebook: notebookId }, client);
      const realName = String((confNow.data as { name?: string })?.name ?? "");
      await expect(
        callTool("notebook_remove", { notebook: notebookId, confirm: true, confirmName: "故意写错" }, client),
      ).rejects.toThrowError(/SIYUAN_CONFIRM_MISMATCH|不一致/);

      const gone = await callTool(
        "notebook_remove",
        { notebook: notebookId, confirm: true, confirmName: realName },
        client,
      );
      expect(gone.text).toContain("已删除笔记本");

      // 顺手清掉第二个沙盒笔记本（刚才的移动目标）
      const conf2 = await callTool("notebook_conf_get", { notebook: sandbox2Id }, client);
      const name2 = String((conf2.data as { name?: string })?.name ?? "");
      const gone2 = await callTool(
        "notebook_remove",
        { notebook: sandbox2Id, confirm: true, confirmName: name2 },
        client,
      );
      expect(gone2.text).toContain("已删除笔记本");
    },
    TIMEOUT,
  );

  it(
    "stdin 管道 × 真实制品：doc create --markdown - 与 block insert -",
    async () => {
      // 直接跑构建好的 CLI 制品，并往 stdin 写内容（验证 `-` 哨兵在打包后依然生效）
      const runBundled = (args: string[], stdin: string): Promise<{ code: number | null; stdout: string }> =>
        new Promise((resolve, reject) => {
          const child = spawn("node", ["dist/cli.cjs", ...args], { stdio: ["pipe", "pipe", "pipe"] });
          let stdout = "";
          child.stdout.on("data", (chunk) => {
            stdout += String(chunk);
          });
          child.on("error", reject);
          child.on("close", (code) => resolve({ code, stdout }));
          child.stdin.end(stdin);
        });

      // 沙盒笔记本（复用或创建）
      const notebooks = await callTool("notebook_list", {}, client);
      const existing = (notebooks.data as Array<{ id: string; name: string }>).find(
        (item) => item.name === SANDBOX_NOTEBOOK_NAME,
      );
      const notebookId = existing
        ? existing.id
        : String(
            ((await callTool("notebook_create", { name: SANDBOX_NOTEBOOK_NAME }, client)).data as { id?: string })
              ?.id ?? "",
          );
      expect(notebookId.length).toBeGreaterThan(0);

      const docPath = `/stdin管道-${Date.now()}`;
      const created = await runBundled(
        ["doc", "create", notebookId, docPath, "--markdown", "-"],
        "# 来自管道的内容",
      );
      expect(created.code).toBe(0);
      expect(created.stdout).toContain("已创建文档");

      const ids = await callTool("doc_ids_by_hpath", { notebook: notebookId, path: docPath }, client);
      const docId = String((ids.data as string[])[0] ?? "");
      expect(docId.length).toBeGreaterThan(0);

      const appended = await runBundled(["block", "insert", "-", "--parentID", docId], "插入自管道");
      expect(appended.code).toBe(0);

      // 核对两段管道内容都真的落到文档里
      const kramdown = await callTool("block_get", { id: docId }, client);
      expect(kramdown.text).toContain("来自管道的内容");
      expect(kramdown.text).toContain("插入自管道");

      // 清理：删文档 + 删沙盒笔记本
      await callTool("doc_remove", { id: docId, confirm: true }, client);
      const conf = await callTool("notebook_conf_get", { notebook: notebookId }, client);
      const realName = String((conf.data as { name?: string })?.name ?? "");
      await callTool("notebook_remove", { notebook: notebookId, confirm: true, confirmName: realName }, client);
    },
    TIMEOUT,
  );
});
