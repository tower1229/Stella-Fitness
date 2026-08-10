# 外部依赖与策略

## OpenClaw

角色：Native Plugin 宿主、conversation hooks、structured media runtime、model permission 和 ClawHub 分发入口。

kickoff 必须以实际 stable 版本建立并验证最低兼容基线，不能依赖 research snapshot，也不得用单一修订版本白名单替代能力预检。

## Extraction model

唯一模型角色是训练日志结构化抽取。Domain contract 不出现厂商名称；候选模型必须支持 image input、schema output、显式 uncertainty 和 timeout/cancellation。

选择依据：

- critical numeric accuracy；
- handwriting/table/layout accuracy；
- blank preservation；
- load/reps/duration semantic accuracy；
- abstention/calibration；
- latency/cost；
- operator permission 与 Provider 数据条款。

CI 使用 deterministic fake/recorded outputs，不依赖 live provider。

## Local persistence

优先开放、provider-neutral、可由用户直接检查和复制的文件格式。Runtime index 必须可重建，不引入第二个 canonical database。

## Media processing

需要可靠支持 orientation apply、metadata strip、byte-integrity verification 和所有退出路径清理。具体库在实现切片中通过目标测试选择。

## Release

目标 package 为 `@tower1229/stella-fitness`。首次发布需要课程派生制品授权、package validation、clean install 和 ClawHub live permission。

## 明确不存在的依赖

- nutrition database；
- diagnosis/audit/reporter models；
- medical or safety classifier；
- Cron supervision runtime。
