# ADR-012：用户控制 Personal Data Directory

Plugin 的持久文件分为两类：可重建的运行状态、游标、锁、缓存和索引进入 Runtime Directory；关于用户的 canonical 数据进入用户控制的 Personal Data Directory，包括原始上传、Observation、correction、Program State、Processing Record 和事实视图。按 ADR-031 与 Runtime-owned locator 合同，operator 只在 `plugins.entries["cognitive-runtime"].config.stella` 配置唯一绝对 Personal Data Repository，Fitness 固定使用 `<repository>/stella/fitness`，不得复制第二份路径配置。locator 缺失或无效时必须 fail closed，不能静默回退到 Runtime Directory。
