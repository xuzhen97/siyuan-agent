import type { SiYuanConfig } from "./config.ts";
import { SiYuanError, type SiYuanErrorCode } from "./errors.ts";
import type {
  BlockOp,
  BlockOpResult,
  BlockRow,
  DocEntry,
  DocSearchHit,
  DocTreeNode,
  Notebook,
  SqlRow,
  TagInfo,
} from "./types.ts";

export type FetchInitLike = {
  method: string;
  headers: Record<string, string>;
  body: string;
  signal?: AbortSignal;
};

export type FetchResponseLike = { ok: boolean; status: number; text(): Promise<string> };

export type FetchLike = (input: string, init: FetchInitLike) => Promise<FetchResponseLike>;

type Envelope = { code?: number; msg?: string; data?: unknown };

const hintFor = (config: SiYuanConfig): string =>
  `确认思源已启动且 API 端口可访问（当前 http://${config.host}:${config.port}），并检查 SIYUAN_TOKEN 是否正确`;

const httpCode = (status: number): SiYuanErrorCode =>
  // SAFETY: 模板字面量类型无法由 TS 从 number 推导；该分支已排除 200/401/403，故必然是 SIYUAN_HTTP_<status>。
  `SIYUAN_HTTP_${status}` as SiYuanErrorCode;

/** 思源内核 HTTP 客户端。默认直连配置中的 host:port，不读取代理环境变量。 */
export class SiYuanClient {
  readonly config: SiYuanConfig;
  private readonly fetchImpl: FetchLike;

  constructor(config: SiYuanConfig, deps?: { fetch?: FetchLike }) {
    this.config = config;
    // SAFETY: 全局 fetch 是 Node ≥20 的原生实现，结构上兼容 FetchLike；断言只用于去掉 RequestInit 的多余可选字段，无运行期转换。
    this.fetchImpl = deps?.fetch ?? (globalThis.fetch as unknown as FetchLike);
  }

  private baseUrl(): string {
    return `http://${this.config.host}:${this.config.port}`;
  }

