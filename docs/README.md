# Stella Fitness 文档索引

## 权威层级

发生冲突时按以下优先级处理：

1. [requirements.md](./requirements.md)：冻结需求与非目标；
2. [known-gaps.md](./known-gaps.md)：当前事实缺口和阶段门禁；
3. `product/`：用户流程与模板语义；
4. [architecture.md](./architecture.md)：目标技术架构；
5. `quality/`：记录准确性、隐私与生命周期验收；
6. `planning/`：实施交接、review 和 release gate；
7. `decisions/`：当前及历史 ADR；
8. `knowledge/`：Program Source 的来源忠实结构化。

外部研究不得静默改写 Program Source。被 ADR-024 移出范围的监督、营养和健康风险能力不得从历史 ADR 恢复。

## 核心入口

- [冻结需求](./requirements.md)
- [需求追踪矩阵](./requirements-traceability.md)
- [目标架构](./architecture.md)
- [路线图](./roadmap.md)
- [已知缺口](./known-gaps.md)
- [Phase 0 Exit Review](./planning/phase0-exit-review.md)

## 产品与计划

- [用户流程](./product/user-flows.md)
- [训练日志模板](./product/training-log-template.md)
- [打印日志边界](./product/printable-log.md)
- [ProgramSpec 设计](./program-spec.md)

## Quality & Privacy

- [Evaluation Plan](./quality/evaluation-plan.md)
- [Golden Cases](./quality/golden-cases.md)
- [Training Log Benchmark](./quality/training-log-benchmark.md)
- [Supplied Template Benchmark](./quality/training-log-template-benchmark.md)
- [Privacy](./quality/privacy-safety.md)
- [Data Lifecycle](./quality/data-lifecycle.md)

## Planning

- [Dependencies](./planning/dependencies.md)
- [Implementation Handoff](./planning/implementation-handoff.md)
- [Review Governance](./planning/review-governance.md)

## Source Program

- [知识包总览](../knowledge/programs/zhuoshu-12-week/README.md)
- [ProgramSpec v0.2](../knowledge/programs/zhuoshu-12-week/program-spec.v0.2.yaml)
- [源资料审计](../knowledge/programs/zhuoshu-12-week/source-audit.md)
- [课程语义确认记录](../knowledge/programs/zhuoshu-12-week/open-questions.md)

ProgramSpec v0.2 已完成 source reconciliation。它是计划事实 fixture，不是专业背书。

## 当前状态

Phase 0 已批准进入实现。OpenClaw stable 最低兼容基线、可安装 Plugin 与 scenario harness 已建立；当前以本机 extended-stable `2026.6.34` 开发并接受 `>=2026.6.34`。课程派生内容授权继续阻止公开发行，但不阻止内部实现。
