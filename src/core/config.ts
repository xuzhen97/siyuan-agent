import { readFileSync as nodeReadFileSync } from "node:fs";
import { homedir } from "node:os";

/** Token 的来源，供 status 展示（绝不回显 Token 本身）。 */
export type TokenSource = "arg" | "env" | "config-file" | "siyuan-conf" | "none";

export type SiYuanConfig = {
  host: string;
  port: number;
  token: string;
  timeoutMs: number;
  tokenSource: TokenSource;
};

export type ConfigDeps = {
  env?: Record<string, string | undefined>;
  readFileSync?: (path: string) => string;
  homeDir?: string;
  platform?: string;
};

export type ConfigOverrides = Partial<SiYuanConfig> & { configPath?: string };

export const DEFAULT_CONFIG: SiYuanConfig = {
  host: "127.0.0.1",
  port: 6806,
  token: "",
  timeoutMs: 30000,
  tokenSource: "none",
};

export function configFilePath(homeDir: string): string {
  return `${homeDir}/.siyuan-agent/config.json`;
}

function parsePort(raw: unknown): number | undefined {
  const n = typeof raw === "number" ? raw : Number.parseInt(String(raw ?? ""), 10);
  return Number.isInteger(n) && n > 0 && n <= 65535 ? n : undefined;
}

function parseTimeout(raw: unknown): number | undefined {
  const n = typeof raw === "number" ? raw : Number.parseInt(String(raw ?? ""), 10);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** 思源自身的配置文件路径（对齐参考实现 utils/siyuan_backend.py）。 */
function siyuanConfPaths(homeDir: string, platform: string): string[] {
  return platform === "win32"
    ? [`${homeDir}/SiYuan/conf/conf.json`]
    : [`${homeDir}/.config/siyuan/conf/conf.json`];
}

/**
 * 最后一级回退：从思源自己的 conf.json 读 api.token。
 * 只在显式参数、环境变量、本项目配置文件都没给出 Token 时才尝试（避免无谓 IO）。
 * 读取失败、JSON 损坏、字段缺失一律静默回退为 none，绝不抛异常。
 */
function readSiYuanToken(
  readFile: (path: string) => string,
  homeDir: string,
  platform: string,
): { token: string; source: TokenSource } {
  for (const confPath of siyuanConfPaths(homeDir, platform)) {
    try {
      const parsed: unknown = JSON.parse(readFile(confPath).replace(/^\uFEFF/, ""));
      const api = (parsed as { api?: { token?: unknown } } | null)?.api;
      const token = api && typeof api.token === "string" ? api.token : "";
      if (token.length > 0) return { token, source: "siyuan-conf" };
    } catch {
      // 继续尝试下一个候选路径
    }
  }
  return { token: "", source: "none" };
}

/**
 * 优先级：显式参数 > 环境变量（含系统全局变量）> 本项目配置文件 > 思源自身 conf.json > 空。
 * 非法值视为「该来源未提供」，静默回退到下一优先级（不抛异常）。
 * 连接语义：直连指定 host:port，不读取代理环境变量（对齐参考实现的 trust_env=False）。
 */
export function resolveSiYuanConfig(overrides?: ConfigOverrides, deps?: ConfigDeps): SiYuanConfig {
  const env = deps?.env ?? process.env;
  const home = deps?.homeDir ?? homedir();
  const platform = deps?.platform ?? process.platform;
  const readFile = deps?.readFileSync ?? ((p: string) => nodeReadFileSync(p, "utf-8"));

  let file: Record<string, unknown> = {};
  try {
    const raw = readFile(overrides?.configPath ?? configFilePath(home));
    const parsed: unknown = JSON.parse(raw.replace(/^\uFEFF/, ""));
    if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
      file = parsed as Record<string, unknown>;
    }
  } catch {
    file = {};
  }

  const pickString = (...values: unknown[]): string | undefined =>
    values.find((v): v is string => typeof v === "string" && v.length > 0);

  const host = pickString(overrides?.host, env.SIYUAN_HOST, file.host) ?? DEFAULT_CONFIG.host;
  const port =
    parsePort(overrides?.port) ?? parsePort(env.SIYUAN_PORT) ?? parsePort(file.port) ?? DEFAULT_CONFIG.port;
  const timeoutMs =
    parseTimeout(overrides?.timeoutMs) ??
    parseTimeout(env.SIYUAN_TIMEOUT_MS) ??
    parseTimeout(file.timeoutMs) ??
    DEFAULT_CONFIG.timeoutMs;

  const tokenFromArg = nonEmptyString(overrides?.token);
  const tokenFromEnv = nonEmptyString(env.SIYUAN_TOKEN);
  const tokenFromFile = nonEmptyString(file.token);

  let token = "";
  let tokenSource: TokenSource = "none";
  if (tokenFromArg !== undefined) {
    token = tokenFromArg;
    tokenSource = "arg";
  } else if (tokenFromEnv !== undefined) {
    token = tokenFromEnv;
    tokenSource = "env";
  } else if (tokenFromFile !== undefined) {
    token = tokenFromFile;
    tokenSource = "config-file";
  } else {
    const discovered = readSiYuanToken(readFile, home, platform);
    token = discovered.token;
    tokenSource = discovered.source;
  }

  return { host, port, token, timeoutMs, tokenSource };
}
