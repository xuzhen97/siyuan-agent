import { parseArgs } from "node:util";
import { TOOL_SPECS } from "../../tools/definitions.ts";
import { toCliPath } from "../../tools/naming.ts";
import type { ToolParam, ToolSpec } from "../../tools/types.ts";

export type CliGlobalOptions = {
  json: boolean;
  host?: string;
  port?: number;
  token?: string;
  configPath?: string;
};

export type ParsedCli = { tool: string; args: Record<string, unknown>; global: CliGlobalOptions };

const GLOBAL_OPTION_NAMES = new Set(["json", "host", "port", "token", "config"]);
const GLOBAL_VALUE_OPTIONS = new Set(["host", "port", "token", "config"]);

/**
 * 选项名兼容别名：参数名与内核真实字段一致（parentID/previousID/nextID），
 * 但参考实现用的是 --parent / --previous / --next，两种写法都收。
 * （--data-type 无需别名：归一化后与 --dataType 等价）
 */
const PARAM_ALIASES: Record<string, string> = {
  parent: "parentid",
  previous: "previousid",
  next: "nextid",
};

/** 选项名归一化：忽略大小写与连字符（--dry-run 与 --dryRun 等价）。 */
function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/-/g, "");
}

function findSpec(segments: string[]): ToolSpec | undefined {
  const candidates = [segments.slice(0, 2).join("_"), segments[0] ?? ""];
  return TOOL_SPECS.find((spec) => candidates.includes(spec.name));
}

type OptionOccurrence = { name: string; value?: string };

/**
 * 用 parseArgs 的 tokens 模式取结构，再自行配对「选项 + 值」。
 *
 * 配对规则必须是确定性的，否则全局选项在子命令之前时会把子命令当成它的值：
 *  1) 命令之前的**已知全局选项**：字符串型（host/port/token/config）吞下一个裸值，布尔型（json）不吞；
 *  2) 未知选项（工具参数）：仅当子命令已解析（已见到首个未被吞的裸 token）时才吞下一个裸值；
 *  3) 其余裸 token 一律作为位置参数。
 */
function collectOptions(argv: string[]): { options: OptionOccurrence[]; positionals: string[] } {
  const { tokens } = parseArgs({
    args: argv,
    options: {},
    strict: false,
    allowPositionals: true,
    tokens: true,
  });

  const options: OptionOccurrence[] = [];
  const positionals: string[] = [];

  const nextIsValue = (index: number): boolean => tokens[index + 1]?.kind === "positional";

  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (!token) continue;
    if (token.kind === "positional") {
      positionals.push(String(token.value ?? ""));
      continue;
    }
    if (token.kind !== "option") continue;

    const name = String(token.name ?? "");
    const key = normalizeKey(name);

    if (token.inlineValue !== undefined) {
      options.push({ name, value: String(token.inlineValue) });
      continue;
    }

    const isKnownGlobal = GLOBAL_OPTION_NAMES.has(key);
    const commandResolved = positionals.length > 0;
    const shouldTakeValue = isKnownGlobal
      ? GLOBAL_VALUE_OPTIONS.has(key) && nextIsValue(i)
      : commandResolved && nextIsValue(i);

    if (shouldTakeValue) {
      const next = tokens[i + 1];
      options.push({ name, value: next?.kind === "positional" ? String(next.value) : "" });
      i += 1;
    } else {
      options.push({ name });
    }
  }

  return { options, positionals };
}

function coerceBooleanish(raw: string | undefined): boolean {
  if (raw === undefined) return true;
  const normalized = raw.trim().toLowerCase();
  if (normalized === "false" || normalized === "0" || normalized === "no") return false;
  return true;
}

export function parseCliArgs(argv: string[]): ParsedCli {
  const { options, positionals } = collectOptions(argv);
  const global: CliGlobalOptions = { json: false };

  const byNormalizedName = new Map<string, string | undefined>();
  for (const option of options) {
    const key = normalizeKey(option.name);
    if (GLOBAL_OPTION_NAMES.has(key)) {
      if (key === "json") global.json = coerceBooleanish(option.value);
      if (key === "host") global.host = option.value;
      if (key === "token") global.token = option.value;
      if (key === "config") global.configPath = option.value;
      if (key === "port" && option.value !== undefined) {
        const port = Number.parseInt(option.value, 10);
        if (Number.isFinite(port)) global.port = port;
      }
      continue;
    }
    byNormalizedName.set(PARAM_ALIASES[key] ?? key, option.value);
  }

  const spec = findSpec(positionals);
  if (!spec) return { tool: "", args: {}, global };

  const args: Record<string, unknown> = {};
  const remaining: string[] = [...positionals.slice(toCliPath(spec.name).length)];

  for (const [name, param] of Object.entries(spec.params) as Array<[string, ToolParam]>) {
    const provided = byNormalizedName.get(normalizeKey(name));
    if (param.type === "boolean") {
      if (provided !== undefined || byNormalizedName.has(normalizeKey(name))) {
        args[name] = coerceBooleanish(provided);
      }
      continue;
    }
    if (provided !== undefined) {
      args[name] = provided;
      continue;
    }
    if (name === "stmt" && remaining.length > 0) {
      args[name] = remaining.shift();
      continue;
    }
    if (remaining.length > 0) args[name] = remaining.shift();
  }

  // sql 的特殊约定：第一个位置参数恒为语句
  if (spec.name === "sql" && args.stmt === undefined) {
    const first = positionals[toCliPath(spec.name).length];
    if (first !== undefined) args.stmt = first;
  }

  return { tool: spec.name, args, global };
}

/**
 * REPL 用的引号感知分词（对齐参考实现里的 shlex.split）：
 * 支持单/双引号包裹带空格的参数，引号本身不出现在结果里。
 */
export function splitReplArgs(line: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quoted = false;
  let started = false;
  let quoteChar: string | null = null;

  for (const ch of line) {
    if (quoteChar !== null) {
      if (ch === quoteChar) {
        quoteChar = null;
      } else {
        current += ch;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quoteChar = ch;
      started = true;
      continue;
    }
    if (/\s/.test(ch)) {
      if (started || current.length > 0) {
        tokens.push(current);
        current = "";
        started = false;
        quoted = false;
      }
      continue;
    }
    current += ch;
  }

  if (started || current.length > 0) tokens.push(current);
  void quoted;
  return tokens;
}
