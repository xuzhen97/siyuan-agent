import type { SiYuanClient } from "../core/client.ts";
import { SiYuanError } from "../core/errors.ts";
import { renderSqlNotice, renderText, truncateText } from "../core/render.ts";
import type { BlockOpResult } from "../core/types.ts";
import { assertReadOnlySql } from "./guard.ts";
import type { ToolSpec } from "./types.ts";
import {
  buildBlockPreview,
  buildDocPreview,
  buildNotebookPreview,
  requireConfirm,
  requireConfirmName,
  requireFreshHash,
  requireIdList,
  shouldDryRun,
} from "./write-guard.ts";

export type { Risk, ToolParam, ToolResult, ToolSpec } from "./types.ts";

/**
 * doc_list 的文本投影：内核返回的条目带大量时间戳/统计字段（hMtime/hCtime/flashcardCount 等），
 * 全部渲染会撑爆上下文。文本只保留定位所需字段，全量仍在 `data` 里（Spec §5.1 上下文经济学）。
 */
function compactDocEntry(entry: unknown): Record<string, unknown> {
  const item = (entry ?? {}) as Record<string, unknown>;
  return { id: item.id, name: item.name, path: item.path, subFileCount: item.subFileCount };
}

const ID_DESC = "块或文档 ID，形如 20210817205410-2kvfpfn";
const NB_DESC = "笔记本 ID（由 notebook_list 获取）";

