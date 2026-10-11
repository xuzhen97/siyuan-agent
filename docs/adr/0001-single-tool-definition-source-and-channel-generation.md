# ADR-0001：单一工具定义真源与三通道接口生成

- 状态：Accepted
- 日期：2026-10-11
- 决策者：项目维护者
- 关联：`README.md`（项目说明）、`examples/CLI-Anything/siyuan/`（Python 参考实现）

## 背景

同一份思源访问能力需要同时供三个消费面使用：Pi 扩展（工具注册）、VCP 插件（stdio 命令）、CLI（人用与调试）。上游参考实现是三份互不相干的手写产物：Python 客户端（`core/client.py`）、click 命令树（`siyuan_cli.py`）、skill 文档（`skills/SKILL.md`）；它自己的 Pi 扩展只注入方法论、不提供任何 API 调用。

三份手写产物必然漂移：skill 文档承诺的能力在实现里缺失，或参数说明与真实字段名不一致。VCP 侧的既有习惯是把每条命令的 LLM 可见描述手写进 `capabilities.invocationCommands`，而该描述质量直接决定调用准确率，因此重复维护成本高且不可持续。

## 决策

1. `src/tools/definitions.ts` 是唯一真源，每条 `ToolSpec` 携带：canonical 名（snake_case）、路由描述、参数（类型/必填/说明/默认）、`invoke`。
2. 命名派生规则固定且确定性：

   | 目标 | 规则 | 例 |
   | --- | --- | --- |
   | Pi 工具名 | `siyuan_` + canonical | `siyuan_notebook_list` |
   | VCP command | canonical → PascalCase | `notebook_list` → `NotebookList` |
   | CLI 子命令 | **两级**：首段为组，剩余部分整体作子命令（不把多段 canonical 完全拆开） | `notebook_list` → `siyuan-agent notebook list`；`doc_ids_by_hpath` → `siyuan-agent doc ids_by_hpath` |

   VCP dispatch **同时接受** canonical 与 PascalCase 两种写法（宽进严出）。
3. VCP 的 `plugin-manifest.json` 与 `skills/siyuan/SKILL.md` 的 `<!-- BEGIN GENERATED -->` 区块由 `src/generators/` 产出，二者的手写部分永不被覆盖。
4. `pnpm generate --check` 重新生成后与仓库内制品逐字节比对，不一致即失败，作为 CI 门。
5. 生成物随源码提交进仓库。

## 候选方案

- **三份手写**：漂移不可控，且每条命令的 LLM 描述需要写三遍；
- **以 CLI 为单一入口，Pi/VCP 都 shell 调用**：引入二次进程启动、靠 stdout 传结构化数据、Windows 引号转义问题，且 VCP 插件本身已是 stdio 进程，再套一层 shell 属架构倒置；
- **纯代码生成、不设真源文件**：无法表达"什么时候该用这个工具"这类路由语义，而描述文案恰恰是 LLM 可调用性的关键。

## 后果

正面：新增或修改能力只改一处，三条通道自动一致；描述与参数说明单点维护；三通道可用同一份 fixture 做一致性测试。

负面：派生规则成为对外公共契约，改 canonical 名即破坏兼容；生成物必须与源码同步提交并受漂移门约束；Pi 侧注册名带 `siyuan_` 前缀是刻意的命名冗余（用于避开内置工具冲突）。

## 验证与退出条件

通过通道装配测试（断言注册条数等于 `TOOL_SPECS.length`、名称前缀与 schema 与真源一致）与 CI 的 `generate --check` 验证。

若未来出现第四个消费面，且其命名或描述规则无法由统一派生规则表达，需要重新评估生成策略并在新 ADR 中 supersede 本决策。

---

- 修订：2026-10-11 经项目维护者批准，将 CLI 子命令派生规则细化为**两级路径**（首段为组，剩余部分整体作子命令），并补充多段 canonical 的实例；决策结论（确定性派生）未变。
