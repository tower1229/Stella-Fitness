# ADR-030：投影个人数据不是 Agent 指令

除经协议映射的主 Stella IDENTITY 与 SOUL 人格字段外，USER、memory、Observation 和 Personal Data 内容进入 Fitness 时一律作为引用数据，不能获得指令权限。Fitness 的 AGENTS、领域边界和 recording-only 约束优先于导入人格；Projection Builder 不把原始个人文本拼入高优先级指令区，也不允许其中的命令扩大工具、数据或专业权限。
