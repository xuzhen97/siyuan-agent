import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SessionManager, emptySession } from "../../src/channels/cli/session.ts";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "siyuan-agent-session-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("SessionManager（对齐参考实现 core/session.py）", () => {
  it("默认状态为空，且状态文件位于给定目录下的 session.json", () => {
    const manager = new SessionManager(dir);
    expect(manager.load()).toEqual(emptySession);
    expect(manager.sessionPath).toBe(join(dir, "session.json"));
  });

  it("update 后 flush 会落盘，可被新的 manager 读回", () => {
    const manager = new SessionManager(dir);
    manager.load();
    manager.update({ currentNotebookId: "nb1", currentNotebookName: "知识库", currentDocId: "d1", currentDocPath: "/甲" });
    manager.flush();

    const reopened = new SessionManager(dir);
    const state = reopened.load();
    expect(state.currentNotebookId).toBe("nb1");
    expect(state.currentNotebookName).toBe("知识库");
    expect(state.currentDocId).toBe("d1");
    expect(state.currentDocPath).toBe("/甲");
  });

  it("未 update 时 flush 不写盘（避免无谓 IO）", () => {
    const manager = new SessionManager(dir);
    manager.load();
    manager.flush();
    expect(existsSync(join(dir, "session.json"))).toBe(false);
  });

  it("状态文件损坏时回退为空状态，不抛异常", () => {
    writeFileSync(join(dir, "session.json"), "{oops", "utf-8");
    const manager = new SessionManager(dir);
    expect(manager.load()).toEqual(emptySession);
  });

  it("未知字段被忽略，缺失字段用默认值补齐（向前兼容）", () => {
    writeFileSync(
      join(dir, "session.json"),
      JSON.stringify({ currentNotebookId: "nb9", futureField: 1 }),
      "utf-8",
    );
    const state = new SessionManager(dir).load();
    expect(state.currentNotebookId).toBe("nb9");
    expect(state.currentDocPath).toBe("");
    expect(state.history).toEqual([]);
  });

  it("历史记录有上限，避免文件无限增长", () => {
    const manager = new SessionManager(dir);
    manager.load();
    for (let i = 0; i < 260; i += 1) manager.update({ history: [...manager.state.history, `cmd-${i}`] });
    manager.flush();

    const state = new SessionManager(dir).load();
    expect(state.history.length).toBeLessThanOrEqual(200);
    expect(state.history.at(-1)).toBe("cmd-259");
  });

  it("写入的是合法 JSON 且带末尾换行（便于人工查看）", () => {
    const manager = new SessionManager(dir);
    manager.load();
    manager.update({ currentNotebookName: "知识库" });
    manager.flush();

    const raw = readFileSync(join(dir, "session.json"), "utf-8");
    expect(raw.endsWith("\n")).toBe(true);
    expect(JSON.parse(raw).currentNotebookName).toBe("知识库");
  });
});
