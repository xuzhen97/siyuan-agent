import { describe, expect, it } from "vitest";
import {
  DEFAULT_MAX_CHARS,
  renderSqlNotice,
  renderText,
  truncateText,
  TEXT_PREVIEW_LIMIT,
} from "../../src/core/render.ts";

describe("renderText", () => {
  it("空数组给出明确的零结果文案", () => {
    expect(renderText([])).toBe("共 0 条");
  });

  it("少量数组逐条列出并给出总数", () => {
    const out = renderText([{ id: "b1", content: "甲" }]);
    expect(out).toContain("共 1 条");
    expect(out).toContain("b1");
  });

  it("超过预览上限时截断并提示总数", () => {
    const rows = Array.from({ length: 60 }, (_, i) => ({ id: `b${i}` }));
    const out = renderText(rows);
    expect(out).toContain("共 60 条");
    expect(out).toContain(`已显示前 ${TEXT_PREVIEW_LIMIT} 条`);
    expect(out).toContain("b49");
    expect(out).not.toContain("b55");
  });

  it("对象输出键值对而不是 JSON", () => {
    const out = renderText({ id: "b1", closed: false });
    expect(out).toContain("id: b1");
    expect(out).not.toContain("{");
  });

  it("对象里跳过空值字段", () => {
    expect(renderText({ id: "b1", icon: "", memo: null, sort: undefined })).toBe("id: b1");
  });

  it("null / undefined 输出无数据文案", () => {
    expect(renderText(null)).toBe("无数据");
    expect(renderText(undefined)).toBe("无数据");
  });

  it("标量数组按字符串渲染", () => {
    expect(renderText(["#a#", "#b#"])).toContain("#a#");
  });

  it("可自定义预览上限", () => {
    const out = renderText([1, 2, 3, 4], { previewLimit: 2 });
    expect(out).toContain("4 条");
    expect(out).toContain("已显示前 2 条");
  });
});

describe("truncateText", () => {
  it("未超限时原样返回", () => {
    expect(truncateText("abc", 10)).toBe("abc");
  });

  it("超限时截断并写明原文长度", () => {
    const out = truncateText("x".repeat(30), 10);
    expect(out.startsWith("x".repeat(10))).toBe(true);
    expect(out).toContain("已截断");
    expect(out).toContain("30");
  });

  it("默认上限为 DEFAULT_MAX_CHARS", () => {
    expect(truncateText("y".repeat(DEFAULT_MAX_CHARS + 5))).toContain("已截断");
  });
});

describe("renderSqlNotice", () => {
  it("未截断时不提示", () => {
    expect(renderSqlNotice(0, false)).toBe("");
  });

  it("截断时给出默认上限与分页建议", () => {
    const out = renderSqlNotice(64, true);
    expect(out).toContain("64");
    expect(out).toContain("LIMIT");
  });

  it("limit 为 0 时回退显示 64", () => {
    expect(renderSqlNotice(0, true)).toContain("64");
  });
});
