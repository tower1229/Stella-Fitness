# Anti-sycophancy 调研与设计约束

**状态：RESEARCH_BASELINE**

## 1. 问题不是 Prompt 风格

Anthropic 对 RLHF 模型的研究表明，模型可能更偏向匹配用户既有观点而非真实/独立判断；人类偏好数据本身也更可能偏爱符合自己观点的回答。

OpenAI 2025 年对一次 GPT-4o 更新的公开复盘同样说明：过度优化短期用户反馈可能形成明显的 sycophancy，且缺少专项 deployment eval 会让这类问题漏过上线流程。

因此 Stella Fitness 不接受以下方案作为主要控制：

```text
system prompt: “请客观，不要迎合用户”
```

Prompt 只能作为次级约束。

## 2. 架构约束

### Blind assessment

第一次诊断只允许接收：

```text
program_state
objective observations
derived metrics
data coverage / confidence
```

禁止：

```text
raw user framing
user belief
desired action
social pressure / coach opinion
```

### Freeze before reveal

BlindDiagnosis 生成并保存后，才允许 BeliefPacket 进入 Auditor。

### Auditor 不是二次同意

任务是主动寻找：

- diagnosis 的证据缺口；
- 反证；
- 过度确定；
- belief 与 evidence 的冲突；
- 是否应该退回 `COLLECT_MORE_DATA`。

### Deterministic gate

LLM 不拥有最终行动权。没有满足 policy conditions 的建议不能因为写得有说服力就进入用户世界。

## 3. Eval 约束

Anthropic 的 Agent eval 实践强调 balanced problem sets；只测试“该采取行动时能否行动”会产生单边优化。

Stella Fitness 必须同时测试：

- 应调整 → 能识别；
- 不应调整 → 能忍住；
- 数据不足 → abstain；
- 用户强烈暗示某个结论 → 不改变核心诊断；
- 用户给出相反暗示 → 仍保持证据一致性。

## 4. 核心指标

### Framing Invariance

同一个 EvidencePacket，替换不同 user framing，核心 BlindDiagnosis 应保持一致。

### Information Leakage

序列化发送给 Blind Diagnostician 的 payload 中不允许存在用户观点字段。

### Unnecessary Intervention Rate

在稳定进步/随机波动案例中错误提出调整的比例。

### Evidence Faithfulness

所有结论引用的 evidence id 必须真实存在，且不能把主观 claim 伪装成 objective observation。

## 5. 质量指标不以讨好为中心

用户满意度可以衡量沟通体验，但不能成为诊断正确性的主要奖励信号。

系统应允许说：

> 现有证据不足以支持你的判断，暂时不调整。

## Sources

- https://www.anthropic.com/news/towards-understanding-sycophancy-in-language-models
- https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents
- https://openai.com/index/sycophancy-in-gpt-4o/ （实施前重新核验具体 URL/复盘版本）