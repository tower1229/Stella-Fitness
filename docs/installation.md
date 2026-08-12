# 发布与安装契约

目标 package identity 为 `@tower1229/stella-fitness`，owner 为 `tower1229`。当前开发与最低兼容基线为本机 OpenClaw extended-stable `2026.6.34`，package 接受 `>=2026.6.34`；发布前仍须按届时 stable OpenClaw/ClawHub 实机复验。

## 首次使用

1. 安装并启用 Plugin；
2. 显式启用所需 conversation/media 权限；
3. 选择 operator 允许的训练日志 extraction model；
4. 显式配置 Personal Data Directory；
5. 运行 `/stella-start` 并批准当前 conversation binding；
6. Plugin 自动验证并使用唯一的卓叔 12 周 Built-in Program；
7. 运行 `/stella-print` 获取完整 12 周内置 XLSX 并打印所需页面；
8. 逐项确认可拆卸哑铃、引体向上杆、打印训练日志和训练记录协议；
9. 按唯一下一步记录 baseline、三个初始 12RM，并确认星期一 cycle start。

首次使用不提供计划选择器、ProgramSpec 导入或文件路径输入。`/stella-status` 独立报告 Personal Data Directory、conversation、media 和 model permission；Program Journey Status 只报告训练前准备与当前唯一下一步。

onboarding 不要求健康档案、营养目标或监督策略配置。

## 发布验收

- manifest、config schema 与 compatibility metadata；
- validate/dry-run；
- clean install、enable、load、原地幂等 upgrade、disable/enable、clean process restart、Runtime Directory 删除重建与 uninstall；
- configuration preflight；
- ProgramSpec validation；
- workout photo → confirmation → Observation 流程；
- Personal/Runtime directory 边界和媒体净化；
- package 不含 raw DOCX、其他 Office/PDF、用户数据、benchmark、pilot 或未授权内容；内置 XLSX 必须匹配白名单路径、20,964 bytes 与固定 digest；
- release gate 要求真实 Telegram Adapter smoke 证据匹配待发布 package 的 name、version 与 artifact SHA-256；本地 Bot API adapter 只用于 deterministic clean-install，不冒充 live smoke；
- `today/week/phase` PDF、A4 render 与 Personal Data Directory 派生打印文件不属于运行时或测试契约；
- privacy、数据目录和 Provider permission 说明；
- 课程派生制品授权与 required notice。

## 禁止声明

不得把产品描述为 AI 私教、训练监督、营养识别、健康风险筛查或医疗能力。

在 #3 获得真实填写训练日志照片、人工 ground truth 与 live provider 结果前，不得宣称固定 layout 数字准确率或裁剪 abstention 已完成。
