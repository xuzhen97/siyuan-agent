import { SiYuanError } from "../../src/core/errors.ts";

/**
 * 断言 Promise 以 SiYuanError 失败并把它按 SiYuanError 返回（供测试直接读 code / hint）。
 * 若没抛错或抛的不是 SiYuanError，直接失败，避免测试静默通过。
 */
export async function captureError(promise: Promise<unknown>): Promise<SiYuanError> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof SiYuanError) return err;
    throw err instanceof Error ? err : new Error(`期望 SiYuanError，实际抛出: ${String(err)}`);
  }
  throw new Error("期望 Promise 抛出 SiYuanError，但它成功了");
}