  private headers(): Record<string, string> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this.config.token) headers.Authorization = `Token ${this.config.token}`;
    return headers;
  }

  private async send(endpoint: string, body: Record<string, unknown>): Promise<FetchResponseLike> {
    try {
      return await this.fetchImpl(`${this.baseUrl()}${endpoint}`, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.config.timeoutMs),
      });
    } catch (err) {
      const name = err instanceof Error ? err.name : "";
      if (name === "AbortError" || name === "TimeoutError") {
        throw new SiYuanError("SIYUAN_TIMEOUT", `请求 ${endpoint} 超时（${this.config.timeoutMs}ms）`, {
          hint: hintFor(this.config),
          cause: err,
        });
      }
      throw new SiYuanError("SIYUAN_UNREACHABLE", `无法连接思源内核（${this.baseUrl()}）`, {
        hint: hintFor(this.config),
        cause: err,
      });
    }
  }

  /**
   * 发起请求并返回完整信封（含 data 同级的额外字段）。
   * 保留信封是为了 /api/query/sql 的 limit / truncated —— 它们与 data 平级（ADR-0002/0004 的截断保真）。
   */
  private async request<T extends Envelope>(
    endpoint: string,
    body: Record<string, unknown>,
  ): Promise<T> {
    const res = await this.send(endpoint, body);

    if (res.status === 401 || res.status === 403) {
      throw new SiYuanError("SIYUAN_AUTH", `鉴权失败（HTTP ${res.status}）`, { hint: hintFor(this.config) });
    }
    if (res.status !== 200) {
      throw new SiYuanError(httpCode(res.status), `接口 ${endpoint} 返回 HTTP ${res.status}`, {
        hint: hintFor(this.config),
      });
    }

    const raw = await res.text();
    let payload: T;
    try {
      payload = JSON.parse(raw) as T;
    } catch (err) {
      throw new SiYuanError("SIYUAN_API_ERROR", `接口 ${endpoint} 返回了非 JSON 响应`, {
        detail: raw.slice(0, 200),
        cause: err,
      });
    }

    if ((payload.code ?? 0) !== 0) {
      throw new SiYuanError("SIYUAN_API_ERROR", `内核返回错误：${payload.msg ?? "unknown error"}`, {
        detail: payload,
        hint: hintFor(this.config),
      });
    }
    return payload;
  }

  /** 调用内核接口并返回 data 字段。 */
  async call<T>(endpoint: string, body: Record<string, unknown> = {}): Promise<T> {
    const payload = await this.request<Envelope>(endpoint, body);
    // SAFETY: code === 0 已在 request() 校验；data 的具体形状由调用点的类型参数约定，运行期无法进一步收窄。
    return payload.data as T;
  }

  async ping(): Promise<boolean> {
    try {
      await this.version();
      return true;
    } catch {
      return false;
    }
  }

  version(): Promise<string> {
    return this.call<string>("/api/system/version");
  }

  currentTime(): Promise<number> {
    return this.call<number>("/api/system/currentTime");
  }

  listNotebooks(): Promise<Notebook[]> {
    return this.call<{ notebooks?: Notebook[] }>("/api/notebook/lsNotebooks").then((d) => d?.notebooks ?? []);
  }

  getNotebookInfo(notebook: string): Promise<Record<string, unknown>> {
    // 真实响应：data = { boxInfo: {...} }（内核 3.8.6 实测）
    return this.call<{ boxInfo?: Record<string, unknown> }>("/api/notebook/getNotebookInfo", { notebook }).then(
      (d) => d?.boxInfo ?? {},
    );
  }

  // ── filetree / export / search（Task 4）────────────────────────────

  listDocsByPath(notebook: string, path: string): Promise<DocEntry[]> {
    // 真实响应：data = { box, path, files, effectiveSortMode }（内核 3.8.6 实测）——不是裸数组。
    return this.call<{ files?: DocEntry[] }>("/api/filetree/listDocsByPath", {
      notebook,
      path,
      maxListCount: 0,
    }).then((d) => d?.files ?? []);
  }

  /**
   * 列出某个**文档**的子树。
   * 真实契约：`path` 必须是文档路径（如 `/20261009104613-x.sy`）或文档 ID；
   * 传根路径（`""` 或 `"/"`）会被内核以 `path escapes notebook directory` 拒绝。
   * 真实响应：data = { tree: [...] }。
   */
  listDocTree(notebook: string, path: string, maxDepth: number, sort: number): Promise<DocTreeNode[]> {
    return this.call<{ tree?: DocTreeNode[] }>("/api/filetree/listDocTree", {
      notebook,
      path,
      maxDepth,
      sort,
    }).then((d) => d?.tree ?? []);
  }

  getPathByID(id: string): Promise<{ notebook: string; path: string }> {
    return this.call<{ notebook: string; path: string }>("/api/filetree/getPathByID", { id });
  }

  getHPathByID(id: string): Promise<string> {
    return this.call<string>("/api/filetree/getHPathByID", { id });
  }

  getIDsByHPath(notebook: string, path: string): Promise<string[]> {
    return this.call<string[]>("/api/filetree/getIDsByHPath", { notebook, path }).then((d) => d ?? []);
  }

  exportMdContent(id: string): Promise<{ hPath: string; content: string }> {
    return this.call<{ hPath: string; content: string }>("/api/export/exportMdContent", { id });
  }

  searchDocs(k: string): Promise<DocSearchHit[]> {
    return this.call<DocSearchHit[]>("/api/filetree/searchDocs", { k }).then((d) => d ?? []);
  }

  // ── block / attr / tag / sql（Task 5）──────────────────────────

  getBlockKramdown(id: string): Promise<{ id: string; kramdown: string }> {
    return this.call<{ id: string; kramdown: string }>("/api/block/getBlockKramdown", { id });
  }

  getChildBlocks(id: string): Promise<BlockRow[]> {
    return this.call<BlockRow[]>("/api/block/getChildBlocks", { id }).then((d) => d ?? []);
  }

  getBlockAttrs(id: string): Promise<Record<string, string>> {
    return this.call<Record<string, string>>("/api/attr/getBlockAttrs", { id }).then((d) => d ?? {});
  }

  fullTextSearchBlock(query: string): Promise<{ blocks?: BlockRow[]; matchedBlockCount?: number }> {
    return this.call<{ blocks?: BlockRow[]; matchedBlockCount?: number }>("/api/search/fullTextSearchBlock", {
      query,
    });
  }

  searchTag(k: string): Promise<string[]> {
    return this.call<{ tags?: string[] }>("/api/search/searchTag", { k }).then((d) => d?.tags ?? []);
  }

  getTag(): Promise<TagInfo[]> {
    return this.call<TagInfo[]>("/api/tag/getTag", { ignoreMaxListHint: true }).then((d) => d ?? []);
  }

  /** 保留内核返回的 limit / truncated（ADR-0002/0004 的截断保真）。 */
  async querySql(stmt: string): Promise<{ rows: SqlRow[]; limit: number; truncated: boolean }> {
    const payload = await this.request<Envelope & { limit?: number; truncated?: boolean }>("/api/query/sql", {
      stmt,
    });
    return {
      rows: Array.isArray(payload.data) ? (payload.data as SqlRow[]) : [],
      limit: typeof payload.limit === "number" ? payload.limit : 0,
      truncated: payload.truncated === true,
    };
  }

  // ── 写方法（Task 5B，ADR-0004）───────────────────────────────

  private static parseBlockOps(data: unknown): BlockOpResult {
    const first = Array.isArray(data)
      ? (data[0] as { doOperations?: BlockOp[]; undoOperations?: unknown } | undefined)
      : undefined;
    return { doOperations: first?.doOperations ?? [], undoOperations: first?.undoOperations ?? null };
  }

  async createNotebook(name: string): Promise<{ id: string; name: string }> {
    const data = await this.call<{ notebook?: { id: string; name: string }; id?: string; name?: string }>(
      "/api/notebook/createNotebook",
      { name },
    );
    const created = data.notebook ?? { id: String(data.id ?? ""), name: String(data.name ?? name) };
    return { id: created.id, name: created.name };
  }

  createDocWithMd(notebook: string, path: string, markdown: string): Promise<string> {
    return this.call<string>("/api/filetree/createDocWithMd", { notebook, path, markdown });
  }

  async appendBlock(parentID: string, data: string, dataType: string): Promise<BlockOpResult> {
    return SiYuanClient.parseBlockOps(await this.call("/api/block/appendBlock", { parentID, data, dataType }));
  }

  async prependBlock(parentID: string, data: string, dataType: string): Promise<BlockOpResult> {
    return SiYuanClient.parseBlockOps(await this.call("/api/block/prependBlock", { parentID, data, dataType }));
  }

  async insertBlock(args: {
    data: string;
    dataType: string;
    parentID?: string;
    previousID?: string;
    nextID?: string;
  }): Promise<BlockOpResult> {
    const body: Record<string, unknown> = { data: args.data, dataType: args.dataType };
    if (args.parentID) body.parentID = args.parentID;
    if (args.previousID) body.previousID = args.previousID;
    if (args.nextID) body.nextID = args.nextID;
    return SiYuanClient.parseBlockOps(await this.call("/api/block/insertBlock", body));
  }

  async updateBlock(id: string, data: string, dataType: string, lockType: boolean): Promise<BlockOpResult> {
    return SiYuanClient.parseBlockOps(await this.call("/api/block/updateBlock", { id, data, dataType, lockType }));
  }

  async deleteBlock(id: string): Promise<BlockOpResult> {
    return SiYuanClient.parseBlockOps(await this.call("/api/block/deleteBlock", { id }));
  }

  async moveBlock(id: string, anchor: { parentID?: string; previousID?: string }): Promise<BlockOpResult> {
    const body: Record<string, unknown> = { id };
    if (anchor.parentID) body.parentID = anchor.parentID;
    if (anchor.previousID) body.previousID = anchor.previousID;
    return SiYuanClient.parseBlockOps(await this.call("/api/block/moveBlock", body));
  }

  setBlockAttrs(id: string, attrs: Record<string, string>): Promise<void> {
    return this.call<void>("/api/attr/setBlockAttrs", { id, attrs });
  }

  renameDocByID(id: string, title: string): Promise<void> {
    return this.call<void>("/api/filetree/renameDocByID", { id, title });
  }

  moveDocsByID(fromIDs: string[], toID: string): Promise<void> {
    return this.call<void>("/api/filetree/moveDocsByID", { fromIDs, toID });
  }

  removeDocByID(id: string): Promise<void> {
    return this.call<void>("/api/filetree/removeDocByID", { id });
  }

  /** 供乐观并发校验（W9）：用只读 SQL 取当前块哈希。 */
  async getBlockHash(id: string): Promise<string | undefined> {
    const escaped = id.replace(/'/g, "''");
    const { rows } = await this.querySql(`SELECT hash FROM blocks WHERE id = '${escaped}'`);
    const hash = rows[0]?.hash;
    return hash === undefined || hash === null ? undefined : String(hash);
  }
}
