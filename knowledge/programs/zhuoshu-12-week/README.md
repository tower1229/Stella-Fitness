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

- [overview.md](./overview.md)：课程概览、器械、阶段与周期逻辑
- [nutrition.md](./nutrition.md)：原教程饮食方案
- [rules.md](./rules.md)：重量、力竭、恢复、加重与循环规则
- [phase-1-weeks-01-04.md](./phase-1-weeks-01-04.md)：第 1–4 周
- [phase-2-weeks-05-08.md](./phase-2-weeks-05-08.md)：第 5–8 周
- [phase-3-weeks-09-12.md](./phase-3-weeks-09-12.md)：第 9–12 周
- [warmup-and-recovery.md](./warmup-and-recovery.md)：统一热身与放松
- [program-spec.v0.1.yaml](./program-spec.v0.1.yaml)：机器可读计划草案

## 重要约束

### 不自行补齐资料

原资料中 **第 4 周周五训练明确缺失**。本知识包保留这一事实，不根据前后规律推测内容。

在该缺口被可靠原始资料补齐前：

- `ProgramSpec` 必须把这一训练日标记为 `unresolved`；
- Program Engine 不得把推测内容当成 canonical program；
- Agent 必须向用户说明资料缺失，而不是自动生成一个看似合理的训练日。

## 与 Stella Fitness 的关系

该计划是 Stella Fitness 的第一份 canonical program，但项目架构不应与该计划强耦合。未来应允许新增其他训练计划，并通过统一的 `ProgramSpec` 接口供监督引擎使用。
