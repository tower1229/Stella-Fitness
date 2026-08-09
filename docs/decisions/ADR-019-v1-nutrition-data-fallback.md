# ADR-019 — V1 Nutrition Data Fallback

**Status:** Accepted  
**Date:** 2026-08-09

## Decision

Stella Fitness v1 does not require a China Food Composition provider. The evidence order is:

1. product/manufacturer nutrition label;
2. user-confirmed weighed recipe or personal meal profile;
3. USDA FoodData Central for generic food reference;
4. restaurant-published nutrition data;
5. image-only range estimate;
6. unknown / request more data.

Chinese mixed dishes that cannot be reliably mapped must remain low-confidence ranges and cannot independently trigger an automatic adjustment. This is consistent with the v1 action allowlist in ADR-017.

The public `Sanotsu/china-food-composition-data` repository is not a v1 provider or package dependency. It has no explicit reuse license, states that copyright belongs to the original authors, derives JSON from screenshots/OCR of《中国食物成分表（标准版第6版）》, disclaims recognition accuracy, and has documented missing-data corrections. Public GitHub availability is not treated as permission to copy, cache, modify, or redistribute it.

## Reconsideration conditions

A China Food Composition provider may be added in a later version only when all of the following are available:

- verifiable authorization from the relevant underlying data rights holder for the intended digital use and distribution channel;
- an explicit license for any third-party extraction code or curated structure used;
- a pinned data version, provenance, field semantics, and independent quality evaluation;
- provider-level failure, confidence, and replacement behavior.

## Consequences

- Lack of licensed Chinese food-composition data no longer blocks v1 implementation.
- Strong Chinese-food coverage remains a known quality limitation, not a claimed capability.
- `NutritionDataProvider` remains replaceable; no third-party repository is hard-coded or downloaded by default.
