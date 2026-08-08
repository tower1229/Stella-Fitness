# Stella Fitness Roadmap

## 当前唯一活动阶段：Phase 0 — Requirements & Research

### 目标

在写任何 Plugin 代码前，把以下问题回答到足够明确：

- 产品为谁解决什么问题；
- 用户最低输入成本是什么；
- 哪些事实必须确定性计算；
- 哪些信息可以向哪一个模型披露；
- 何时必须保持沉默、收集更多数据或安全升级；
- 外部平台能否支持所需信息隔离；
- 模型、数据库、营养数据等依赖如何选择与替换；
- 哪些领域阈值已有证据，哪些仍需专业审定；
- 训练教程是否完整、可再发布；
- 如何证明系统没有因为用户 framing 改变诊断。

### Phase 0 工作包

#### A. Product requirements

- [x] 产品定位与非目标
- [x] Offline-first 训练交互
- [x] 训练日志/体重/饮食输入边界
- [x] 默认不干预
- [x] 信息隔离与反迎合原则
- [x] 决策状态语义

#### B. Source & knowledge

- [x] 12 周教程 Markdown 化
- [x] ProgramSpec v0.1 设计草案
- [x] source audit
- [x] 缺失内容保持 unresolved
- [ ] 补齐第 4 周周五可靠来源
- [ ] 明确教程再发布许可

#### C. Platform research

- [x] OpenClaw hooks
- [x] isolated LLM runtime
- [x] structured media extraction
- [x] model allowlist / override policy
- [x] Cron 静默周期任务
- [x] ClawHub package 发布要求
- [ ] 实施开始前重新核验 OpenClaw 当前稳定版本和 SDK contract

#### D. Model & data research

- [x] 视觉结构化抽取候选模型
- [x] Blind Diagnosis 候选模型
- [x] 异构 Auditor 候选模型
- [x] Provider 数据使用/保留基线
- [x] 食物照片营养估算局限
- [x] USDA FoodData Central grounding 候选
- [ ] 建立真实手写训练日志 benchmark 数据集
- [ ] 建立常见中式饮食 benchmark 与营养数据库候选清单

#### E. Domain & safety

- [x] 2026 ACSM resistance training 基线
- [x] 蛋白质与能量盈余研究基线
- [x] 运动中危险症状升级原则基线
- [ ] 对干预阈值进行专业审定
- [ ] 明确不同适用人群与排除条件

#### F. Quality

- [x] Information Flow Eval 设计
- [x] Framing Invariance Eval 设计
- [x] Abstention / No-change Eval 设计
- [x] Source Fidelity Eval 设计
- [ ] Phase 0 Golden Cases 定稿
- [ ] 建立人工专家审核计划

## Phase 0 Exit Review

只有 [planning/implementation-handoff.md](./planning/implementation-handoff.md) 中的退出条件被明确审核通过，才允许创建 `src/` 和真实 Plugin 配置。

## 未来阶段（仅规划，不执行）

- **Phase 1 — Reliable Data Collection**：训练日志、体重、可选饮食的事实采集；
- **Phase 2 — Deterministic Evidence Layer**：Program / Metrics / Evidence；
- **Phase 3 — Supervision Pipeline**：Blind Diagnosis / Audit / Policy Gate；
- **Phase 4 — Periodic Supervision**：Cron、静默监督、异常通知；
- **Phase 5 — Public Release**：ClawHub 验证、发布、文档与版本治理。

当前不开展上述任何实现工作。