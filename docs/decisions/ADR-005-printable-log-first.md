# ADR-005 — Existing Printable Log First

**Status:** Accepted for v1 requirements  
**Date:** 2026-08-08

## Context

用户训练过程中不适合持续操作手机。完全自由格式纸质日志虽然灵活，但会显著增加图片结构化的不确定性。

Phase 0 最初计划由 `ProgramSpec` 自动生成一套新的 printable sheet。随后用户提供了一份已经覆盖三个训练阶段的 XLSX 训练情况记录模板。该模板已经采用固定 week/day/action 布局，并留出实际重量、最多六组结果、动作质量和问题备注字段。

重新设计一套新表并不会明显提高用户体验，反而会引入不必要的产品与实现成本。

## Decision

Stella Fitness v1 的推荐主路径改为：

```text
existing three-stage workout-log workbook
→ print relevant sheet/pages
→ user records actual data on paper
→ post-workout photo upload
→ structured extraction
```

**首版优先复用用户提供的现成模板。**

`ProgramSpec → generated printable sheet` 保留为未来扩展能力，用于：

- 新增其他训练 program；
- 校验现有模板；
- 用户需要自定义计划时生成对应记录表。

但它不再是 v1 默认训练日志体验的前置条件。

自由格式纸质日志仍作为兼容/扩展能力，不要求在 v1 达到与固定模板相同的识别可靠性。

## Consequences

- 训练过程继续保持 offline-first；
- 无需为了 AI 重做用户已习惯的训练表；
- extraction 可以利用稳定的三阶段 layout；
- benchmark 可直接围绕真实模板设计，而不是围绕假想模板；
- `重量` 字段必须支持 kg、弹力带辅助、俯卧撑姿势等多态值；
- `第 x 组` 字段要根据动作解释为 reps 或 duration；
- 必须支持第 4 周周五特殊力量测试块；
- 模板文件的公开再分发权需与教程版权独立确认。

## References

- `product/training-log-template.md`
- `product/printable-log.md`
- `quality/training-log-benchmark.md`
