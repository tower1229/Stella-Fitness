# ADR-008 — No Unreviewed Numeric Intervention Thresholds

**Status:** Accepted for v1 requirements  
**Date:** 2026-08-08

## Context

外部文献可以支持“训练量重要”“蛋白足够重要”“单日体重噪声不应触发调整”等原则，但不能自动推出 Stella Fitness 应该使用的所有个体触发数字。

LLM 很容易把模糊证据包装成精确经验规则，例如“连续 7 天不涨就加 300 kcal”。这会产生伪专业确定性。

## Decision

生产 Policy 中任何会直接改变用户训练/饮食的 numeric threshold 必须具备：

```text
source/rationale
applicable population
reviewer approval
policy version
Golden Cases
```

未满足时，只允许：

```text
NO_CHANGE
OBSERVE
COLLECT_MORE_DATA
```

或使用已经批准的保守 fallback。

LLM 无权在运行时创造新的正式 threshold。

## Consequences

- Phase 0 不为 plateau window、minimum weigh-ins、diet coverage、kcal increment、load increment 等伪造数字；
- Evidence quality gate 与 trend calculation 应先于干预 policy；
- 未来数值政策必须版本化；
- 若专业审核无法完成，可通过缩小 v1 自动调整能力来发布，而不是降低证据要求。

## References

- `research/intervention-thresholds.md`
- `planning/review-governance.md`
- `quality/golden-cases.md`
