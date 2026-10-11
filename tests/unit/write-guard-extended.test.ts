import { describe, expect, it } from "vitest";
import { captureError } from "../helpers/errors.ts";
import { requireConfirmName, requireIdList } from "../../src/tools/write-guard.ts";

describe("requireConfirmName（R9：整库删除的二次确认）", () => {
  const realName = "时鎏的知识库";

  it("confirmName 逐字匹配时放行", () => {
    expect(() => requireConfirmName({ confirmName: realName }, realName, "删除笔记本")).not.toThrow();
  });

  it("前后空白被容忍（复制粘贴常带空格）", () => {
    expect(() => requireConfirmName({ confirmName: `  ${realName} ` }, realName, "删除笔记本")).not.toThrow();
  });

  it("缺失 confirmName 时抛 SIYUAN_CONFIRM_MISMATCH 并给出实际名称", async () => {
    const err = await captureError(Promise.resolve().then(() => requireConfirmName({}, realName, "删除笔记本")));
    expect(err.code).toBe("SIYUAN_CONFIRM_MISMATCH");
    expect(err.hint).toContain(realName);
  });

  it("名称不一致时同样拒绝（不做模糊匹配）", async () => {
    const err = await captureError(
      Promise.resolve().then(() => requireConfirmName({ confirmName: "时鎏的知识" }, realName, "删除笔记本")),
    );
    expect(err.code).toBe("SIYUAN_CONFIRM_MISMATCH");
  });

  it("目标名称为空时拒绝（避免空串绕过）", async () => {
    const err = await captureError(
      Promise.resolve().then(() => requireConfirmName({ confirmName: "" }, "", "删除笔记本")),
    );
    expect(err.code).toBe("SIYUAN_CONFIRM_MISMATCH");
  });
});

describe("requireIdList（R10：批量替换必须限定 ids）", () => {
  it("接受数组", () => {
    expect(requireIdList({ ids: ["b1", "b2"] }, "ids")).toEqual(["b1", "b2"]);
  });

  it("接受 JSON 字符串数组", () => {
    expect(requireIdList({ ids: '["b1","b2"]' }, "ids")).toEqual(["b1", "b2"]);
  });

  it("接受逗号分隔字符串", () => {
    expect(requireIdList({ ids: "b1, b2 ," }, "ids")).toEqual(["b1", "b2"]);
  });

  it("过滤空白项并去重", () => {
    expect(requireIdList({ ids: ["b1", " b1 ", "", "  "] }, "ids")).toEqual(["b1"]);
  });

  it("空数组 / 缺失 / 非法 JSON 一律拒绝（不允许全库替换）", async () => {
    for (const args of [{}, { ids: [] }, { ids: "" }, { ids: "[oops" }] as Array<Record<string, unknown>>) {
      const err = await captureError(Promise.resolve().then(() => requireIdList(args, "ids")));
      expect(err.code).toBe("SIYUAN_API_ERROR");
      expect(err.message).toContain("不允许全库替换");
    }
  });
});
