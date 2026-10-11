export type SiYuanErrorCode =
  | "SIYUAN_UNREACHABLE"
  | "SIYUAN_TIMEOUT"
  | "SIYUAN_API_ERROR"
  | "SIYUAN_AUTH"
  | "SIYUAN_READONLY_BLOCKED"
  | "SIYUAN_CONFIRM_REQUIRED"
  | "SIYUAN_CONFIRM_MISMATCH"
  | "SIYUAN_STALE_TARGET"
  | "SIYUAN_NOT_FOUND"
  | `SIYUAN_HTTP_${number}`;

export class SiYuanError extends Error {
  readonly code: SiYuanErrorCode;
  readonly hint?: string;
  readonly detail?: unknown;

  constructor(
    code: SiYuanErrorCode,
    message: string,
    options?: { hint?: string; detail?: unknown; cause?: unknown },
  ) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = "SiYuanError";
    this.code = code;
    this.hint = options?.hint;
    this.detail = options?.detail;
  }
}

export type ErrorDescription = { code: SiYuanErrorCode; message: string; hint?: string };

/** 把任意异常归一化为「错误码 + 人话 + 可操作提示」，供三条通道统一渲染。 */
export function describeError(err: unknown): ErrorDescription {
  if (err instanceof SiYuanError) {
    return { code: err.code, message: err.message, hint: err.hint };
  }
  return {
    code: "SIYUAN_API_ERROR",
    message: err instanceof Error ? err.message : String(err),
  };
}