const readOnlyTools: readonly ToolSpec[] = [
  {
    name: "version",
    title: "内核版本",
    description: "获取思源内核版本号，用于确认连接可用性与内核大版本。",
    risk: "read",
    params: {},
    invoke: async (client) => {
      const version = await client.version();
      return { text: `思源内核版本：${version}`, data: { version } };
    },
  },
  {
    name: "status",
    title: "连接状态",
    description:
      "汇总连接状态、内核版本、内核时间与当前连接配置（host/port、是否带 Token），用于排查连不上或鉴权问题。",
    risk: "read",
    params: {},
    invoke: async (client) => {
      const connected = await client.ping();
      const version = connected ? await client.version() : "";
      const time = connected ? await client.currentTime() : 0;
      const { host, port, token, tokenSource } = client.config;
      const text = [
        `连接：${connected ? "正常" : "不可达"}`,
        `地址：http://${host}:${port}`,
        // 只报来源，绝不上显 Token 本身
        `Token：${token ? `已配置（来源：${tokenSource}）` : "未配置"}`,
        connected ? `内核版本：${version}` : "",
        connected ? `内核时间：${new Date(time).toISOString()}` : "",
      ]
        .filter(Boolean)
        .join("\n");
      return { text, data: { connected, host, port, hasToken: Boolean(token), tokenSource, version, time } };
    },
  },
  {
    name: "notebook_list",
    title: "列出笔记本",
    description: "列出所有笔记本及其 id、名称与是否已关闭（closed）。任何按笔记本操作的起点。",
    risk: "read",
    params: {},
    invoke: async (client) => {
      const notebooks = await client.listNotebooks();
      return { text: renderText(notebooks), data: notebooks };
    },
  },
  {
    name: "notebook_info",
    title: "笔记本信息",
    description: "获取指定笔记本的配置与统计信息。",
    risk: "read",
    params: { notebook: { type: "string", required: true, description: NB_DESC } },
    invoke: async (client, args) => {
      const info = await client.getNotebookInfo(String(args.notebook));
      return { text: renderText(info), data: info };
    },
  },
  {
    name: "notebook_conf_get",
    title: "笔记本配置",
    description:
      "读取笔记本配置：名称、图标、是否已关闭、引用/新建文档的保存路径、日记保存路径与模板路径等。" +
      "要写日记前可用它确认 dailyNoteSavePath。",
    risk: "read",
    params: { notebook: { type: "string", required: true, description: NB_DESC } },
    invoke: async (client, args) => {
      const { box, name, conf } = await client.getNotebookConf(String(args.notebook));
      // conf 字段很多，文本只展示定位与日记相关项；全量仍在 data.conf（Spec §5.1）
      const picked = {
        name: conf.name ?? name,
        icon: conf.icon,
        closed: conf.closed,
        refCreateSavePath: conf.refCreateSavePath,
        docCreateSavePath: conf.docCreateSavePath,
        dailyNoteSavePath: conf.dailyNoteSavePath,
        dailyNoteTemplatePath: conf.dailyNoteTemplatePath,
      };
      return { text: `${renderText(picked)}\n\n（全量配置见 data.conf）`, data: { box, name, conf } };
    },
  },
  {
    name: "doc_list",
    title: "列出文档",
    description: "列出指定笔记本路径下的直接子文档与子目录（不递归）。",
    risk: "read",
    params: {
      notebook: { type: "string", required: true, description: NB_DESC },
      path: { type: "string", description: "笔记本内路径，默认根路径", default: "/" },
    },
    invoke: async (client, args) => {
      const docs = await client.listDocsByPath(String(args.notebook), String(args.path));
      return { text: renderText(docs.map(compactDocEntry)), data: docs };
    },
  },
  {
    name: "doc_tree",
    title: "文档子树",
    description:
      "以指定文档为根递归列出其子文档树。内核不接受根路径：path 必须是文档路径（如 /20261009104613-x.sy）或文档 ID；" +
      "要枚举整个笔记本的文档请用 doc_list（逐层）或 sql。注意：返回的是子文档 **ID 列表**，需要路径时再用 doc_hpath_by_id 解析。" +
      "depth 控制最大深度（-1 表示不限）。",
    risk: "read",
    params: {
      notebook: { type: "string", required: true, description: NB_DESC },
      path: {
        type: "string",
        required: true,
        description: "文档路径（如 /20261009104613-x.sy）或文档 ID；不能是根路径",
      },
      depth: { type: "number", description: "最大深度，-1 为不限", default: -1 },
      sort: { type: "number", description: "排序模式，0 为默认", default: 0 },
    },
    invoke: async (client, args) => {
      const tree = await client.listDocTree(
        String(args.notebook),
        String(args.path),
        Number(args.depth),
        Number(args.sort),
      );
      return { text: renderText(tree), data: tree };
    },
  },
  {
    name: "doc_path_by_id",
    title: "文档存储路径",
    description: "由文档 ID 获取其所在笔记本与内核存储路径。",
    risk: "read",
    params: { id: { type: "string", required: true, description: ID_DESC } },
    invoke: async (client, args) => {
      const path = await client.getPathByID(String(args.id));
      return { text: `notebook: ${path.notebook}\npath: ${path.path}`, data: path };
    },
  },
  {
    name: "doc_hpath_by_id",
    title: "文档人类可读路径",
    description: "由文档 ID 获取人类可读路径（如 /笔记/甲）。",
    risk: "read",
    params: { id: { type: "string", required: true, description: ID_DESC } },
    invoke: async (client, args) => {
      const hPath = await client.getHPathByID(String(args.id));
      return { text: hPath, data: { hPath } };
    },
  },
  {
    name: "doc_ids_by_hpath",
    title: "按路径取文档 ID",
    description: "由笔记本内的人类可读路径获取对应文档 ID 列表。",
    risk: "read",
    params: {
      notebook: { type: "string", required: true, description: NB_DESC },
      path: { type: "string", required: true, description: "人类可读路径，如 /笔记/甲" },
    },
    invoke: async (client, args) => {
      const ids = await client.getIDsByHPath(String(args.notebook), String(args.path));
      return { text: renderText(ids), data: ids };
    },
  },
  {
    name: "doc_export_md",
    title: "导出文档 Markdown",
    description: "把文档导出为 Markdown 文本；maxChars 控制最大返回字符数，超出会被截断并提示。",
    risk: "read",
    params: {
      id: { type: "string", required: true, description: ID_DESC },
      maxChars: { type: "number", description: "最大字符数", default: 20000 },
    },
    invoke: async (client, args) => {
      const { hPath, content } = await client.exportMdContent(String(args.id));
      return {
        text: `${hPath}\n\n${truncateText(content ?? "", Number(args.maxChars))}`,
        data: { hPath, content },
      };
    },
  },
  {
    name: "block_get",
    title: "读取块 kramdown",
    description: "获取块的 kramdown 源文本；maxChars 控制最大返回字符数，是改写前的「先读」步骤。",
    risk: "read",
    params: {
      id: { type: "string", required: true, description: ID_DESC },
      maxChars: { type: "number", description: "最大字符数", default: 20000 },
    },
    invoke: async (client, args) => {
      const res = await client.getBlockKramdown(String(args.id));
      return { text: truncateText(res.kramdown ?? "", Number(args.maxChars)), data: res };
    },
  },
  {
    name: "block_children",
    title: "读取子块",
    description: "获取指定块的直接子块列表。",
    risk: "read",
    params: { id: { type: "string", required: true, description: ID_DESC } },
    invoke: async (client, args) => {
      const rows = await client.getChildBlocks(String(args.id));
      return { text: renderText(rows), data: rows };
    },
  },
  {
    name: "block_attrs_get",
    title: "读取块属性",
    description: "获取块的自定义属性键值对。",
    risk: "read",
    params: { id: { type: "string", required: true, description: ID_DESC } },
    invoke: async (client, args) => {
      const attrs = await client.getBlockAttrs(String(args.id));
      return { text: renderText(attrs), data: attrs };
    },
  },
  {
    name: "search_blocks",
    title: "全文检索块",
    description: "在块内容中做全文检索，返回命中的块及匹配统计。",
    risk: "read",
    params: { query: { type: "string", required: true, description: "检索关键词" } },
    invoke: async (client, args) => {
      const res = await client.fullTextSearchBlock(String(args.query));
      const blocks = res.blocks ?? [];
      return {
        text: `${renderText(blocks)}\n匹配块数：${res.matchedBlockCount ?? blocks.length}`,
        data: res,
      };
    },
  },
  {
    name: "search_docs",
    title: "检索文档名",
    description: "按关键词检索文档名称，返回命中的文档路径与 ID。",
    risk: "read",
    params: { k: { type: "string", required: true, description: "检索关键词" } },
    invoke: async (client, args) => {
      const hits = await client.searchDocs(String(args.k));
      return { text: renderText(hits), data: hits };
    },
  },
  {
    name: "search_tag",
    title: "检索标签",
    description: "按关键词检索标签名，k 为空时返回全部标签名。",
    risk: "read",
    params: { k: { type: "string", description: "标签关键词，可留空", default: "" } },
    invoke: async (client, args) => {
      const tags = await client.searchTag(String(args.k));
      return { text: renderText(tags), data: tags };
    },
  },
  {
    name: "tag_list",
    title: "列出全部标签",
    description: "列出知识库中的全部标签及引用计数（忽略内核的列表条数上限）。",
    risk: "read",
    params: {},
    invoke: async (client) => {
      const tags = await client.getTag();
      return { text: renderText(tags), data: tags };
    },
  },
  {
    name: "sql",
    title: "SQL 查询（只读）",
    description:
      "对内核 SQLite 索引执行只读 SQL 查询，是未覆盖场景的逃生通道。仅允许单条 SELECT 或 WITH 语句；" +
      "变更类语句（INSERT/UPDATE/DELETE/DROP/PRAGMA 等）会被拒绝。无 LIMIT 时内核默认只返回 64 行并标记截断。",
    risk: "read",
    params: {
      stmt: { type: "string", required: true, description: "只读 SQL 语句（单条 SELECT 或 WITH）" },
    },
    invoke: async (client, args) => {
      const stmt = String(args.stmt);
      assertReadOnlySql(stmt);
      const { rows, limit, truncated } = await client.querySql(stmt);
      const notice = renderSqlNotice(limit, truncated);
      return {
        text: [renderText(rows), notice].filter(Boolean).join("\n\n"),
        data: { rows, limit, truncated },
      };
    },
  },
];

