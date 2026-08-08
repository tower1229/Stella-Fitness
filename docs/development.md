# 实施准备说明

> 本文件原名为开发指南，但当前项目尚未进入实现阶段。Phase 0 不提供构建、运行或安装命令。

## 当前状态

Stella Fitness 处于 **Requirements & Research**。

当前仓库的可交付物是：

- 冻结需求；
- 目标架构；
- 来源知识包；
- 外部研究；
- 数据/模型/安全依赖清单；
- Eval 计划；
- 已知缺口；
- 实施交接清单。

## 实施开始前必须回答

1. OpenClaw 当时稳定 Plugin API 是否仍支持设计中的 hooks / isolated runtime？
2. 哪些配置权限需要用户显式开启？
3. ProgramSpec 是否已经解决 source blocker？
4. 训练日志 benchmark 是否足以选择 extraction model？
5. Blind Diagnosis 与 Auditor 的候选模型是否完成反迎合 Eval？
6. Provider 隐私方案是否满足项目对身体数据的要求？
7. Policy Gate 的阈值是否有可靠依据和版本？
8. ClawHub owner / scope / license / source redistribution 是否已明确？

## 未来实施原则

当明确进入实施阶段后：

- 先实现事实采集与确定性数据层；
- 后实现模型诊断；
- 最后实现周期主动监督；
- 每增加一条信息流，都必须有对应 Information Flow Test；
- 每增加一个自动干预规则，都必须有正例和反例 Eval；
- Provider/model 始终通过 role contract 封装，不把某个厂商写进核心领域模型。

正式实施交接见 [planning/implementation-handoff.md](./planning/implementation-handoff.md)。