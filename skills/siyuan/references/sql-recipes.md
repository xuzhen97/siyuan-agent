# 思源 SQL 配方（只读）

> 事实基线：本机内核 **3.8.6**（`/api/system/version` 实测），数据取自 `sqlite_master` 与 `PRAGMA table_info` 实测结果，**不是记忆**。内核升级后请重跑验证（`SELECT name FROM sqlite_master WHERE type='table'` 与 `PRAGMA table_info(blocks)`）。

## 一、先记住两条硬事实

### 1. 无 LIMIT 会被内核截断到 64 行

| 语句 | 返回行数 | 响应里的 limit / truncated |
|---|---|---|
| `SELECT id FROM blocks`（无 LIMIT） | **64** | `limit: 64`, `truncated: true` |
| `SELECT id FROM blocks LIMIT 65` | 65 | `limit: 0`, `truncated: false` |
| `SELECT COUNT(*) AS c FROM blocks` | 1 | `limit: 64`, `truncated: false` |

**含义**：只要工具文本出现"结果被截断"，就必须加显式 `LIMIT`/`OFFSET` 分页或改成聚合查询；不要把那 64 行当成全部数据。**结论必须建立在显式 `LIMIT` 或聚合之上。**

### 2. SQL 通道只读

只放行单条 `SELECT` / `WITH`。变更类语句（`INSERT`/`UPDATE`/`DELETE`/`DROP`/`ALTER`/`PRAGMA` 等）与多语句一律被拦截（`SIYUAN_READONLY_BLOCKED`）。要改内容请用写工具（`block_append`/`block_update` 等）。

## 二、表清单（实测）

```sql
SELECT name FROM sqlite_master WHERE type='table' ORDER BY name
-- assets, attributes, block_embeddings, blocks,
-- blocks_fts, blocks_fts_config, blocks_fts_data, blocks_fts_docsize, blocks_fts_idx,
-- file_annotation_refs, refs, spans, stat
```

| 表 | 用途 |
|---|---|
| `blocks` | 核心索引表：文档与块的行式索引（内容、属性、路径、时间戳） |
| `refs` | 块之间的引用关系（反链的来源） |
| `attributes` | 块属性索引（含 `custom-*` 自定义属性） |
| `spans` | 行内元素索引 |
| `assets` | 资源文件索引 |
| `stat` | 统计信息 |
| `blocks_fts*` | blocks 的全文检索虚表（改动 `blocks` 由内核维护） |

## 三、`blocks` 列（实测，21 列）

```
id, parent_id, root_id, hash, box, path, hpath, name, alias, memo, tag, content,
fcontent, markdown, length, type, subtype, ial, sort, created, updated
```

常用列说明：

- `type`：块类型。`d` = 文档（document）、`h` = 标题、`p` = 段落、`l` = 列表、`i` = 列表项、`c` = 代码块、`t` = 表格、`b` = 引述、`s` = 超级块、`m` = 数学块。
- `box`：所属笔记本 ID；`path`：存储路径（`.sy`）；`hpath`：人类可读路径。
- `content`：纯文本内容（检索用）；`markdown`：Markdown 源；`fcontent`：折叠后的内容。
- `tag`：标签（形如 `#标签#`）；`ial`：内联属性列表。
- `hash`：内容短哈希（用于并发校验，例如写工具？`expectedHash`）；`created`/`updated`：形如 `20261010165512` 的时间戳（**字符串**，非 Unix 秒）。
- `box` 与 `path` 组合可用于定位文档所在笔记本。

## 四、常用配方

### 1. 按内容找块（限定列，避免全列扫）

```sql
SELECT id, type, hpath, substr(content, 1, 80) AS excerpt
FROM blocks
WHERE content LIKE '%会议%'
ORDER BY updated DESC
LIMIT 20
```

### 2. 文档树（某笔记本的所有文档）

```sql
SELECT id, hpath, updated
FROM blocks
WHERE box = '<笔记本ID>' AND type = 'd'
ORDER BY hpath
LIMIT 100
```

### 3. 最近修改的文档（基于字符串时间戳，字典序即时间序）

```sql
SELECT id, hpath, updated
FROM blocks
WHERE type = 'd'
ORDER BY updated DESC
LIMIT 20
```

### 4. 按标签找块

```sql
SELECT id, hpath, substr(content, 1, 60) AS excerpt
FROM blocks
WHERE tag LIKE '%#待办#%'
LIMIT 50
```

自定义属性则走 `attributes` 表：

```sql
SELECT b.id, b.hpath
FROM attributes a JOIN blocks b ON b.id = a.block_id
WHERE a.name = 'custom-status' AND a.value = 'done'
LIMIT 50
```

### 5. 反链（谁引用了某文档）

```sql
SELECT r.block_id, r.def_block_id, b.hpath, substr(b.content, 1, 60) AS excerpt
FROM refs r LEFT JOIN blocks b ON b.id = r.block_id
WHERE r.def_block_id = '<目标块ID>'
LIMIT 50
```

### 6. 统计聚合（不受 64 行截断影响）

```sql
SELECT type, COUNT(*) AS c
FROM blocks
GROUP BY type
ORDER BY c DESC
```

### 7. 内容体量分布（`length` 列）

```sql
SELECT hpath, length, updated
FROM blocks
WHERE type = 'd'
ORDER BY length DESC
LIMIT 10
```

### 8. 分页写法（超过 64 行时必须）

```sql
SELECT id, hpath FROM blocks WHERE type = 'd' ORDER BY hpath LIMIT 50 OFFSET 0
-- 下一页：LIMIT 50 OFFSET 50
```

## 五、字符串与转义注意

- 时间戳与 ID 都是**字符串**，不要当数字比较；时间戳可用 `substr(updated, 1, 8) = '20261010'` 取某天。
- 单引号内的单引号需写成两个（`'it''s'`）。
- `hpath` 含中文与 `/`，用 `LIKE '%/沙盒/%'` 时注意 `/` 不是通配符。
- 需要精确匹配块 ID 时：`WHERE id = '20260419184156-0yw56ke'`。
