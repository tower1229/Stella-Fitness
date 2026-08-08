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
- [program-spec.md](./program-spec.md)

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

- [../knowledge/programs/zhuoshu-12-week/README.md](../knowledge/programs/zhuoshu-12-week/README.md)
- [../knowledge/programs/zhuoshu-12-week/source-audit.md](../knowledge/programs/zhuoshu-12-week/source-audit.md)
- [../knowledge/programs/zhuoshu-12-week/open-questions.md](../knowledge/programs/zhuoshu-12-week/open-questions.md) — 需要用户集中确认的课程关系语义

**第 4 周周五已由可靠同源配套 XLSX 补齐为力量测试，不再属于 source gap。**

## Sources

- [../sources/README.md](../sources/README.md)
- [../sources/source-register.md](../sources/source-register.md)
- [../sources/training-log-template-audit.md](../sources/training-log-template-audit.md)

## 开工规则

Phase 0 未通过 `planning/phase0-exit-review.md` 前，不创建 `src/`、Plugin manifest、package scaffold 或可执行实现。
