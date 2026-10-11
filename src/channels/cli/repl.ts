import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";
import { SiYuanClient } from "../../core/client.ts";
import { resolveSiYuanConfig } from "../../core/config.ts";
import { dispatchTool } from "../../tools/dispatch.ts";
import { TOOL_SPECS } from "../../tools/definitions.ts";
import { parseCliArgs, splitReplArgs } from "./args.ts";
import { STDIN_SENTINEL, stdinParams } from "./stdin.ts";
import { SessionManager, type SessionState } from "./session.ts";
import { makeSkin } from "./skin.ts";

/** REPL 命令表（对齐参考实现 siyuan_cli.py::_build_repl_commands）。 */
export const REPL_COMMANDS: Record<string, string> = {
  "notebook list": "List all notebooks",
  "notebook create <name>": "Create a notebook",
  "notebook rename <id> <name>": "Rename a notebook",
  "notebook remove <id>": "Remove a notebook",
  "doc create <notebook> <path>": "Create a document with optional --md content",
  "doc list <notebook> <path>": "List documents at path",
  "doc tree <notebook> <文档路径或ID>": "以某篇文档为根列出子树（内核不接受根路径）",
  "doc get <id>": "Get document info by ID",
  "block insert <parent> <data>": "Insert a block (use '-' for stdin)",
  "block update <id> <data>": "Update a block (use '-' for stdin)",
  "block delete <id>": "Delete a block",
  "block get <id>": "Get block kramdown source",
  "sql <stmt>": "Execute SQL query",
  "search <query>": "Full-text search",
  "export md <doc-id>": "Export doc as Markdown",
  status: "Show connection and session status",
  help: "Show this help",
  quit: "Exit REPL",
};

export type ReplDeps = {
  input?: Readable;
  output?: Writable;
  client?: SiYuanClient;
  stateDir?: string;
  color?: boolean;
  version?: string;
};

const QUIT_WORDS = new Set(["quit", "exit", "q", ":q"]);
const HELP_WORDS = new Set(["help", "?", "h"]);

function promptLabel(state: SessionState): string {
  return state.currentDocPath || state.currentNotebookName || "siyuan";
}

/**
 * 参考实现 REPL 的语法兼容层：让参考实现的命令写法在本 REPL 里也能用。
 * - `search <query>` → `search blocks <query>`（参考实现的 search 就是全文搜块）
 * - `export md <doc-id>` → `doc export_md <doc-id>`
 * - `doc get <id>` → `doc path_by_id <id>`
 * - `block insert <parent> <data>` → 本项目参数顺序是 `insert <data> --parentID <id>`
 * - `--md <content>` → 本项目写作 `--markdown <content>`
 * - `sql ...` / `search ...`：把剩余 token 拼回参数（对齐参考实现的 " ".join(parts[1:])，REPL 里不必加引号）
 */
export function applyReplAliases(argv: string[]): string[] {
  const [first, second] = argv;

  if (first === "sql" && argv.length > 2) {
    return ["sql", argv.slice(1).join(" ")];
  }
  if (first === "search" && second !== undefined && !["blocks", "docs", "tag"].includes(second)) {
    return ["search", "blocks", argv.slice(1).join(" ")];
  }
  if (first === "search" && second === "blocks" && argv.length > 3) {
    return ["search", "blocks", argv.slice(2).join(" ")];
  }
  if (first === "export" && second === "md") {
    return ["doc", "export_md", ...argv.slice(2)];
  }
  if (first === "doc" && second === "get") {
    return ["doc", "path_by_id", ...argv.slice(2)];
  }
  if (first === "block" && second === "insert" && argv.length >= 4) {
    // 本项目参数名是 parentID（选项名归一化后为 parentid）
    return ["block", "insert", argv[3] as string, "--parentID", argv[2] as string, ...argv.slice(4)];
  }

  const mdIndex = argv.indexOf("--md");
  if (mdIndex !== -1) {
    const next = [...argv];
    next.splice(mdIndex, 1, "--markdown");
    return next;
  }

  return argv;
}

/**
 * 交互式 REPL（对齐参考实现的 repl 子命令与命令表）。
 * 与参考实现的一处**有意差异**：写操作同样走本项目的 confirm 规则，REPL 不能绕过安全检查。
 */
