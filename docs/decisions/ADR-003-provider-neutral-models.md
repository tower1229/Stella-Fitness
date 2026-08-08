# ADR-003：模型按角色选择，不锁定单一厂商

**Status: Accepted**

## Decision

核心 domain schema 只定义能力契约，不定义 GPT/Gemini/Claude 类型。

当前模型名称只是 research baseline candidate。

## Rationale

- 模型更新快；
- 不同角色成本/质量要求不同；
- 视觉识别和复杂诊断未必由同一模型最优；
- 跨厂商 Auditor 可以作为降低相关性错误的一种工程手段；
- privacy/availability 可能决定实际选择。

## Requirement

替换模型必须重跑该角色对应 Eval。