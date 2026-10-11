import { mkdirSync } from "node:fs";
import { build } from "esbuild";

/**
 * 把 VCP 通道打成零依赖单文件制品（对齐 VCPDeck/packages/vcp-plugin 的做法）。
 * 零 external（除 node: 内置）：插件商店安装时不执行 npm install 也能跑。
 */
mkdirSync("plugins/siyuan-agent", { recursive: true });

await build({
  entryPoints: ["src/channels/vcp/index.ts"],
  outfile: "plugins/siyuan-agent/index.cjs",
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  legalComments: "none",
  logLevel: "info",
});

console.log("[build:vcp] plugins/siyuan-agent/index.cjs 已生成");
