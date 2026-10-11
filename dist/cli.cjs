"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/channels/cli/index.ts
var cli_exports = {};
__export(cli_exports, {
  parseCliArgs: () => parseCliArgs,
  runCli: () => runCli,
  usage: () => usage
});
module.exports = __toCommonJS(cli_exports);

// src/core/errors.ts
var SiYuanError = class extends Error {
  code;
  hint;
  detail;
  constructor(code, message, options) {
    super(message, options?.cause === void 0 ? void 0 : { cause: options.cause });
    this.name = "SiYuanError";
    this.code = code;
    this.hint = options?.hint;
    this.detail = options?.detail;
  }
};
function describeError(err) {
  if (err instanceof SiYuanError) {
    return { code: err.code, message: err.message, hint: err.hint };
  }
  return {
    code: "SIYUAN_API_ERROR",
    message: err instanceof Error ? err.message : String(err)
  };
}

// src/core/client.ts
var hintFor = (config) => `\u786E\u8BA4\u601D\u6E90\u5DF2\u542F\u52A8\u4E14 API \u7AEF\u53E3\u53EF\u8BBF\u95EE\uFF08\u5F53\u524D http://${config.host}:${config.port}\uFF09\uFF0C\u5E76\u68C0\u67E5 SIYUAN_TOKEN \u662F\u5426\u6B63\u786E`;
var httpCode = (status) => (
  // SAFETY: 模板字面量类型无法由 TS 从 number 推导；该分支已排除 200/401/403，故必然是 SIYUAN_HTTP_<status>。
  `SIYUAN_HTTP_${status}`
);
var SiYuanClient = class _SiYuanClient {
  config;
  fetchImpl;
  constructor(config, deps) {
    this.config = config;
    this.fetchImpl = deps?.fetch ?? globalThis.fetch;
  }
  baseUrl() {
    return `http://${this.config.host}:${this.config.port}`;
  }
  headers() {
    const headers = { "Content-Type": "application/json" };
    if (this.config.token) headers.Authorization = `Token ${this.config.token}`;
    return headers;
  }
  async send(endpoint, body) {
    try {
      return await this.fetchImpl(`${this.baseUrl()}${endpoint}`, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.config.timeoutMs)
      });
    } catch (err) {
      const name = err instanceof Error ? err.name : "";
      if (name === "AbortError" || name === "TimeoutError") {
        throw new SiYuanError("SIYUAN_TIMEOUT", `\u8BF7\u6C42 ${endpoint} \u8D85\u65F6\uFF08${this.config.timeoutMs}ms\uFF09`, {
          hint: hintFor(this.config),
          cause: err
        });
      }
      throw new SiYuanError("SIYUAN_UNREACHABLE", `\u65E0\u6CD5\u8FDE\u63A5\u601D\u6E90\u5185\u6838\uFF08${this.baseUrl()}\uFF09`, {
        hint: hintFor(this.config),
        cause: err
      });
    }
  }
  /**
   * 发起请求并返回完整信封（含 data 同级的额外字段）。
   * 保留信封是为了 /api/query/sql 的 limit / truncated —— 它们与 data 平级（ADR-0002/0004 的截断保真）。
   */
  async request(endpoint, body) {
    const res = await this.send(endpoint, body);
    if (res.status === 401 || res.status === 403) {
      throw new SiYuanError("SIYUAN_AUTH", `\u9274\u6743\u5931\u8D25\uFF08HTTP ${res.status}\uFF09`, { hint: hintFor(this.config) });
    }
    if (res.status !== 200) {
      throw new SiYuanError(httpCode(res.status), `\u63A5\u53E3 ${endpoint} \u8FD4\u56DE HTTP ${res.status}`, {
        hint: hintFor(this.config)
      });
    }
    const raw = await res.text();
    let payload;
    try {
      payload = JSON.parse(raw);
    } catch (err) {
      throw new SiYuanError("SIYUAN_API_ERROR", `\u63A5\u53E3 ${endpoint} \u8FD4\u56DE\u4E86\u975E JSON \u54CD\u5E94`, {
        detail: raw.slice(0, 200),
        cause: err
      });
    }
    if ((payload.code ?? 0) !== 0) {
      throw new SiYuanError("SIYUAN_API_ERROR", `\u5185\u6838\u8FD4\u56DE\u9519\u8BEF\uFF1A${payload.msg ?? "unknown error"}`, {
        detail: payload,
        hint: hintFor(this.config)
      });
    }
    return payload;
  }
  /** 调用内核接口并返回 data 字段。 */
  async call(endpoint, body = {}) {
    const payload = await this.request(endpoint, body);
    return payload.data;
  }
  async ping() {
    try {
      await this.version();
      return true;
    } catch {
      return false;
    }
  }
  version() {
    return this.call("/api/system/version");
  }
  currentTime() {
    return this.call("/api/system/currentTime");
  }
  listNotebooks() {
    return this.call("/api/notebook/lsNotebooks").then((d) => d?.notebooks ?? []);
  }
  getNotebookInfo(notebook) {
    return this.call("/api/notebook/getNotebookInfo", { notebook }).then(
      (d) => d?.boxInfo ?? {}
    );
  }
  /** 真实响应：data = { box, name, conf: {...} }（官方 API 文档 + 本机实测）。 */
  getNotebookConf(notebook) {
    return this.call(
      "/api/notebook/getNotebookConf",
      { notebook }
    ).then((d) => ({ box: d?.box ?? notebook, name: d?.name ?? "", conf: d?.conf ?? {} }));
  }
  /**
   * 创建「今天」的日记。内核按笔记本的 dailyNoteSavePath 模板落盘；
   * 若今日日记已存在则返回**既有文档 ID**且不重复推送（天然幂等）。
   * 真实响应：data = { id }（kernel/api/filetree.go::createDailyNote）。
   */
  async createDailyNote(notebook, app) {
    const body = { notebook };
    if (app) body.app = app;
    const data = await this.call("/api/filetree/createDailyNote", body);
    return data?.id ?? "";
  }
  // ── filetree / export / search（Task 4）────────────────────────────
  listDocsByPath(notebook, path) {
    return this.call("/api/filetree/listDocsByPath", {
      notebook,
      path,
      maxListCount: 0
    }).then((d) => d?.files ?? []);
  }
  /**
   * 列出某个**文档**的子树。
   * 真实契约：`path` 必须是文档路径（如 `/20261009104613-x.sy`）或文档 ID；
   * 传根路径（`""` 或 `"/"`）会被内核以 `path escapes notebook directory` 拒绝。
   * 真实响应：data = { tree: [...] }。
   */
  listDocTree(notebook, path, maxDepth, sort) {
    return this.call("/api/filetree/listDocTree", {
      notebook,
      path,
      maxDepth,
      sort
    }).then((d) => d?.tree ?? []);
  }
  getPathByID(id) {
    return this.call("/api/filetree/getPathByID", { id });
  }
  getHPathByID(id) {
    return this.call("/api/filetree/getHPathByID", { id });
  }
  getIDsByHPath(notebook, path) {
    return this.call("/api/filetree/getIDsByHPath", { notebook, path }).then((d) => d ?? []);
  }
  exportMdContent(id) {
    return this.call("/api/export/exportMdContent", { id });
  }
  searchDocs(k) {
    return this.call("/api/filetree/searchDocs", { k }).then((d) => d ?? []);
  }
  // ── block / attr / tag / sql（Task 5）──────────────────────────
  getBlockKramdown(id) {
    return this.call("/api/block/getBlockKramdown", { id });
  }
  getChildBlocks(id) {
    return this.call("/api/block/getChildBlocks", { id }).then((d) => d ?? []);
  }
  getBlockAttrs(id) {
    return this.call("/api/attr/getBlockAttrs", { id }).then((d) => d ?? {});
  }
  fullTextSearchBlock(query) {
    return this.call("/api/search/fullTextSearchBlock", {
      query
    });
  }
  searchTag(k) {
    return this.call("/api/search/searchTag", { k }).then((d) => d?.tags ?? []);
  }
  getTag() {
    return this.call("/api/tag/getTag", { ignoreMaxListHint: true }).then((d) => d ?? []);
  }
  /** 保留内核返回的 limit / truncated（ADR-0002/0004 的截断保真）。 */
  async querySql(stmt) {
    const payload = await this.request("/api/query/sql", {
      stmt
    });
    return {
      rows: Array.isArray(payload.data) ? payload.data : [],
      limit: typeof payload.limit === "number" ? payload.limit : 0,
      truncated: payload.truncated === true
    };
  }
  // ── 写方法（Task 5B，ADR-0004）───────────────────────────────
  static parseBlockOps(data) {
    const first = Array.isArray(data) ? data[0] : void 0;
    return { doOperations: first?.doOperations ?? [], undoOperations: first?.undoOperations ?? null };
  }
  async createNotebook(name) {
    const data = await this.call(
      "/api/notebook/createNotebook",
      { name }
    );
    const created = data.notebook ?? { id: String(data.id ?? ""), name: String(data.name ?? name) };
    return { id: created.id, name: created.name };
  }
  createDocWithMd(notebook, path, markdown) {
    return this.call("/api/filetree/createDocWithMd", { notebook, path, markdown });
  }
  async appendBlock(parentID, data, dataType) {
    return _SiYuanClient.parseBlockOps(await this.call("/api/block/appendBlock", { parentID, data, dataType }));
  }
  async prependBlock(parentID, data, dataType) {
    return _SiYuanClient.parseBlockOps(await this.call("/api/block/prependBlock", { parentID, data, dataType }));
  }
  async insertBlock(args) {
    const body = { data: args.data, dataType: args.dataType };
    if (args.parentID) body.parentID = args.parentID;
    if (args.previousID) body.previousID = args.previousID;
    if (args.nextID) body.nextID = args.nextID;
    return _SiYuanClient.parseBlockOps(await this.call("/api/block/insertBlock", body));
  }
  async updateBlock(id, data, dataType, lockType) {
    return _SiYuanClient.parseBlockOps(await this.call("/api/block/updateBlock", { id, data, dataType, lockType }));
  }
  async deleteBlock(id) {
    return _SiYuanClient.parseBlockOps(await this.call("/api/block/deleteBlock", { id }));
  }
  async moveBlock(id, anchor) {
    const body = { id };
    if (anchor.parentID) body.parentID = anchor.parentID;
    if (anchor.previousID) body.previousID = anchor.previousID;
    return _SiYuanClient.parseBlockOps(await this.call("/api/block/moveBlock", body));
  }
  setBlockAttrs(id, attrs) {
    return this.call("/api/attr/setBlockAttrs", { id, attrs });
  }
  renameDocByID(id, title) {
    return this.call("/api/filetree/renameDocByID", { id, title });
  }
  moveDocsByID(fromIDs, toID) {
    return this.call("/api/filetree/moveDocsByID", { fromIDs, toID });
  }
  removeDocByID(id) {
    return this.call("/api/filetree/removeDocByID", { id });
  }
  // ── 笔记本级写方法 / 导出 / 折叠 / 按路径操作 / 批量替换（对齐参考实现）──
  openNotebook(notebook) {
    return this.call("/api/notebook/openNotebook", { notebook });
  }
  closeNotebook(notebook) {
    return this.call("/api/notebook/closeNotebook", { notebook });
  }
  removeNotebook(notebook) {
    return this.call("/api/notebook/removeNotebook", { notebook });
  }
  renameNotebook(notebook, name) {
    return this.call("/api/notebook/renameNotebook", { notebook, name });
  }
  setNotebookIcon(notebook, icon) {
    return this.call("/api/notebook/setNotebookIcon", { notebook, icon });
  }
  /** 真实响应：data = conf（内核回显保存后的配置）。 */
  setNotebookConf(notebook, conf) {
    return this.call("/api/notebook/setNotebookConf", { notebook, conf }).then(
      (d) => d ?? {}
    );
  }
  /** 真实响应：data = { path }（workspace 内的 zip 相对路径）。 */
  async exportResources(paths, name) {
    const body = { paths };
    if (name) body.name = name;
    const data = await this.call("/api/export/exportResources", body);
    return data?.path ?? "";
  }
  foldBlock(id) {
    return this.call("/api/block/foldBlock", { id });
  }
  unfoldBlock(id) {
    return this.call("/api/block/unfoldBlock", { id });
  }
  renameDoc(notebook, path, title) {
    return this.call("/api/filetree/renameDoc", { notebook, path, title });
  }
  removeDoc(notebook, path) {
    return this.call("/api/filetree/removeDoc", { notebook, path });
  }
  moveDocs(fromPaths, toNotebook, toPath) {
    return this.call("/api/filetree/moveDocs", { fromPaths, toNotebook, toPath });
  }
  /** 内核源码：{ k, r, ids: string[], replaceTypes?: Record<string, boolean> }。 */
  findReplace(k, r, ids, replaceTypes) {
    const body = { k, r, ids };
    if (replaceTypes) body.replaceTypes = replaceTypes;
    return this.call("/api/search/findReplace", body);
  }
  /** 供乐观并发校验（W9）：用只读 SQL 取当前块哈希。 */
  async getBlockHash(id) {
    const escaped = id.replace(/'/g, "''");
    const { rows } = await this.querySql(`SELECT hash FROM blocks WHERE id = '${escaped}'`);
    const hash = rows[0]?.hash;
    return hash === void 0 || hash === null ? void 0 : String(hash);
  }
};

// src/core/config.ts
var import_node_fs = require("node:fs");
var import_node_os = require("node:os");
var DEFAULT_CONFIG = {
  host: "127.0.0.1",
  port: 6806,
  token: "",
  timeoutMs: 3e4,
  tokenSource: "none"
};
function configFilePath(homeDir) {
  return `${homeDir}/.siyuan-agent/config.json`;
}
function parsePort(raw) {
  const n = typeof raw === "number" ? raw : Number.parseInt(String(raw ?? ""), 10);
  return Number.isInteger(n) && n > 0 && n <= 65535 ? n : void 0;
}
function parseTimeout(raw) {
  const n = typeof raw === "number" ? raw : Number.parseInt(String(raw ?? ""), 10);
  return Number.isInteger(n) && n > 0 ? n : void 0;
}
function nonEmptyString(value) {
  return typeof value === "string" && value.length > 0 ? value : void 0;
}
function siyuanConfPaths(homeDir, platform) {
  return platform === "win32" ? [`${homeDir}/SiYuan/conf/conf.json`] : [`${homeDir}/.config/siyuan/conf/conf.json`];
}
function readSiYuanToken(readFile, homeDir, platform) {
  for (const confPath of siyuanConfPaths(homeDir, platform)) {
    try {
      const parsed = JSON.parse(readFile(confPath).replace(/^\uFEFF/, ""));
      const api = parsed?.api;
      const token = api && typeof api.token === "string" ? api.token : "";
      if (token.length > 0) return { token, source: "siyuan-conf" };
    } catch {
    }
  }
  return { token: "", source: "none" };
}
function resolveSiYuanConfig(overrides, deps) {
  const env = deps?.env ?? process.env;
  const home = deps?.homeDir ?? (0, import_node_os.homedir)();
  const platform = deps?.platform ?? process.platform;
  const readFile = deps?.readFileSync ?? ((p) => (0, import_node_fs.readFileSync)(p, "utf-8"));
  let file = {};
  try {
    const raw = readFile(overrides?.configPath ?? configFilePath(home));
    const parsed = JSON.parse(raw.replace(/^\uFEFF/, ""));
    if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
      file = parsed;
    }
  } catch {
    file = {};
  }
  const pickString = (...values) => values.find((v) => typeof v === "string" && v.length > 0);
  const host = pickString(overrides?.host, env.SIYUAN_HOST, file.host) ?? DEFAULT_CONFIG.host;
  const port = parsePort(overrides?.port) ?? parsePort(env.SIYUAN_PORT) ?? parsePort(file.port) ?? DEFAULT_CONFIG.port;
  const timeoutMs = parseTimeout(overrides?.timeoutMs) ?? parseTimeout(env.SIYUAN_TIMEOUT_MS) ?? parseTimeout(file.timeoutMs) ?? DEFAULT_CONFIG.timeoutMs;
  const tokenFromArg = nonEmptyString(overrides?.token);
  const tokenFromEnv = nonEmptyString(env.SIYUAN_TOKEN);
  const tokenFromFile = nonEmptyString(file.token);
  let token = "";
  let tokenSource = "none";
  if (tokenFromArg !== void 0) {
    token = tokenFromArg;
    tokenSource = "arg";
  } else if (tokenFromEnv !== void 0) {
    token = tokenFromEnv;
    tokenSource = "env";
  } else if (tokenFromFile !== void 0) {
    token = tokenFromFile;
    tokenSource = "config-file";
  } else {
    const discovered = readSiYuanToken(readFile, home, platform);
    token = discovered.token;
    tokenSource = discovered.source;
  }
  return { host, port, token, timeoutMs, tokenSource };
}

