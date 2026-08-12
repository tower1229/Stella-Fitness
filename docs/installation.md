# 发布与安装契约

目标 package identity 为 `@tower1229/stella-fitness`，owner 为 `tower1229`。当前开发与最低兼容基线为本机 OpenClaw extended-stable `2026.6.34`，package 接受 `>=2026.6.34`；发布前仍须按届时 stable OpenClaw/ClawHub 实机复验。

## 首次使用

1. 安装并启用 Plugin；
2. 显式启用所需 conversation/media 权限；
3. 选择 operator 允许的训练日志 extraction model；
4. 显式配置 Personal Data Directory；
5. 运行 `/stella-start` 并批准当前 conversation binding；
6. Plugin 自动验证并使用唯一的卓叔 12 周 Built-in Program；
7. 逐项确认可拆卸哑铃、引体向上杆、打印训练日志和训练记录协议；
8. 按唯一下一步记录 baseline、三个初始 12RM，并确认星期一 cycle start。

首次使用不提供计划选择器、ProgramSpec 导入或文件路径输入。`/stella-status` 独立报告 Personal Data Directory、conversation、media 和 model permission；Program Journey Status 只报告训练前准备与当前唯一下一步。

onboarding 不要求健康档案、营养目标或监督策略配置。

## 发布验收

- manifest、config schema 与 compatibility metadata；
- validate/dry-run；
- clean install、enable、load、upgrade、disable、uninstall；
- configuration preflight；
- ProgramSpec validation；
- workout photo → confirmation → Observation 流程；
- Personal/Runtime directory 边界和媒体净化；
- package 不含 raw DOCX/XLSX、用户数据、pilot 或未授权内容；
- privacy、数据目录和 Provider permission 说明；
- 课程派生制品授权与 required notice。

## 禁止声明

不得把产品描述为 AI 私教、训练监督、营养识别、健康风险筛查或医疗能力。