const CONFIRM_DESC = "确认标志：必须显式传 true 才执行；不传或传 false 时只返回预览并拒绝（防误操作）";
const DRYRUN_DESC = "只预览影响、不写内核；仅传字面 true 生效";
const HASH_DESC = "可选乐观并发校验：传入目标的当前 blocks hash，不一致则拒绝覆盖";

function renderOps(title: string, ops: BlockOpResult): string {
  const lines = ops.doOperations.map((op) => `- ${op.action} id=${op.id ?? "-"}`);
  const undo = ops.undoOperations ? "\n内核已返回可撤销操作（undoOperations）" : "";
  return [title, ...lines, undo].filter(Boolean).join("\n");
}

function previewText(spec: ToolSpec, action: string, preview: string): string {
  return `预览（未执行）：${action}（${spec.name}）\n${preview}\n\n确认无误请带 confirm: true 重新调用。`;
}

function requireName(spec: ToolSpec, args: Record<string, unknown>, key: string): string {
  const value = String(args[key] ?? "").trim();
  if (value.length === 0) {
    throw new SiYuanError("SIYUAN_API_ERROR", `${spec.name} 需要非空参数 ${key}`, {
      hint: `请提供 ${key}`,
    });
  }
  return value;
}

function requireAnchor(spec: ToolSpec, parentID?: string, previousID?: string, nextID?: string): void {
  if (!parentID && !previousID && !nextID) {
    throw new SiYuanError("SIYUAN_API_ERROR", `${spec.name} 至少需要一个锚点（parentID 或 previousID）`,
      { hint: "用 block_get/block_children 找到目标块后，传入 parentID（挂到其下）或 previousID（插到其后）。" },
    );
  }
}

function parseAttrs(raw: unknown): Record<string, string> {
  let parsed: unknown = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new SiYuanError("SIYUAN_API_ERROR", "attrs 需要 JSON 对象字符串（例如 {\"custom-a\":\"1\"}）", {
        hint: "自定义属性键必须以 custom- 开头。",
      });
    }
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new SiYuanError("SIYUAN_API_ERROR", "attrs 需要 JSON 对象", { hint: "形如 {\"custom-a\":\"1\"}" });
  }

  const entries = Object.entries(parsed as Record<string, unknown>);
  for (const [key] of entries) {
    if (!key.startsWith("custom-")) {
      throw new SiYuanError("SIYUAN_API_ERROR", `属性名 ${key} 非法：内核要求自定义属性以 custom- 开头`, {
        hint: "例如 custom-status、custom-tag。",
      });
    }
  }
  return Object.fromEntries(entries.map(([key, value]) => [key, String(value)]));
}

function parseIdList(raw: unknown): string[] {
  const ids = String(raw ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  if (ids.length === 0) {
    throw new SiYuanError("SIYUAN_API_ERROR", "需要至少一个文档 ID", { hint: "多个 ID 用逗号分隔。" });
  }
  return ids;
}

/** 解析 JSON 对象参数（接受对象或 JSON 字符串）。用于 conf / replaceTypes。 */
function parseJsonObject(raw: unknown, label: string): Record<string, unknown> {
  let parsed: unknown = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new SiYuanError("SIYUAN_API_ERROR", `${label} 需要 JSON 对象字符串`, {
        hint: `例如 {"${label}Key":"value"}`,
      });
    }
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new SiYuanError("SIYUAN_API_ERROR", `${label} 需要 JSON 对象`);
  }
  return parsed as Record<string, unknown>;
}

/** 解析字符串列表参数（接受数组、JSON 数组字符串或逗号分隔字符串；允许为空由调用方判断）。 */
function parseListParam(raw: unknown, label: string): string[] {
  if (Array.isArray(raw)) return raw.map((value) => String(value).trim()).filter((value) => value.length > 0);

  const text = String(raw ?? "").trim();
  if (text.length === 0) return [];

  // 以 [ 开头就必须是合法 JSON 数组：否则旧行为会静默退化成逗号切分，产生垃圾值
  if (text.startsWith("[")) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new SiYuanError("SIYUAN_API_ERROR", `${label} 的 JSON 数组格式非法`, {
        hint: '例如 ["/a","/b"]；也可以直接用逗号分隔：/a,/b',
      });
    }
    if (!Array.isArray(parsed)) {
      throw new SiYuanError("SIYUAN_API_ERROR", `${label} 需要 JSON 数组或逗号分隔字符串`);
    }
    return parsed.map((value) => String(value).trim()).filter((value) => value.length > 0);
  }

  return text
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

/** 内核支持的替换类型全集（kernel/model/search.go::FindReplaceInBox）。 */
const ALL_REPLACE_TYPES = [
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
  "htmlBlock",
];

/**
 * 内核的替换是**按类型逐项 opt-in**（不传 replaceTypes 等于什么都不替换）。
 * 默认只替换普通文本（text）；传 {"all": true} 才展开为全部类型。
 */
function resolveReplaceTypes(raw: unknown): { types: Record<string, boolean>; label: string } {
  if (raw === undefined || raw === "") {
    return { types: { text: true }, label: "text（默认只替换普通文本）" };
  }
  const parsed = parseJsonObject(raw, "replaceTypes");
  if (parsed.all === true) {
    return {
      types: Object.fromEntries(ALL_REPLACE_TYPES.map((type) => [type, true])),
      label: `全部类型（${ALL_REPLACE_TYPES.length} 种）`,
    };
  }
  const keys = Object.keys(parsed);
  return { types: parsed as Record<string, boolean>, label: keys.length > 0 ? keys.join(", ") : "(空，将不会替换任何内容)" };
}

/**
 * 按「笔记本 + 路径」解析文档 ID，用于 by-path 工具的存在性校验与预览。
 *
 * 注意两种路径不是同一回事（实测）：
 *  - **hpath**：人类可读路径（如 `/我的数据`），供 getIDsByHPath 使用；
 *  - **存储路径**：形如 `/<docId>.sy`（文件名是文档 ID，不是标题），供 renameDoc/removeDoc/moveDocs 使用，
 *    也是 listDocsByPath 返回的 `path` 字段。
 * 所以先按 hpath 试，失败再用存储路径列父目录匹配——两条路都不猜。
 */
