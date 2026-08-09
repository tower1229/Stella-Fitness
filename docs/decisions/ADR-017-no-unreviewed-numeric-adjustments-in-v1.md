# ADR-017 — V1 Does Not Perform Unreviewed Numeric Adjustments

**Status:** Accepted for v1 scope  
**Date:** 2026-08-09

在专业 numeric intervention Policy 尚未签署前，v1 只执行 Built-in Program 中已经确认的计划处方与绑定规则，并提供趋势计算、`NO_CHANGE`、`OBSERVE`、`COLLECT_MORE_DATA` 和安全 `ESCALATE`。Plugin 可以指出偏离、可能原因和证据不足，但不得新增具体 kcal、负重、组数、减量比例、采样窗口或 plateau 天数，也不启用监督性 `ADJUST_DIET`、`ADJUST_TRAINING` 或 `RECOVERY`。ProgramSpec 原有计划进阶和计划恢复不属于监督模型创造的新干预，继续确定性执行。未来只有经过 Domain Review、版本化和 Golden Cases 验证的 Policy 才能扩展这些行动。
