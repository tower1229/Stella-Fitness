# ADR-005 — Official Printable Log First

**Status:** Accepted for v1 requirements  
**Date:** 2026-08-08

## Context

用户训练过程中不适合持续操作手机。完全自由格式纸质日志虽然灵活，但会显著增加图片结构化的不确定性。

## Decision

Stella Fitness v1 推荐的主路径为：

```text
ProgramSpec
→ generate print-friendly session sheet
→ user records actual data on paper
→ post-workout photo upload
→ structured extraction
```

官方模板应预填计划目标，并把 actual load/reps 留给用户填写。

自由格式纸质日志作为兼容/扩展能力，不作为 v1 默认体验必须达到同等准确率的前置条件。

## Consequences

- 训练过程保持 offline-first；
- 用户录入负担更低；
- extraction 可以利用稳定 layout；
- 必须专门测试 Target 与 Actual 混淆；
- printable template 本身成为产品资产，而不是文档附件。

## References

- `product/printable-log.md`
- `quality/training-log-benchmark.md`
