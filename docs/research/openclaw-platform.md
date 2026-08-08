# OpenClaw 平台能力调研

**状态：RESEARCH_BASELINE**  
**checked_at：2026-08-08**

目标：验证 Stella Fitness 的信息隔离与长期监督架构是否能由 OpenClaw Native Plugin 完整实现。

## 1. Conversation hooks

OpenClaw 官方 Plugin hooks 文档列出：

- `before_prompt_build`：增加上下文或收窄工具面；
- `before_agent_run`：模型提交前检查最终 prompt/session messages，并可阻止 run；
- `before_agent_reply`：使用 synthetic reply 或 silence 直接跳过普通模型轮次；
- `before_agent_finalize`：自然回复进入最终输出前可要求一次额外 revision。

`before_agent_run` 位于任何模型读取输入之前，因此可作为 fail-closed 保险；`before_agent_reply` 可用于由 Plugin 完整接管 Stella Fitness 领域 turn。

非 bundled Plugin 使用原始 conversation hooks 需要 operator 显式开启 `plugins.entries.<id>.hooks.allowConversationAccess: true`。

**设计结论：** 目标架构不需要假装在一个已看过全部上下文的模型里“忘掉”用户观点；Plugin 可以在模型读取前改变控制流。

## 2. Isolated model runtime

`api.runtime.llm.complete()` 支持：

```text
execution.mode = isolated-agent-runtime
```

官方定义的重要语义：

- exactly one user message；
- fresh context；
- zero model-callable tools；
- 不回退到 direct provider transport；
- runtime 不支持时在 inference 前失败。

**设计结论：** Blind Diagnostician 可以只收到白名单 `EvidencePacket`。这比 prompt 里的“忽略用户观点”更接近真正的信息边界。

## 3. Model policy

OpenClaw 对 Plugin model override 有 operator opt-in：

- `allowModelOverride`
- `allowedModels`
- `allowedCompletionModels`
- auth profile / agent override 也有独立授权。

**需求：** Stella Fitness 未来应把允许参与监督的模型做成显式 operator policy，而不是让聊天 Agent 临时自由选择。

## 4. Structured media extraction

Plugin runtime 提供 `api.runtime.mediaUnderstanding.extractStructuredWithModel()`：

- 指定 provider/model；
- 图像 + 辅助文本；
- instructions；
- schema name；
- JSON Schema。

**设计结论：** 训练日志图片可以优先使用 OpenClaw host-owned media runtime，不必在需求阶段先绑定第三方 OCR SDK。但“能调用”不等于“手写训练日志识别可靠”，必须用真实样本 benchmark。

## 5. Cron / Automations

OpenClaw Cron 支持纯 command 任务；command 输出只有 `NO_REPLY` 时不会发回聊天。

**设计结论：** 周期监督可采用：

```text
cheap deterministic metrics
      ↓
no anomaly → NO_REPLY
      ↓ anomaly/evidence ready
invoke diagnosis pipeline
```

这样能同时实现默认静默与模型成本控制。

## 6. Plugin manifest / build contract

未来 Native Plugin 需要 `openclaw.plugin.json`，其中包含 `id` 和 `configSchema`；当前官方 build guide 使用 TypeScript ESM，并列出 Node 22.22.3+、24.15+ 或 25.9+ 等兼容条件。

这些是**实施时依赖快照**，Phase 0 不创建 manifest/package，也不提前锁定 Node 版本。实施开始当天应重新核验。

## 7. 风险

- conversation hook 权限属于敏感能力，需要透明安装说明；
- hook timeout 不等于 cancellation，耗时模型 pipeline 必须自行处理取消与幂等；
- OpenClaw API 仍会演进，设计应通过适配层隔离；
- 不应直接依赖 OpenClaw 内部 session/storage schema 作为长期业务数据库合同。

## Sources

- https://docs.openclaw.ai/plugins/hooks
- https://docs.openclaw.ai/plugins/sdk-runtime
- https://docs.openclaw.ai/plugins/manifest
- https://docs.openclaw.ai/plugins/building-plugins
- https://docs.openclaw.ai/automation/cron-jobs