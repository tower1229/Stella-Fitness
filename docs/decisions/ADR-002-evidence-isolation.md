# ADR-002：Evidence 与 User Belief 分离

**Status: Accepted**

## Context

模型存在 sycophancy 风险；用户 framing 会影响输出。

## Decision

- objective observations 与 subjective claims 分库存储/建模；
- Blind Diagnostician 只接收 EvidencePacket；
- diagnosis 先冻结；
- User Belief 后披露给 Auditor；
- 最终行动通过 deterministic Policy Gate。

## Rejected alternative

“把全部上下文给同一个模型，并在 Prompt 中要求忽略用户观点。”

原因：不可验证真正忽略，也无法提供强信息流保证。