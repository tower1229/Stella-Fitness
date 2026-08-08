# Privacy & Safety Requirements

**状态：FROZEN PRINCIPLES / PROVIDER DETAILS ARE RESEARCH SNAPSHOT**  
**checked_at：2026-08-08**

Stella Fitness 处理体重、饮食、训练表现和潜在健康描述。这些数据虽然不一定构成医疗记录，但应按敏感个人身体数据设计。

详细数据生命周期见 [data-lifecycle.md](./data-lifecycle.md)，红旗症状与升级路径见 [safety-escalation.md](./safety-escalation.md)。

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

Phase 0 已冻结原则：

> 长期优先保留 verified structured facts；raw image 应有有限、可配置的保留生命周期，而不是默认永久保存。

具体默认时长仍待 Product/Privacy Review。

如果关联字段仍在 `NEEDS_CONFIRMATION`，原图不能在纠错完成前被自动删除。

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

模型/Provider 选择必须服从 privacy profile，而不是反过来要求用户为了某个模型放弃隐私策略。

## 4. Provider disclosure ledger

未来系统需要能够让用户审计：

```text
provider
model
role
run timestamp
payload category
raw image sent? yes/no
privacy profile reference
```

这不要求无限期保存完整 prompt 文本，但要能回答“哪些身体数据发给过谁”。

## 5. 安全边界

Stella Fitness v1 的默认 scope 是：

```text
healthy adults, age >= 18,
general hypertrophy supervision,
not medical / rehabilitation care
```

它不是：

- 医疗诊断；
- 伤病诊断；
- 药物/激素方案；
- 饮食治疗；
- 急救替代；
- 特殊疾病、孕期、未成年人或康复人群的通用自动处方系统。

### Safety escalation

遇到明确危险信号时，停止普通增肌优化并进入 `ESCALATE`。

当前 Phase 0 已形成高层类别：

- exertional chest discomfort；
- fainting / near-syncope；
- unusual/extreme shortness of breath；
- serious acute injury / loss of function；
- possible rhabdomyolysis pattern；
- 其他经 Safety Review 批准的 red flags。

LLM 无权临场降低这些优先级，例如因为用户说“应该只是低血糖”就继续建议完成训练。

## 6. 数据控制要求

未来产品至少需要：

- 查看已保存数据；
- 更正错误 extraction；
- 删除单条记录；
- 删除 raw artifact；
- 导出结构化历史；
- 删除全部 Stella Fitness 数据；
- 查看模型调用/数据披露日志。

这些能力属于产品需求，而不是“以后有空再做”的后台功能。

## 7. Benchmark privacy

真实用户训练日志/饮食照片不能因为被上传给 Stella Fitness 就自动进入研发数据集。

进入 benchmark 前必须：

- 独立授权；
- 去身份；
- 明确 public/private dataset 范围；
- 与 runtime storage 分离。

## 8. 尚未冻结的隐私决策

- raw image Standard profile 的具体默认保留时长；
- 最终 Provider / endpoint / ZDR 组合；
- diagnosis/audit structured records 的默认保留周期；
- benchmark consent template；
- public privacy notice 的最终措辞。

这些必须在 Phase 0 Exit Review 或 release review 中明确，不得由代码默认值静默决定。

## Sources

- OpenAI data controls: https://platform.openai.com/docs/models/default-usage-policies-by-endpoint
- OpenAI business data: https://openai.com/business-data/
- Gemini ZDR: https://ai.google.dev/gemini-api/docs/zdr
- Gemini pricing/data terms: https://ai.google.dev/gemini-api/docs/pricing
- Anthropic commercial training policy: https://privacy.anthropic.com/en/articles/7996868-is-my-data-used-for-model-training
- Anthropic ZDR: https://privacy.anthropic.com/en/articles/8956058-i-have-a-zero-data-retention-agreement-with-anthropic-what-products-does-it-apply-to
- AHA exercise warning signs: https://www.heart.org/en/health-topics/cardiac-rehab/getting-physically-active/develop-a-physical-activity-plan-for-you