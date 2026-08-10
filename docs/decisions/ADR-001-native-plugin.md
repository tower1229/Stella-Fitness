# ADR-001：使用 Native Plugin

Stella Fitness 采用 OpenClaw Native Plugin，而不是 Skill-only 实现，因为固定训练日志媒体处理、Personal Data Directory 持久化、确定性 Program Engine、字段确认与 synthetic reply 需要 Plugin 级运行时和生命周期边界。该选择不再用于承载训练诊断或监督控制面；相关旧理由已由 ADR-024 取代。
