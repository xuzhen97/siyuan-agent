import { vi } from "vitest";

export type FetchInit = { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal };
export type FetchResult = { ok: boolean; status: number; text(): Promise<string> };

/**
 * 构造一个类型安全的假 fetch（供 unit 测试注入 SiYuanClient）。
 * - rawFetch: 原样返回 payload（字符串则直接作为响应体），用于测非 JSON / 非 200 等异常路径
 * - okFetch: 包成内核信封 {code:0,msg:"",data}
 * - apiFetch: 自定义信封（可附 limit / truncated 等同级字段）
 */
export function rawFetch(payload: unknown, status = 200) {
  return vi.fn(async (_url: string, _init: FetchInit): Promise<FetchResult> => ({
    ok: status < 400,
    status,
    text: async () => (typeof payload === "string" ? payload : JSON.stringify(payload)),
  }));
}

export function okFetch(data: unknown) {
  return rawFetch({ code: 0, msg: "", data });
}

export function apiFetch(data: unknown, extra: Record<string, unknown> = {}, status = 200) {
  return rawFetch({ code: 0, msg: "", data, ...extra }, status);
}

export function failingFetch(error: unknown) {
  return vi.fn(async (_url: string, _init: FetchInit): Promise<FetchResult> => {
    throw error;
  });
}

export const urlOf = (f: { mock: { calls: Array<[string, FetchInit]> } }, i = 0): string => f.mock.calls[i]![0];

export const initOf = (f: { mock: { calls: Array<[string, FetchInit]> } }, i = 0): FetchInit => f.mock.calls[i]![1];

export const bodyOf = (f: { mock: { calls: Array<[string, FetchInit]> } }, i = 0): Record<string, unknown> =>
  JSON.parse(initOf(f, i).body) as Record<string, unknown>;
