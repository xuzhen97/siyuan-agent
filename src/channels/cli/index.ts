import { SiYuanClient } from "../../core/client.ts";
import { resolveSiYuanConfig } from "../../core/config.ts";
import { dispatchTool } from "../../tools/dispatch.ts";
import { TOOL_SPECS } from "../../tools/definitions.ts";
import { toCliPath } from "../../tools/naming.ts";
import { parseCliArgs } from "./args.ts";
import { runRepl } from "./repl.ts";
import { readStdinText, resolveStdinArgs } from "./stdin.ts";

export { parseCliArgs } from "./args.ts";
export type { CliGlobalOptions, ParsedCli } from "./args.ts";

export function usage(): string {
  const lines = TOOL_SPECS.map((spec) => `siyuan-agent ${toCliPath(spec.name).join(" ")} — ${spec.title}`);
  return [
    "用法：siyuan-agent <命令> [参数...] [--json] [--host] [--port] [--token] [--config]",
    "",
    "全局选项：",
    "  --json            以 JSON 输出结果（取 data 字段）",
    "  --host / --port   覆盖内核地址与端口",
    "  --token           覆盖 API Token",
    "  --config          指定配置文件路径",
    "",
    "其他：",
    "  repl              交互式 REPL（等价于不带参数运行）",
    "",
    "命令：",
    ...lines,
  ].join("\n");
}

export async function runCli(
  argv: string[],
  deps?: {
    client?: SiYuanClient;
    stdout?: (text: string) => void;
    stderr?: (text: string) => void;
    stdin?: () => string;
  },
): Promise<number> {
  const writeOut = deps?.stdout ?? ((text: string) => process.stdout.write(text));
  const writeErr = deps?.stderr ?? ((text: string) => process.stderr.write(text));

  // 无参数或 `repl` → 交互式 REPL（对齐参考实现）。
  // 非 TTY（管道/CI）下不进入 REPL，避免挂住，改为打印用法。
  if (argv.length === 0 || argv[0] === "repl") {
    if (!process.stdin.isTTY) {
      writeErr(`${usage()}\n`);
      return 1;
    }
    return await runRepl({ client: deps?.client });
  }

  const parsed = parseCliArgs(argv);
  const spec = TOOL_SPECS.find((item) => item.name === parsed.tool);
  if (!spec) {
    writeErr(`未知子命令：${argv.join(" ")}\n\n${usage()}\n`);
    return 1;
  }

  const client =
    deps?.client ??
    new SiYuanClient(
      resolveSiYuanConfig({
        host: parsed.global.host,
        port: parsed.global.port,
        token: parsed.global.token,
        configPath: parsed.global.configPath,
      }),
    );

  // `-` 哨兵：从 stdin 读取内容（对齐参考实现；用于 `--md -` 与 block 写操作）
  const args = resolveStdinArgs(spec, parsed.args, deps?.stdin ?? readStdinText);
  const outcome = await dispatchTool(spec, args, client);

  if (outcome.ok) {
    const text = parsed.global.json
      ? JSON.stringify(outcome.result.data ?? { text: outcome.result.text })
      : outcome.result.text;
    writeOut(`${text}\n`);
    return 0;
  }

  const { code, message, hint } = outcome.error;
  writeErr(`[${code}] ${message}${hint ? `\n提示：${hint}` : ""}\n`);
  return 1;
}

const entry = process.argv[1] ?? "";
if (entry.endsWith("cli.cjs") || entry.endsWith("cli/index.ts")) {
  // 不用 process.exit()：Windows 上会与未刷完的 stdout 竞争，触发 libuv 断言（UV_HANDLE_CLOSING）。
  // 设置 exitCode 并在事件循环空后自然退出，输出会先刷完。
  void runCli(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