// src/tools/naming.ts
function toCliPath(canonical) {
  const parts = canonical.split("_");
  if (parts.length <= 1) return parts;
  return [parts[0], parts.slice(1).join("_")];
}

// src/tools/dispatch.ts
function coerceArgs(spec, args) {
  const out = {};
  for (const [name, param] of Object.entries(spec.params)) {
    const raw = args[name];
    if (raw === void 0 || raw === null || raw === "") {
      if (param.required) {
        throw new SiYuanError("SIYUAN_API_ERROR", `\u7F3A\u5C11\u5FC5\u586B\u53C2\u6570 ${name}\uFF08${param.description}\uFF09`, {
          hint: `\u8C03\u7528 ${spec.name} \u65F6\u5FC5\u987B\u63D0\u4F9B ${name}`
        });
      }
      if (param.default !== void 0) out[name] = param.default;
      continue;
    }
    if (param.type === "number") {
      const text = typeof raw === "number" ? String(raw) : String(raw).trim();
      const n = text === "" ? Number.NaN : Number(text);
      if (!Number.isFinite(n)) {
        throw new SiYuanError("SIYUAN_API_ERROR", `\u53C2\u6570 ${name} \u9700\u8981\u6570\u5B57\uFF0C\u6536\u5230 ${String(raw)}`, {
          hint: `\u4E3A ${name} \u63D0\u4F9B\u6570\u5B57\uFF08\u4F8B\u5982 ${name}=10\uFF09`
        });
      }
      out[name] = n;
    } else if (param.type === "boolean") {
      if (typeof raw === "boolean") {
        out[name] = raw;
      } else if (String(raw).toLowerCase() === "true") {
        out[name] = true;
      } else if (String(raw).toLowerCase() === "false") {
        out[name] = false;
      } else {
        throw new SiYuanError("SIYUAN_API_ERROR", `\u53C2\u6570 ${name} \u9700\u8981 true/false\uFF0C\u6536\u5230 ${String(raw)}`, {
          hint: `\u4E3A ${name} \u63D0\u4F9B\u5E03\u5C14\u503C`
        });
      }
    } else {
      out[name] = String(raw);
    }
  }
  return out;
}
async function dispatchTool(spec, args, client) {
  try {
    const coerced = coerceArgs(spec, args);
    return { ok: true, result: await spec.invoke(client, coerced) };
  } catch (err) {
    return { ok: false, error: describeError(err) };
  }
}

// src/core/render.ts
var TEXT_PREVIEW_LIMIT = 50;
var DEFAULT_MAX_CHARS = 2e4;
function renderItem(item) {
  if (item !== null && typeof item === "object" && !Array.isArray(item)) {
    return Object.entries(item).filter(([, v]) => v !== void 0 && v !== null && v !== "").map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`).join(" | ");
  }
  return String(item);
}
function renderText(value, options) {
  if (value === null || value === void 0) return "\u65E0\u6570\u636E";
  const previewLimit = options?.previewLimit ?? TEXT_PREVIEW_LIMIT;
  if (Array.isArray(value)) {
    if (value.length === 0) return "\u5171 0 \u6761";
    const shown = value.slice(0, previewLimit);
    const lines = shown.map((item, i) => `${i + 1}. ${renderItem(item)}`);
    if (value.length > previewLimit) {
      lines.push(`\u2026 \u5171 ${value.length} \u6761\uFF0C\u5DF2\u663E\u793A\u524D ${previewLimit} \u6761\uFF08\u53D6\u5168\u91CF\u8BF7\u7528 --json \u6216\u8BFB\u53D6 data \u5B57\u6BB5\uFF09`);
    } else {
      lines.unshift(`\u5171 ${value.length} \u6761`);
    }
    return lines.join("\n");
  }
  if (typeof value === "object") return renderItem(value);
  return String(value);
}
function truncateText(text, maxChars = DEFAULT_MAX_CHARS) {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}

\u26A0\uFE0F \u5DF2\u622A\u65AD\uFF1A\u539F\u6587 ${text.length} \u5B57\u7B26\uFF0C\u4EC5\u663E\u793A\u524D ${maxChars} \u5B57\u7B26`;
}
var DEFAULT_SQL_ROW_CAP = 64;
function renderSqlNotice(limit, truncated) {
  if (!truncated) return "";
  const cap = limit > 0 ? limit : DEFAULT_SQL_ROW_CAP;
  return `\u26A0\uFE0F \u7ED3\u679C\u88AB\u622A\u65AD\uFF1A\u5185\u6838\u9ED8\u8BA4\u4E0A\u9650 ${cap} \u884C\u3002\u8BF7\u52A0\u663E\u5F0F LIMIT/OFFSET \u5206\u9875\uFF0C\u6216\u6539\u7528\u805A\u5408/\u8FC7\u6EE4\u6761\u4EF6\u3002`;
}

// src/tools/guard.ts
var SQL_FORBIDDEN_KEYWORDS = [
  "PRAGMA",
  "ATTACH",
  "DETACH",
  "INSERT",
  "UPDATE",
  "DELETE",
  "DROP",
  "ALTER",
  "CREATE",
  "REPLACE",
  "VACUUM",
  "REINDEX",
  "ANALYZE",
  "TRUNCATE"
];
function stripComments(sql) {
  return sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
}
function stripStringLiterals(sql) {
  let out = "";
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i];
    if (ch !== "'") {
      out += ch;
      i += 1;
      continue;
    }
    i += 1;
    let closed = false;
    while (i < sql.length) {
      if (sql[i] === "'") {
        if (sql[i + 1] === "'") {
          i += 2;
          continue;
        }
        closed = true;
        i += 1;
        break;
      }
      i += 1;
    }
    if (!closed) return null;
    out += " '' ";
  }
  return out;
}
function assertReadOnlySql(stmt) {
  function refuse(reason) {
    throw new SiYuanError(
      "SIYUAN_READONLY_BLOCKED",
      `SQL \u88AB\u62D2\u7EDD\uFF1A${reason}\u3002\u672C\u5DE5\u5177\u4E00\u671F\u53EA\u8BFB\uFF0C\u4EC5\u5141\u8BB8\u5355\u6761 SELECT / WITH \u67E5\u8BE2\u3002`,
      { hint: "\u6539\u7528 SELECT \u67E5\u8BE2\uFF1B\u5199\u64CD\u4F5C\u8BF7\u4F7F\u7528 typed \u5199\u5DE5\u5177\uFF08\u5E26 confirm \u786E\u8BA4\uFF09\u3002" }
    );
  }
  const withoutComments = stripComments(stmt).trim();
  if (withoutComments.length === 0) refuse("\u8BED\u53E5\u4E3A\u7A7A");
  const withoutLiterals = stripStringLiterals(withoutComments);
  if (withoutLiterals === null) refuse("\u5355\u5F15\u53F7\u4E0D\u95ED\u5408");
  const firstWord = /^([A-Za-z]+)/.exec(withoutLiterals)?.[1]?.toUpperCase();
  if (firstWord !== "SELECT" && firstWord !== "WITH") {
    refuse(`\u4E0D\u652F\u6301\u7684\u8BED\u53E5\u7C7B\u578B ${firstWord ?? "(\u672A\u77E5)"}`);
  }
  const semicolon = withoutLiterals.indexOf(";");
  if (semicolon !== -1) {
    const trailing = withoutLiterals.slice(semicolon + 1).trim();
    if (trailing.length > 0) refuse("\u68C0\u6D4B\u5230\u591A\u8BED\u53E5");
  }
  for (const keyword of SQL_FORBIDDEN_KEYWORDS) {
    if (new RegExp(`\\b${keyword}\\b`, "i").test(withoutLiterals)) {
      refuse(`\u5305\u542B\u53D8\u66F4\u5173\u952E\u5B57 ${keyword}`);
    }
  }
}

