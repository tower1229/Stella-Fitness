# 发布与安装契约

> 当前没有可安装 Plugin。

目标 package identity 为 `@tower1229/stella-fitness`，owner 为 `tower1229`。具体命令和最低兼容版本必须在实现与发布时按锁定 OpenClaw/ClawHub 版本验证。

## 首次使用

1. 安装并启用 Plugin；
2. 显式启用所需 conversation/media 权限；
3. 选择 operator 允许的训练日志 extraction model；
4. 显式配置 Personal Data Directory；
5. 选择 Built-in Program 或导入 ProgramSpec；
6. 建立 Program State；
7. 上传训练日志或记录体重。

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
