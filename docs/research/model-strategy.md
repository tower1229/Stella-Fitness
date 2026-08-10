# 训练日志抽取模型策略

**状态：MODEL-SELECTION-BLOCKED / REAL PILOT PENDING**

v1 只有一个模型角色：把固定 XLSX 布局的训练日志图片转换为 typed candidate fields。模型不评价训练表现，不分析营养或健康风险。

## Contract

- image input；
- strict structured output；
- field-level confidence/uncertainty；
- blank preservation；
- load polymorphism；
- reps/duration semantic distinction；
- explicit failure/timeout/cancellation。

## Selection

必须使用真实填写照片和人工 ground truth 比较：

- critical numeric accuracy；
- layout/exercise normalization；
- blank inference rate；
- semantic classification；
- abstention；
- latency/cost；
- Provider terms 与 OpenClaw operator permission。

当前不冻结厂商或默认模型。基础实现与 CI 使用 deterministic fake/recorded extraction result。
