# Privacy & Safety Requirements

**状态：FROZEN PRINCIPLES / PROVIDER DETAILS ARE RESEARCH SNAPSHOT**  
**checked_at：2026-08-08**

Stella Fitness 处理体重、饮食、训练表现和潜在健康描述。这些数据虽然不一定构成医疗记录，但应按敏感个人身体数据设计。

权利模型只有三类：Built-in Program 内容由发布方解决授权；User Input Data 与 User Derived Data 均由用户控制，Plugin 不取得再利用、公开、Benchmark 或训练权。Runtime Directory 只是可重建技术状态，不是第四类个人数据权利域。用户控制不等于 Plugin 保证用户对上传的第三方内容拥有公开再分发权。

详细数据生命周期见 [data-lifecycle.md](./data-lifecycle.md)，红旗症状与升级路径见 [safety-escalation.md](./safety-escalation.md)。

## 1. 数据最小化

### 用户控制的个人数据目录

原始上传文件与长期个人事实必须保存到用户显式配置的 Personal Data Directory，而不是 Plugin 自行选择的 Runtime Directory，也不是模型 Provider。该目录生成可移植的结构化产出，并推荐由用户自己的 Personal Data Repository 管理。

Plugin Runtime Directory 只保存可重建的运行状态、锁、缓存和任务状态。包含个人内容的临时副本必须最小化并具备清理语义。

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

> raw image 是用户 Personal Data Directory 中的 canonical 个人记录，默认与结构化产出一起长期保留。

Plugin 不对用户目录执行静默的按时限自动删除。v1 不提供 Plugin 删除或 retention-policy 功能；用户通过文件系统或 Personal Data Repository 工具管理原件。Runtime Directory 中的临时副本在处理完成后清理。

原件保持用户上传时的字节内容，包括其自带 metadata，但 Plugin 不把无关 EXIF/GPS/设备信息提取为结构化记录。提交给 OpenClaw media runtime 的必须是临时净化副本：先应用正确方向，再移除 EXIF、GPS、设备、软件和缩略图 metadata。任何模型角色都不得接收原始 metadata；副本在成功、失败、超时或取消后清理。

## 2. Provider privacy research snapshot

### OpenAI API

OpenAI 当前商业/API政策默认不使用 API customer content 训练模型（除非客户选择共享等特定情形）。官方同时提供经批准的 Modified Abuse Monitoring / Zero Data Retention 控制；不同 endpoint/feature 的 ZDR 兼容性不同。

**要求：** 实施时记录实际 endpoint、`store` 行为、图片/文件输入规则及账户是否具备 ZDR，而不是只写“OpenAI 不存数据”。

### Google Gemini Developer API

Google 当前文档明确：Paid Services 的 prompts/responses（含图片/文件）不用于改进产品；同时可能为 abuse monitoring 做有限期日志。Google 也提供 ZDR 相关流程与功能限制。

**要求：** 真实用户敏感数据不得依赖“免费 tier 反正也一样”的假设。生产使用需要明确 billing/data terms。

### Anthropic API

Anthropic 当前商业产品隐私说明：默认不使用商业产品/API inputs/outputs 训练模型，除非用户显式 opt-in/反馈等情况；Anthropic 也有 API Zero Data Retention arrangement 的说明。

**说明：** Auditor 处理同样遵循最小输入原则；实际 Provider 的选择、隐私条款和外发由 OpenClaw 配置负责，不由 Plugin 再建一套策略。

## 3. OpenClaw owns model and egress configuration

Stella Fitness 不创建第二套 Provider/privacy profile，也不管理网络外发策略。OpenClaw 负责：

- Provider 凭据与 endpoint；
- 模型目录与 canonical `provider/model`；
- allowlist / `allowedModels`；
- 默认模型、fallback 和实际网络请求。

Plugin 负责：

- 编排 Extraction、Blind Diagnosis、Belief Extraction、Audit、Policy Gate 和 Reporting；
- 明确构造每个处理步骤提交给 OpenClaw runtime 的最小 payload；
- 保证 diagnosis freeze、选择性披露和 Information Flow Test；
- 在 operator 授权的 `allowedModels` 范围内为内部角色引用 OpenClaw canonical `provider/model`；
- 在文档中说明哪些操作会把原图或结构化数据交给 OpenClaw；
- 保存 OpenClaw runtime 实际返回的可用执行元数据。

`Extractor`、`Auditor` 是内部处理职责，不是用户需要理解或配置的 route。角色模型绑定不等于管理 Provider 凭据、endpoint 或实际网络外发；这些仍属于 OpenClaw。

## 4. Processing provenance

Plugin 至少记录自己执行过的处理操作：

```text
operation
run timestamp
payload category
raw image submitted to OpenClaw runtime? yes/no
runtime-reported provider/model (if available)
```

这能回答“Plugin 把什么交给了 OpenClaw runtime”。只有在 OpenClaw 返回相应元数据时，才能进一步记录实际 provider/model；Plugin 不声称具备网络层外发审计能力。

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

v1 的数据控制通过 Personal Data Directory 的开放文件契约实现：

- 查看已保存数据；
- 更正错误 extraction；
- 通过普通文件操作删除或复制 raw artifact、结构化记录或整个目录；
- 文件缺失后安全重建派生状态，且 runtime 不恢复已删除内容；
- 对 schema-invalid 手工修改报告错误并 fail closed；
- 查看模型调用/数据披露日志。

Plugin 不提供通用数据管理 UI、删除/导出命令、备份、回收站或 Git 历史清理；目录复制就是导出。Provider、备份和远端副本的删除由相应系统负责。

## 7. Benchmark privacy

真实用户训练日志/饮食照片不能因为被上传给 Stella Fitness 就自动进入研发数据集。

Plugin 不提供遥测、“贡献数据”或自动 Benchmark 上传功能。Benchmark 样本只通过 Plugin 之外的独立人工流程取得。

进入 benchmark 前必须：

- 独立授权；
- 去身份；
- 明确 public/private dataset 范围；
- 与 runtime storage 分离。

## 8. 剩余实施/Review artifact

- OpenClaw runtime 实际可提供哪些 processing metadata；
- 独立 benchmark authorization template；
- public privacy notice 的最终措辞。

这些必须在 Phase 0 Exit Review 或 release review 中完成，但不再改变已冻结的数据权利分类。

## Sources

- OpenAI data controls: https://platform.openai.com/docs/models/default-usage-policies-by-endpoint
- OpenAI business data: https://openai.com/business-data/
- Gemini ZDR: https://ai.google.dev/gemini-api/docs/zdr
- Gemini pricing/data terms: https://ai.google.dev/gemini-api/docs/pricing
- Anthropic commercial training policy: https://privacy.anthropic.com/en/articles/7996868-is-my-data-used-for-model-training
- Anthropic ZDR: https://privacy.anthropic.com/en/articles/8956058-i-have-a-zero-data-retention-agreement-with-anthropic-what-products-does-it-apply-to
- AHA exercise warning signs: https://www.heart.org/en/health-topics/cardiac-rehab/getting-physically-active/develop-a-physical-activity-plan-for-you