async function resolveIdByPath(
  client: SiYuanClient,
  notebook: string,
  path: string,
): Promise<{ ids: string[] }> {
  const asHPath = path.replace(/\.sy$/i, "");
  try {
    const byHPath = await client.getIDsByHPath(notebook, asHPath);
    if (byHPath.length > 0) return { ids: byHPath };
  } catch {
    // 落到存储路径分支
  }

  try {
    const normalized = path.startsWith("/") ? path : `/${path}`;
    const slash = normalized.lastIndexOf("/");
    const parent = slash <= 0 ? "/" : normalized.slice(0, slash);
    const entries = (await client.listDocsByPath(notebook, parent)) as Array<Record<string, unknown>>;
    const hit = entries.find((entry) => String(entry.path ?? "") === normalized);
    const id = hit ? String(hit.id ?? "") : "";
    return { ids: id.length > 0 ? [id] : [] };
  } catch {
    return { ids: [] };
  }
}

const additiveTools: readonly ToolSpec[] = [
  {
    name: "notebook_create",
    title: "创建笔记本",
    description: "创建一个新笔记本并返回其 ID。也是做写操作实验（沙盒）的起点。",
    risk: "additive",
    params: { name: { type: "string", required: true, description: "笔记本名称" } },
    invoke: async (client, args) => {
      const created = await client.createNotebook(requireName(findToolSpecOrThrow("notebook_create"), args, "name"));
      return { text: `已创建笔记本：${created.name}（id=${created.id}）`, data: created };
    },
  },
  {
    name: "doc_create",
    title: "创建文档",
    description:
      "在指定笔记本中按人读路径创建文档并写入 Markdown。同 path 重复调用不会覆盖已有文档（幂等）。",
    risk: "additive",
    params: {
      notebook: { type: "string", required: true, description: NB_DESC },
      path: { type: "string", required: true, description: "人读路径，需以 / 开头，如 /沙盒/甲" },
      markdown: { type: "string", description: "GFM Markdown 内容", default: "" },
    },
    invoke: async (client, args) => {
      const id = await client.createDocWithMd(
        String(args.notebook),
        String(args.path),
        String(args.markdown ?? ""),
      );
      return { text: `已创建文档：${id}\n路径：${String(args.path)}`, data: { id, notebook: args.notebook, path: args.path } };
    },
  },
  {
    name: "daily_note_create",
    title: "创建今日日记",
    description:
      "在指定笔记本中创建「今天」的日记文档并返回其 ID（按该笔记本的 dailyNoteSavePath 模板落盘）。" +
      "若今天的日记已存在，内核返回既有文档 ID 且不重复创建（天然幂等）。",
    risk: "additive",
    params: { notebook: { type: "string", required: true, description: NB_DESC } },
    invoke: async (client, args) => {
      const id = await client.createDailyNote(String(args.notebook));
      return {
        text:
          `日记文档：${id || "(内核未返回 ID)"}\n` +
          "提示：用 doc_hpath_by_id 解析其人类可读路径，或用 block_append（parentID 传该 ID）追加内容。",
        data: { id },
      };
    },
  },
  {
    name: "block_append",
    title: "追加块",
    description: "把内容追加到指定块（通常是文档 ID）的子块末尾。写入新内容的首选方式。",
    risk: "additive",
    params: {
      parentID: { type: "string", required: true, description: "父块 ID（文档 ID 也可）" },
      data: { type: "string", required: true, description: "要写入的内容" },
      dataType: { type: "string", description: "数据类型：markdown", default: "markdown" },
    },
    invoke: async (client, args) => {
      const ops = await client.appendBlock(String(args.parentID), String(args.data), String(args.dataType));
      return { text: renderOps(`已追加到 ${String(args.parentID)}`, ops), data: ops };
    },
  },
  {
    name: "block_prepend",
    title: "前置块",
    description: "把内容插入到指定块的子块开头。",
    risk: "additive",
    params: {
      parentID: { type: "string", required: true, description: "父块 ID（文档 ID 也可）" },
      data: { type: "string", required: true, description: "要写入的内容" },
      dataType: { type: "string", description: "数据类型：markdown", default: "markdown" },
    },
    invoke: async (client, args) => {
      const ops = await client.prependBlock(String(args.parentID), String(args.data), String(args.dataType));
      return { text: renderOps(`已前置到 ${String(args.parentID)}`, ops), data: ops };
    },
  },
  {
    name: "block_insert",
    title: "插入块",
    description:
      "按锚点插入新块。nextID / previousID / parentID 至少一个有效，内核优先级 nextID > previousID > parentID。",
    risk: "additive",
    params: {
      data: { type: "string", required: true, description: "要写入的内容" },
      dataType: { type: "string", description: "数据类型：markdown", default: "markdown" },
      parentID: { type: "string", description: "父块 ID（挂到其下）" },
      previousID: { type: "string", description: "前一个块 ID（插到其后）" },
      nextID: { type: "string", description: "后一个块 ID（插到其前）" },
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
        nextID,
      });
      return { text: renderOps("已插入块", ops), data: ops };
    },
  },
  {
    name: "block_attrs_set",
    title: "设置块属性",
    description: "设置块的自定义属性（标签等）。属性名必须以 custom- 开头（内核要求）。",
    risk: "additive",
    params: {
      id: { type: "string", required: true, description: ID_DESC },
      attrs: {
        type: "string",
        required: true,
        description: 'JSON 对象字符串，键须以 custom- 开头，例如 {"custom-status":"done"}',
      },
    },
    invoke: async (client, args) => {
      const attrs = parseAttrs(args.attrs);
      await client.setBlockAttrs(String(args.id), attrs);
      return { text: `已设置 ${String(args.id)} 的属性：${Object.keys(attrs).join(", ")}`, data: { id: args.id, attrs } };
    },
  },
  {
    name: "notebook_open",
    title: "打开笔记本",
    description: "打开（加载）指定笔记本。属运行态变更、不改数据；思源客户端界面会同步显示为已打开。",
    risk: "additive",
    params: { notebook: { type: "string", required: true, description: NB_DESC } },
    invoke: async (client, args) => {
      const notebook = String(args.notebook);
      await client.openNotebook(notebook);
      return { text: `已打开笔记本 ${notebook}`, data: { notebook, opened: true } };
    },
  },
  {
    name: "notebook_close",
    title: "关闭笔记本",
    description:
      "关闭指定笔记本（仅运行态，数据不动）。若主人正在思源客户端里使用该笔记本，界面会同步变为已关闭。",
    risk: "additive",
    params: { notebook: { type: "string", required: true, description: NB_DESC } },
    invoke: async (client, args) => {
      const notebook = String(args.notebook);
      await client.closeNotebook(notebook);
      return { text: `已关闭笔记本 ${notebook}（数据未改动）`, data: { notebook, closed: true } };
    },
  },
  {
    name: "export_resources",
    title: "导出资源为 zip",
    description:
      "把 workspace 内的文件/文件夹打包为 zip，返回 zip 在 workspace 中的相对路径。" +
      "写在临时导出目录，不改动笔记内容。",
    risk: "additive",
    params: {
      paths: {
        type: "string",
        required: true,
        description: '要导出的路径列表：JSON 数组或逗号分隔，如 ["/conf/appearance/boot"]',
      },
      name: { type: "string", description: "导出文件名（不含 .zip）" },
    },
    invoke: async (client, args) => {
      const paths = parseListParam(args.paths, "paths");
      if (paths.length === 0) {
        throw new SiYuanError("SIYUAN_API_ERROR", "paths 不能为空", { hint: "至少给一个 workspace 内路径。" });
      }
      const zipPath = await client.exportResources(paths, optionalString(args.name));
      return {
        text: zipPath ? `已导出：${zipPath}（${paths.length} 个路径）` : "内核未返回导出路径",
        data: { path: zipPath, paths },
      };
    },
  },
  {
    name: "block_fold",
    title: "折叠块",
    description: "折叠指定块（只改折叠状态，可逆，不改内容）。",
    risk: "additive",
    params: { id: { type: "string", required: true, description: ID_DESC } },
    invoke: async (client, args) => {
      const id = String(args.id);
      await client.foldBlock(id);
      return { text: `已折叠块 ${id}`, data: { id, folded: true } };
    },
  },
  {
    name: "block_unfold",
    title: "展开块",
    description: "展开指定块（只改折叠状态，可逆）。",
    risk: "additive",
    params: { id: { type: "string", required: true, description: ID_DESC } },
    invoke: async (client, args) => {
      const id = String(args.id);
      await client.unfoldBlock(id);
      return { text: `已展开块 ${id}`, data: { id, folded: false } };
    },
  },
];

