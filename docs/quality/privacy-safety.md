# Privacy & Safety Requirements

**状态：FROZEN PRINCIPLES / PROVIDER DETAILS ARE RESEARCH SNAPSHOT**  
**checked_at：2026-08-08**

Stella Fitness 处理体重、饮食、训练表现和潜在健康描述。这些数据虽然不一定构成医疗记录，但应按敏感个人身体数据设计。

## 1. 数据最小化

### 本地优先长期保存

长期事实库应由用户控制的 Plugin storage 保存，而不是把完整历史永久交给模型 Provider。

### Role-specific payload

不同模型只看到完成任务需要的最小数据：

- extractor：目标图片 + extraction schema；
- Blind Diagnostician：EvidencePacket；
- Belief Extractor：当前用户语句；
- Auditor：EvidencePacket + frozen diagnosis + BeliefPacket；
- Reporter：approved DecisionPacket。

不得为了方便把完整 conversation history 发给所有模型。

### Raw artifacts

原始训练照片/饮食照片应有明确保留策略。未来默认值需在隐私设计中冻结，可考虑“结构化完成后可配置删除原图”。

## 2. Provider privacy research snapshot

### OpenAI API

OpenAI 当前商业/API政策默认不使用 API customer content 训练模型（除非客户选择共享等特定情形）。官方同时提供经批准的 Modified Abuse Monitoring / Zero Data Retention 控制；不同 endpoint/feature 的 ZDR 兼容性不同。

**要求：** 实施时记录实际 endpoint、`store` 行为、图片/文件输入规则及账户是否具备 ZDR，而不是只写“OpenAI 不存数据”。

### Google Gemini Developer API

Google 当前文档明确：Paid Services 的 prompts/responses（含图片/文件）不用于改进产品；同时可能为 abuse monitoring 做有限期日志。Google 也提供 ZDR 相关流程与功能限制。

**要求：** 真实用户敏感数据不得依赖“免费 tier 反正也一样”的假设。生产使用需要明确 billing/data terms。

### Anthropic API

Anthropic 当前商业产品隐私说明：默认不使用商业产品/API inputs/outputs 训练模型，除非用户显式 opt-in/反馈等情况；Anthropic 也有 API Zero Data Retention arrangement 的说明。

**要求：** Auditor provider 也必须经过同等隐私审查，不能因为只做二次审计就降低标准。

## 3. Provider-neutral privacy profile

未来建议提供配置级 profile：

```text
privacy_profile: standard | strict | local-preferred
```

但具体语义必须实施时定义。至少应能表达：

- 允许哪些 Provider；
- 是否允许图片离开本机；
- 是否要求 ZDR；
- 是否允许跨 Provider audit；
- 原图保留多久。

## 4. 安全边界

Stella Fitness 的目标是健康成人的增肌训练监督，不是：

- 医疗诊断；
- 伤病诊断；
- 药物/激素方案；
- 饮食治疗；
- 急救替代；
- 为未成年人或特殊疾病人群自动制定方案。

### Safety escalation

当前只冻结高层原则：出现明显危险症状时停止增肌优化并建议寻求合适医疗帮助。

AHA 公开资料将运动中异常/极端呼吸困难、胸部不适，以及头晕/晕厥等列为需要停止活动并寻求医疗帮助的重要警示情形。

未来 Policy Gate 需要地区化、可审计的 safety rules；不能让 LLM 临场发明医疗阈值。

## 5. 数据控制要求

未来产品至少需要：

- 查看已保存数据；
- 更正错误 extraction；
- 删除单条记录；
- 删除 raw artifact；
- 导出结构化历史；
- 删除全部 Stella Fitness 数据；
- 查看模型调用/数据披露日志。

这些能力属于产品需求，而不是“以后有空再做”的后台功能。

## Sources

- OpenAI data controls: https://platform.openai.com/docs/models/default-usage-policies-by-endpoint
- OpenAI business data: https://openai.com/business-data/
- Gemini ZDR: https://ai.google.dev/gemini-api/docs/zdr
- Gemini pricing/data terms: https://ai.google.dev/gemini-api/docs/pricing
- Anthropic commercial training policy: https://privacy.anthropic.com/en/articles/7996868-is-my-data-used-for-model-training
- Anthropic ZDR: https://privacy.anthropic.com/en/articles/8956058-i-have-a-zero-data-retention-agreement-with-anthropic-what-products-does-it-apply-to
- AHA exercise warning signs: https://www.heart.org/en/health-topics/cardiac-rehab/getting-physically-active/develop-a-physical-activity-plan-for-you