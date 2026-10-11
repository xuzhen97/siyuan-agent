import { describe, expect, it, vi } from "vitest";
import type { SiYuanClient } from "../../src/core/client.ts";
import type { ToolSpec } from "../../src/tools/types.ts";
import { captureError } from "../helpers/errors.ts";
import {
  buildBlockPreview,
  buildDocPreview,
  isDestructive,
  previewBlock,
  previewDoc,
  requireConfirm,
  requireFreshHash,
  shouldDryRun,
} from "../../src/tools/write-guard.ts";

const destructive = { name: "block_delete", risk: "destructive" } as unknown as ToolSpec;
const additive = { name: "block_append", risk: "additive" } as unknown as ToolSpec;

describe("isDestructive", () => {
  it("仅 destructive 为真", () => {
    expect(isDestructive(destructive)).toBe(true);
    expect(isDestructive(additive)).toBe(false);
  });
});

describe("preview 渲染", () => {
  it("块预览带子块数与内容摘要", () => {
    const out = previewBlock("第一行\n第二行", 3);
    expect(out).toContain("子块数：3");
    expect(out).toContain("第一行");
  });

  it("超长内容被截断（200 字上限）", () => {
    const out = previewBlock("x".repeat(500), 0);
    expect(out).toContain("已截断");
  });

  it("空块有明确文案", () => {
    expect(previewBlock("", 0)).toContain("空块");
  });

  it("文档预览带 hpath；不存在时给出明确文案", () => {
    expect(previewDoc("/沙盒/甲", 4)).toContain("/沙盒/甲");
    expect(previewDoc(undefined, 0)).toContain("不存在");
  });
});

describe("requireConfirm（R1）", () => {
  const preview = "将删除块 b1";

  it("缺失/false/非 true 值一律拒绝，错误码 SIYUAN_CONFIRM_REQUIRED，消息含预览", () => {
    for (const args of [{}, { confirm: false }, { confirm: "yes" }] as Array<Record<string, unknown>>) {
      let err: unknown;
      try {
        requireConfirm(destructive, args, preview, true);
      } catch (e) {
        err = e;
      }
      expect((err as { code: string }).code).toBe("SIYUAN_CONFIRM_REQUIRED");
      expect((err as Error).message).toContain("将删除块 b1");
    }
  });

  it("confirm: true 时放行", () => {
    expect(() => requireConfirm(destructive, { confirm: true }, preview, true)).not.toThrow();
  });

  it("目标不存在时拒绝（即使 confirm: true）", () => {
    expect(() => requireConfirm(destructive, { confirm: true }, preview, false)).toThrowError(/不存在/);
  });

  it("增量型工具不需要 confirm", () => {
    expect(() => requireConfirm(additive, {}, preview, true)).not.toThrow();
  });
});

describe("shouldDryRun", () => {
  it("仅字面 true 为真", () => {
    expect(shouldDryRun({ dryRun: true })).toBe(true);
    expect(shouldDryRun({})).toBe(false);
    expect(shouldDryRun({ dryRun: "true" })).toBe(false);
    expect(shouldDryRun({ dryRun: 1 })).toBe(false);
  });
});

describe("requireFreshHash（R4/R5）", () => {
  const client = { getBlockHash: vi.fn(async () => "curr123") } as unknown as SiYuanClient;

  it("未传 expectedHash 时不做校验", async () => {
    await expect(requireFreshHash(client, "b1")).resolves.toBeUndefined();
  });

  it("哈希一致时放行", async () => {
    await expect(requireFreshHash(client, "b1", "curr123")).resolves.toBeUndefined();
  });

  it("哈希不一致时抛 SIYUAN_STALE_TARGET 并给出当前哈希", async () => {
    const err = await captureError(requireFreshHash(client, "b1", "old999"));
    expect(err.code).toBe("SIYUAN_STALE_TARGET");
    expect(err.message).toContain("curr123");
  });

  it("目标块已不存在时也抛 SIYUAN_STALE_TARGET", async () => {
    const gone = { getBlockHash: vi.fn(async () => undefined) } as unknown as SiYuanClient;
    const err = await captureError(requireFreshHash(gone, "b1", "curr123"));
    expect(err.code).toBe("SIYUAN_STALE_TARGET");
  });
});

describe("buildBlockPreview / buildDocPreview", () => {
  it("块不存在时 exists=false 且不抛异常", async () => {
    const client = {
      getBlockKramdown: vi.fn(async () => {
        throw new Error("not found");
      }),
      getChildBlocks: vi.fn(async () => []),
    } as unknown as SiYuanClient;
    const out = await buildBlockPreview(client, "nope");
    expect(out.exists).toBe(false);
    expect(out.preview).toContain("不存在");
  });

  it("块预览汇总内容与子块数", async () => {
    const client = {
      getBlockKramdown: vi.fn(async () => ({ id: "b1", kramdown: "内容" })),
      getChildBlocks: vi.fn(async () => [{ id: "c1" }, { id: "c2" }]),
    } as unknown as SiYuanClient;
    const out = await buildBlockPreview(client, "b1");
    expect(out.exists).toBe(true);
    expect(out.preview).toContain("子块数：2");
  });

  it("文档预览用 doc_hpath_by_id", async () => {
    const client = {
      getHPathByID: vi.fn(async () => "/沙盒/甲"),
      getChildBlocks: vi.fn(async () => [{}, {}]),
    } as unknown as SiYuanClient;
    const out = await buildDocPreview(client, "d1");
    expect(out.exists).toBe(true);
    expect(out.preview).toContain("/沙盒/甲");
  });

  it("文档不存在时 exists=false", async () => {
    const client = {
      getHPathByID: vi.fn(async () => {
        throw new Error("nf");
      }),
      getChildBlocks: vi.fn(async () => []),
    } as unknown as SiYuanClient;
    expect((await buildDocPreview(client, "d9")).exists).toBe(false);
  });
});