const destructiveTools: readonly ToolSpec[] = [
  {
    name: "block_update",
    title: "改写块（破坏型）",
    description:
      "用新内容整体覆盖指定块（内核 updateBlock 是覆盖语义）。破坏型：必须 confirm: true；默认 lockType 为 true，块类型变化会被拒绝。",
    risk: "destructive",
    params: {
      id: { type: "string", required: true, description: ID_DESC },
      data: { type: "string", required: true, description: "新的块内容" },
      dataType: { type: "string", description: "数据类型：markdown", default: "markdown" },
      confirm: { type: "boolean", description: CONFIRM_DESC },
      dryRun: { type: "boolean", description: DRYRUN_DESC },
      expectedHash: { type: "string", description: HASH_DESC },
    },
    invoke: async (client, args) => {
      const spec = findToolSpecOrThrow("block_update");
      const id = String(args.id);
      const { preview, exists } = await buildBlockPreview(client, id);
      requireConfirm(spec, args, preview, exists);
      if (shouldDryRun(args)) {
        return { text: previewText(spec, "将覆盖该块内容", preview), data: { dryRun: true, exists } };
      }
      await requireFreshHash(client, id, optionalString(args.expectedHash));
      const ops = await client.updateBlock(id, String(args.data), String(args.dataType), true);
      return { text: renderOps(`已改写块 ${id}`, ops), data: ops };
    },
  },
  {
    name: "block_delete",
    title: "删除块（破坏型）",
    description: "删除指定块及其子块。破坏型：必须 confirm: true；不传则只返回预览。",
    risk: "destructive",
    params: {
      id: { type: "string", required: true, description: ID_DESC },
      confirm: { type: "boolean", description: CONFIRM_DESC },
      dryRun: { type: "boolean", description: DRYRUN_DESC },
      expectedHash: { type: "string", description: HASH_DESC },
    },
    invoke: async (client, args) => {
      const spec = findToolSpecOrThrow("block_delete");
      const id = String(args.id);
      const { preview, exists } = await buildBlockPreview(client, id);
      requireConfirm(spec, args, preview, exists);
      if (shouldDryRun(args)) {
        return { text: previewText(spec, "将删除该块及其子块", preview), data: { dryRun: true, exists } };
      }
      await requireFreshHash(client, id, optionalString(args.expectedHash));
      const ops = await client.deleteBlock(id);
      return { text: renderOps(`已删除块 ${id}`, ops), data: ops };
    },
  },
  {
    name: "block_move",
    title: "移动块（破坏型）",
    description: "把块移动到另一个父块下或某个块之后。破坏型：必须 confirm: true。",
    risk: "destructive",
    params: {
      id: { type: "string", required: true, description: ID_DESC },
      confirm: { type: "boolean", description: CONFIRM_DESC },
      parentID: { type: "string", description: "目标父块 ID" },
      previousID: { type: "string", description: "目标前一位置块 ID" },
      dryRun: { type: "boolean", description: DRYRUN_DESC },
    },
    invoke: async (client, args) => {
      const spec = findToolSpecOrThrow("block_move");
      const id = String(args.id);
      const parentID = optionalString(args.parentID);
      const previousID = optionalString(args.previousID);
      requireConfirm(spec, args, "移动块会改变文档结构（可用内核 undoOperations 回退）", true);
      requireAnchor(spec, parentID, previousID, undefined);
      if (shouldDryRun(args)) {
        return { text: previewText(spec, "将移动该块", `id=${id}`), data: { dryRun: true } };
      }
      const ops = await client.moveBlock(id, { parentID, previousID });
      return { text: renderOps(`已移动块 ${id}`, ops), data: ops };
    },
  },
  {
    name: "doc_rename",
    title: "重命名文档（破坏型）",
    description: "修改文档标题。破坏型：必须 confirm: true；不传则只返回预览。",
    risk: "destructive",
    params: {
      id: { type: "string", required: true, description: ID_DESC },
      title: { type: "string", required: true, description: "新的文档标题" },
      confirm: { type: "boolean", description: CONFIRM_DESC },
      dryRun: { type: "boolean", description: DRYRUN_DESC },
    },
    invoke: async (client, args) => {
      const spec = findToolSpecOrThrow("doc_rename");
      const id = String(args.id);
      const title = requireName(spec, args, "title");
      const { preview, exists } = await buildDocPreview(client, id);
      requireConfirm(spec, args, preview, exists);
      if (shouldDryRun(args)) {
        return { text: previewText(spec, `将重命名为「${title}」`, preview), data: { dryRun: true, exists } };
      }
      await client.renameDocByID(id, title);
      return { text: `已重命名文档 ${id} 为「${title}」\n原有位置：\n${preview}`, data: { id, title } };
    },
  },
  {
    name: "doc_move",
    title: "移动文档（破坏型）",
    description: "把一个或多个文档移动到目标父文档/笔记本下。破坏型：必须 confirm: true。",
    risk: "destructive",
    params: {
      fromIDs: { type: "string", required: true, description: "源文档 ID，多个用逗号分隔" },
      toID: { type: "string", required: true, description: "目标父文档 ID 或笔记本 ID" },
      confirm: { type: "boolean", description: CONFIRM_DESC },
      dryRun: { type: "boolean", description: DRYRUN_DESC },
    },
    invoke: async (client, args) => {
      const spec = findToolSpecOrThrow("doc_move");
      const fromIDs = parseIdList(args.fromIDs);
      const toID = requireName(spec, args, "toID");
      const { preview } = await buildDocPreview(client, fromIDs[0]);
      requireConfirm(spec, args, `将移动 ${fromIDs.length} 个文档到 ${toID}\n${preview}`, true);
      if (shouldDryRun(args)) {
        return {
          text: previewText(spec, `将移动 ${fromIDs.join(", ")} 到 ${toID}`, preview),
          data: { dryRun: true, fromIDs, toID },
        };
      }
      await client.moveDocsByID(fromIDs, toID);
      return { text: `已移动 ${fromIDs.length} 个文档到 ${toID}：${fromIDs.join(", ")}`, data: { fromIDs, toID } };
    },
  },
  {
    name: "doc_remove",
    title: "删除文档（破坏型）",
    description:
      "删除文档。破坏型：必须 confirm: true。内核会先把文档写入数据历史（数据历史 中可回滚，受历史保留设置限制）。",
    risk: "destructive",
    params: {
      id: { type: "string", required: true, description: ID_DESC },
      confirm: { type: "boolean", description: CONFIRM_DESC },
      dryRun: { type: "boolean", description: DRYRUN_DESC },
    },
    invoke: async (client, args) => {
      const spec = findToolSpecOrThrow("doc_remove");
      const id = String(args.id);
      const { preview, exists } = await buildDocPreview(client, id);
      requireConfirm(spec, args, preview, exists);
      if (shouldDryRun(args)) {
        return { text: previewText(spec, "将删除该文档", preview), data: { dryRun: true, exists } };
      }
      await client.removeDocByID(id);
      return {
        text: `已删除文档 ${id}\n删除前位置：\n${preview}\n\n提示：内核已把该文档写入数据历史，可在思源「数据历史」中回滚（受历史保留设置限制）。`,
        data: { id },
      };
    },
  },
  {
    name: "doc_rename_by_path",
    title: "按路径重命名文档（破坏型）",
    description: "按「笔记本 + 文档路径」重命名文档标题（对齐参考实现）。破坏型：必须 confirm: true；不传则只返回预览。",
    risk: "destructive",
    params: {
      notebook: { type: "string", required: true, description: NB_DESC },
      path: { type: "string", required: true, description: "文档路径（相对笔记本，如 /a.sy）" },
      title: { type: "string", required: true, description: "新的文档标题" },
      confirm: { type: "boolean", description: CONFIRM_DESC },
      dryRun: { type: "boolean", description: DRYRUN_DESC },
    },
    invoke: async (client, args) => {
      const spec = findToolSpecOrThrow("doc_rename_by_path");
      const notebook = String(args.notebook);
      const path = requireName(spec, args, "path");
      const title = requireName(spec, args, "title");
      const { ids } = await resolveIdByPath(client, notebook, path);
      const preview =
        `笔记本：${notebook}\n文档路径：${path}` +
        `${ids.length > 0 ? `\n解析到文档 ID：${ids.join(", ")}` : "\n（未能按此路径解析到文档）"}\n新标题：${title}`;
      requireConfirm(spec, args, preview, ids.length > 0);
      if (shouldDryRun(args)) {
        return { text: previewText(spec, `将重命名为「${title}」`, preview), data: { dryRun: true } };
      }
      await client.renameDoc(notebook, path, title);
      return { text: `已重命名 ${path} 为「${title}」\n${preview}`, data: { notebook, path, title } };
    },
  },
  {
    name: "doc_remove_by_path",
    title: "按路径删除文档（破坏型）",
    description:
      "按「笔记本 + 文档路径」删除文档（对齐参考实现）。内核会先把文件写入数据历史。破坏型：必须 confirm: true。",
    risk: "destructive",
    params: {
      notebook: { type: "string", required: true, description: NB_DESC },
      path: { type: "string", required: true, description: "文档路径（相对笔记本，如 /a.sy）" },
      confirm: { type: "boolean", description: CONFIRM_DESC },
      dryRun: { type: "boolean", description: DRYRUN_DESC },
    },
    invoke: async (client, args) => {
      const spec = findToolSpecOrThrow("doc_remove_by_path");
      const notebook = String(args.notebook);
      const path = requireName(spec, args, "path");
      const { ids } = await resolveIdByPath(client, notebook, path);
      const preview =
        `笔记本：${notebook}\n文档路径：${path}` +
        `${ids.length > 0 ? `\n解析到文档 ID：${ids.join(", ")}` : "\n（未能按此路径解析到文档）"}`;
      requireConfirm(spec, args, preview, ids.length > 0);
      if (shouldDryRun(args)) {
        return { text: previewText(spec, "将删除该文档", preview), data: { dryRun: true } };
      }
      await client.removeDoc(notebook, path);
      return {
        text: `已删除文档 ${path}\n${preview}\n\n提示：内核已把该文档写入数据历史，可在思源「数据历史」中回滚。`,
        data: { notebook, path },
      };
    },
  },
  {
    name: "doc_move_by_path",
    title: "按路径移动文档（破坏型）",
    description: "按路径把一个或多个文档移动到目标笔记本/路径（对齐参考实现）。破坏型：必须 confirm: true。",
    risk: "destructive",
    params: {
      fromPaths: { type: "string", required: true, description: "源文档路径列表：JSON 数组或逗号分隔" },
      toNotebook: { type: "string", required: true, description: "目标笔记本 ID" },
      toPath: { type: "string", required: true, description: "目标目录（**必须已存在**；根目录用 /）" },
      confirm: { type: "boolean", description: CONFIRM_DESC },
      dryRun: { type: "boolean", description: DRYRUN_DESC },
    },
    invoke: async (client, args) => {
      const spec = findToolSpecOrThrow("doc_move_by_path");
      const fromPaths = parseListParam(args.fromPaths, "fromPaths");
      if (fromPaths.length === 0) {
        throw new SiYuanError("SIYUAN_API_ERROR", "fromPaths 不能为空", { hint: "给出至少一个源文档路径。" });
      }
      const toNotebook = requireName(spec, args, "toNotebook");
      const toPath = requireName(spec, args, "toPath");

      // 内核不会自动创建目录，而失败时只报晦涩的 OS 错误（实测：open …\子目录: The system cannot find the file specified.）
      // 所以这里先做一次只读探测，把错误翻译成可操作的提示。
      try {
        await client.listDocsByPath(toNotebook, toPath);
      } catch {
        throw new SiYuanError("SIYUAN_NOT_FOUND", `目标目录不存在：${toNotebook} 的 ${toPath}`,
          { hint: "目标目录必须已存在（根目录用 /）；若要用新层级，先用 doc_create 建好该层级的文档。" },
        );
      }

      const preview =
        `将移动 ${fromPaths.length} 个文档：\n${fromPaths.join("\n")}\n` +
        `目标笔记本：${toNotebook}\n目标路径：${toPath}`;
      requireConfirm(spec, args, preview, true);
      if (shouldDryRun(args)) {
        return { text: previewText(spec, "将移动这些文档", preview), data: { dryRun: true, fromPaths } };
      }
      await client.moveDocs(fromPaths, toNotebook, toPath);
      return { text: `已移动 ${fromPaths.length} 个文档到 ${toNotebook}${toPath}`, data: { fromPaths, toNotebook, toPath } };
    },
  },
  {
    name: "notebook_rename",
    title: "重命名笔记本（破坏型）",
    description: "覆盖笔记本名称。破坏型：必须 confirm: true；预览会给出当前名称。",
    risk: "destructive",
    params: {
      notebook: { type: "string", required: true, description: NB_DESC },
      name: { type: "string", required: true, description: "新的笔记本名称" },
      confirm: { type: "boolean", description: CONFIRM_DESC },
      dryRun: { type: "boolean", description: DRYRUN_DESC },
    },
    invoke: async (client, args) => {
      const spec = findToolSpecOrThrow("notebook_rename");
      const notebook = String(args.notebook);
      const name = requireName(spec, args, "name");
      const info = await buildNotebookPreview(client, notebook);
      requireConfirm(spec, args, info.preview, info.exists);
      if (shouldDryRun(args)) {
        return { text: previewText(spec, `将改名为「${name}」`, info.preview), data: { dryRun: true, exists: info.exists } };
      }
      await client.renameNotebook(notebook, name);
      return { text: `已把笔记本改名为「${name}」（原名称：${info.name}）`, data: { notebook, name, previousName: info.name } };
    },
  },
  {
    name: "notebook_icon_set",
    title: "设置笔记本图标（破坏型）",
    description:
      "覆盖笔记本图标（Unicode 表情码点或图标资源名）。破坏型：必须 confirm: true；预览会给出当前图标。",
    risk: "destructive",
    params: {
      notebook: { type: "string", required: true, description: NB_DESC },
      icon: { type: "string", required: true, description: "新图标（如 1f4d6 这样的表情码点，或图标资源名）" },
      confirm: { type: "boolean", description: CONFIRM_DESC },
      dryRun: { type: "boolean", description: DRYRUN_DESC },
    },
    invoke: async (client, args) => {
      const spec = findToolSpecOrThrow("notebook_icon_set");
      const notebook = String(args.notebook);
      const icon = requireName(spec, args, "icon");
      const info = await buildNotebookPreview(client, notebook);
      requireConfirm(spec, args, info.preview, info.exists);
      if (shouldDryRun(args)) {
        return { text: previewText(spec, `将图标改为「${icon}」`, info.preview), data: { dryRun: true, exists: info.exists } };
      }
      await client.setNotebookIcon(notebook, icon);
      return {
        text: `已设置笔记本图标为「${icon}」（原图标：${info.icon || "未设置"}）`,
        data: { notebook, icon, previousIcon: info.icon },
      };
    },
  },
  {
    name: "notebook_conf_set",
    title: "设置笔记本配置（破坏型）",
    description:
      "覆盖笔记本配置（如 dailyNoteSavePath、refCreateSavePath、docCreateSavePath 等）。" +
      "破坏型：必须 confirm: true；预览会给出当前配置要点。建议先用 notebook_conf_get 读取现有配置再部分修改。",
    risk: "destructive",
    params: {
      notebook: { type: "string", required: true, description: NB_DESC },
      conf: {
        type: "string",
        required: true,
        description: '要写入的配置 JSON 对象字符串，如 {"dailyNoteSavePath":"/daily note/{{now | date \\"2006-01-02\\"}}"}',
      },
      confirm: { type: "boolean", description: CONFIRM_DESC },
      dryRun: { type: "boolean", description: DRYRUN_DESC },
    },
    invoke: async (client, args) => {
      const spec = findToolSpecOrThrow("notebook_conf_set");
      const notebook = String(args.notebook);
      const conf = parseJsonObject(args.conf, "conf");
      const info = await buildNotebookPreview(client, notebook);
      const preview = `${info.preview}\n\n将写入的配置：\n${Object.entries(conf)
        .map(([key, value]) => `- ${key}: ${String(value)}`)
        .join("\n")}`;
      requireConfirm(spec, args, preview, info.exists);
      if (shouldDryRun(args)) {
        return { text: previewText(spec, "将覆盖笔记本配置", preview), data: { dryRun: true, exists: info.exists } };
      }
      const saved = await client.setNotebookConf(notebook, conf);
      return { text: `已更新笔记本配置（${Object.keys(conf).join(", ")}）\n${preview}`, data: { notebook, conf, saved } };
    },
  },
  {
    name: "notebook_remove",
    title: "删除笔记本（最高风险）",
    description:
      "删除整个笔记本（含其全部文档）。除 confirm: true 外，**还必须传 confirmName**，且其值必须与笔记本当前名称逐字一致。" +
      "预览会给出名称与文档数；不一致时报 SIYUAN_CONFIRM_MISMATCH。不传 confirm 时只返回预览。",
    risk: "destructive",
    params: {
      notebook: { type: "string", required: true, description: NB_DESC },
      confirmName: { type: "string", required: true, description: "二次确认：必须逐字填写笔记本当前名称" },
      confirm: { type: "boolean", description: CONFIRM_DESC },
      dryRun: { type: "boolean", description: DRYRUN_DESC },
    },
    invoke: async (client, args) => {
      const spec = findToolSpecOrThrow("notebook_remove");
      const notebook = String(args.notebook);
      const info = await buildNotebookPreview(client, notebook);
      requireConfirm(spec, args, info.preview, info.exists);
      if (shouldDryRun(args)) {
        return {
          text: previewText(spec, `将删除整个笔记本（含 ${info.docCount} 篇文档）`, info.preview),
          data: { dryRun: true, docCount: info.docCount },
        };
      }
      requireConfirmName(args, info.name, "删除笔记本");
      await client.removeNotebook(notebook);
      return {
        text: `已删除笔记本「${info.name}」（含 ${info.docCount} 篇文档）\n${info.preview}`,
        data: { notebook, name: info.name, docCount: info.docCount },
      };
    },
  },
  {
    name: "find_replace",
    title: "批量替换内容（破坏型）",
    description:
      "在**指定块**内把文本 k 替换为 r（对齐参考实现）。为避免全库误替换，ids 必须非空、且 k 与 r 都不能为空字符串。" +
      "内核的替换是按类型逐项生效的，本工具默认只替换**普通文本**（text）；需要连代码块、标题等一起替换时传 replaceTypes \"{\\\"all\\\":true}\" 或指定类型集合。" +
      "破坏型：必须 confirm: true；不传则只返回预览。",
    risk: "destructive",
    params: {
      k: { type: "string", required: true, description: "要查找的文本" },
      r: { type: "string", required: true, description: "替换为的文本（不支持空串/删除式替换）" },
      ids: {
        type: "string",
        required: true,
        description: "目标块 ID 列表：JSON 数组或逗号分隔；**不允许为空**（禁止全库替换）",
      },
      replaceTypes: {
        type: "string",
        description:
          '可选。默认 {"text":true}（只替换普通文本）；传 {"all":true} 替换全部 25 种类型，或自定义如 {"text":true,"code":true}',
      },
      confirm: { type: "boolean", description: CONFIRM_DESC },
      dryRun: { type: "boolean", description: DRYRUN_DESC },
    },
    invoke: async (client, args) => {
      const spec = findToolSpecOrThrow("find_replace");
      const k = requireName(spec, args, "k");
      const r = requireName(spec, args, "r");
      const ids = requireIdList(args, "ids");
      const replaceTypes = resolveReplaceTypes(args.replaceTypes);
      const preview =
        `将在 ${ids.length} 个块中把「${k}」替换为「${r}」\n` +
        `替换类型：${replaceTypes.label}\n` +
        `目标块：${ids.slice(0, 10).join(", ")}${ids.length > 10 ? " …" : ""}`;
      requireConfirm(spec, args, preview, true);
      if (shouldDryRun(args)) {
        return { text: previewText(spec, "将执行批量替换", preview), data: { dryRun: true, ids } };
      }
      await client.findReplace(k, r, ids, replaceTypes.types);
      return {
        text: `已在 ${ids.length} 个块中把「${k}」替换为「${r}」（类型：${replaceTypes.label}）\n${preview}`,
        data: { k, r, ids, replaceTypes: replaceTypes.types },
      };
    },
  },
];

export const TOOL_SPECS: readonly ToolSpec[] = [...readOnlyTools, ...additiveTools, ...destructiveTools];

function findToolSpecOrThrow(name: string): ToolSpec {
  const spec = TOOL_SPECS.find((item) => item.name === name);
  if (!spec) throw new SiYuanError("SIYUAN_API_ERROR", `内部错误：未注册工具 ${name}`);
  return spec;
}

function optionalString(value: unknown): string | undefined {
  const text = value === undefined || value === null ? "" : String(value).trim();
  return text.length > 0 ? text : undefined;
}

export function findToolSpec(name: string): ToolSpec | undefined {
  return TOOL_SPECS.find((spec) => spec.name === name);
}
