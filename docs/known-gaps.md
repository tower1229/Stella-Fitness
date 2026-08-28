# Known Gaps

## GAP-001：OpenClaw stable 兼容契约

**状态：CLOSED / REVERIFIED AGAINST LOCAL 2026.7.1-2**

2026-08-10 已以本机 OpenClaw extended-stable `2026.6.34` 建立最低兼容基线。2026-08-28 又以本机 `2026.7.1-2` SDK 完成 478 个 deterministic tests、package 验证，以及包含 13 次 Gateway restart 的 clean-install 验收。Package 声明最低兼容版本 `>=2026.6.34`，不使用精确版本白名单；运行时继续按实际能力 fail closed。

## GAP-002：ProgramSpec schema 与完整 fixture validator

**状态：IMPLEMENTATION TASK**

`program-spec.v0.2.yaml` 已完成来源交叉核对，但尚无可执行 schema validator。实现必须覆盖全部 12 周、phase transition、strength-test binding、recovery、exercise alias 和 next-cycle restart。

## GAP-003：真实手写日志 pilot

**状态：EXTRACTION MODEL SELECTION BLOCKED**

固定模板 benchmark 规范已存在。2026-08-13 已用 2 张经用户明确授权的真实填写照片建立本机私有 benchmark：2 个全页 crop-required 样本、5 个第一阶段常规训练裁切样本及人工确认 ground truth。图片、ground truth 和逐例输出均在 Git 忽略目录中，不属于仓库、安装包或公开 fixture。

当前 `codex/gpt-5.6-sol` 结果通过结构有效性、全页裁切判断、关键数字、空白保持、set 语义和 plan-leakage 检查，但 identity accuracy 为 95%，abstention precision/recall 为 31.25%/17.86%，且只覆盖 5 个要求布局中的 2 个，因此 live-model gate 仍失败。第二/三阶段、力量测试、成本和 Provider 条款证据仍缺失，默认 extraction model 继续保持 selection blocked。

确定性 CI 与 live-model gate 保持分离；本机私有 pilot 不进入 deterministic suite，也不构成公开发行或真实 Telegram E2E 证据。

## GAP-004：课程派生制品发行授权

**状态：RELEASE-BLOCKING / AUTHORIZATION PENDING**

公开源码仓库收录原始 DOCX/XLSX 的用户许可不等于安装包分发权。正式发行前必须取得覆盖具体运行时制品、原始训练日志 XLSX、修改、署名和目标渠道的可核验授权。原始 DOCX 与任意非白名单 Office 文件不进入安装包；内置训练日志 XLSX 必须匹配固定路径与 digest。

## GAP-005：ClawHub 实时发布权限

**状态：RELEASE-BLOCKING / LIVE CHECK PENDING**

canonical identity 为 `tower1229` / `@tower1229/stella-fitness`。首次发布前必须核验登录身份、owner 权限、名称可用性、package validation、dry-run 和 clean install。

release gate 还要求一次真实 Telegram channel smoke，且证据必须绑定待发布 artifact 的 package name、version 与 SHA-256；本地 Bot API test adapter 不能满足该 live gate。

## GAP-006：训练/营养监督专业审核

**状态：CLOSED / CAPABILITY REMOVED**

Stella Fitness 不再评价训练表现、推断原因、调整计划、分析饮食或提供营养建议，因此 Supervision/Nutrition Domain Review 不再适用，也不保留隐藏或默认关闭的监督分支。

## GAP-007：健康风险与 Safety Review

**状态：CLOSED / CAPABILITY REMOVED**

Stella Fitness 不识别、判断、分级或升级健康风险，不处理医疗、伤病或特殊人群适用性，因此 Safety Review 不再适用。用户独立承担训练决策并在需要时自行咨询专业人员。

## GAP-008：Privacy Review

**状态：CLOSED / PRODUCT OWNER APPROVED 2026-08-10**

Product Owner 已批准 Personal Data Directory、Runtime Directory、原件保真、净化媒体 payload、删除/重建、最小披露、无遥测及 Benchmark 独立授权边界。实现必须按已批准设计执行。

## GAP-009：软件与内容权利边界

**状态：CLOSED FOR IMPLEMENTATION / RELEASE GATE RETAINED**

Plugin 代码、通用 schema 和原创材料采用 Apache-2.0；课程内容和用户数据不在该许可范围内。该边界不阻止实现，GAP-004 继续阻止未经授权发行课程派生制品。

## 当前结论

不存在剩余的 Phase 0 `IMPLEMENTATION-BLOCKING` 审核项。OpenClaw stable contract kickoff 与 Plugin foundation 已完成；model selection 和 release blockers 按各自阶段保留。
