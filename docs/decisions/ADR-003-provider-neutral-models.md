# ADR-003：抽取模型保持 Provider-neutral

训练日志抽取通过 provider-neutral contract 接入 OpenClaw runtime，领域 schema 不包含厂商类型。默认模型只能在真实手写日志 benchmark 和 operator permission 验证后选择；CI 使用 deterministic fake/recorded outputs。
