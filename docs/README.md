# Stella Fitness 文档索引

本目录是 Stella Fitness 的 **Phase 0：Requirements & Research** 单一入口。

## 文档权威层级

发生冲突时按以下优先级处理：

1. `requirements.md`：冻结产品需求与非目标；
2. `known-gaps.md`：尚未解决的事实、策略、许可和发布问题；
3. `product/`：用户流程与产品决策语义；
4. `architecture.md`：目标技术架构；
5. `research/`：外部调研基线；
6. `quality/`：安全、隐私、Benchmark 与 Eval；
7. `planning/`：依赖、review governance 与 Phase 0 退出条件；
8. `decisions/`：已接受 ADR；
9. `knowledge/`：源教程与可靠同源配套资料的忠实结构化。

外部研究不得静默改写 source program。

## 核心需求

- [requirements.md](./requirements.md)
- [requirements-traceability.md](./requirements-traceability.md)
- [known-gaps.md](./known-gaps.md)
- [program-spec.md](./program-spec.md) — 当前设计已演进到 source-reconciled v0.2 草案

## 产品

- [product/user-flows.md](./product/user-flows.md)
- [product/decision-policy.md](./product/decision-policy.md)
- [product/training-log-template.md](./product/training-log-template.md) — 原课程三阶段 XLSX 字段/语义
- [product/printable-log.md](./product/printable-log.md)
- [product/applicability.md](./product/applicability.md)

## Research

- [research/openclaw-platform.md](./research/openclaw-platform.md)
- [research/clawhub-publishing.md](./research/clawhub-publishing.md)
- [research/anti-sycophancy.md](./research/anti-sycophancy.md)
- [research/model-strategy.md](./research/model-strategy.md)
- [research/domain-evidence.md](./research/domain-evidence.md)
- [research/intervention-thresholds.md](./research/intervention-thresholds.md)
- [research/food-image-estimation.md](./research/food-image-estimation.md)
- [research/nutrition-data-sources.md](./research/nutrition-data-sources.md)

## Quality & Safety

- [quality/evaluation-plan.md](./quality/evaluation-plan.md)
- [quality/golden-cases.md](./quality/golden-cases.md)
- [quality/training-log-benchmark.md](./quality/training-log-benchmark.md)
- [quality/training-log-template-benchmark.md](./quality/training-log-template-benchmark.md)
- [quality/diet-benchmark.md](./quality/diet-benchmark.md)
- [quality/privacy-safety.md](./quality/privacy-safety.md)
- [quality/data-lifecycle.md](./quality/data-lifecycle.md)
- [quality/safety-escalation.md](./quality/safety-escalation.md)

## Planning & Review

- [planning/dependencies.md](./planning/dependencies.md)
- [planning/review-governance.md](./planning/review-governance.md)
- [planning/implementation-handoff.md](./planning/implementation-handoff.md)
- [planning/phase0-exit-review.md](./planning/phase0-exit-review.md)
- [roadmap.md](./roadmap.md)

## Source Program

- [知识包总览](../knowledge/programs/zhuoshu-12-week/README.md)
- [ProgramSpec v0.2](../knowledge/programs/zhuoshu-12-week/program-spec.v0.2.yaml) — 当前 source-reconciled draft
- [ProgramSpec v0.1](../knowledge/programs/zhuoshu-12-week/program-spec.v0.1.yaml) — 历史草案
- [源资料审计](../knowledge/programs/zhuoshu-12-week/source-audit.md)
- [课程语义确认记录](../knowledge/programs/zhuoshu-12-week/open-questions.md) — Q1–Q6 已全部关闭

当前训练计划来源语义已经明确：`A` 为各主项初始 12RM，第 4 周新 12RM 分别绑定 `N`，引体测试用于辅助带选择，“哑铃推举/推肩”统一为哑铃推肩，第一阶段以详细逐周计划为准。

最终 source cross-check 已完成，目前没有新的已知训练计划语义问题。未来若新版本原件产生新歧义，按项目规则集中向用户确认，不自行补全。

## Sources

- [../sources/README.md](../sources/README.md)
- [../sources/source-register.md](../sources/source-register.md)
- [../sources/training-log-template-audit.md](../sources/training-log-template-audit.md)

## 开工规则

Phase 0 未通过 `planning/phase0-exit-review.md` 前，不创建 `src/`、Plugin manifest、package scaffold 或可执行实现。
