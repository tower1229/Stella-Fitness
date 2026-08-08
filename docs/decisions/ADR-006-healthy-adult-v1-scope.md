# ADR-006 — V1 Scope Is Healthy Adults, Not Medical/Rehab Care

**Status:** Accepted for v1 requirements  
**Date:** 2026-08-08

## Context

抗阻训练和增肌建议的适用性会被年龄、疾病、孕期、康复状态和医生限制显著改变。用一个普通 hypertrophy policy 覆盖所有人群会制造不可验证的安全风险。

## Decision

v1 默认 scope：

```text
age >= 18
healthy adult
supported hypertrophy/resistance-training program
general long-term supervision
not medical or rehabilitation care
```

特殊疾病、孕期、未成年人、术后/伤病康复、医生限制运动等场景不进入默认自动监督策略。

## Consequences

- onboarding 需要最少的 eligibility confirmation；
- 不能从姓名/照片推断健康或敏感属性；
- 特殊人群未来必须使用独立 evidence/policy version；
- 产品文案不能暗示医疗诊断或康复能力。

## References

- `product/applicability.md`
- `quality/safety-escalation.md`
- ACSM 2026 Position Stand
