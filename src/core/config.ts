import { readFileSync as nodeReadFileSync } from "node:fs";
import { homedir } from "node:os";

export type SiYuanConfig = { host: string; port: number; token: string; timeoutMs: number };

export type ConfigDeps = {
  env?: Record<string, string | undefined>;
  readFileSync?: (path: string) => string;
  homeDir?: string;
};

export type ConfigOverrides = Partial<SiYuanConfig> & { configPath?: string };

export const DEFAULT_CONFIG: SiYuanConfig = { host: "127.0.0.1", port: 6806, token: "", timeoutMs: 30000 };

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

/**
 * 优先级：显式参数 > 环境变量 > 配置文件 > 默认值。
 * 非法值视为「该来源未提供」，静默回退到下一优先级（不抛异常）。
 * 连接语义：直连指定 host:port，不读取代理环境变量（对齐参考实现的 trust_env=False）。
 */
export function resolveSiYuanConfig(overrides?: ConfigOverrides, deps?: ConfigDeps): SiYuanConfig {
  const env = deps?.env ?? process.env;
  const home = deps?.homeDir ?? homedir();
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
  const pickToken = (...values: unknown[]): string | undefined =>
    values.find((v): v is string => typeof v === "string");

  const host = pickString(overrides?.host, env.SIYUAN_HOST, file.host) ?? DEFAULT_CONFIG.host;
  const port =
    parsePort(overrides?.port) ?? parsePort(env.SIYUAN_PORT) ?? parsePort(file.port) ?? DEFAULT_CONFIG.port;
  const timeoutMs =
    parseTimeout(overrides?.timeoutMs) ??
    parseTimeout(env.SIYUAN_TIMEOUT_MS) ??
    parseTimeout(file.timeoutMs) ??
    DEFAULT_CONFIG.timeoutMs;

  return {
    host,
    port,
    token: pickToken(overrides?.token, env.SIYUAN_TOKEN, file.token) ?? DEFAULT_CONFIG.token,
    timeoutMs,
  };
}
