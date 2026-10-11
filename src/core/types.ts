export type Notebook = { id: string; name: string; icon?: string; closed?: boolean; sort?: number };

export type DocEntry = { id: string; name: string; path?: string; hPath?: string; subFileCount?: number };

export type DocTreeNode = DocEntry & { children?: DocTreeNode[]; depth?: number };

export type DocSearchHit = { path?: string; hPath?: string; id?: string; name?: string; box?: string };

export type BlockRow = { id: string; type?: string; content?: string; parent_id?: string; root_id?: string };

export type SqlRow = Record<string, unknown>;

export type TagInfo = { name: string; label?: string; count?: number };

/** 内核写操作返回的动作条目（doOperations）。 */
export type BlockOp = { action: string; id?: string; parentID?: string; previousID?: string };

export type BlockOpResult = { doOperations: BlockOp[]; undoOperations: unknown };
