# ADR-016 — OpenClaw Owns Provider/Egress, Plugin Owns Orchestration

**Status:** Accepted for v1 requirements  
**Date:** 2026-08-09

Stella Fitness 不定义 `standard | strict | local-preferred` 等 Plugin privacy profiles，也不管理 Provider 注册、凭据、endpoint、网络请求或外发策略；这些由 OpenClaw 负责。Plugin 仍然拥有核心监督编排：划分 Extraction、Blind Diagnosis、Belief Extraction、Audit、Policy Gate 和 Reporting 等内部步骤，明确构造每次调用的最小 payload，并保证 diagnosis freeze 与选择性披露。Plugin 可以为内部角色引用 OpenClaw canonical `provider/model`，但只能在 operator 授权的 `allowedModels` 范围内；这是角色能力绑定，不是第二套 Provider 或外发配置。`Extractor route`、`Auditor route` 不作为用户产品概念。Plugin 文档应说明哪些操作会把原图或结构化数据提交给 OpenClaw runtime；若 runtime 返回实际 provider/model 等执行元数据，Plugin 可以将其作为 processing provenance 保存，但不得声称自己具备网络层外发审计或 Provider 数据删除能力。

当前依据：[OpenClaw model providers](https://docs.openclaw.ai/concepts/model-providers) 与 [configuration reference](https://docs.openclaw.ai/gateway/configuration-reference)。实施和发布时必须按锁定 OpenClaw 版本重新核验。
