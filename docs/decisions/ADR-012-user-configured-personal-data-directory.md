# ADR-012 — Personal Data Lives in a User-Configured Directory

**Status:** Accepted for v1 requirements  
**Date:** 2026-08-09

Plugin 产生的持久文件分为两类，是否跨重启持久化不是分类标准。可重建的运行状态、游标、锁、缓存、任务状态和索引进入 Plugin 自行扩展的 `Runtime Directory`；关于用户的 canonical 个人数据进入用户显式配置的 `Personal Data Directory`，包括上传原件、训练进度、健康档案、observations、分析结果、决策及 processing provenance，并生成可移植的结构化产出。删除 Runtime Directory 不得造成训练进度丢失，最多触发重建或重新调度。Plugin 不得在用户未配置个人数据位置时静默回退到自身运行目录保存个人数据。项目推荐用户以 `Personal Data Repository` 管理、备份和版本化该目录，但不强制绑定 Git 或某一种仓库实现。