// src/tools/write-guard.ts
var PREVIEW_CHARS = 200;
function isDestructive(spec) {
  return spec.risk === "destructive";
}
function previewBlock(kramdown, childCount) {
  const head = kramdown.length > PREVIEW_CHARS ? `${kramdown.slice(0, PREVIEW_CHARS)}
\u2026\uFF08\u5DF2\u622A\u65AD\uFF0C\u539F\u6587 ${kramdown.length} \u5B57\u7B26\uFF09` : kramdown;
  return `\u5B50\u5757\u6570\uFF1A${childCount}
\u5F53\u524D\u5185\u5BB9\uFF1A
${head || "\uFF08\u7A7A\u5757\uFF09"}`;
}
function previewDoc(hPath, childCount) {
  if (!hPath) return "\u76EE\u6807\u6587\u6863\u4E0D\u5B58\u5728\uFF08\u53EF\u80FD\u5DF2\u88AB\u5220\u9664\u6216 ID \u6709\u8BEF\uFF09";
  return `\u6587\u6863\u8DEF\u5F84\uFF1A${hPath}
\u5B50\u5757\u6570\uFF1A${childCount}`;
}
async function buildBlockPreview(client, id) {
  try {
    const { kramdown } = await client.getBlockKramdown(id);
    const children = await client.getChildBlocks(id).catch(() => []);
    return { preview: previewBlock(kramdown ?? "", children.length), exists: true };
  } catch {
    return { preview: "\u76EE\u6807\u5757\u4E0D\u5B58\u5728\uFF08\u53EF\u80FD\u5DF2\u88AB\u5220\u9664\u6216 ID \u6709\u8BEF\uFF09", exists: false };
  }
}
async function buildDocPreview(client, id) {
  try {
    const hPath = await client.getHPathByID(id);
    const children = await client.getChildBlocks(id).catch(() => []);
    return { preview: previewDoc(hPath, children.length), exists: Boolean(hPath) };
  } catch {
    return { preview: previewDoc(void 0, 0), exists: false };
  }
}
function requireConfirm(spec, args, preview, exists) {
  if (!isDestructive(spec)) return;
  if (!exists) {
    throw new SiYuanError("SIYUAN_NOT_FOUND", `\u76EE\u6807\u4E0D\u5B58\u5728\uFF0C\u5DF2\u62D2\u7EDD\u6267\u884C\uFF08${spec.name}\uFF09`, { hint: preview });
  }
  if (args.confirm !== true) {
    throw new SiYuanError(
      "SIYUAN_CONFIRM_REQUIRED",
      `\u7834\u574F\u578B\u64CD\u4F5C\u672A\u786E\u8BA4\uFF0C\u5DF2\u62D2\u7EDD\u6267\u884C\uFF08${spec.name}\uFF09\u3002
--- \u9884\u89C8 ---
${preview}`,
      { hint: "\u786E\u8BA4\u65E0\u8BEF\u540E\u8BF7\u5E26 confirm: true \u91CD\u65B0\u8C03\u7528\uFF1B\u53EA\u67E5\u770B\u5F71\u54CD\u53EF\u7528 dryRun: true\u3002" }
    );
  }
}
function shouldDryRun(args) {
  return args.dryRun === true;
}
async function requireFreshHash(client, id, expectedHash) {
  if (!expectedHash) return;
  const current = await client.getBlockHash(id);
  if (current === void 0) {
    throw new SiYuanError("SIYUAN_STALE_TARGET", `\u76EE\u6807\u5757\u5DF2\u4E0D\u5B58\u5728\uFF08id=${id}\uFF09\uFF0C\u5DF2\u62D2\u7EDD\u6267\u884C`, {
      hint: "\u8BF7\u91CD\u65B0\u5B9A\u4F4D\u76EE\u6807\u540E\u518D\u8BD5\u3002"
    });
  }
  if (current !== expectedHash) {
    throw new SiYuanError(
      "SIYUAN_STALE_TARGET",
      `\u76EE\u6807\u5757\u5DF2\u88AB\u4FEE\u6539\uFF08\u5F53\u524D hash=${current}\uFF0C\u671F\u671B ${expectedHash}\uFF09\uFF0C\u5DF2\u62D2\u7EDD\u6267\u884C`,
      { hint: "\u8BF7\u5148\u91CD\u65B0\u8BFB\u53D6\u76EE\u6807\u5185\u5BB9\uFF0C\u786E\u8BA4\u540E\u518D\u6267\u884C\u3002" }
    );
  }
}
async function buildNotebookPreview(client, notebook) {
  try {
    const { name, conf } = await client.getNotebookConf(notebook);
    const docCount = await countDocs(client, notebook);
    const icon = typeof conf.icon === "string" ? conf.icon : "";
    const preview = [
      `\u7B14\u8BB0\u672C\u540D\u79F0\uFF1A${name}`,
      `\u56FE\u6807\uFF1A${icon || "(\u672A\u8BBE\u7F6E)"}`,
      `\u5F53\u524D\u72B6\u6001\uFF1A${conf.closed === true ? "\u5DF2\u5173\u95ED" : "\u5DF2\u6253\u5F00"}`,
      `\u6587\u6863\u6570\uFF1A${docCount}`,
      `\u65E5\u8BB0\u4FDD\u5B58\u8DEF\u5F84\uFF1A${String(conf.dailyNoteSavePath ?? "(\u672A\u914D\u7F6E)")}`
    ].join("\n");
    return { preview, exists: true, name, icon, docCount };
  } catch {
    return {
      preview: "\u76EE\u6807\u7B14\u8BB0\u672C\u4E0D\u5B58\u5728\uFF08\u53EF\u80FD\u5DF2\u88AB\u5220\u9664\u6216 ID \u6709\u8BEF\uFF09",
      exists: false,
      name: "",
      icon: "",
      docCount: 0
    };
  }
}
async function countDocs(client, notebook) {
  try {
    const escaped = notebook.replace(/'/g, "''");
    const { rows } = await client.querySql(
      `SELECT COUNT(*) AS c FROM blocks WHERE box = '${escaped}' AND type = 'd'`
    );
    const value = rows[0]?.c;
    const count = typeof value === "number" ? value : Number(value ?? 0);
    return Number.isFinite(count) ? count : 0;
  } catch {
    return 0;
  }
}
function requireConfirmName(args, currentName, what) {
  const provided = typeof args.confirmName === "string" ? args.confirmName.trim() : "";
  if (currentName.length > 0 && provided === currentName) return;
  throw new SiYuanError("SIYUAN_CONFIRM_MISMATCH", `${what} \u7684 confirmName \u4E0E\u5F53\u524D\u540D\u79F0\u4E0D\u4E00\u81F4\uFF0C\u5DF2\u62D2\u7EDD\u6267\u884C\u3002`, {
    hint: `\u5F53\u524D\u540D\u79F0\u662F\u300C${currentName}\u300D\u3002\u8BF7\u628A\u5B83\u539F\u6837\u586B\u5165 confirmName \u518D\u8C03\u7528\uFF08\u8FD9\u662F\u6574\u5E93\u5220\u9664\u7684\u4E8C\u6B21\u786E\u8BA4\uFF09\u3002`
  });
}
function requireIdList(args, key) {
  const raw = args[key];
  let ids = [];
  if (Array.isArray(raw)) {
    ids = raw.map((value) => String(value).trim());
  } else if (typeof raw === "string") {
    const text = raw.trim();
    if (text.startsWith("[")) {
      try {
        const parsed = JSON.parse(text);
        if (Array.isArray(parsed)) ids = parsed.map((value) => String(value).trim());
      } catch {
        ids = [];
      }
    } else {
      ids = text.split(",").map((part) => part.trim());
    }
  }
  const unique = [...new Set(ids.filter((id) => id.length > 0))];
  if (unique.length === 0) {
    throw new SiYuanError(
      "SIYUAN_API_ERROR",
      `${key} \u4E0D\u80FD\u4E3A\u7A7A\uFF1A\u6279\u91CF\u66FF\u6362\u5FC5\u987B\u9650\u5B9A\u5230\u5177\u4F53\u5757 ID \u5217\u8868\uFF08\u4E0D\u5141\u8BB8\u5168\u5E93\u66FF\u6362\uFF09`,
      { hint: "\u5148\u7528 search_blocks \u6216 sql \u627E\u5230\u76EE\u6807\u5757\uFF0C\u518D\u628A\u5B83\u4EEC\u7684 ID \u4F20\u7ED9 ids\uFF08\u6570\u7EC4\u6216\u9017\u53F7\u5206\u9694\uFF09\u3002" }
    );
  }
  return unique;
}

// src/tools/definitions.ts
function compactDocEntry(entry2) {
  const item = entry2 ?? {};
  return { id: item.id, name: item.name, path: item.path, subFileCount: item.subFileCount };
}
var ID_DESC = "\u5757\u6216\u6587\u6863 ID\uFF0C\u5F62\u5982 20210817205410-2kvfpfn";
var NB_DESC = "\u7B14\u8BB0\u672C ID\uFF08\u7531 notebook_list \u83B7\u53D6\uFF09";
var readOnlyTools = [
  {
    name: "version",
    title: "\u5185\u6838\u7248\u672C",
    description: "\u83B7\u53D6\u601D\u6E90\u5185\u6838\u7248\u672C\u53F7\uFF0C\u7528\u4E8E\u786E\u8BA4\u8FDE\u63A5\u53EF\u7528\u6027\u4E0E\u5185\u6838\u5927\u7248\u672C\u3002",
    risk: "read",
    params: {},
    invoke: async (client) => {
      const version = await client.version();
      return { text: `\u601D\u6E90\u5185\u6838\u7248\u672C\uFF1A${version}`, data: { version } };
    }
  },
  {
    name: "status",
    title: "\u8FDE\u63A5\u72B6\u6001",
    description: "\u6C47\u603B\u8FDE\u63A5\u72B6\u6001\u3001\u5185\u6838\u7248\u672C\u3001\u5185\u6838\u65F6\u95F4\u4E0E\u5F53\u524D\u8FDE\u63A5\u914D\u7F6E\uFF08host/port\u3001\u662F\u5426\u5E26 Token\uFF09\uFF0C\u7528\u4E8E\u6392\u67E5\u8FDE\u4E0D\u4E0A\u6216\u9274\u6743\u95EE\u9898\u3002",
    risk: "read",
    params: {},
    invoke: async (client) => {
      const connected = await client.ping();
      const version = connected ? await client.version() : "";
      const time = connected ? await client.currentTime() : 0;
      const { host, port, token, tokenSource } = client.config;
      const text = [
        `\u8FDE\u63A5\uFF1A${connected ? "\u6B63\u5E38" : "\u4E0D\u53EF\u8FBE"}`,
        `\u5730\u5740\uFF1Ahttp://${host}:${port}`,
        // 只报来源，绝不上显 Token 本身
        `Token\uFF1A${token ? `\u5DF2\u914D\u7F6E\uFF08\u6765\u6E90\uFF1A${tokenSource}\uFF09` : "\u672A\u914D\u7F6E"}`,
        connected ? `\u5185\u6838\u7248\u672C\uFF1A${version}` : "",
        connected ? `\u5185\u6838\u65F6\u95F4\uFF1A${new Date(time).toISOString()}` : ""
      ].filter(Boolean).join("\n");
      return { text, data: { connected, host, port, hasToken: Boolean(token), tokenSource, version, time } };
    }
  },
  {
    name: "notebook_list",
    title: "\u5217\u51FA\u7B14\u8BB0\u672C",
    description: "\u5217\u51FA\u6240\u6709\u7B14\u8BB0\u672C\u53CA\u5176 id\u3001\u540D\u79F0\u4E0E\u662F\u5426\u5DF2\u5173\u95ED\uFF08closed\uFF09\u3002\u4EFB\u4F55\u6309\u7B14\u8BB0\u672C\u64CD\u4F5C\u7684\u8D77\u70B9\u3002",
    risk: "read",
    params: {},
    invoke: async (client) => {
      const notebooks = await client.listNotebooks();
      return { text: renderText(notebooks), data: notebooks };
    }
  },
  {
    name: "notebook_info",
    title: "\u7B14\u8BB0\u672C\u4FE1\u606F",
    description: "\u83B7\u53D6\u6307\u5B9A\u7B14\u8BB0\u672C\u7684\u914D\u7F6E\u4E0E\u7EDF\u8BA1\u4FE1\u606F\u3002",
    risk: "read",
    params: { notebook: { type: "string", required: true, description: NB_DESC } },
    invoke: async (client, args) => {
      const info = await client.getNotebookInfo(String(args.notebook));
      return { text: renderText(info), data: info };
    }
  },
  {
    name: "notebook_conf_get",
    title: "\u7B14\u8BB0\u672C\u914D\u7F6E",
    description: "\u8BFB\u53D6\u7B14\u8BB0\u672C\u914D\u7F6E\uFF1A\u540D\u79F0\u3001\u56FE\u6807\u3001\u662F\u5426\u5DF2\u5173\u95ED\u3001\u5F15\u7528/\u65B0\u5EFA\u6587\u6863\u7684\u4FDD\u5B58\u8DEF\u5F84\u3001\u65E5\u8BB0\u4FDD\u5B58\u8DEF\u5F84\u4E0E\u6A21\u677F\u8DEF\u5F84\u7B49\u3002\u8981\u5199\u65E5\u8BB0\u524D\u53EF\u7528\u5B83\u786E\u8BA4 dailyNoteSavePath\u3002",
    risk: "read",
    params: { notebook: { type: "string", required: true, description: NB_DESC } },
    invoke: async (client, args) => {
      const { box, name, conf } = await client.getNotebookConf(String(args.notebook));
      const picked = {
        name: conf.name ?? name,
        icon: conf.icon,
        closed: conf.closed,
        refCreateSavePath: conf.refCreateSavePath,
        docCreateSavePath: conf.docCreateSavePath,
        dailyNoteSavePath: conf.dailyNoteSavePath,
        dailyNoteTemplatePath: conf.dailyNoteTemplatePath
      };
      return { text: `${renderText(picked)}

\uFF08\u5168\u91CF\u914D\u7F6E\u89C1 data.conf\uFF09`, data: { box, name, conf } };
    }
  },
  {
    name: "doc_list",
    title: "\u5217\u51FA\u6587\u6863",
    description: "\u5217\u51FA\u6307\u5B9A\u7B14\u8BB0\u672C\u8DEF\u5F84\u4E0B\u7684\u76F4\u63A5\u5B50\u6587\u6863\u4E0E\u5B50\u76EE\u5F55\uFF08\u4E0D\u9012\u5F52\uFF09\u3002",
    risk: "read",
    params: {
      notebook: { type: "string", required: true, description: NB_DESC },
      path: { type: "string", description: "\u7B14\u8BB0\u672C\u5185\u8DEF\u5F84\uFF0C\u9ED8\u8BA4\u6839\u8DEF\u5F84", default: "/" }
    },
    invoke: async (client, args) => {
      const docs = await client.listDocsByPath(String(args.notebook), String(args.path));
      return { text: renderText(docs.map(compactDocEntry)), data: docs };
    }
  },
  {
    name: "doc_tree",
    title: "\u6587\u6863\u5B50\u6811",
    description: "\u4EE5\u6307\u5B9A\u6587\u6863\u4E3A\u6839\u9012\u5F52\u5217\u51FA\u5176\u5B50\u6587\u6863\u6811\u3002\u5185\u6838\u4E0D\u63A5\u53D7\u6839\u8DEF\u5F84\uFF1Apath \u5FC5\u987B\u662F\u6587\u6863\u8DEF\u5F84\uFF08\u5982 /20261009104613-x.sy\uFF09\u6216\u6587\u6863 ID\uFF1B\u8981\u679A\u4E3E\u6574\u4E2A\u7B14\u8BB0\u672C\u7684\u6587\u6863\u8BF7\u7528 doc_list\uFF08\u9010\u5C42\uFF09\u6216 sql\u3002\u6CE8\u610F\uFF1A\u8FD4\u56DE\u7684\u662F\u5B50\u6587\u6863 **ID \u5217\u8868**\uFF0C\u9700\u8981\u8DEF\u5F84\u65F6\u518D\u7528 doc_hpath_by_id \u89E3\u6790\u3002depth \u63A7\u5236\u6700\u5927\u6DF1\u5EA6\uFF08-1 \u8868\u793A\u4E0D\u9650\uFF09\u3002",
    risk: "read",
    params: {
      notebook: { type: "string", required: true, description: NB_DESC },
      path: {
        type: "string",
        required: true,
        description: "\u6587\u6863\u8DEF\u5F84\uFF08\u5982 /20261009104613-x.sy\uFF09\u6216\u6587\u6863 ID\uFF1B\u4E0D\u80FD\u662F\u6839\u8DEF\u5F84"
      },
      depth: { type: "number", description: "\u6700\u5927\u6DF1\u5EA6\uFF0C-1 \u4E3A\u4E0D\u9650", default: -1 },
      sort: { type: "number", description: "\u6392\u5E8F\u6A21\u5F0F\uFF0C0 \u4E3A\u9ED8\u8BA4", default: 0 }
    },
    invoke: async (client, args) => {
      const tree = await client.listDocTree(
        String(args.notebook),
        String(args.path),
        Number(args.depth),
        Number(args.sort)
      );
      return { text: renderText(tree), data: tree };
    }
  },
  {
    name: "doc_path_by_id",
    title: "\u6587\u6863\u5B58\u50A8\u8DEF\u5F84",
    description: "\u7531\u6587\u6863 ID \u83B7\u53D6\u5176\u6240\u5728\u7B14\u8BB0\u672C\u4E0E\u5185\u6838\u5B58\u50A8\u8DEF\u5F84\u3002",
    risk: "read",
    params: { id: { type: "string", required: true, description: ID_DESC } },
    invoke: async (client, args) => {
      const path = await client.getPathByID(String(args.id));
      return { text: `notebook: ${path.notebook}
path: ${path.path}`, data: path };
    }
  },
  {
    name: "doc_hpath_by_id",
    title: "\u6587\u6863\u4EBA\u7C7B\u53EF\u8BFB\u8DEF\u5F84",
    description: "\u7531\u6587\u6863 ID \u83B7\u53D6\u4EBA\u7C7B\u53EF\u8BFB\u8DEF\u5F84\uFF08\u5982 /\u7B14\u8BB0/\u7532\uFF09\u3002",
    risk: "read",
    params: { id: { type: "string", required: true, description: ID_DESC } },
    invoke: async (client, args) => {
      const hPath = await client.getHPathByID(String(args.id));
      return { text: hPath, data: { hPath } };
    }
  },
  {
    name: "doc_ids_by_hpath",
    title: "\u6309\u8DEF\u5F84\u53D6\u6587\u6863 ID",
    description: "\u7531\u7B14\u8BB0\u672C\u5185\u7684\u4EBA\u7C7B\u53EF\u8BFB\u8DEF\u5F84\u83B7\u53D6\u5BF9\u5E94\u6587\u6863 ID \u5217\u8868\u3002",
    risk: "read",
    params: {
      notebook: { type: "string", required: true, description: NB_DESC },
      path: { type: "string", required: true, description: "\u4EBA\u7C7B\u53EF\u8BFB\u8DEF\u5F84\uFF0C\u5982 /\u7B14\u8BB0/\u7532" }
    },
    invoke: async (client, args) => {
      const ids = await client.getIDsByHPath(String(args.notebook), String(args.path));
      return { text: renderText(ids), data: ids };
    }
  },
  {
    name: "doc_export_md",
    title: "\u5BFC\u51FA\u6587\u6863 Markdown",
    description: "\u628A\u6587\u6863\u5BFC\u51FA\u4E3A Markdown \u6587\u672C\uFF1BmaxChars \u63A7\u5236\u6700\u5927\u8FD4\u56DE\u5B57\u7B26\u6570\uFF0C\u8D85\u51FA\u4F1A\u88AB\u622A\u65AD\u5E76\u63D0\u793A\u3002",
    risk: "read",
    params: {
      id: { type: "string", required: true, description: ID_DESC },
      maxChars: { type: "number", description: "\u6700\u5927\u5B57\u7B26\u6570", default: 2e4 }
    },
    invoke: async (client, args) => {
      const { hPath, content } = await client.exportMdContent(String(args.id));
      return {
        text: `${hPath}

${truncateText(content ?? "", Number(args.maxChars))}`,
        data: { hPath, content }
      };
    }
  },
  {
    name: "block_get",
    title: "\u8BFB\u53D6\u5757 kramdown",
    description: "\u83B7\u53D6\u5757\u7684 kramdown \u6E90\u6587\u672C\uFF1BmaxChars \u63A7\u5236\u6700\u5927\u8FD4\u56DE\u5B57\u7B26\u6570\uFF0C\u662F\u6539\u5199\u524D\u7684\u300C\u5148\u8BFB\u300D\u6B65\u9AA4\u3002",
    risk: "read",
    params: {
      id: { type: "string", required: true, description: ID_DESC },
      maxChars: { type: "number", description: "\u6700\u5927\u5B57\u7B26\u6570", default: 2e4 }
    },
    invoke: async (client, args) => {
      const res = await client.getBlockKramdown(String(args.id));
      return { text: truncateText(res.kramdown ?? "", Number(args.maxChars)), data: res };
    }
  },
  {
    name: "block_children",
    title: "\u8BFB\u53D6\u5B50\u5757",
    description: "\u83B7\u53D6\u6307\u5B9A\u5757\u7684\u76F4\u63A5\u5B50\u5757\u5217\u8868\u3002",
    risk: "read",
    params: { id: { type: "string", required: true, description: ID_DESC } },
    invoke: async (client, args) => {
      const rows = await client.getChildBlocks(String(args.id));
      return { text: renderText(rows), data: rows };
    }
  },
  {
    name: "block_attrs_get",
    title: "\u8BFB\u53D6\u5757\u5C5E\u6027",
    description: "\u83B7\u53D6\u5757\u7684\u81EA\u5B9A\u4E49\u5C5E\u6027\u952E\u503C\u5BF9\u3002",
    risk: "read",
    params: { id: { type: "string", required: true, description: ID_DESC } },
    invoke: async (client, args) => {
      const attrs = await client.getBlockAttrs(String(args.id));
      return { text: renderText(attrs), data: attrs };
    }
  },
  {
    name: "search_blocks",
    title: "\u5168\u6587\u68C0\u7D22\u5757",
    description: "\u5728\u5757\u5185\u5BB9\u4E2D\u505A\u5168\u6587\u68C0\u7D22\uFF0C\u8FD4\u56DE\u547D\u4E2D\u7684\u5757\u53CA\u5339\u914D\u7EDF\u8BA1\u3002",
    risk: "read",
    params: { query: { type: "string", required: true, description: "\u68C0\u7D22\u5173\u952E\u8BCD" } },
    invoke: async (client, args) => {
      const res = await client.fullTextSearchBlock(String(args.query));
      const blocks = res.blocks ?? [];
      return {
        text: `${renderText(blocks)}
\u5339\u914D\u5757\u6570\uFF1A${res.matchedBlockCount ?? blocks.length}`,
        data: res
      };
    }
  },
  {
    name: "search_docs",
    title: "\u68C0\u7D22\u6587\u6863\u540D",
    description: "\u6309\u5173\u952E\u8BCD\u68C0\u7D22\u6587\u6863\u540D\u79F0\uFF0C\u8FD4\u56DE\u547D\u4E2D\u7684\u6587\u6863\u8DEF\u5F84\u4E0E ID\u3002",
    risk: "read",
    params: { k: { type: "string", required: true, description: "\u68C0\u7D22\u5173\u952E\u8BCD" } },
    invoke: async (client, args) => {
      const hits = await client.searchDocs(String(args.k));
      return { text: renderText(hits), data: hits };
    }
  },
  {
    name: "search_tag",
    title: "\u68C0\u7D22\u6807\u7B7E",
    description: "\u6309\u5173\u952E\u8BCD\u68C0\u7D22\u6807\u7B7E\u540D\uFF0Ck \u4E3A\u7A7A\u65F6\u8FD4\u56DE\u5168\u90E8\u6807\u7B7E\u540D\u3002",
    risk: "read",
    params: { k: { type: "string", description: "\u6807\u7B7E\u5173\u952E\u8BCD\uFF0C\u53EF\u7559\u7A7A", default: "" } },
    invoke: async (client, args) => {
      const tags = await client.searchTag(String(args.k));
      return { text: renderText(tags), data: tags };
    }
  },
  {
    name: "tag_list",
    title: "\u5217\u51FA\u5168\u90E8\u6807\u7B7E",
    description: "\u5217\u51FA\u77E5\u8BC6\u5E93\u4E2D\u7684\u5168\u90E8\u6807\u7B7E\u53CA\u5F15\u7528\u8BA1\u6570\uFF08\u5FFD\u7565\u5185\u6838\u7684\u5217\u8868\u6761\u6570\u4E0A\u9650\uFF09\u3002",
    risk: "read",
    params: {},
    invoke: async (client) => {
      const tags = await client.getTag();
      return { text: renderText(tags), data: tags };
    }
  },
  {
    name: "sql",
    title: "SQL \u67E5\u8BE2\uFF08\u53EA\u8BFB\uFF09",
    description: "\u5BF9\u5185\u6838 SQLite \u7D22\u5F15\u6267\u884C\u53EA\u8BFB SQL \u67E5\u8BE2\uFF0C\u662F\u672A\u8986\u76D6\u573A\u666F\u7684\u9003\u751F\u901A\u9053\u3002\u4EC5\u5141\u8BB8\u5355\u6761 SELECT \u6216 WITH \u8BED\u53E5\uFF1B\u53D8\u66F4\u7C7B\u8BED\u53E5\uFF08INSERT/UPDATE/DELETE/DROP/PRAGMA \u7B49\uFF09\u4F1A\u88AB\u62D2\u7EDD\u3002\u65E0 LIMIT \u65F6\u5185\u6838\u9ED8\u8BA4\u53EA\u8FD4\u56DE 64 \u884C\u5E76\u6807\u8BB0\u622A\u65AD\u3002",
    risk: "read",
    params: {
      stmt: { type: "string", required: true, description: "\u53EA\u8BFB SQL \u8BED\u53E5\uFF08\u5355\u6761 SELECT \u6216 WITH\uFF09" }
    },
    invoke: async (client, args) => {
      const stmt = String(args.stmt);
      assertReadOnlySql(stmt);
      const { rows, limit, truncated } = await client.querySql(stmt);
      const notice = renderSqlNotice(limit, truncated);
      return {
        text: [renderText(rows), notice].filter(Boolean).join("\n\n"),
        data: { rows, limit, truncated }
      };
    }
  }
];
var CONFIRM_DESC = "\u786E\u8BA4\u6807\u5FD7\uFF1A\u5FC5\u987B\u663E\u5F0F\u4F20 true \u624D\u6267\u884C\uFF1B\u4E0D\u4F20\u6216\u4F20 false \u65F6\u53EA\u8FD4\u56DE\u9884\u89C8\u5E76\u62D2\u7EDD\uFF08\u9632\u8BEF\u64CD\u4F5C\uFF09";
var DRYRUN_DESC = "\u53EA\u9884\u89C8\u5F71\u54CD\u3001\u4E0D\u5199\u5185\u6838\uFF1B\u4EC5\u4F20\u5B57\u9762 true \u751F\u6548";
var HASH_DESC = "\u53EF\u9009\u4E50\u89C2\u5E76\u53D1\u6821\u9A8C\uFF1A\u4F20\u5165\u76EE\u6807\u7684\u5F53\u524D blocks hash\uFF0C\u4E0D\u4E00\u81F4\u5219\u62D2\u7EDD\u8986\u76D6";
function renderOps(title, ops) {
  const lines = ops.doOperations.map((op) => `- ${op.action} id=${op.id ?? "-"}`);
  const undo = ops.undoOperations ? "\n\u5185\u6838\u5DF2\u8FD4\u56DE\u53EF\u64A4\u9500\u64CD\u4F5C\uFF08undoOperations\uFF09" : "";
  return [title, ...lines, undo].filter(Boolean).join("\n");
}
function previewText(spec, action, preview) {
  return `\u9884\u89C8\uFF08\u672A\u6267\u884C\uFF09\uFF1A${action}\uFF08${spec.name}\uFF09
${preview}

\u786E\u8BA4\u65E0\u8BEF\u8BF7\u5E26 confirm: true \u91CD\u65B0\u8C03\u7528\u3002`;
}
function requireName(spec, args, key) {
  const value = String(args[key] ?? "").trim();
  if (value.length === 0) {
    throw new SiYuanError("SIYUAN_API_ERROR", `${spec.name} \u9700\u8981\u975E\u7A7A\u53C2\u6570 ${key}`, {
      hint: `\u8BF7\u63D0\u4F9B ${key}`
    });
  }
  return value;
}
function requireAnchor(spec, parentID, previousID, nextID) {
  if (!parentID && !previousID && !nextID) {
    throw new SiYuanError(
      "SIYUAN_API_ERROR",
      `${spec.name} \u81F3\u5C11\u9700\u8981\u4E00\u4E2A\u951A\u70B9\uFF08parentID \u6216 previousID\uFF09`,
      { hint: "\u7528 block_get/block_children \u627E\u5230\u76EE\u6807\u5757\u540E\uFF0C\u4F20\u5165 parentID\uFF08\u6302\u5230\u5176\u4E0B\uFF09\u6216 previousID\uFF08\u63D2\u5230\u5176\u540E\uFF09\u3002" }
    );
  }
}
function parseAttrs(raw) {
  let parsed = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new SiYuanError("SIYUAN_API_ERROR", 'attrs \u9700\u8981 JSON \u5BF9\u8C61\u5B57\u7B26\u4E32\uFF08\u4F8B\u5982 {"custom-a":"1"}\uFF09', {
        hint: "\u81EA\u5B9A\u4E49\u5C5E\u6027\u952E\u5FC5\u987B\u4EE5 custom- \u5F00\u5934\u3002"
      });
    }
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new SiYuanError("SIYUAN_API_ERROR", "attrs \u9700\u8981 JSON \u5BF9\u8C61", { hint: '\u5F62\u5982 {"custom-a":"1"}' });
  }
  const entries = Object.entries(parsed);
  for (const [key] of entries) {
    if (!key.startsWith("custom-")) {
      throw new SiYuanError("SIYUAN_API_ERROR", `\u5C5E\u6027\u540D ${key} \u975E\u6CD5\uFF1A\u5185\u6838\u8981\u6C42\u81EA\u5B9A\u4E49\u5C5E\u6027\u4EE5 custom- \u5F00\u5934`, {
        hint: "\u4F8B\u5982 custom-status\u3001custom-tag\u3002"
      });
    }
  }
  return Object.fromEntries(entries.map(([key, value]) => [key, String(value)]));
}
function parseIdList(raw) {
  const ids = String(raw ?? "").split(",").map((part) => part.trim()).filter((part) => part.length > 0);
  if (ids.length === 0) {
    throw new SiYuanError("SIYUAN_API_ERROR", "\u9700\u8981\u81F3\u5C11\u4E00\u4E2A\u6587\u6863 ID", { hint: "\u591A\u4E2A ID \u7528\u9017\u53F7\u5206\u9694\u3002" });
  }
  return ids;
}
function parseJsonObject(raw, label) {
  let parsed = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new SiYuanError("SIYUAN_API_ERROR", `${label} \u9700\u8981 JSON \u5BF9\u8C61\u5B57\u7B26\u4E32`, {
        hint: `\u4F8B\u5982 {"${label}Key":"value"}`
      });
    }
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new SiYuanError("SIYUAN_API_ERROR", `${label} \u9700\u8981 JSON \u5BF9\u8C61`);
  }
  return parsed;
}
function parseListParam(raw, label) {
  if (Array.isArray(raw)) return raw.map((value) => String(value).trim()).filter((value) => value.length > 0);
  const text = String(raw ?? "").trim();
  if (text.length === 0) return [];
  if (text.startsWith("[")) {
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new SiYuanError("SIYUAN_API_ERROR", `${label} \u7684 JSON \u6570\u7EC4\u683C\u5F0F\u975E\u6CD5`, {
        hint: '\u4F8B\u5982 ["/a","/b"]\uFF1B\u4E5F\u53EF\u4EE5\u76F4\u63A5\u7528\u9017\u53F7\u5206\u9694\uFF1A/a,/b'
      });
    }
    if (!Array.isArray(parsed)) {
      throw new SiYuanError("SIYUAN_API_ERROR", `${label} \u9700\u8981 JSON \u6570\u7EC4\u6216\u9017\u53F7\u5206\u9694\u5B57\u7B26\u4E32`);
    }
    return parsed.map((value) => String(value).trim()).filter((value) => value.length > 0);
  }
  return text.split(",").map((part) => part.trim()).filter((part) => part.length > 0);
}
var ALL_REPLACE_TYPES = [
  "text",
  "imgText",
  "imgTitle",
  "imgSrc",
  "aText",
  "aTitle",
  "aHref",
  "code",
  "em",
  "strong",
  "inlineMath",
  "inlineMemo",
  "blockRef",
  "fileAnnotationRef",
  "kbd",
  "mark",
  "s",
  "sub",
  "sup",
  "tag",
  "u",
  "docTitle",
  "codeBlock",
  "mathBlock",
  "htmlBlock"
];
function resolveReplaceTypes(raw) {
  if (raw === void 0 || raw === "") {
    return { types: { text: true }, label: "text\uFF08\u9ED8\u8BA4\u53EA\u66FF\u6362\u666E\u901A\u6587\u672C\uFF09" };
  }
  const parsed = parseJsonObject(raw, "replaceTypes");
  if (parsed.all === true) {
    return {
      types: Object.fromEntries(ALL_REPLACE_TYPES.map((type) => [type, true])),
      label: `\u5168\u90E8\u7C7B\u578B\uFF08${ALL_REPLACE_TYPES.length} \u79CD\uFF09`
    };
  }
  const keys = Object.keys(parsed);
  return { types: parsed, label: keys.length > 0 ? keys.join(", ") : "(\u7A7A\uFF0C\u5C06\u4E0D\u4F1A\u66FF\u6362\u4EFB\u4F55\u5185\u5BB9)" };
}
async function resolveIdByPath(client, notebook, path) {
  const asHPath = path.replace(/\.sy$/i, "");
  try {
    const byHPath = await client.getIDsByHPath(notebook, asHPath);
    if (byHPath.length > 0) return { ids: byHPath };
  } catch {
  }
  try {
    const normalized = path.startsWith("/") ? path : `/${path}`;
    const slash = normalized.lastIndexOf("/");
    const parent = slash <= 0 ? "/" : normalized.slice(0, slash);
    const entries = await client.listDocsByPath(notebook, parent);
    const hit = entries.find((entry2) => String(entry2.path ?? "") === normalized);
    const id = hit ? String(hit.id ?? "") : "";
    return { ids: id.length > 0 ? [id] : [] };
  } catch {
    return { ids: [] };
  }
}
var additiveTools = [
  {
    name: "notebook_create",
    title: "\u521B\u5EFA\u7B14\u8BB0\u672C",
    description: "\u521B\u5EFA\u4E00\u4E2A\u65B0\u7B14\u8BB0\u672C\u5E76\u8FD4\u56DE\u5176 ID\u3002\u4E5F\u662F\u505A\u5199\u64CD\u4F5C\u5B9E\u9A8C\uFF08\u6C99\u76D2\uFF09\u7684\u8D77\u70B9\u3002",
    risk: "additive",
    params: { name: { type: "string", required: true, description: "\u7B14\u8BB0\u672C\u540D\u79F0" } },
    invoke: async (client, args) => {
      const created = await client.createNotebook(requireName(findToolSpecOrThrow("notebook_create"), args, "name"));
      return { text: `\u5DF2\u521B\u5EFA\u7B14\u8BB0\u672C\uFF1A${created.name}\uFF08id=${created.id}\uFF09`, data: created };
    }
  },
  {
    name: "doc_create",
    title: "\u521B\u5EFA\u6587\u6863",
    description: "\u5728\u6307\u5B9A\u7B14\u8BB0\u672C\u4E2D\u6309\u4EBA\u8BFB\u8DEF\u5F84\u521B\u5EFA\u6587\u6863\u5E76\u5199\u5165 Markdown\u3002\u540C path \u91CD\u590D\u8C03\u7528\u4E0D\u4F1A\u8986\u76D6\u5DF2\u6709\u6587\u6863\uFF08\u5E42\u7B49\uFF09\u3002",
    risk: "additive",
    params: {
      notebook: { type: "string", required: true, description: NB_DESC },
      path: { type: "string", required: true, description: "\u4EBA\u8BFB\u8DEF\u5F84\uFF0C\u9700\u4EE5 / \u5F00\u5934\uFF0C\u5982 /\u6C99\u76D2/\u7532" },
      markdown: { type: "string", description: "GFM Markdown \u5185\u5BB9", default: "" }
    },
    invoke: async (client, args) => {
      const id = await client.createDocWithMd(
        String(args.notebook),
        String(args.path),
        String(args.markdown ?? "")
      );
      return { text: `\u5DF2\u521B\u5EFA\u6587\u6863\uFF1A${id}
\u8DEF\u5F84\uFF1A${String(args.path)}`, data: { id, notebook: args.notebook, path: args.path } };
    }
  },
  {
    name: "daily_note_create",
    title: "\u521B\u5EFA\u4ECA\u65E5\u65E5\u8BB0",
    description: "\u5728\u6307\u5B9A\u7B14\u8BB0\u672C\u4E2D\u521B\u5EFA\u300C\u4ECA\u5929\u300D\u7684\u65E5\u8BB0\u6587\u6863\u5E76\u8FD4\u56DE\u5176 ID\uFF08\u6309\u8BE5\u7B14\u8BB0\u672C\u7684 dailyNoteSavePath \u6A21\u677F\u843D\u76D8\uFF09\u3002\u82E5\u4ECA\u5929\u7684\u65E5\u8BB0\u5DF2\u5B58\u5728\uFF0C\u5185\u6838\u8FD4\u56DE\u65E2\u6709\u6587\u6863 ID \u4E14\u4E0D\u91CD\u590D\u521B\u5EFA\uFF08\u5929\u7136\u5E42\u7B49\uFF09\u3002",
    risk: "additive",
    params: { notebook: { type: "string", required: true, description: NB_DESC } },
    invoke: async (client, args) => {
      const id = await client.createDailyNote(String(args.notebook));
      return {
        text: `\u65E5\u8BB0\u6587\u6863\uFF1A${id || "(\u5185\u6838\u672A\u8FD4\u56DE ID)"}
\u63D0\u793A\uFF1A\u7528 doc_hpath_by_id \u89E3\u6790\u5176\u4EBA\u7C7B\u53EF\u8BFB\u8DEF\u5F84\uFF0C\u6216\u7528 block_append\uFF08parentID \u4F20\u8BE5 ID\uFF09\u8FFD\u52A0\u5185\u5BB9\u3002`,
        data: { id }
      };
    }
  },
  {
    name: "block_append",
    title: "\u8FFD\u52A0\u5757",
    description: "\u628A\u5185\u5BB9\u8FFD\u52A0\u5230\u6307\u5B9A\u5757\uFF08\u901A\u5E38\u662F\u6587\u6863 ID\uFF09\u7684\u5B50\u5757\u672B\u5C3E\u3002\u5199\u5165\u65B0\u5185\u5BB9\u7684\u9996\u9009\u65B9\u5F0F\u3002",
    risk: "additive",
    params: {
      parentID: { type: "string", required: true, description: "\u7236\u5757 ID\uFF08\u6587\u6863 ID \u4E5F\u53EF\uFF09" },
      data: { type: "string", required: true, description: "\u8981\u5199\u5165\u7684\u5185\u5BB9" },
      dataType: { type: "string", description: "\u6570\u636E\u7C7B\u578B\uFF1Amarkdown", default: "markdown" }
    },
    invoke: async (client, args) => {
      const ops = await client.appendBlock(String(args.parentID), String(args.data), String(args.dataType));
      return { text: renderOps(`\u5DF2\u8FFD\u52A0\u5230 ${String(args.parentID)}`, ops), data: ops };
    }
  },
  {
    name: "block_prepend",
    title: "\u524D\u7F6E\u5757",
    description: "\u628A\u5185\u5BB9\u63D2\u5165\u5230\u6307\u5B9A\u5757\u7684\u5B50\u5757\u5F00\u5934\u3002",
    risk: "additive",
    params: {
      parentID: { type: "string", required: true, description: "\u7236\u5757 ID\uFF08\u6587\u6863 ID \u4E5F\u53EF\uFF09" },
      data: { type: "string", required: true, description: "\u8981\u5199\u5165\u7684\u5185\u5BB9" },
      dataType: { type: "string", description: "\u6570\u636E\u7C7B\u578B\uFF1Amarkdown", default: "markdown" }
    },
    invoke: async (client, args) => {
      const ops = await client.prependBlock(String(args.parentID), String(args.data), String(args.dataType));
      return { text: renderOps(`\u5DF2\u524D\u7F6E\u5230 ${String(args.parentID)}`, ops), data: ops };
    }
  },
  {
    name: "block_insert",
    title: "\u63D2\u5165\u5757",
    description: "\u6309\u951A\u70B9\u63D2\u5165\u65B0\u5757\u3002nextID / previousID / parentID \u81F3\u5C11\u4E00\u4E2A\u6709\u6548\uFF0C\u5185\u6838\u4F18\u5148\u7EA7 nextID > previousID > parentID\u3002",
    risk: "additive",
    params: {
      data: { type: "string", required: true, description: "\u8981\u5199\u5165\u7684\u5185\u5BB9" },
      dataType: { type: "string", description: "\u6570\u636E\u7C7B\u578B\uFF1Amarkdown", default: "markdown" },
      parentID: { type: "string", description: "\u7236\u5757 ID\uFF08\u6302\u5230\u5176\u4E0B\uFF09" },
      previousID: { type: "string", description: "\u524D\u4E00\u4E2A\u5757 ID\uFF08\u63D2\u5230\u5176\u540E\uFF09" },
      nextID: { type: "string", description: "\u540E\u4E00\u4E2A\u5757 ID\uFF08\u63D2\u5230\u5176\u524D\uFF09" }
    },
    invoke: async (client, args) => {
      const parentID = optionalString(args.parentID);
      const previousID = optionalString(args.previousID);
      const nextID = optionalString(args.nextID);
      requireAnchor(findToolSpecOrThrow("block_insert"), parentID, previousID, nextID);
      const ops = await client.insertBlock({
        data: String(args.data),
        dataType: String(args.dataType),
        parentID,
        previousID,
        nextID
      });
      return { text: renderOps("\u5DF2\u63D2\u5165\u5757", ops), data: ops };
    }
  },
  {
    name: "block_attrs_set",
    title: "\u8BBE\u7F6E\u5757\u5C5E\u6027",
    description: "\u8BBE\u7F6E\u5757\u7684\u81EA\u5B9A\u4E49\u5C5E\u6027\uFF08\u6807\u7B7E\u7B49\uFF09\u3002\u5C5E\u6027\u540D\u5FC5\u987B\u4EE5 custom- \u5F00\u5934\uFF08\u5185\u6838\u8981\u6C42\uFF09\u3002",
    risk: "additive",
    params: {
      id: { type: "string", required: true, description: ID_DESC },
      attrs: {
        type: "string",
        required: true,
        description: 'JSON \u5BF9\u8C61\u5B57\u7B26\u4E32\uFF0C\u952E\u987B\u4EE5 custom- \u5F00\u5934\uFF0C\u4F8B\u5982 {"custom-status":"done"}'
      }
    },
    invoke: async (client, args) => {
      const attrs = parseAttrs(args.attrs);
      await client.setBlockAttrs(String(args.id), attrs);
      return { text: `\u5DF2\u8BBE\u7F6E ${String(args.id)} \u7684\u5C5E\u6027\uFF1A${Object.keys(attrs).join(", ")}`, data: { id: args.id, attrs } };
    }
  },
  {
    name: "notebook_open",
    title: "\u6253\u5F00\u7B14\u8BB0\u672C",
    description: "\u6253\u5F00\uFF08\u52A0\u8F7D\uFF09\u6307\u5B9A\u7B14\u8BB0\u672C\u3002\u5C5E\u8FD0\u884C\u6001\u53D8\u66F4\u3001\u4E0D\u6539\u6570\u636E\uFF1B\u601D\u6E90\u5BA2\u6237\u7AEF\u754C\u9762\u4F1A\u540C\u6B65\u663E\u793A\u4E3A\u5DF2\u6253\u5F00\u3002",
    risk: "additive",
    params: { notebook: { type: "string", required: true, description: NB_DESC } },
    invoke: async (client, args) => {
      const notebook = String(args.notebook);
      await client.openNotebook(notebook);
      return { text: `\u5DF2\u6253\u5F00\u7B14\u8BB0\u672C ${notebook}`, data: { notebook, opened: true } };
    }
  },
  {
    name: "notebook_close",
    title: "\u5173\u95ED\u7B14\u8BB0\u672C",
    description: "\u5173\u95ED\u6307\u5B9A\u7B14\u8BB0\u672C\uFF08\u4EC5\u8FD0\u884C\u6001\uFF0C\u6570\u636E\u4E0D\u52A8\uFF09\u3002\u82E5\u4E3B\u4EBA\u6B63\u5728\u601D\u6E90\u5BA2\u6237\u7AEF\u91CC\u4F7F\u7528\u8BE5\u7B14\u8BB0\u672C\uFF0C\u754C\u9762\u4F1A\u540C\u6B65\u53D8\u4E3A\u5DF2\u5173\u95ED\u3002",
    risk: "additive",
    params: { notebook: { type: "string", required: true, description: NB_DESC } },
    invoke: async (client, args) => {
      const notebook = String(args.notebook);
      await client.closeNotebook(notebook);
      return { text: `\u5DF2\u5173\u95ED\u7B14\u8BB0\u672C ${notebook}\uFF08\u6570\u636E\u672A\u6539\u52A8\uFF09`, data: { notebook, closed: true } };
    }
  },
  {
    name: "export_resources",
    title: "\u5BFC\u51FA\u8D44\u6E90\u4E3A zip",
    description: "\u628A workspace \u5185\u7684\u6587\u4EF6/\u6587\u4EF6\u5939\u6253\u5305\u4E3A zip\uFF0C\u8FD4\u56DE zip \u5728 workspace \u4E2D\u7684\u76F8\u5BF9\u8DEF\u5F84\u3002\u5199\u5728\u4E34\u65F6\u5BFC\u51FA\u76EE\u5F55\uFF0C\u4E0D\u6539\u52A8\u7B14\u8BB0\u5185\u5BB9\u3002",
    risk: "additive",
    params: {
      paths: {
        type: "string",
        required: true,
        description: '\u8981\u5BFC\u51FA\u7684\u8DEF\u5F84\u5217\u8868\uFF1AJSON \u6570\u7EC4\u6216\u9017\u53F7\u5206\u9694\uFF0C\u5982 ["/conf/appearance/boot"]'
      },
      name: { type: "string", description: "\u5BFC\u51FA\u6587\u4EF6\u540D\uFF08\u4E0D\u542B .zip\uFF09" }
    },
    invoke: async (client, args) => {
      const paths = parseListParam(args.paths, "paths");
      if (paths.length === 0) {
        throw new SiYuanError("SIYUAN_API_ERROR", "paths \u4E0D\u80FD\u4E3A\u7A7A", { hint: "\u81F3\u5C11\u7ED9\u4E00\u4E2A workspace \u5185\u8DEF\u5F84\u3002" });
      }
      const zipPath = await client.exportResources(paths, optionalString(args.name));
      return {
        text: zipPath ? `\u5DF2\u5BFC\u51FA\uFF1A${zipPath}\uFF08${paths.length} \u4E2A\u8DEF\u5F84\uFF09` : "\u5185\u6838\u672A\u8FD4\u56DE\u5BFC\u51FA\u8DEF\u5F84",
        data: { path: zipPath, paths }
      };
    }
  },
  {
    name: "block_fold",
    title: "\u6298\u53E0\u5757",
    description: "\u6298\u53E0\u6307\u5B9A\u5757\uFF08\u53EA\u6539\u6298\u53E0\u72B6\u6001\uFF0C\u53EF\u9006\uFF0C\u4E0D\u6539\u5185\u5BB9\uFF09\u3002",
    risk: "additive",
    params: { id: { type: "string", required: true, description: ID_DESC } },
    invoke: async (client, args) => {
      const id = String(args.id);
      await client.foldBlock(id);
      return { text: `\u5DF2\u6298\u53E0\u5757 ${id}`, data: { id, folded: true } };
    }
  },
  {
    name: "block_unfold",
    title: "\u5C55\u5F00\u5757",
    description: "\u5C55\u5F00\u6307\u5B9A\u5757\uFF08\u53EA\u6539\u6298\u53E0\u72B6\u6001\uFF0C\u53EF\u9006\uFF09\u3002",
    risk: "additive",
    params: { id: { type: "string", required: true, description: ID_DESC } },
    invoke: async (client, args) => {
      const id = String(args.id);
      await client.unfoldBlock(id);
      return { text: `\u5DF2\u5C55\u5F00\u5757 ${id}`, data: { id, folded: false } };
    }
  }
];
var destructiveTools = [
  {
    name: "block_update",
    title: "\u6539\u5199\u5757\uFF08\u7834\u574F\u578B\uFF09",
    description: "\u7528\u65B0\u5185\u5BB9\u6574\u4F53\u8986\u76D6\u6307\u5B9A\u5757\uFF08\u5185\u6838 updateBlock \u662F\u8986\u76D6\u8BED\u4E49\uFF09\u3002\u7834\u574F\u578B\uFF1A\u5FC5\u987B confirm: true\uFF1B\u9ED8\u8BA4 lockType \u4E3A true\uFF0C\u5757\u7C7B\u578B\u53D8\u5316\u4F1A\u88AB\u62D2\u7EDD\u3002",
    risk: "destructive",
    params: {
      id: { type: "string", required: true, description: ID_DESC },
      data: { type: "string", required: true, description: "\u65B0\u7684\u5757\u5185\u5BB9" },
      dataType: { type: "string", description: "\u6570\u636E\u7C7B\u578B\uFF1Amarkdown", default: "markdown" },
      confirm: { type: "boolean", description: CONFIRM_DESC },
      dryRun: { type: "boolean", description: DRYRUN_DESC },
      expectedHash: { type: "string", description: HASH_DESC }
    },
    invoke: async (client, args) => {
      const spec = findToolSpecOrThrow("block_update");
      const id = String(args.id);
      const { preview, exists } = await buildBlockPreview(client, id);
      requireConfirm(spec, args, preview, exists);
      if (shouldDryRun(args)) {
        return { text: previewText(spec, "\u5C06\u8986\u76D6\u8BE5\u5757\u5185\u5BB9", preview), data: { dryRun: true, exists } };
      }
      await requireFreshHash(client, id, optionalString(args.expectedHash));
      const ops = await client.updateBlock(id, String(args.data), String(args.dataType), true);
      return { text: renderOps(`\u5DF2\u6539\u5199\u5757 ${id}`, ops), data: ops };
    }
  },
  {
    name: "block_delete",
    title: "\u5220\u9664\u5757\uFF08\u7834\u574F\u578B\uFF09",
    description: "\u5220\u9664\u6307\u5B9A\u5757\u53CA\u5176\u5B50\u5757\u3002\u7834\u574F\u578B\uFF1A\u5FC5\u987B confirm: true\uFF1B\u4E0D\u4F20\u5219\u53EA\u8FD4\u56DE\u9884\u89C8\u3002",
    risk: "destructive",
    params: {
      id: { type: "string", required: true, description: ID_DESC },
      confirm: { type: "boolean", description: CONFIRM_DESC },
      dryRun: { type: "boolean", description: DRYRUN_DESC },
      expectedHash: { type: "string", description: HASH_DESC }
    },
    invoke: async (client, args) => {
      const spec = findToolSpecOrThrow("block_delete");
      const id = String(args.id);
      const { preview, exists } = await buildBlockPreview(client, id);
      requireConfirm(spec, args, preview, exists);
      if (shouldDryRun(args)) {
        return { text: previewText(spec, "\u5C06\u5220\u9664\u8BE5\u5757\u53CA\u5176\u5B50\u5757", preview), data: { dryRun: true, exists } };
      }
      await requireFreshHash(client, id, optionalString(args.expectedHash));
      const ops = await client.deleteBlock(id);
      return { text: renderOps(`\u5DF2\u5220\u9664\u5757 ${id}`, ops), data: ops };
    }
  },
  {
    name: "block_move",
    title: "\u79FB\u52A8\u5757\uFF08\u7834\u574F\u578B\uFF09",
    description: "\u628A\u5757\u79FB\u52A8\u5230\u53E6\u4E00\u4E2A\u7236\u5757\u4E0B\u6216\u67D0\u4E2A\u5757\u4E4B\u540E\u3002\u7834\u574F\u578B\uFF1A\u5FC5\u987B confirm: true\u3002",
    risk: "destructive",
    params: {
      id: { type: "string", required: true, description: ID_DESC },
      confirm: { type: "boolean", description: CONFIRM_DESC },
      parentID: { type: "string", description: "\u76EE\u6807\u7236\u5757 ID" },
      previousID: { type: "string", description: "\u76EE\u6807\u524D\u4E00\u4F4D\u7F6E\u5757 ID" },
      dryRun: { type: "boolean", description: DRYRUN_DESC }
    },
    invoke: async (client, args) => {
      const spec = findToolSpecOrThrow("block_move");
      const id = String(args.id);
      const parentID = optionalString(args.parentID);
      const previousID = optionalString(args.previousID);
      requireConfirm(spec, args, "\u79FB\u52A8\u5757\u4F1A\u6539\u53D8\u6587\u6863\u7ED3\u6784\uFF08\u53EF\u7528\u5185\u6838 undoOperations \u56DE\u9000\uFF09", true);
      requireAnchor(spec, parentID, previousID, void 0);
      if (shouldDryRun(args)) {
        return { text: previewText(spec, "\u5C06\u79FB\u52A8\u8BE5\u5757", `id=${id}`), data: { dryRun: true } };
      }
      const ops = await client.moveBlock(id, { parentID, previousID });
      return { text: renderOps(`\u5DF2\u79FB\u52A8\u5757 ${id}`, ops), data: ops };
    }
  },
  {
    name: "doc_rename",
    title: "\u91CD\u547D\u540D\u6587\u6863\uFF08\u7834\u574F\u578B\uFF09",
    description: "\u4FEE\u6539\u6587\u6863\u6807\u9898\u3002\u7834\u574F\u578B\uFF1A\u5FC5\u987B confirm: true\uFF1B\u4E0D\u4F20\u5219\u53EA\u8FD4\u56DE\u9884\u89C8\u3002",
    risk: "destructive",
    params: {
      id: { type: "string", required: true, description: ID_DESC },
      title: { type: "string", required: true, description: "\u65B0\u7684\u6587\u6863\u6807\u9898" },
      confirm: { type: "boolean", description: CONFIRM_DESC },
      dryRun: { type: "boolean", description: DRYRUN_DESC }
    },
    invoke: async (client, args) => {
      const spec = findToolSpecOrThrow("doc_rename");
      const id = String(args.id);
      const title = requireName(spec, args, "title");
      const { preview, exists } = await buildDocPreview(client, id);
      requireConfirm(spec, args, preview, exists);
      if (shouldDryRun(args)) {
        return { text: previewText(spec, `\u5C06\u91CD\u547D\u540D\u4E3A\u300C${title}\u300D`, preview), data: { dryRun: true, exists } };
      }
      await client.renameDocByID(id, title);
      return { text: `\u5DF2\u91CD\u547D\u540D\u6587\u6863 ${id} \u4E3A\u300C${title}\u300D
\u539F\u6709\u4F4D\u7F6E\uFF1A
${preview}`, data: { id, title } };
    }
  },
  {
    name: "doc_move",
    title: "\u79FB\u52A8\u6587\u6863\uFF08\u7834\u574F\u578B\uFF09",
    description: "\u628A\u4E00\u4E2A\u6216\u591A\u4E2A\u6587\u6863\u79FB\u52A8\u5230\u76EE\u6807\u7236\u6587\u6863/\u7B14\u8BB0\u672C\u4E0B\u3002\u7834\u574F\u578B\uFF1A\u5FC5\u987B confirm: true\u3002",
    risk: "destructive",
    params: {
      fromIDs: { type: "string", required: true, description: "\u6E90\u6587\u6863 ID\uFF0C\u591A\u4E2A\u7528\u9017\u53F7\u5206\u9694" },
      toID: { type: "string", required: true, description: "\u76EE\u6807\u7236\u6587\u6863 ID \u6216\u7B14\u8BB0\u672C ID" },
      confirm: { type: "boolean", description: CONFIRM_DESC },
      dryRun: { type: "boolean", description: DRYRUN_DESC }
    },
    invoke: async (client, args) => {
      const spec = findToolSpecOrThrow("doc_move");
      const fromIDs = parseIdList(args.fromIDs);
      const toID = requireName(spec, args, "toID");
      const { preview } = await buildDocPreview(client, fromIDs[0]);
      requireConfirm(spec, args, `\u5C06\u79FB\u52A8 ${fromIDs.length} \u4E2A\u6587\u6863\u5230 ${toID}
${preview}`, true);
      if (shouldDryRun(args)) {
        return {
          text: previewText(spec, `\u5C06\u79FB\u52A8 ${fromIDs.join(", ")} \u5230 ${toID}`, preview),
          data: { dryRun: true, fromIDs, toID }
        };
      }
      await client.moveDocsByID(fromIDs, toID);
      return { text: `\u5DF2\u79FB\u52A8 ${fromIDs.length} \u4E2A\u6587\u6863\u5230 ${toID}\uFF1A${fromIDs.join(", ")}`, data: { fromIDs, toID } };
    }
  },
  {
    name: "doc_remove",
    title: "\u5220\u9664\u6587\u6863\uFF08\u7834\u574F\u578B\uFF09",
    description: "\u5220\u9664\u6587\u6863\u3002\u7834\u574F\u578B\uFF1A\u5FC5\u987B confirm: true\u3002\u5185\u6838\u4F1A\u5148\u628A\u6587\u6863\u5199\u5165\u6570\u636E\u5386\u53F2\uFF08\u6570\u636E\u5386\u53F2 \u4E2D\u53EF\u56DE\u6EDA\uFF0C\u53D7\u5386\u53F2\u4FDD\u7559\u8BBE\u7F6E\u9650\u5236\uFF09\u3002",
    risk: "destructive",
    params: {
      id: { type: "string", required: true, description: ID_DESC },
      confirm: { type: "boolean", description: CONFIRM_DESC },
      dryRun: { type: "boolean", description: DRYRUN_DESC }
    },
    invoke: async (client, args) => {
      const spec = findToolSpecOrThrow("doc_remove");
      const id = String(args.id);
      const { preview, exists } = await buildDocPreview(client, id);
      requireConfirm(spec, args, preview, exists);
      if (shouldDryRun(args)) {
        return { text: previewText(spec, "\u5C06\u5220\u9664\u8BE5\u6587\u6863", preview), data: { dryRun: true, exists } };
      }
      await client.removeDocByID(id);
      return {
        text: `\u5DF2\u5220\u9664\u6587\u6863 ${id}
\u5220\u9664\u524D\u4F4D\u7F6E\uFF1A
${preview}

\u63D0\u793A\uFF1A\u5185\u6838\u5DF2\u628A\u8BE5\u6587\u6863\u5199\u5165\u6570\u636E\u5386\u53F2\uFF0C\u53EF\u5728\u601D\u6E90\u300C\u6570\u636E\u5386\u53F2\u300D\u4E2D\u56DE\u6EDA\uFF08\u53D7\u5386\u53F2\u4FDD\u7559\u8BBE\u7F6E\u9650\u5236\uFF09\u3002`,
        data: { id }
      };
    }
  },
  {
    name: "doc_rename_by_path",
    title: "\u6309\u8DEF\u5F84\u91CD\u547D\u540D\u6587\u6863\uFF08\u7834\u574F\u578B\uFF09",
    description: "\u6309\u300C\u7B14\u8BB0\u672C + \u6587\u6863\u8DEF\u5F84\u300D\u91CD\u547D\u540D\u6587\u6863\u6807\u9898\uFF08\u5BF9\u9F50\u53C2\u8003\u5B9E\u73B0\uFF09\u3002\u7834\u574F\u578B\uFF1A\u5FC5\u987B confirm: true\uFF1B\u4E0D\u4F20\u5219\u53EA\u8FD4\u56DE\u9884\u89C8\u3002",
    risk: "destructive",
    params: {
      notebook: { type: "string", required: true, description: NB_DESC },
      path: { type: "string", required: true, description: "\u6587\u6863\u8DEF\u5F84\uFF08\u76F8\u5BF9\u7B14\u8BB0\u672C\uFF0C\u5982 /a.sy\uFF09" },
      title: { type: "string", required: true, description: "\u65B0\u7684\u6587\u6863\u6807\u9898" },
      confirm: { type: "boolean", description: CONFIRM_DESC },
      dryRun: { type: "boolean", description: DRYRUN_DESC }
    },
    invoke: async (client, args) => {
      const spec = findToolSpecOrThrow("doc_rename_by_path");
      const notebook = String(args.notebook);
      const path = requireName(spec, args, "path");
      const title = requireName(spec, args, "title");
      const { ids } = await resolveIdByPath(client, notebook, path);
      const preview = `\u7B14\u8BB0\u672C\uFF1A${notebook}
\u6587\u6863\u8DEF\u5F84\uFF1A${path}${ids.length > 0 ? `
\u89E3\u6790\u5230\u6587\u6863 ID\uFF1A${ids.join(", ")}` : "\n\uFF08\u672A\u80FD\u6309\u6B64\u8DEF\u5F84\u89E3\u6790\u5230\u6587\u6863\uFF09"}
\u65B0\u6807\u9898\uFF1A${title}`;
      requireConfirm(spec, args, preview, ids.length > 0);
      if (shouldDryRun(args)) {
        return { text: previewText(spec, `\u5C06\u91CD\u547D\u540D\u4E3A\u300C${title}\u300D`, preview), data: { dryRun: true } };
      }
      await client.renameDoc(notebook, path, title);
      return { text: `\u5DF2\u91CD\u547D\u540D ${path} \u4E3A\u300C${title}\u300D
${preview}`, data: { notebook, path, title } };
    }
  },
  {
    name: "doc_remove_by_path",
    title: "\u6309\u8DEF\u5F84\u5220\u9664\u6587\u6863\uFF08\u7834\u574F\u578B\uFF09",
    description: "\u6309\u300C\u7B14\u8BB0\u672C + \u6587\u6863\u8DEF\u5F84\u300D\u5220\u9664\u6587\u6863\uFF08\u5BF9\u9F50\u53C2\u8003\u5B9E\u73B0\uFF09\u3002\u5185\u6838\u4F1A\u5148\u628A\u6587\u4EF6\u5199\u5165\u6570\u636E\u5386\u53F2\u3002\u7834\u574F\u578B\uFF1A\u5FC5\u987B confirm: true\u3002",
    risk: "destructive",
    params: {
      notebook: { type: "string", required: true, description: NB_DESC },
      path: { type: "string", required: true, description: "\u6587\u6863\u8DEF\u5F84\uFF08\u76F8\u5BF9\u7B14\u8BB0\u672C\uFF0C\u5982 /a.sy\uFF09" },
      confirm: { type: "boolean", description: CONFIRM_DESC },
      dryRun: { type: "boolean", description: DRYRUN_DESC }
    },
    invoke: async (client, args) => {
      const spec = findToolSpecOrThrow("doc_remove_by_path");
      const notebook = String(args.notebook);
      const path = requireName(spec, args, "path");
      const { ids } = await resolveIdByPath(client, notebook, path);
      const preview = `\u7B14\u8BB0\u672C\uFF1A${notebook}
\u6587\u6863\u8DEF\u5F84\uFF1A${path}${ids.length > 0 ? `
\u89E3\u6790\u5230\u6587\u6863 ID\uFF1A${ids.join(", ")}` : "\n\uFF08\u672A\u80FD\u6309\u6B64\u8DEF\u5F84\u89E3\u6790\u5230\u6587\u6863\uFF09"}`;
      requireConfirm(spec, args, preview, ids.length > 0);
      if (shouldDryRun(args)) {
        return { text: previewText(spec, "\u5C06\u5220\u9664\u8BE5\u6587\u6863", preview), data: { dryRun: true } };
      }
      await client.removeDoc(notebook, path);
      return {
        text: `\u5DF2\u5220\u9664\u6587\u6863 ${path}
${preview}

\u63D0\u793A\uFF1A\u5185\u6838\u5DF2\u628A\u8BE5\u6587\u6863\u5199\u5165\u6570\u636E\u5386\u53F2\uFF0C\u53EF\u5728\u601D\u6E90\u300C\u6570\u636E\u5386\u53F2\u300D\u4E2D\u56DE\u6EDA\u3002`,
        data: { notebook, path }
      };
    }
  },
  {
    name: "doc_move_by_path",
    title: "\u6309\u8DEF\u5F84\u79FB\u52A8\u6587\u6863\uFF08\u7834\u574F\u578B\uFF09",
    description: "\u6309\u8DEF\u5F84\u628A\u4E00\u4E2A\u6216\u591A\u4E2A\u6587\u6863\u79FB\u52A8\u5230\u76EE\u6807\u7B14\u8BB0\u672C/\u8DEF\u5F84\uFF08\u5BF9\u9F50\u53C2\u8003\u5B9E\u73B0\uFF09\u3002\u7834\u574F\u578B\uFF1A\u5FC5\u987B confirm: true\u3002",
    risk: "destructive",
    params: {
      fromPaths: { type: "string", required: true, description: "\u6E90\u6587\u6863\u8DEF\u5F84\u5217\u8868\uFF1AJSON \u6570\u7EC4\u6216\u9017\u53F7\u5206\u9694" },
      toNotebook: { type: "string", required: true, description: "\u76EE\u6807\u7B14\u8BB0\u672C ID" },
      toPath: { type: "string", required: true, description: "\u76EE\u6807\u76EE\u5F55\uFF08**\u5FC5\u987B\u5DF2\u5B58\u5728**\uFF1B\u6839\u76EE\u5F55\u7528 /\uFF09" },
      confirm: { type: "boolean", description: CONFIRM_DESC },
      dryRun: { type: "boolean", description: DRYRUN_DESC }
    },
    invoke: async (client, args) => {
      const spec = findToolSpecOrThrow("doc_move_by_path");
      const fromPaths = parseListParam(args.fromPaths, "fromPaths");
      if (fromPaths.length === 0) {
        throw new SiYuanError("SIYUAN_API_ERROR", "fromPaths \u4E0D\u80FD\u4E3A\u7A7A", { hint: "\u7ED9\u51FA\u81F3\u5C11\u4E00\u4E2A\u6E90\u6587\u6863\u8DEF\u5F84\u3002" });
      }
      const toNotebook = requireName(spec, args, "toNotebook");
      const toPath = requireName(spec, args, "toPath");
      try {
        await client.listDocsByPath(toNotebook, toPath);
      } catch {
        throw new SiYuanError(
          "SIYUAN_NOT_FOUND",
          `\u76EE\u6807\u76EE\u5F55\u4E0D\u5B58\u5728\uFF1A${toNotebook} \u7684 ${toPath}`,
          { hint: "\u76EE\u6807\u76EE\u5F55\u5FC5\u987B\u5DF2\u5B58\u5728\uFF08\u6839\u76EE\u5F55\u7528 /\uFF09\uFF1B\u82E5\u8981\u7528\u65B0\u5C42\u7EA7\uFF0C\u5148\u7528 doc_create \u5EFA\u597D\u8BE5\u5C42\u7EA7\u7684\u6587\u6863\u3002" }
        );
      }
      const preview = `\u5C06\u79FB\u52A8 ${fromPaths.length} \u4E2A\u6587\u6863\uFF1A
${fromPaths.join("\n")}
\u76EE\u6807\u7B14\u8BB0\u672C\uFF1A${toNotebook}
\u76EE\u6807\u8DEF\u5F84\uFF1A${toPath}`;
      requireConfirm(spec, args, preview, true);
      if (shouldDryRun(args)) {
        return { text: previewText(spec, "\u5C06\u79FB\u52A8\u8FD9\u4E9B\u6587\u6863", preview), data: { dryRun: true, fromPaths } };
      }
      await client.moveDocs(fromPaths, toNotebook, toPath);
      return { text: `\u5DF2\u79FB\u52A8 ${fromPaths.length} \u4E2A\u6587\u6863\u5230 ${toNotebook}${toPath}`, data: { fromPaths, toNotebook, toPath } };
    }
  },
  {
    name: "notebook_rename",
    title: "\u91CD\u547D\u540D\u7B14\u8BB0\u672C\uFF08\u7834\u574F\u578B\uFF09",
    description: "\u8986\u76D6\u7B14\u8BB0\u672C\u540D\u79F0\u3002\u7834\u574F\u578B\uFF1A\u5FC5\u987B confirm: true\uFF1B\u9884\u89C8\u4F1A\u7ED9\u51FA\u5F53\u524D\u540D\u79F0\u3002",
    risk: "destructive",
    params: {
      notebook: { type: "string", required: true, description: NB_DESC },
      name: { type: "string", required: true, description: "\u65B0\u7684\u7B14\u8BB0\u672C\u540D\u79F0" },
      confirm: { type: "boolean", description: CONFIRM_DESC },
      dryRun: { type: "boolean", description: DRYRUN_DESC }
    },
    invoke: async (client, args) => {
      const spec = findToolSpecOrThrow("notebook_rename");
      const notebook = String(args.notebook);
      const name = requireName(spec, args, "name");
      const info = await buildNotebookPreview(client, notebook);
      requireConfirm(spec, args, info.preview, info.exists);
      if (shouldDryRun(args)) {
        return { text: previewText(spec, `\u5C06\u6539\u540D\u4E3A\u300C${name}\u300D`, info.preview), data: { dryRun: true, exists: info.exists } };
      }
      await client.renameNotebook(notebook, name);
      return { text: `\u5DF2\u628A\u7B14\u8BB0\u672C\u6539\u540D\u4E3A\u300C${name}\u300D\uFF08\u539F\u540D\u79F0\uFF1A${info.name}\uFF09`, data: { notebook, name, previousName: info.name } };
    }
  },
  {
    name: "notebook_icon_set",
    title: "\u8BBE\u7F6E\u7B14\u8BB0\u672C\u56FE\u6807\uFF08\u7834\u574F\u578B\uFF09",
    description: "\u8986\u76D6\u7B14\u8BB0\u672C\u56FE\u6807\uFF08Unicode \u8868\u60C5\u7801\u70B9\u6216\u56FE\u6807\u8D44\u6E90\u540D\uFF09\u3002\u7834\u574F\u578B\uFF1A\u5FC5\u987B confirm: true\uFF1B\u9884\u89C8\u4F1A\u7ED9\u51FA\u5F53\u524D\u56FE\u6807\u3002",
    risk: "destructive",
    params: {
      notebook: { type: "string", required: true, description: NB_DESC },
      icon: { type: "string", required: true, description: "\u65B0\u56FE\u6807\uFF08\u5982 1f4d6 \u8FD9\u6837\u7684\u8868\u60C5\u7801\u70B9\uFF0C\u6216\u56FE\u6807\u8D44\u6E90\u540D\uFF09" },
      confirm: { type: "boolean", description: CONFIRM_DESC },
      dryRun: { type: "boolean", description: DRYRUN_DESC }
    },
    invoke: async (client, args) => {
      const spec = findToolSpecOrThrow("notebook_icon_set");
      const notebook = String(args.notebook);
      const icon = requireName(spec, args, "icon");
      const info = await buildNotebookPreview(client, notebook);
      requireConfirm(spec, args, info.preview, info.exists);
      if (shouldDryRun(args)) {
        return { text: previewText(spec, `\u5C06\u56FE\u6807\u6539\u4E3A\u300C${icon}\u300D`, info.preview), data: { dryRun: true, exists: info.exists } };
      }
      await client.setNotebookIcon(notebook, icon);
      return {
        text: `\u5DF2\u8BBE\u7F6E\u7B14\u8BB0\u672C\u56FE\u6807\u4E3A\u300C${icon}\u300D\uFF08\u539F\u56FE\u6807\uFF1A${info.icon || "\u672A\u8BBE\u7F6E"}\uFF09`,
        data: { notebook, icon, previousIcon: info.icon }
      };
    }
  },
  {
    name: "notebook_conf_set",
    title: "\u8BBE\u7F6E\u7B14\u8BB0\u672C\u914D\u7F6E\uFF08\u7834\u574F\u578B\uFF09",
    description: "\u8986\u76D6\u7B14\u8BB0\u672C\u914D\u7F6E\uFF08\u5982 dailyNoteSavePath\u3001refCreateSavePath\u3001docCreateSavePath \u7B49\uFF09\u3002\u7834\u574F\u578B\uFF1A\u5FC5\u987B confirm: true\uFF1B\u9884\u89C8\u4F1A\u7ED9\u51FA\u5F53\u524D\u914D\u7F6E\u8981\u70B9\u3002\u5EFA\u8BAE\u5148\u7528 notebook_conf_get \u8BFB\u53D6\u73B0\u6709\u914D\u7F6E\u518D\u90E8\u5206\u4FEE\u6539\u3002",
    risk: "destructive",
    params: {
      notebook: { type: "string", required: true, description: NB_DESC },
      conf: {
        type: "string",
        required: true,
        description: '\u8981\u5199\u5165\u7684\u914D\u7F6E JSON \u5BF9\u8C61\u5B57\u7B26\u4E32\uFF0C\u5982 {"dailyNoteSavePath":"/daily note/{{now | date \\"2006-01-02\\"}}"}'
      },
      confirm: { type: "boolean", description: CONFIRM_DESC },
      dryRun: { type: "boolean", description: DRYRUN_DESC }
    },
    invoke: async (client, args) => {
      const spec = findToolSpecOrThrow("notebook_conf_set");
      const notebook = String(args.notebook);
      const conf = parseJsonObject(args.conf, "conf");
      const info = await buildNotebookPreview(client, notebook);
      const preview = `${info.preview}

\u5C06\u5199\u5165\u7684\u914D\u7F6E\uFF1A
${Object.entries(conf).map(([key, value]) => `- ${key}: ${String(value)}`).join("\n")}`;
      requireConfirm(spec, args, preview, info.exists);
      if (shouldDryRun(args)) {
        return { text: previewText(spec, "\u5C06\u8986\u76D6\u7B14\u8BB0\u672C\u914D\u7F6E", preview), data: { dryRun: true, exists: info.exists } };
      }
      const saved = await client.setNotebookConf(notebook, conf);
      return { text: `\u5DF2\u66F4\u65B0\u7B14\u8BB0\u672C\u914D\u7F6E\uFF08${Object.keys(conf).join(", ")}\uFF09
${preview}`, data: { notebook, conf, saved } };
    }
  },
  {
    name: "notebook_remove",
    title: "\u5220\u9664\u7B14\u8BB0\u672C\uFF08\u6700\u9AD8\u98CE\u9669\uFF09",
    description: "\u5220\u9664\u6574\u4E2A\u7B14\u8BB0\u672C\uFF08\u542B\u5176\u5168\u90E8\u6587\u6863\uFF09\u3002\u9664 confirm: true \u5916\uFF0C**\u8FD8\u5FC5\u987B\u4F20 confirmName**\uFF0C\u4E14\u5176\u503C\u5FC5\u987B\u4E0E\u7B14\u8BB0\u672C\u5F53\u524D\u540D\u79F0\u9010\u5B57\u4E00\u81F4\u3002\u9884\u89C8\u4F1A\u7ED9\u51FA\u540D\u79F0\u4E0E\u6587\u6863\u6570\uFF1B\u4E0D\u4E00\u81F4\u65F6\u62A5 SIYUAN_CONFIRM_MISMATCH\u3002\u4E0D\u4F20 confirm \u65F6\u53EA\u8FD4\u56DE\u9884\u89C8\u3002",
    risk: "destructive",
    params: {
      notebook: { type: "string", required: true, description: NB_DESC },
      confirmName: { type: "string", required: true, description: "\u4E8C\u6B21\u786E\u8BA4\uFF1A\u5FC5\u987B\u9010\u5B57\u586B\u5199\u7B14\u8BB0\u672C\u5F53\u524D\u540D\u79F0" },
      confirm: { type: "boolean", description: CONFIRM_DESC },
      dryRun: { type: "boolean", description: DRYRUN_DESC }
    },
    invoke: async (client, args) => {
      const spec = findToolSpecOrThrow("notebook_remove");
      const notebook = String(args.notebook);
      const info = await buildNotebookPreview(client, notebook);
      requireConfirm(spec, args, info.preview, info.exists);
      if (shouldDryRun(args)) {
        return {
          text: previewText(spec, `\u5C06\u5220\u9664\u6574\u4E2A\u7B14\u8BB0\u672C\uFF08\u542B ${info.docCount} \u7BC7\u6587\u6863\uFF09`, info.preview),
          data: { dryRun: true, docCount: info.docCount }
        };
      }
      requireConfirmName(args, info.name, "\u5220\u9664\u7B14\u8BB0\u672C");
      await client.removeNotebook(notebook);
      return {
        text: `\u5DF2\u5220\u9664\u7B14\u8BB0\u672C\u300C${info.name}\u300D\uFF08\u542B ${info.docCount} \u7BC7\u6587\u6863\uFF09
${info.preview}`,
        data: { notebook, name: info.name, docCount: info.docCount }
      };
    }
  },
  {
    name: "find_replace",
    title: "\u6279\u91CF\u66FF\u6362\u5185\u5BB9\uFF08\u7834\u574F\u578B\uFF09",
    description: '\u5728**\u6307\u5B9A\u5757**\u5185\u628A\u6587\u672C k \u66FF\u6362\u4E3A r\uFF08\u5BF9\u9F50\u53C2\u8003\u5B9E\u73B0\uFF09\u3002\u4E3A\u907F\u514D\u5168\u5E93\u8BEF\u66FF\u6362\uFF0Cids \u5FC5\u987B\u975E\u7A7A\u3001\u4E14 k \u4E0E r \u90FD\u4E0D\u80FD\u4E3A\u7A7A\u5B57\u7B26\u4E32\u3002\u5185\u6838\u7684\u66FF\u6362\u662F\u6309\u7C7B\u578B\u9010\u9879\u751F\u6548\u7684\uFF0C\u672C\u5DE5\u5177\u9ED8\u8BA4\u53EA\u66FF\u6362**\u666E\u901A\u6587\u672C**\uFF08text\uFF09\uFF1B\u9700\u8981\u8FDE\u4EE3\u7801\u5757\u3001\u6807\u9898\u7B49\u4E00\u8D77\u66FF\u6362\u65F6\u4F20 replaceTypes "{\\"all\\":true}" \u6216\u6307\u5B9A\u7C7B\u578B\u96C6\u5408\u3002\u7834\u574F\u578B\uFF1A\u5FC5\u987B confirm: true\uFF1B\u4E0D\u4F20\u5219\u53EA\u8FD4\u56DE\u9884\u89C8\u3002',
    risk: "destructive",
    params: {
      k: { type: "string", required: true, description: "\u8981\u67E5\u627E\u7684\u6587\u672C" },
      r: { type: "string", required: true, description: "\u66FF\u6362\u4E3A\u7684\u6587\u672C\uFF08\u4E0D\u652F\u6301\u7A7A\u4E32/\u5220\u9664\u5F0F\u66FF\u6362\uFF09" },
      ids: {
        type: "string",
        required: true,
        description: "\u76EE\u6807\u5757 ID \u5217\u8868\uFF1AJSON \u6570\u7EC4\u6216\u9017\u53F7\u5206\u9694\uFF1B**\u4E0D\u5141\u8BB8\u4E3A\u7A7A**\uFF08\u7981\u6B62\u5168\u5E93\u66FF\u6362\uFF09"
      },
      replaceTypes: {
        type: "string",
        description: '\u53EF\u9009\u3002\u9ED8\u8BA4 {"text":true}\uFF08\u53EA\u66FF\u6362\u666E\u901A\u6587\u672C\uFF09\uFF1B\u4F20 {"all":true} \u66FF\u6362\u5168\u90E8 25 \u79CD\u7C7B\u578B\uFF0C\u6216\u81EA\u5B9A\u4E49\u5982 {"text":true,"code":true}'
      },
      confirm: { type: "boolean", description: CONFIRM_DESC },
      dryRun: { type: "boolean", description: DRYRUN_DESC }
    },
    invoke: async (client, args) => {
      const spec = findToolSpecOrThrow("find_replace");
      const k = requireName(spec, args, "k");
      const r = requireName(spec, args, "r");
      const ids = requireIdList(args, "ids");
      const replaceTypes = resolveReplaceTypes(args.replaceTypes);
      const preview = `\u5C06\u5728 ${ids.length} \u4E2A\u5757\u4E2D\u628A\u300C${k}\u300D\u66FF\u6362\u4E3A\u300C${r}\u300D
\u66FF\u6362\u7C7B\u578B\uFF1A${replaceTypes.label}
\u76EE\u6807\u5757\uFF1A${ids.slice(0, 10).join(", ")}${ids.length > 10 ? " \u2026" : ""}`;
      requireConfirm(spec, args, preview, true);
      if (shouldDryRun(args)) {
        return { text: previewText(spec, "\u5C06\u6267\u884C\u6279\u91CF\u66FF\u6362", preview), data: { dryRun: true, ids } };
      }
      await client.findReplace(k, r, ids, replaceTypes.types);
      return {
        text: `\u5DF2\u5728 ${ids.length} \u4E2A\u5757\u4E2D\u628A\u300C${k}\u300D\u66FF\u6362\u4E3A\u300C${r}\u300D\uFF08\u7C7B\u578B\uFF1A${replaceTypes.label}\uFF09
${preview}`,
        data: { k, r, ids, replaceTypes: replaceTypes.types }
      };
    }
  }
];
var TOOL_SPECS = [...readOnlyTools, ...additiveTools, ...destructiveTools];
function findToolSpecOrThrow(name) {
  const spec = TOOL_SPECS.find((item) => item.name === name);
  if (!spec) throw new SiYuanError("SIYUAN_API_ERROR", `\u5185\u90E8\u9519\u8BEF\uFF1A\u672A\u6CE8\u518C\u5DE5\u5177 ${name}`);
  return spec;
}
function optionalString(value) {
  const text = value === void 0 || value === null ? "" : String(value).trim();
  return text.length > 0 ? text : void 0;
}

