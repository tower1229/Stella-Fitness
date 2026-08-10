# ADR-012：用户配置 Personal Data Directory

Plugin 的持久文件分为两类：可重建的运行状态、游标、锁、缓存和索引进入 Runtime Directory；关于用户的 canonical 数据进入用户显式配置的 Personal Data Directory，包括原始上传、Observation、correction、Program State、Processing Record 和事实视图。未配置或无效时必须 fail closed，不能静默回退到 Runtime Directory。用户可用自己的 Personal Data Repository 管理该目录，但不强制绑定具体工具。
