# 未来发布与安装契约

> **Phase 0 状态：当前没有可安装 Plugin。**

本文只记录未来产品进入 ClawHub 发布阶段时需要满足的用户体验与兼容性要求，不是现在的安装指南。

## 目标

最终用户应能通过 OpenClaw 支持的 ClawHub package source 安装 Stella Fitness，而不需要克隆源码或手工复制文件。

具体 package scope、命令和最低兼容版本必须在发布前按当时 OpenClaw/ClawHub 官方文档重新验证，当前不冻结假包名。

## 未来发布必须具备

- Native Plugin `openclaw.plugin.json`；
- package 中的 OpenClaw compatibility/build metadata；
- 明确的 Plugin config schema；
- ClawHub owner 与 package scope 一致；
- `clawhub package validate` 通过；
- `clawhub package publish ... --dry-run` 通过；
- 真实 OpenClaw 安装、启用、升级、禁用、卸载流程验证；
- Provider 配置和权限说明；
- 数据目录、备份、删除和迁移说明；
- 隐私与安全声明；
- 模型成本与可替换方案；
- 版本兼容矩阵。

## 首次使用体验要求

未来 onboarding 不应要求用户理解内部多模型 pipeline。用户只需要完成：

1. 安装 Plugin；
2. 启用必要的 OpenClaw conversation hook 权限；
3. 选择/确认可用模型与隐私配置；
4. 选择训练 program 或导入自己的计划；
5. 建立最小个人档案；
6. 开始上传训练日志/体重。

如果内置训练教程无法获得再发布许可，则安装包不得偷偷携带该教程，onboarding 应改成“用户本地导入 program”。

## 发布前禁止事项

- 不使用未经确认的 ClawHub owner 预占正式包名；
- 不把 research snapshot 当作长期兼容保证；
- 不把包含身体数据的示例真实数据打进 package；
- 不默认启用会把用户数据发送到未经选择的外部 Provider；
- 不在未完成 Eval 时宣称“专业 AI 健身教练”或“医学级营养识别”。

详见 [research/clawhub-publishing.md](./research/clawhub-publishing.md)。