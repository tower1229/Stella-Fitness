# ADR-027：私人 Fitness Agent 跨 Channel 共享事实与对话记忆

每个 Stella Fitness Agent 都是只服务一个 Fitness Principal 的私人部署，不支持多用户或群组使用；Channel 私有性与访问控制由 OpenClaw/operator 作为部署前提保证，Plugin 不实现账户、租户或 per-user 数据分区。在此前提下，WebChat、Telegram 等入口共享同一组 Canonical Fitness Facts、Base Stella Context Projection、Fitness Context Projection，并允许跨该 Agent 的 sessions 检索 Conversational Fitness Memory，以保持跨 Channel 的连续交流。
