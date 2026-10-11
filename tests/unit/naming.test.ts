import { describe, expect, it } from "vitest";
import { fromVcpCommand, toCliPath, toPiToolName, toVcpCommand } from "../../src/tools/naming.ts";

describe("命名派生（ADR-0001）", () => {
  it("Pi 工具名加 siyuan_ 前缀", () => {
    expect(toPiToolName("notebook_list")).toBe("siyuan_notebook_list");
  });

  it("VCP command 转 PascalCase", () => {
    expect(toVcpCommand("doc_ids_by_hpath")).toBe("DocIdsByHpath");
  });

  it("VCP command 单段也可用", () => {
    expect(toVcpCommand("sql")).toBe("Sql");
  });

  it("CLI 路径按 _ 拆分", () => {
    expect(toCliPath("notebook_list")).toEqual(["notebook", "list"]);
  });

  it("CLI 路径为两级（组 + 剩余部分），不把多段 canonical 完全拆开", () => {
    expect(toCliPath("doc_ids_by_hpath")).toEqual(["doc", "ids_by_hpath"]);
    expect(toCliPath("block_attrs_get")).toEqual(["block", "attrs_get"]);
    expect(toCliPath("sql")).toEqual(["sql"]);
  });

  it("fromVcpCommand 可还原 canonical", () => {
    expect(fromVcpCommand("DocIdsByHpath")).toBe("doc_ids_by_hpath");
  });

  it("canonical → VCP → canonical 往返稳定", () => {
    for (const canonical of [
      "notebook_list",
      "doc_ids_by_hpath",
      "block_attrs_set",
      "search_blocks",
      "version",
      "sql",
      "doc_export_md",
    ]) {
      expect(fromVcpCommand(toVcpCommand(canonical))).toBe(canonical);
    }
  });

  it("fromVcpCommand 直接接受 canonical", () => {
    expect(fromVcpCommand("notebook_list")).toBe("notebook_list");
  });

  it("fromVcpCommand 对单段 PascalCase 还原为单段", () => {
    expect(fromVcpCommand("Sql")).toBe("sql");
  });

  it("fromVcpCommand 对连续大写缩写不粘连出错", () => {
    expect(fromVcpCommand("GetBlockHPathByID")).toBe("get_block_h_path_by_id");
  });
});
