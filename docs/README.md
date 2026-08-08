# Stella Fitness 文档索引

本目录是 Stella Fitness 的 **Phase 0：Requirements & Research** 单一入口。

## 文档权威层级

发生冲突时按以下优先级处理：

1. **`requirements.md`**：冻结产品需求与非目标；
2. **`known-gaps.md`**：所有尚未解决的事实、策略、许可和发布问题；
3. **`product/`**：用户流程与产品决策语义；
4. **`architecture.md`**：目标技术架构，仅描述实施目标；
5. **`research/`**：外部调研基线，可随外部平台与研究更新；
6. **`quality/`**：安全、隐私、Benchmark 与 Eval 要求；
7. **`planning/`**：依赖、review governance、Phase 0 退出条件及未来实施交接；
8. **`decisions/`**：已经接受的关键架构/产品决策；
9. **`knowledge/`**：源教程的忠实结构化，不应被外部研究静默改写。

若外部研究与源教程有分歧，应在 `research/` 中记录差异，而不是直接修改 `knowledge/`。

## 核心需求

- [requirements.md](./requirements.md) — 冻结需求
- [requirements-traceability.md](./requirements-traceability.md) — 需求 → 设计 → 证据 → 验收追踪
- [known-gaps.md](./known-gaps.md) — 未解决事项与阻塞项
- [program-spec.md](./program-spec.md) — ProgramSpec 设计语义

## 产品

- [product/user-flows.md](./product/user-flows.md) — 用户输入与监督流程
- [product/decision-policy.md](./product/decision-policy.md) — NO_CHANGE / OBSERVE / ADJUST 等决策语义
- [product/printable-log.md](./product/printable-log.md) — offline-first 可打印训练日志要求
- [product/applicability.md](./product/applicability.md) — v1 默认适用人群与排除边界

## 目标架构

- [architecture.md](./architecture.md) — OpenClaw Plugin 目标架构
- [document-system.md](./document-system.md) — 当前与未来目录结构

> `architecture.md` 是**设计文档，不代表当前已有实现**。

## Research

- [research/openclaw-platform.md](./research/openclaw-platform.md) — Plugin hooks、isolated runtime、media、Cron
- [research/clawhub-publishing.md](./research/clawhub-publishing.md) — 未来发布与安装要求
- [research/anti-sycophancy.md](./research/anti-sycophancy.md) — 迎合偏差与工程约束
- [research/model-strategy.md](./research/model-strategy.md) — 模型角色、候选与选择方法
- [research/domain-evidence.md](./research/domain-evidence.md) — 运动科学/营养外部证据
- [research/intervention-thresholds.md](./research/intervention-thresholds.md) — 可冻结原则与不可伪造的个体阈值边界
- [research/food-image-estimation.md](./research/food-image-estimation.md) — 食物照片营养估算能力边界
- [research/nutrition-data-sources.md](./research/nutrition-data-sources.md) — 中国食物成分表、USDA、标签与个人餐食库的来源优先级

## Quality & Safety

- [quality/evaluation-plan.md](./quality/evaluation-plan.md) — 系统级 Eval 设计
- [quality/golden-cases.md](./quality/golden-cases.md) — 实施前行为真值案例目录
- [quality/training-log-benchmark.md](./quality/training-log-benchmark.md) — 纸质训练日志图像 Benchmark 规范
- [quality/diet-benchmark.md](./quality/diet-benchmark.md) — 饮食证据与食物照片 Benchmark 规范
- [quality/privacy-safety.md](./quality/privacy-safety.md) — Provider 隐私与健康安全总原则
- [quality/data-lifecycle.md](./quality/data-lifecycle.md) — 原图、事实、派生数据与模型运行记录生命周期
- [quality/safety-escalation.md](./quality/safety-escalation.md) — 明确红旗症状与 ESCALATE 行为优先级

## Planning & Review

- [planning/dependencies.md](./planning/dependencies.md) — 外部依赖与替换策略
- [planning/review-governance.md](./planning/review-governance.md) — Product / Domain / Safety / Privacy / Platform / Rights reviewer 职责
- [planning/implementation-handoff.md](./planning/implementation-handoff.md) — 实施前交接清单
- [planning/phase0-exit-review.md](./planning/phase0-exit-review.md) — 正式开工许可 Review Checklist
- [roadmap.md](./roadmap.md) — 阶段路线图

## Decisions

- [ADR-001 — Native Plugin](./decisions/ADR-001-native-plugin.md)
- [ADR-002 — Evidence Isolation](./decisions/ADR-002-evidence-isolation.md)
- [ADR-003 — Provider-neutral Models](./decisions/ADR-003-provider-neutral-models.md)
- [ADR-004 — Food Photo Is Estimate Only](./decisions/ADR-004-food-photo-estimate-only.md)
- [ADR-005 — Official Printable Log First](./decisions/ADR-005-printable-log-first.md)
- [ADR-006 — Healthy Adult V1 Scope](./decisions/ADR-006-healthy-adult-v1-scope.md)
- [ADR-007 — Nutrition Evidence Hierarchy](./decisions/ADR-007-nutrition-evidence-hierarchy.md)
- [ADR-008 — No Unreviewed Numeric Thresholds](./decisions/ADR-008-no-unreviewed-numeric-thresholds.md)

## Knowledge

首个 program：

- [../knowledge/programs/zhuoshu-12-week/README.md](../knowledge/programs/zhuoshu-12-week/README.md)
- [../knowledge/programs/zhuoshu-12-week/source-audit.md](../knowledge/programs/zhuoshu-12-week/source-audit.md)

## Sources

- [../sources/README.md](../sources/README.md)
- [../sources/source-register.md](../sources/source-register.md)

## 开工规则

**Phase 0 未通过 `planning/phase0-exit-review.md` 前，不创建 `src/`、Plugin manifest、package scaffold 或可执行实现。**

所有会变化的外部信息应记录 `checked_at` 或明确“实施时必须重新验证”，避免把 2026-08 的平台状态永久写死为事实。