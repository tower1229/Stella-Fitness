# 模型角色与外部依赖策略

> 调研基线：2026-08-08。模型供应和价格变化较快，本文件只定义角色与当前候选，不把某个商业模型写成不可替换的业务依赖。

## 1. 基本原则

### 模型不是系统裁判

Stella Fitness 中模型只承担：

- 多模态 / 文本结构化；
- 证据上的开放式归因；
- 反方审计；
- 可选的自然语言表达。

以下能力必须留在代码中：

- ProgramSpec 解释；
- 数学指标计算；
- Evidence 白名单；
- Policy Gate；
- 数据持久化与审计。

### 角色独立配置

不同角色可以使用不同 provider / model：

```text
trainingLogExtractor
dietExtractor
beliefExtractor
diagnostician
auditor
reporter
```

模型替换必须经过对应 Eval，而不是仅按价格或主观体验切换。

## 2. 当前推荐基线

### 2.1 训练日志图片结构化

推荐候选：

```text
google/gemini-3.6-flash
```

原因：

- OpenClaw 当前 Google provider catalog 支持 Gemini 3.6 Flash；
- Google 官方模型页明确支持 Image input 与 Structured outputs；
- 该步骤核心是视觉理解 + JSON schema extraction，而不是长链开放式诊断。

降本候选：

```text
google/gemini-3.5-flash-lite
```

只有在真实手写训练表 fixture 上达到要求后才能降级。

必须评测：

- 动作名称；
- 重量；
- 每组次数；
- 总次数；
- 不确定字段识别；
- “看不清”时是否会猜测。

官方参考：

- https://ai.google.dev/gemini-api/docs/models/gemini-3.6-flash
- https://ai.google.dev/gemini-api/docs/latest-model
- https://docs.openclaw.ai/providers/google

### 2.2 饮食照片估算

首选同样使用：

```text
google/gemini-3.6-flash
```

但输出契约与训练日志不同：必须返回范围与不确定性，不以“识别模型更强”为理由制造精确克数。

模型只负责视觉估计；是否拥有足够证据支持饮食归因由 Evidence Coverage + Policy Gate 决定。

### 2.3 User Belief Extraction

推荐低成本候选：

```text
google/gemini-3.5-flash-lite
```

这是低风险结构化任务，只需要抽取：

```text
claims[]
desiredActions[]
```

它不能产生训练诊断。

如果该模型在否定句、反问和复杂表达上的准确率不足，可升级到 Gemini 3.6 Flash 或其他通过 Eval 的结构化文本模型。

### 2.4 Blind Diagnostician

质量优先基线：

```text
openai/gpt-5.6-sol
```

原因：

- OpenAI 当前将 GPT-5.6 Sol 定位为复杂专业工作的旗舰模型；
- 支持 reasoning 与 Structured outputs；
- OpenClaw 当前原生识别 `openai/gpt-5.6-sol`，并在 `api.runtime.llm.complete()` 的 isolated runtime 文档中使用该模型作为示例。

成本 / 延迟候选：

```text
openai/gpt-5.6-terra
```

必须通过诊断 Golden Cases、Evidence Fidelity、Abstention 和稳定性测试后才可成为默认值。

官方参考：

- https://developers.openai.com/api/docs/models/gpt-5.6-sol
- https://developers.openai.com/api/docs/guides/latest-model
- https://docs.openclaw.ai/providers/openai
- https://docs.openclaw.ai/plugins/sdk-runtime

### 2.5 Adversarial Auditor

推荐基线：

```text
anthropic/claude-sonnet-5
```

选择不同供应商的目的不是假设 Anthropic 一定比 OpenAI 更客观，而是减少 Blind Diagnosis 与 Audit 共享同一模型误差模式的概率。

Anthropic 当前将 Sonnet 5 定位为高能力、较高性价比的 agentic / reasoning 模型；OpenClaw 当前支持 `anthropic/claude-sonnet-5`。

质量上限候选可通过 Eval 评估更高阶 Claude 模型，但不应仅因为“更贵/更大”就默认替换。

官方参考：

- https://www.anthropic.com/news/claude-sonnet-5
- https://docs.openclaw.ai/providers/anthropic

### 2.6 Reporter

默认：**不用模型**。

优先采用模板：

