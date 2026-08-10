# ADR-016：OpenClaw 管模型配置，Plugin 管抽取 payload

OpenClaw 负责 Provider 注册、凭据、endpoint、allowlist 和实际外发；Stella Fitness 只在 operator 授权范围内引用训练日志 extraction model，并构造当前抽取所需的最小 payload。Plugin 保存 runtime 实际返回的可用 execution metadata，但不声称具备网络层审计或 Provider 数据删除能力。
