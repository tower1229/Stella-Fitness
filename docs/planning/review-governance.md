# Review Governance

## Product Review

Product Owner 批准产品定位、非目标、用户流程、事实语义和 scope regression cases。当前记录型 v1 已批准。

## Privacy Review

负责 Personal Data Directory、Runtime Directory、原件保真、模型 payload、删除/重建、遥测和 Benchmark 二次使用边界。Product Owner `tower1229` 已于 2026-08-10 批准当前设计；实现变更这些边界时必须重新 review。

## Platform Review

implementation kickoff 按本机 OpenClaw stable 基线核验 hooks、permissions、media runtime、execution metadata、timeout/cancellation 和 packaging。平台契约具有时效性，旧 research snapshot 不能替代 live validation；兼容判断采用最低版本声明与能力预检，不采用精确版本白名单。

## Source / Rights Review

负责课程派生、修改、署名、目标发行渠道和 package contents。该 review 阻止公开发行，不阻止内部实现和 source fixture validation。

## Extraction Model Review

默认模型必须通过真实手写训练日志 benchmark，包括 critical numeric accuracy、blank preservation、semantic classification、abstention、latency、cost 和候选 Provider 条款核验。

## 不适用的 reviewer

Supervision/Nutrition Domain 和 Safety Reviewer 不再是项目角色，因为对应能力已由 ADR-024 删除。来源计划忠实性审核不等于训练专业背书，Stella Fitness 不作这种背书。

## Review record

```text
artifact
version
reviewer_role
reviewer_identity/reference
review_date
scope
status
notes
```

## Gate mapping

| Gate | Evidence | Effect while pending |
|---|---|---|
| `REVALIDATE_AT_KICKOFF` | verified OpenClaw stable baseline | 对应集成能力不得继续实现 |
| `MODEL-SELECTION-BLOCKED` | real pilot + ground truth + provider terms | 不得冻结默认 extraction model |
| `RELEASE-BLOCKING` | content rights + package inspection + live permission | 不得公开发行 |