```text
Decision
Evidence summary
Uncertainty
Action / no action
```

只有自然语言质量确实成为问题时，再配置低成本 isolated Reporter。

可评测候选：

```text
openai/gpt-5.6-luna
google/gemini-3.5-flash-lite
```

Reporter 没有权限修改 `FinalDecisionPacket`。

## 3. OpenClaw 模型权限

Stella Fitness 需要用户 / operator 显式允许 Plugin 的模型 override。

部署时至少需要核对：

```text
plugins.entries.stella-fitness.llm.allowModelOverride
plugins.entries.stella-fitness.llm.allowedModels
plugins.entries.stella-fitness.llm.allowedCompletionModels
```

如果指定 auth profile，还需遵守 OpenClaw 对 auth-profile override 的额外授权要求。

模型白名单应该与 Stella Fitness 配置中的各角色模型一致；配置了角色模型但未获得 host 授权时，应 fail closed，而不是偷偷使用当前聊天 Agent 模型。

官方参考：

- https://docs.openclaw.ai/plugins/sdk-runtime

## 4. 隔离调用要求

Blind Diagnostician 与 Auditor 优先使用：

```ts
execution: {
  mode: "isolated-agent-runtime"
}
```

该模式的价值不是“多 Agent”本身，而是 fresh context + 单条受控 user message + 无 model-callable tools。

Belief Extractor 也应采用独立受控调用；Reporter 若使用模型同理。

## 5. 供应商策略

### 质量优先组合

```text
Training/Diet extraction  → Gemini 3.6 Flash
Belief extraction         → Gemini 3.5 Flash-Lite
Blind diagnosis           → GPT-5.6 Sol
Adversarial audit         → Claude Sonnet 5
Reporter                  → Template
```

优点：

- 每个模型与任务特征匹配；
- Blind / Audit 跨供应商；
- Reporter 几乎无成本。

缺点：

- 需要配置三个 provider；
- 用户数据会分别发送给多个外部模型供应商（但每一步只发送最小必要字段）。

### 简化运维组合

如果用户不希望维护三个供应商，可减少 provider 数量，但仍保持**调用上下文隔离**。

例如：

```text
Extraction / Belief → Gemini
Diagnosis / Audit   → OpenAI 两次独立 isolated calls
Reporter            → Template
```

代价是 Blind / Audit 可能具有更强的相关误差，因此必须用更严格的 adversarial / framing eval 补偿。

## 6. 隐私原则

每个外部调用只发送任务所需信息：

| 角色 | 允许发送 | 禁止发送 |
|---|---|---|
| Training extractor | 单张训练日志图、必要提示 | 无关历史、用户画像 |
| Diet extractor | 该餐图片/描述 | 完整训练历史 |
| Belief extractor | 当前用户表达 | 全部身体数据 |
| Blind Diagnostician | EvidencePacket | 用户观点、原始聊天 |
| Auditor | Evidence + frozen diagnosis + belief | 无关会话历史 |
| Reporter | FinalDecisionPacket | Raw data / user expectation |

## 7. 模型资格测试

### Extraction model

必须在真实图片 fixture 上衡量 field-level accuracy 与 uncertainty recall。

### Diagnostician

必须通过：

- Evidence Fidelity；
- `NO_CHANGE`；
- `COLLECT_MORE_DATA`；
- 多假设鉴别诊断；
- 不虚构缺失数据。

### Auditor

必须证明能发现人为注入的：

- unsupported conclusion；
- ignored contradictory evidence；
- overconfidence；
- framing drift。

### Reporter

必须证明不会改变决策语义。

## 8. 版本记录

每次模型调用需要保存：

```text
role
provider/model ref
run time
Evidence / input hash
structured output
success/failure
```

生产环境中若 provider 支持 stable / snapshot model，应优先采用可复现版本；如果使用 rolling alias，升级必须触发模型回归 Eval。

## 9. 成本原则

成本优化顺序：

1. 正常状态不调用模型；
2. deterministic metrics 先判断是否需要 review；
3. Reporter 模板化；
4. 简单 extraction/belief 使用较小模型；
5. 最后才考虑降低 Diagnostician / Auditor 能力。

不在业务规则中硬编码当前 token 单价。价格只用于部署期评估，因为供应商价格会变化。