// src/channels/cli/args.ts
var import_node_util = require("node:util");
var GLOBAL_OPTION_NAMES = /* @__PURE__ */ new Set(["json", "host", "port", "token", "config"]);
var GLOBAL_VALUE_OPTIONS = /* @__PURE__ */ new Set(["host", "port", "token", "config"]);
var PARAM_ALIASES = {
  parent: "parentid",
  previous: "previousid",
  next: "nextid"
};
function normalizeKey(key) {
  return key.toLowerCase().replace(/-/g, "");
}
function findSpec(segments) {
  const candidates = [segments.slice(0, 2).join("_"), segments[0] ?? ""];
  return TOOL_SPECS.find((spec) => candidates.includes(spec.name));
}
function collectOptions(argv) {
  const { tokens } = (0, import_node_util.parseArgs)({
    args: argv,
    options: {},
    strict: false,
    allowPositionals: true,
    tokens: true
  });
  const options = [];
  const positionals = [];
  const nextIsValue = (index) => tokens[index + 1]?.kind === "positional";
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
    if (token.inlineValue !== void 0) {
      options.push({ name, value: String(token.inlineValue) });
      continue;
    }
    const isKnownGlobal = GLOBAL_OPTION_NAMES.has(key);
    const commandResolved = positionals.length > 0;
    const shouldTakeValue = isKnownGlobal ? GLOBAL_VALUE_OPTIONS.has(key) && nextIsValue(i) : commandResolved && nextIsValue(i);
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
function coerceBooleanish(raw) {
  if (raw === void 0) return true;
  const normalized = raw.trim().toLowerCase();
  if (normalized === "false" || normalized === "0" || normalized === "no") return false;
  return true;
}
function parseCliArgs(argv) {
  const { options, positionals } = collectOptions(argv);
  const global = { json: false };
  const byNormalizedName = /* @__PURE__ */ new Map();
  for (const option of options) {
    const key = normalizeKey(option.name);
    if (GLOBAL_OPTION_NAMES.has(key)) {
      if (key === "json") global.json = coerceBooleanish(option.value);
      if (key === "host") global.host = option.value;
      if (key === "token") global.token = option.value;
      if (key === "config") global.configPath = option.value;
      if (key === "port" && option.value !== void 0) {
        const port = Number.parseInt(option.value, 10);
        if (Number.isFinite(port)) global.port = port;
      }
      continue;
    }
    byNormalizedName.set(PARAM_ALIASES[key] ?? key, option.value);
  }
  const spec = findSpec(positionals);
  if (!spec) return { tool: "", args: {}, global };
  const args = {};
  const remaining = [...positionals.slice(toCliPath(spec.name).length)];
  for (const [name, param] of Object.entries(spec.params)) {
    const provided = byNormalizedName.get(normalizeKey(name));
    if (param.type === "boolean") {
      if (provided !== void 0 || byNormalizedName.has(normalizeKey(name))) {
        args[name] = coerceBooleanish(provided);
      }
      continue;
    }
    if (provided !== void 0) {
      args[name] = provided;
      continue;
    }
    if (name === "stmt" && remaining.length > 0) {
      args[name] = remaining.shift();
      continue;
    }
    if (remaining.length > 0) args[name] = remaining.shift();
  }
  if (spec.name === "sql" && args.stmt === void 0) {
    const first = positionals[toCliPath(spec.name).length];
    if (first !== void 0) args.stmt = first;
  }
  return { tool: spec.name, args, global };
}
function splitReplArgs(line) {
  const tokens = [];
  let current = "";
  let quoted = false;
  let started = false;
  let quoteChar = null;
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
  return tokens;
}

// src/channels/cli/repl.ts
var import_node_readline = require("node:readline");

// src/channels/cli/stdin.ts
var import_node_fs2 = require("node:fs");
var STDIN_SENTINEL = "-";
function stdinParams(spec) {
  if (spec.name === "doc_create") return ["markdown"];
  if (spec.name === "block_insert" || spec.name === "block_update") return ["data"];
  return [];
}
var EXPLICIT_SENTINEL_ONLY = /* @__PURE__ */ new Set(["markdown"]);
function resolveStdinArgs(spec, args, readStdin) {
  const params = stdinParams(spec);
  if (params.length === 0) return args;
  const next = { ...args };
  for (const param of params) {
    const value = next[param];
    const omitted = value === void 0 || value === "";
    const wantsStdin = value === STDIN_SENTINEL || omitted && !EXPLICIT_SENTINEL_ONLY.has(param);
    if (wantsStdin) next[param] = readStdin();
  }
  return next;
}
function readStdinText() {
  try {
    return (0, import_node_fs2.readFileSync)(0, "utf-8");
  } catch {
    return "";
  }
}

// src/channels/cli/session.ts
var import_node_fs3 = require("node:fs");
var import_node_os2 = require("node:os");
var import_node_path = require("node:path");
var emptySession = {
  currentNotebookId: "",
  currentNotebookName: "",
  currentDocId: "",
  currentDocPath: "",
  history: []
};
var HISTORY_LIMIT = 200;
function defaultStateDir() {
  return (0, import_node_path.join)((0, import_node_os2.homedir)(), ".siyuan-agent");
}
var SessionManager = class {
  sessionPath;
  state = { ...emptySession, history: [] };
  dirty = false;
  constructor(stateDir) {
    this.sessionPath = (0, import_node_path.join)(stateDir ?? defaultStateDir(), "session.json");
  }
  load() {
    try {
      const parsed = JSON.parse((0, import_node_fs3.readFileSync)(this.sessionPath, "utf-8").replace(/^\uFEFF/, ""));
      const raw = parsed ?? {};
      const str = (value) => typeof value === "string" ? value : "";
      const history = Array.isArray(raw.history) ? raw.history.filter((item) => typeof item === "string") : [];
      this.state = {
        currentNotebookId: str(raw.currentNotebookId),
        currentNotebookName: str(raw.currentNotebookName),
        currentDocId: str(raw.currentDocId),
        currentDocPath: str(raw.currentDocPath),
        history: history.slice(-HISTORY_LIMIT)
      };
    } catch {
      this.state = { ...emptySession, history: [] };
    }
    this.dirty = false;
    return this.state;
  }
  update(patch) {
    if (patch.history !== void 0) {
      this.state.history = patch.history.slice(-HISTORY_LIMIT);
    }
    for (const key of ["currentNotebookId", "currentNotebookName", "currentDocId", "currentDocPath"]) {
      const value = patch[key];
      if (typeof value === "string") this.state[key] = value;
    }
    this.dirty = true;
  }
  /** 仅在有过 update 时写盘（避免无谓 IO）。 */
  flush() {
    if (!this.dirty) return;
    (0, import_node_fs3.mkdirSync)((0, import_node_path.dirname)(this.sessionPath), { recursive: true });
    (0, import_node_fs3.writeFileSync)(this.sessionPath, `${JSON.stringify(this.state, null, 2)}
`, "utf-8");
    this.dirty = false;
  }
};

// src/channels/cli/skin.ts
var CODES = {
  reset: "\x1B[0m",
  bold: "\x1B[1m",
  dim: "\x1B[2m",
  red: "\x1B[31m",
  green: "\x1B[32m",
  yellow: "\x1B[33m",
  blue: "\x1B[34m",
  magenta: "\x1B[35m",
  cyan: "\x1B[36m",
  gray: "\x1B[90m"
};
function detectColor(options) {
  if (typeof options?.color === "boolean") return options.color;
  if (process.env.NO_COLOR) return false;
  if (process.env.FORCE_COLOR) return true;
  return Boolean(options?.isTty ?? process.stdout.isTTY);
}
function makeSkin(options) {
  const color = detectColor(options);
  const paint = (name, text) => color ? `${CODES[name]}${text}${CODES.reset}` : text;
  const section = (title) => paint("bold", title);
  const statusBlock = (items, title) => {
    const lines = Object.entries(items).map(([key, value]) => `  ${paint("gray", `${key}:`.padEnd(16))}${value}`);
    return [title ? section(title) : "", ...lines].filter(Boolean).join("\n");
  };
  const table = (headers, rows) => {
    const widths = headers.map(
      (header, index) => Math.max(visibleLength(header), ...rows.map((row) => visibleLength(row[index] ?? "")))
    );
    const format = (cells) => cells.map((cell, index) => pad(cell, widths[index] ?? 0)).join("  ").trimEnd();
    if (rows.length === 0) return `${paint("gray", format(headers))}
${paint("gray", "\uFF08\u65E0\u6570\u636E\uFF09")}`;
    return [paint("gray", format(headers)), ...rows.map((row) => format(row))].join("\n");
  };
  const help = (commands) => {
    const width = Math.max(...Object.keys(commands).map((command) => command.length));
    const lines = Object.entries(commands).map(
      ([command, description]) => `  ${paint("cyan", command.padEnd(width))}  ${description}`
    );
    return [section("\u53EF\u7528\u547D\u4EE4\uFF1A"), ...lines, "", "\u63D0\u793A\uFF1A\u6240\u6709 CLI \u5B50\u547D\u4EE4\u5728 REPL \u5185\u4E5F\u53EF\u7528\uFF08\u652F\u6301 --json \u4E0E --confirm\uFF09\u3002"].join("\n");
  };
  return {
    color,
    paint,
    banner: (version, address) => [
      `${paint("magenta", "\u601D\u6E90\u7B14\u8BB0")} ${paint("bold", "siyuan-agent")} ${paint("gray", `v${version}`)} \xB7 \u5185\u6838 ${address}`,
      paint("gray", "\u8F93\u5165 help \u67E5\u770B\u547D\u4EE4\uFF0Cquit \u9000\u51FA\u3002\u5199\u64CD\u4F5C\u4ECD\u9700 confirm\u3002")
    ].join("\n"),
    prompt: (label) => `${paint("cyan", label)} ${paint("gray", ">")} `,
    success: (message) => `${paint("green", "\u2713")} ${message}`,
    error: (message) => `${paint("red", "\u2717")} ${message}`,
    warning: (message) => `${paint("yellow", "!")} ${message}`,
    info: (message) => `${paint("blue", "\xB7")} ${message}`,
    section,
    statusBlock,
    table,
    help,
    goodbye: () => paint("gray", "\u518D\u89C1\u3002")
  };
}
function visibleLength(text) {
  return text.replace(/\u001b\[[0-9;]*m/g, "").length;
}
function pad(text, width) {
  return text + " ".repeat(Math.max(0, width - visibleLength(text)));
}

// src/channels/cli/repl.ts
var REPL_COMMANDS = {
  "notebook list": "List all notebooks",
  "notebook create <name>": "Create a notebook",
  "notebook rename <id> <name>": "Rename a notebook",
  "notebook remove <id>": "Remove a notebook",
  "doc create <notebook> <path>": "Create a document with optional --md content",
  "doc list <notebook> <path>": "List documents at path",
  "doc tree <notebook> <\u6587\u6863\u8DEF\u5F84\u6216ID>": "\u4EE5\u67D0\u7BC7\u6587\u6863\u4E3A\u6839\u5217\u51FA\u5B50\u6811\uFF08\u5185\u6838\u4E0D\u63A5\u53D7\u6839\u8DEF\u5F84\uFF09",
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
  quit: "Exit REPL"
};
var QUIT_WORDS = /* @__PURE__ */ new Set(["quit", "exit", "q", ":q"]);
var HELP_WORDS = /* @__PURE__ */ new Set(["help", "?", "h"]);
function promptLabel(state) {
  return state.currentDocPath || state.currentNotebookName || "siyuan";
}
function applyReplAliases(argv) {
  const [first, second] = argv;
  if (first === "sql" && argv.length > 2) {
    return ["sql", argv.slice(1).join(" ")];
  }
  if (first === "search" && second !== void 0 && !["blocks", "docs", "tag"].includes(second)) {
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
    return ["block", "insert", argv[3], "--parentID", argv[2], ...argv.slice(4)];
  }
  const mdIndex = argv.indexOf("--md");
  if (mdIndex !== -1) {
    const next = [...argv];
    next.splice(mdIndex, 1, "--markdown");
    return next;
  }
  return argv;
}
async function runRepl(deps) {
  const input = deps?.input ?? process.stdin;
  const output = deps?.output ?? process.stdout;
  const interactive = Boolean(input.isTTY);
  const skin = makeSkin({ color: deps?.color, isTty: output.isTTY });
  const session = new SessionManager(deps?.stateDir);
  const state = session.load();
  const client = deps?.client ?? new SiYuanClient(resolveSiYuanConfig());
  const write = (text) => {
    output.write(`${text}
`);
  };
  const rl = (0, import_node_readline.createInterface)({ input, output, terminal: interactive });
  const queue = [];
  let draining = false;
  let closed = false;
  let inputClosed = false;
  let finished = false;
  let resolveDone = () => {
  };
  const done = new Promise((resolve) => {
    resolveDone = resolve;
  });
  const finishIfIdle = () => {
    if (finished) return;
    if (!inputClosed) return;
    if (draining || queue.length > 0) return;
    finished = true;
    session.flush();
    write(skin.goodbye());
    resolveDone(0);
  };
  const handle = async (rawLine) => {
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
      write(skin.error(`\u672A\u77E5\u547D\u4EE4\uFF1A${line}\uFF08\u8F93\u5165 help \u67E5\u770B\u53EF\u7528\u547D\u4EE4\uFF09`));
      session.flush();
      return;
    }
    if (stdinParams(spec).some((param) => parsed.args[param] === STDIN_SENTINEL)) {
      write(
        skin.error(
          'REPL \u5185\u4E0D\u652F\u6301 `-` \u4ECE stdin \u8BFB\u53D6\uFF08\u4F1A\u541E\u6389\u4F1A\u8BDD\u8F93\u5165\uFF09\uFF1A\u8BF7\u6539\u7528 --markdown "\u6587\u672C"\uFF0C\u6216\u7528\u7BA1\u9053\u8C03\u7528 CLI \u547D\u4EE4\u3002'
        )
      );
      session.flush();
      return;
    }
    const outcome = await dispatchTool(spec, parsed.args, client);
    if (!outcome.ok) {
      const { code, message, hint } = outcome.error;
      write(skin.error(`[${code}] ${message}${hint ? `
  ${hint}` : ""}`));
      session.flush();
      return;
    }
    write(
      parsed.global.json ? JSON.stringify(outcome.result.data ?? { text: outcome.result.text }) : outcome.result.text
    );
    const data = outcome.result.data ?? {};
    if (spec.name === "status") {
      write(
        skin.statusBlock({
          \u5F53\u524D\u7B14\u8BB0\u672C: state.currentNotebookName || "(\u672A\u9009\u62E9)",
          \u5F53\u524D\u6587\u6863: state.currentDocPath || "(\u672A\u9009\u62E9)"
        })
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
  const drain = async () => {
    if (draining) return;
    draining = true;
    while (queue.length > 0 && !closed) {
      const next = queue.shift();
      if (next === void 0) break;
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

// src/channels/cli/index.ts
function usage() {
  const lines = TOOL_SPECS.map((spec) => `siyuan-agent ${toCliPath(spec.name).join(" ")} \u2014 ${spec.title}`);
  return [
    "\u7528\u6CD5\uFF1Asiyuan-agent <\u547D\u4EE4> [\u53C2\u6570...] [--json] [--host] [--port] [--token] [--config]",
    "",
    "\u5168\u5C40\u9009\u9879\uFF1A",
    "  --json            \u4EE5 JSON \u8F93\u51FA\u7ED3\u679C\uFF08\u53D6 data \u5B57\u6BB5\uFF09",
    "  --host / --port   \u8986\u76D6\u5185\u6838\u5730\u5740\u4E0E\u7AEF\u53E3",
    "  --token           \u8986\u76D6 API Token",
    "  --config          \u6307\u5B9A\u914D\u7F6E\u6587\u4EF6\u8DEF\u5F84",
    "",
    "\u5176\u4ED6\uFF1A",
    "  repl              \u4EA4\u4E92\u5F0F REPL\uFF08\u7B49\u4EF7\u4E8E\u4E0D\u5E26\u53C2\u6570\u8FD0\u884C\uFF09",
    "",
    "\u547D\u4EE4\uFF1A",
    ...lines
  ].join("\n");
}
async function runCli(argv, deps) {
  const writeOut = deps?.stdout ?? ((text) => process.stdout.write(text));
  const writeErr = deps?.stderr ?? ((text) => process.stderr.write(text));
  if (argv.length === 0 || argv[0] === "repl") {
    if (!process.stdin.isTTY) {
      writeErr(`${usage()}
`);
      return 1;
    }
    return await runRepl({ client: deps?.client });
  }
  const parsed = parseCliArgs(argv);
  const spec = TOOL_SPECS.find((item) => item.name === parsed.tool);
  if (!spec) {
    writeErr(`\u672A\u77E5\u5B50\u547D\u4EE4\uFF1A${argv.join(" ")}

${usage()}
`);
    return 1;
  }
  const client = deps?.client ?? new SiYuanClient(
    resolveSiYuanConfig({
      host: parsed.global.host,
      port: parsed.global.port,
      token: parsed.global.token,
      configPath: parsed.global.configPath
    })
  );
  const args = resolveStdinArgs(spec, parsed.args, deps?.stdin ?? readStdinText);
  const outcome = await dispatchTool(spec, args, client);
  if (outcome.ok) {
    const text = parsed.global.json ? JSON.stringify(outcome.result.data ?? { text: outcome.result.text }) : outcome.result.text;
    writeOut(`${text}
`);
    return 0;
  }
  const { code, message, hint } = outcome.error;
  writeErr(`[${code}] ${message}${hint ? `
\u63D0\u793A\uFF1A${hint}` : ""}
`);
  return 1;
}
var entry = process.argv[1] ?? "";
if (entry.endsWith("cli.cjs") || entry.endsWith("cli/index.ts")) {
  void runCli(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  parseCliArgs,
  runCli,
  usage
});
