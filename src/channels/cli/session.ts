import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/** REPL 会话状态（对齐参考实现 core/session.py 的 SessionState）。 */
export type SessionState = {
  currentNotebookId: string;
  currentNotebookName: string;
  currentDocId: string;
  currentDocPath: string;
  history: string[];
};

export const emptySession: SessionState = {
  currentNotebookId: "",
  currentNotebookName: "",
  currentDocId: "",
  currentDocPath: "",
  history: [],
};

/** 历史记录上限：避免 session.json 无限增长。 */
export const HISTORY_LIMIT = 200;

export function defaultStateDir(): string {
  return join(homedir(), ".siyuan-agent");
}

/**
 * 会话状态持久化（load / save / update / flush，对齐参考实现的 SessionManager）。
 * 读取容错：文件不存在、JSON 损坏、字段缺失一律回退，绝不抛异常。
 */
export class SessionManager {
  readonly sessionPath: string;
  state: SessionState = { ...emptySession, history: [] };
  private dirty = false;

  constructor(stateDir?: string) {
    this.sessionPath = join(stateDir ?? defaultStateDir(), "session.json");
  }

  load(): SessionState {
    try {
      const parsed: unknown = JSON.parse(readFileSync(this.sessionPath, "utf-8").replace(/^\uFEFF/, ""));
      const raw = (parsed ?? {}) as Partial<Record<keyof SessionState, unknown>>;
      const str = (value: unknown): string => (typeof value === "string" ? value : "");
      const history = Array.isArray(raw.history) ? raw.history.filter((item) => typeof item === "string") : [];
      this.state = {
        currentNotebookId: str(raw.currentNotebookId),
        currentNotebookName: str(raw.currentNotebookName),
        currentDocId: str(raw.currentDocId),
        currentDocPath: str(raw.currentDocPath),
        history: history.slice(-HISTORY_LIMIT),
      };
    } catch {
      this.state = { ...emptySession, history: [] };
    }
    this.dirty = false;
    return this.state;
  }

  update(patch: Partial<SessionState>): void {
    if (patch.history !== undefined) {
      this.state.history = patch.history.slice(-HISTORY_LIMIT);
    }
    for (const key of ["currentNotebookId", "currentNotebookName", "currentDocId", "currentDocPath"] as const) {
      const value = patch[key];
      if (typeof value === "string") this.state[key] = value;
    }
    this.dirty = true;
  }

  /** 仅在有过 update 时写盘（避免无谓 IO）。 */
  flush(): void {
    if (!this.dirty) return;
    mkdirSync(dirname(this.sessionPath), { recursive: true });
    writeFileSync(this.sessionPath, `${JSON.stringify(this.state, null, 2)}\n`, "utf-8");
    this.dirty = false;
  }
}
