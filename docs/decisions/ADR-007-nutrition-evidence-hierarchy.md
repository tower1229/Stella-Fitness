# ADR-007 — Nutrition Uses an Evidence Hierarchy, Not Vision as Ground Truth

**Status:** Accepted for v1 requirements  
**Date:** 2026-08-08

## Context

单张食物照片对食物识别有价值，但份量和宏量营养估算误差明显。如果把视觉模型输出直接当 intake ground truth，会污染长期归因。

## Decision

Nutrition evidence 默认优先级：

```text
1. Product nutrition label / manufacturer data
2. User-confirmed weighed recipe or fixed personal meal
3. Authoritative food-composition DB + known portion
4. Restaurant published nutrition
5. Image-only estimate
6. Unknown
```

任何 Nutrition Observation 必须保存 `source_type` 与 confidence/range。

## Consequences

- photo-only evidence 不能独立触发高置信饮食调整；
- NutritionDataProvider 必须可替换；
- 中国食物成分数据与 USDA 可同时存在，不把单一数据库当全球真相；
- 用户长期确认的 Personal Meal Library 是关键私人 Agent 能力；
- Benchmark 必须测试 source-selection accuracy，而不只是 macro error。

## References

- `research/nutrition-data-sources.md`
- `research/food-image-estimation.md`
- `quality/diet-benchmark.md`
