/**
 * pi 包入口（package.json 的 `pi.extensions` 指向本文件）。
 * 实际实现位于 src/channels/pi，这里只做转发，使 src 成为唯一代码真源。
 */
export { default } from "../src/channels/pi/index.ts";
