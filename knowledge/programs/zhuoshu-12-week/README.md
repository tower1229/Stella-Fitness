# 卓叔 12 周结构化增肌增重计划

> Stella Fitness 内置的首个训练计划知识包。

## 来源与状态

本目录由《卓叔增重 · 结构化增肌增重教程》重新组织而来。原教程覆盖 12 周，分为三个阶段：

1. 第 1–4 周：力量积累，全身训练，每周 3 练；
2. 第 5–8 周：高效增肌，躯干/四肢分化，每周 4 练；
3. 第 9–12 周：全面显壮，继续分化训练并提高加重频率。

本目录的目标不是改写或优化原计划，而是把原资料转换为：

- 便于用户阅读和核对的 Markdown 文档；
- 便于 Program Engine 消费的结构化 `ProgramSpec`；
- 可以显式追踪资料缺失、来源不确定性和后续修订的版本化知识包。

## 文档结构

- [overview.md](./overview.md)：课程概览、器械与三阶段结构
- [nutrition.md](./nutrition.md)：原教程饮食方案
- [rules.md](./rules.md)：重量、力竭、恢复与加重规则
- [warmup-and-recovery.md](./warmup-and-recovery.md)：统一热身与放松
- [phase-1-weeks-01-04.md](./phase-1-weeks-01-04.md)：第 1–4 周
- [phase-2-weeks-05-08.md](./phase-2-weeks-05-08.md)：第 5–8 周
- [phase-3-weeks-09-12.md](./phase-3-weeks-09-12.md)：第 9–12 周
- [cycle.md](./cycle.md)：12 周结束后的 12RM 重测与循环
- [source-audit.md](./source-audit.md)：源资料完整性、未知项与发布风险审计
- [program-spec.v0.1.yaml](./program-spec.v0.1.yaml)：机器可读计划草案

## 重要约束

### 不自行补齐资料

原资料中 **第 4 周周五训练明确缺失**。本知识包保留这一事实，不根据前后规律推测内容。

在该缺口被可靠原始资料补齐前：

- `ProgramSpec` 必须把这一训练日标记为 `unresolved`；
- Program Engine 不得把推测内容当成 canonical program；
- Agent 必须向用户说明资料缺失，而不是自动生成一个看似合理的训练日。

### 忠实结构化不等于专业背书

原始文件末尾注明“部分内容可能由 AI 生成”。因此当前知识包完成的是对用户提供资料的忠实结构化，不自动代表训练科学、营养学或医疗层面的独立验证。详见 [source-audit.md](./source-audit.md)。

## 与 Stella Fitness 的关系

该计划是 Stella Fitness 的第一份 program package，但在已知阻塞项解决前，`program-spec.v0.1.yaml` 保持 `draft`。

项目架构不应与该计划强耦合。未来应允许新增其他训练计划，并通过统一的 `ProgramSpec` 接口供监督引擎使用。
