# 文档系统与项目结构

## 当前状态

Phase 0 已批准进入实现；仓库当前仍是需求、Program Source、质量和实施准备材料，尚无代码 scaffold。

## 资料分层

- `docs/requirements.md`：冻结产品需求与非目标；
- `docs/known-gaps.md`：分阶段缺口和 gate；
- `docs/architecture.md`：记录型 Plugin 目标架构；
- `docs/quality/`：Program、extraction、record lifecycle 与 privacy 验收；
- `knowledge/`：来源忠实的 Program Source 结构化；
- `sources/`：来源登记与原始审计材料；
- `docs/decisions/`：当前及被取代的 ADR。

外部研究不得改写 Program Source。被 ADR-024 移出的监督、营养和健康风险能力不得从 superseded ADR 恢复。

## 实施目标结构

目标结构以 `docs/architecture.md` 为准，重点包括 Plugin/config、Program validator/engine、Observation/correction、media sanitizer、Personal Data storage 和 recording reply。

不创建 diagnosis、nutrition、safety、policy 或 scheduler 模块。

## 变更纪律

1. 需求变更同步 requirements、traceability 和 Golden Cases；
2. 硬边界变化记录 ADR；
3. 未解决问题进入 known-gaps；
4. Program Source 修改必须带来源依据；
5. 平台事实在 kickoff/release live revalidation；
6. 实现不得静默扩大产品范围。
