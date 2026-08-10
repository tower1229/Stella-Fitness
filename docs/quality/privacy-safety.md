# Privacy Boundary

**状态：APPROVED BY PRODUCT OWNER 2026-08-10**

## Storage

- Personal Data Directory 由用户显式配置，保存 raw artifacts、observations、corrections、program state 和 processing records；
- Runtime Directory 只保存临时文件与可重建状态；
- 未配置、不可读写或目录重叠时 fail closed；
- canonical 用户数据不得回退到 Runtime Directory。

## Media

- 原始上传在 Personal Data Directory 保持 byte-identical；
- OpenClaw media payload 使用 Runtime Directory 中的 Sanitized Media Copy；
- 先应用 orientation，再移除 EXIF、GPS、设备、软件和缩略图 metadata；
- 成功、失败、超时和取消均清理临时副本。

## Model payload

训练日志 Extractor 只接收当前 artifact、固定 layout context、必要 ProgramSpec 标识和 extraction schema。不得提交无关对话历史、其他训练记录、体重历史或个人仓库内容。

OpenClaw 管 Provider、凭据、endpoint、allowlist 和实际外发；Plugin 只调用 operator 已授权模型，并保存 runtime 实际返回的可用 execution metadata。

## User control

- 用户通过文件系统或 Personal Data Repository 查看、复制、备份和删除数据；
- Plugin 不静默删除用户文件；
- 文件缺失后重建，Runtime Directory 不恢复已删除数据；
- schema-invalid 手工编辑被隔离并报告；
- Personal Data Directory 本身是可移植制品，不另做 export command。

## Secondary use

Plugin 无遥测、自动数据贡献或 Benchmark 上传。真实用户数据进入研发 benchmark 必须通过 Plugin 外独立授权流程。

## Scope boundary

Plugin 不持久化或生成训练诊断、营养判断、健康风险、医疗结论、完整 prompt、Provider 自由文本 response 或隐藏推理。
