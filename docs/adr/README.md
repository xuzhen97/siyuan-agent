# 架构决策记录（ADR）

> 维护责任：项目维护者｜最后核验：2026-10-11

ADR 记录会长期影响系统结构、数据、协议、安全或运维的决策。ADR 一经 Accepted 不修改结论；后续变化用新 ADR supersede。

## 编号与状态

文件名：`NNNN-short-title.md`，编号四位递增。

状态：

- Proposed
- Accepted
- Deprecated
- Superseded by ADR-NNNN
- Rejected

## 模板

```markdown
# ADR-NNNN：标题

- 状态：Proposed
- 日期：YYYY-MM-DD
- 决策者：项目维护者
- 关联：相关文档路径

## 背景

问题、约束和驱动因素。

## 决策

明确、可执行的结论。

## 候选方案

各方案及未选择原因。

## 后果

正面、负面、风险、运维和迁移影响。

## 验证与退出条件

如何验证；何时应重新评估。
```

## 何时必须写 ADR

- 新的运行组件、外部集成面或消费通道；
- 对外的公共接口、数据契约、错误契约；
- 安全、信任边界或只读/可写范围的划定；
- 基础依赖、运行时版本与交付方式的选择；
- 引入难以撤销的跨切面约定。

实现细节、文件划分、局部可撤销选择、验证任务清单不写 ADR。

## 当前决策索引

| ADR | 状态 | 决策 |
| --- | --- | --- |
| [0001](./0001-single-tool-definition-source-and-channel-generation.md) | Accepted | 单一工具定义真源，生成 Pi / VCP / CLI 三通道接口 |
| [0002](./0002-read-only-boundary-and-client-side-sql-guard.md) | Superseded by ADR-0004（其 SQL 守卫与 `truncated` 保真两条继续有效） | 一期只读边界与客户端 SQL 守卫 |
| [0003](./0003-zero-runtime-dependency-and-committed-artifacts.md) | Accepted | 零运行时依赖、Node ≥20 与制品提交进仓库 |
| [0004](./0004-write-channel-and-unified-confirmation-boundary.md) | Accepted | 写通道与统一 `confirm` 确认安全边界（取代 0002 的只读结论） |
