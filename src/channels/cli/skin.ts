/**
 * REPL 皮肤（对齐参考实现 utils/repl_skin.py 的公开方法集，但用零依赖的 ANSI 实现）。
 * 颜色支持自动检测：尊重 NO_COLOR / FORCE_COLOR，非 TTY 时不上色（便于管道与测试断言）。
 */

const CODES = {
  reset: "\u001b[0m",
  bold: "\u001b[1m",
  dim: "\u001b[2m",
  red: "\u001b[31m",
  green: "\u001b[32m",
  yellow: "\u001b[33m",
  blue: "\u001b[34m",
  magenta: "\u001b[35m",
  cyan: "\u001b[36m",
  gray: "\u001b[90m",
} as const;

type ColorName = keyof typeof CODES;

export type SkinOptions = { color?: boolean; isTty?: boolean };

export function detectColor(options?: SkinOptions): boolean {
  if (typeof options?.color === "boolean") return options.color;
  if (process.env.NO_COLOR) return false;
  if (process.env.FORCE_COLOR) return true;
  return Boolean(options?.isTty ?? process.stdout.isTTY);
}

export type Skin = {
  color: boolean;
  paint(name: ColorName, text: string): string;
  banner(version: string, address: string): string;
  prompt(label: string): string;
  success(message: string): string;
  error(message: string): string;
  warning(message: string): string;
  info(message: string): string;
  section(title: string): string;
  statusBlock(items: Record<string, string>, title?: string): string;
  table(headers: string[], rows: string[][]): string;
  help(commands: Record<string, string>): string;
  goodbye(): string;
};

export function makeSkin(options?: SkinOptions): Skin {
  const color = detectColor(options);

  const paint = (name: ColorName, text: string): string => (color ? `${CODES[name]}${text}${CODES.reset}` : text);

  const section = (title: string): string => paint("bold", title);

  const statusBlock = (items: Record<string, string>, title?: string): string => {
    const lines = Object.entries(items).map(([key, value]) => `  ${paint("gray", `${key}:`.padEnd(16))}${value}`);
    return [title ? section(title) : "", ...lines].filter(Boolean).join("\n");
  };

  const table = (headers: string[], rows: string[][]): string => {
    const widths = headers.map((header, index) =>
      Math.max(visibleLength(header), ...rows.map((row) => visibleLength(row[index] ?? ""))),
    );
    const format = (cells: string[]): string =>
      cells.map((cell, index) => pad(cell, widths[index] ?? 0)).join("  ").trimEnd();
    if (rows.length === 0) return `${paint("gray", format(headers))}\n${paint("gray", "（无数据）")}`;
    return [paint("gray", format(headers)), ...rows.map((row) => format(row))].join("\n");
  };

  const help = (commands: Record<string, string>): string => {
    const width = Math.max(...Object.keys(commands).map((command) => command.length));
    const lines = Object.entries(commands).map(
      ([command, description]) => `  ${paint("cyan", command.padEnd(width))}  ${description}`,
    );
    return [section("可用命令："), ...lines, "", "提示：所有 CLI 子命令在 REPL 内也可用（支持 --json 与 --confirm）。"].join("\n");
  };

  return {
    color,
    paint,
    banner: (version: string, address: string): string =>
      [
        `${paint("magenta", "思源笔记")} ${paint("bold", "siyuan-agent")} ${paint("gray", `v${version}`)} · 内核 ${address}`,
        paint("gray", "输入 help 查看命令，quit 退出。写操作仍需 confirm。"),
      ].join("\n"),
    prompt: (label: string): string => `${paint("cyan", label)} ${paint("gray", ">")} `,
    success: (message: string): string => `${paint("green", "✓")} ${message}`,
    error: (message: string): string => `${paint("red", "✗")} ${message}`,
    warning: (message: string): string => `${paint("yellow", "!")} ${message}`,
    info: (message: string): string => `${paint("blue", "·")} ${message}`,
    section,
    statusBlock,
    table,
    help,
    goodbye: (): string => paint("gray", "再见。"),
  };
}

function visibleLength(text: string): number {
  // 去掉 ANSI 转义序列后计数（表格对齐用）
  return text.replace(/\u001b\[[0-9;]*m/g, "").length;
}

function pad(text: string, width: number): string {
  return text + " ".repeat(Math.max(0, width - visibleLength(text)));
}
