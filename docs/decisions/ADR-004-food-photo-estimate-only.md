# ADR-004：食物照片只作为估算证据

**Status: Accepted**

## Context

现有研究显示通用 VLM 对菜品识别有实用价值，但 portion/nutrient 定量仍有明显误差，蛋白质估计尤其不稳定。

## Decision

photo-only 数据：

- 输出 range + confidence；
- evidence grade 低于称重/标签/固定食谱；
- 不显示虚假小数精度；
- 不单独触发高置信 `ADJUST_DIET`；
- 优先用最小澄清和营养数据库 grounding 提升质量。

## Consequence

产品不承诺“拍照精准算宏量营养素”，而是将照片用于降低记录摩擦与辅助趋势判断。