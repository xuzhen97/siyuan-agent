/**
 * skill 文档生成：与 VCP manifest 共用同一套真源与标记协议。
 * 单独成文件是为了让 Spec §3.1 的文件职责划分清晰（VCP manifest / skill 文档各自可被替换）。
 */
export {
  GENERATED_BEGIN,
  GENERATED_END,
  insertGeneratedSkillTable,
  renderSkillCommandTable,
} from "./vcpManifest.ts";