export async function runRepl(deps?: ReplDeps): Promise<number> {
  const input = deps?.input ?? process.stdin;
  const output = deps?.output ?? process.stdout;
  const interactive = Boolean((input as { isTTY?: boolean }).isTTY);
  const skin = makeSkin({ color: deps?.color, isTty: (output as { isTTY?: boolean }).isTTY });
  const session = new SessionManager(deps?.stateDir);
  const state = session.load();
  const client = deps?.client ?? new SiYuanClient(resolveSiYuanConfig());

  const write = (text: string): void => {
    output.write(`${text}\n`);
  };

  // 先同步建好 readline 与队列，再做可能耗时的事情（版本探测）：
  // 否则调用方在探测期间写入的输入会整行丢失（实测：批量管道输入时命令凭空消失）。
  const rl = createInterface({ input, output, terminal: interactive });
  const queue: string[] = [];
  let draining = false;
  let closed = false;
  let inputClosed = false;
  let finished = false;
  let resolveDone: (code: number) => void = () => {};
  const done = new Promise<number>((resolve) => {
    resolveDone = resolve;
  });

  /**
   * 收尾条件必须是「输入已关闭」**且**「队列已排空」：
   * 输入流结束时 readline 会立即发 close 事件，而异步命令可能还在执行——
   * 只看 close 会导致提前 resolve、只写出 banner（实测踩过）。
   */
  const finishIfIdle = (): void => {
    if (finished) return;
    if (!inputClosed) return;
    if (draining || queue.length > 0) return;
    finished = true;
    session.flush();
    write(skin.goodbye());
    resolveDone(0);
  };

  const handle = async (rawLine: string): Promise<void> => {
    const line = rawLine.trim();
    if (line.length === 0) return;

    session.update({ history: [...state.history, line] });
    const lower = line.toLowerCase();

    if (QUIT_WORDS.has(lower)) {
      closed = true;
      rl.close();
      return;
    }
    if (HELP_WORDS.has(lower)) {
      write(skin.help(REPL_COMMANDS));
      session.flush();
      return;
    }

    const parsed = parseCliArgs(applyReplAliases(splitReplArgs(line)));
    const spec = TOOL_SPECS.find((item) => item.name === parsed.tool);
    if (!spec) {
      write(skin.error(`未知命令：${line}（输入 help 查看可用命令）`));
      session.flush();
      return;
    }

    // REPL 里不允许 `-` 读 stdin：那会吞掉会话自身的输入（参考实现此处会阻塞，我们不照搬）
    if (stdinParams(spec).some((param) => parsed.args[param] === STDIN_SENTINEL)) {
      write(
        skin.error(
          'REPL 内不支持 `-` 从 stdin 读取（会吞掉会话输入）：请改用 --markdown "文本"，或用管道调用 CLI 命令。',
        ),
      );
      session.flush();
      return;
    }

    const outcome = await dispatchTool(spec, parsed.args, client);
    if (!outcome.ok) {
      const { code, message, hint } = outcome.error;
      write(skin.error(`[${code}] ${message}${hint ? `\n  ${hint}` : ""}`));
      session.flush();
      return;
    }

    write(
      parsed.global.json
        ? JSON.stringify(outcome.result.data ?? { text: outcome.result.text })
        : outcome.result.text,
    );

    // 记录会话上下文（对齐参考实现：创建/打开后更新 current_*，供 prompt 与 status 使用）
    const data = (outcome.result.data ?? {}) as Record<string, unknown>;
    if (spec.name === "status") {
      write(
        skin.statusBlock({
          当前笔记本: state.currentNotebookName || "(未选择)",
          当前文档: state.currentDocPath || "(未选择)",
        }),
      );
    }
    if (spec.name === "doc_create") {
      session.update({ currentDocId: String(data.id ?? ""), currentDocPath: String(data.path ?? "") });
    }
    if (spec.name === "daily_note_create") {
      session.update({ currentDocId: String(data.id ?? "") });
    }
    if (spec.name === "notebook_create") {
      session.update({ currentNotebookId: String(data.id ?? ""), currentNotebookName: String(data.name ?? "") });
    }
    if (spec.name === "notebook_open") {
      session.update({ currentNotebookId: String(data.notebook ?? "") });
    }
    session.flush();
  };

  // 顺序执行：避免多条异步命令交错输出
  const drain = async (): Promise<void> => {
    if (draining) return;
    draining = true;
    while (queue.length > 0 && !closed) {
      const next = queue.shift();
      if (next === undefined) break;
      await handle(next);
      if (interactive) rl.prompt();
    }
    draining = false;
    finishIfIdle();
  };

  rl.on("line", (line) => {
    queue.push(line);
  });
  rl.on("close", () => {
    inputClosed = true;
    // 必须在这里也尝试收尾：EOF（无 quit）时 close 可能发生在 drain 结束之后
    finishIfIdle();
  });

  let version = deps?.version ?? "";
  if (version.length === 0) {
    try {
      version = await client.version();
    } catch {
      version = "?";
    }
  }
  write(skin.banner(version, `${client.config.host}:${client.config.port}`));

  if (interactive) {
    rl.setPrompt(skin.prompt(promptLabel(state)));
    rl.prompt();
  }

  void drain();
  return done;
}
