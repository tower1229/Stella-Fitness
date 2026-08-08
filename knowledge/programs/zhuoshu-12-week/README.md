# 卓叔 12 周结构化增肌增重计划

> Stella Fitness 的首个训练计划知识包。

## 来源与状态

本目录由两份**可靠同源课程资料**重新组织而来：

1. 《卓叔增重 · 结构化增肌增重教程》；
2. 原课程配套三阶段训练情况记录 XLSX（用户已确认来自原作者或可靠同源版本）。

课程覆盖 12 周，分为三个阶段：

1. 第 1–4 周：力量积累，全身训练，每周 3 练；
2. 第 5–8 周：高效增肌，躯干/四肢分化，每周 4 练；
3. 第 9–12 周：全面显壮，继续分化训练并提高加重频率。

本目录的目标不是改写或优化原计划，而是把原资料转换为：

- 便于用户阅读和核对的 Markdown 文档；
- 便于未来 Program Engine 消费的结构化 `ProgramSpec`；
- 能显式追踪来源、冲突、解释问题和后续修订的版本化知识包。

## 文档结构

- [overview.md](./overview.md)：课程概览、器械与三阶段结构
- [nutrition.md](./nutrition.md)：原教程饮食方案
- [rules.md](./rules.md)：重量、力竭、恢复与加重规则
- [warmup-and-recovery.md](./warmup-and-recovery.md)：统一热身与放松
- [phase-1-weeks-01-04.md](./phase-1-weeks-01-04.md)：第 1–4 周（含已补齐的第 4 周周五力量测试）
- [phase-2-weeks-05-08.md](./phase-2-weeks-05-08.md)：第 5–8 周
- [phase-3-weeks-09-12.md](./phase-3-weeks-09-12.md)：第 9–12 周
- [cycle.md](./cycle.md)：12 周结束后的 12RM 重测与循环
- [open-questions.md](./open-questions.md)：仍需用户确认的课程语义关系
- [source-audit.md](./source-audit.md)：源资料完整性、未知项与发布风险审计
- [program-spec.v0.1.yaml](./program-spec.v0.1.yaml)：**历史草案**，生成于配套 XLSX 来源确认前

## 第 4 周周五已解决

早期结构化教程把第 4 周周五标记为“资料缺失”。原课程配套 XLSX 提供了缺失内容，且用户已确认其同源可靠性。

正式 source program 内容为：

```text
第4周，周五，力量测试

高脚杯深蹲：12RM 测试重量
哑铃卧推：12RM 测试重量
哑铃硬拉：12RM 测试重量
引体向上：第一组最大完成次数
```

因此**第 4 周周五不再是来源缺口**。

## ProgramSpec 当前状态

`program-spec.v0.1.yaml` 仍保留在仓库中用于追踪早期结构化工作，但其中 Week 4 Friday 的 `unresolved` 已被后续来源证据推翻。

Phase 0 当前不直接就地“猜着修”这一份旧草案，而采用以下顺序：

1. 先补齐 source Markdown；
2. 将所有仍影响 ProgramSpec 的问题集中到 `open-questions.md`；
3. 用户一次性确认；
4. 再生成/审定下一版 ProgramSpec，使 A/N/测试关系和动作命名同时收敛。

在下一版 ProgramSpec 生成前，**source Markdown + source audit 是当前训练计划内容的权威表示**。

## 不自行推断课程意图

已有同源资料能明确证明的内容直接记录；资料没有说明的关系保持 Unknown。

尤其不得自行推断：

- 第 4 周 12RM 与第 5 周 `N` 的映射；
- 引体向上测试值如何影响下一阶段；
- `A` 是否一定等于初始 12RM；
- “哑铃推举/哑铃推肩”是否同一动作；
- 第一阶段加重频率汇总冲突。

详见 [open-questions.md](./open-questions.md)。

## 忠实结构化不等于专业背书

原始教程末尾注明“部分内容可能由 AI 生成”。因此当前知识包完成的是对用户提供同源资料的忠实结构化，不自动代表训练科学、营养学或医疗层面的独立验证。

## 与 Stella Fitness 的关系

该计划是 Stella Fitness 的第一份 program package，但当前仍处于 Phase 0 来源审定阶段。

项目架构不应与该计划强耦合。未来应允许新增其他训练计划，并通过统一 ProgramSpec 接口供监督引擎使用。
