# OpenClaw 平台能力调研

**状态：RESEARCH SNAPSHOT / REVALIDATE AT KICKOFF**

当前架构依赖以下 OpenClaw 能力：

## Conversation hooks

Plugin 需要在默认 Agent 回复前认领训练记录输入并返回 synthetic status、confirmation 或 recording reply。non-bundled Plugin 的 conversation access 必须由 operator 显式允许。

## Structured media extraction

Plugin 需要向 media runtime 提交 Sanitized Media Copy、instructions 和 JSON schema，并获得结构化候选字段。实现必须验证图片输入、schema output、timeout、cancellation 和错误语义。

## Model permission

operator 管理 provider/model、credentials、endpoint 和 allowlist。Plugin 只能引用获准的 extraction model，不自行绕过或创建第二套 Provider 配置。

## Execution metadata

实现需核验 runtime 实际返回哪些 provider/model/operation 元数据。Processing Record 只能保存可观察事实，不推断网络层行为。

## Plugin package

kickoff 必须验证 manifest、Node/runtime compatibility、install、enable、load、status 和 clean environment 行为。

## 不再依赖

v1 不依赖 isolated diagnosis runtime、multi-model audit、Cron supervision 或 safety classifier。历史调研不能被用来恢复这些已删除能力。
