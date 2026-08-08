# ADR-001：以 Native Plugin 而不是 Skill-only 实现监督控制面

**Status: Accepted at design level**

## Context

Blind Diagnosis 的关键要求是：第一次诊断模型不能看到用户观点。Skill 与普通聊天上下文共享模型上下文，单靠指令无法构成可靠信息边界。

## Decision

目标实现采用专用 OpenClaw Agent 作为人机入口，Native Plugin 作为监督控制面。Plugin 负责决定每个内部模型调用能看到什么。

## Evidence

OpenClaw 当前 Plugin hooks 可以在普通模型读取输入前 block/short-circuit；Plugin runtime 支持 isolated LLM completion。

## Consequences

- 需要敏感 conversation-hook 权限；
- 复杂度高于 Skill；
- 能做确定性 Information Flow Test；
- Skill 可作为知识/说明补充，但不是安全边界。