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
- 哪些领域原则已有证据，哪些个体数值阈值仍需专业审定；
- 训练教程是否完整、可再发布；
- 如何证明系统没有因为用户 framing 改变诊断；
- 谁负责批准专业、安全、隐私和发布相关结论。

### Phase 0 工作包

#### A. Product requirements

- [x] 产品定位与非目标
- [x] Offline-first 训练交互
- [x] **v1 训练日志模板已确定：复用用户提供的三阶段 XLSX**
- [x] 不为 v1 强制开发新的 ProgramSpec-driven printable generator
- [x] 训练日志/体重/饮食输入边界
- [x] 默认不干预
- [x] 信息隔离与反迎合原则
- [x] 决策状态语义
- [x] v1 默认适用范围：健康成年人 18+、一般增肌监督、非医疗/康复

#### B. Source & knowledge

- [x] 12 周教程 Markdown 化
- [x] ProgramSpec v0.1 设计草案
- [x] source audit
- [x] 缺失内容保持 unresolved
- [x] source program 与外部研究分层，不静默改写
- [x] 获得 Week 4 Friday 新 candidate evidence：XLSX 显示力量测试
- [ ] 确认 XLSX provenance 是否足以补齐 Week 4 Friday canonical source，否则继续 unresolved
- [ ] 明确教程再发布许可
- [ ] 明确 XLSX 模板公开再发布许可，或接受“不随 ClawHub 包分发原文件”的 fallback
- [ ] 决定 source program 的专业审核范围

#### C. Platform research

- [x] OpenClaw hooks
- [x] isolated LLM runtime
- [x] structured media extraction
- [x] model allowlist / override policy
- [x] Cron 静默周期任务
- [x] ClawHub package 发布要求
- [ ] 实施开始前重新核验 OpenClaw 当前稳定版本和 SDK contract

#### D. Model & data research

- [x] 模型角色契约与 provider-neutral 选择原则
- [x] 当前视觉/推理/Audit 候选模型登记
- [x] Provider 数据使用/保留研究基线
- [x] 食物照片营养估算局限
- [x] Nutrition evidence hierarchy
- [x] 中国食物成分表 + USDA FoodData Central 候选调研
- [x] Training Log Benchmark 规范
- [x] **supplied XLSX 专项 extraction benchmark 规范**
- [x] Diet Benchmark 规范
- [ ] 采集并人工标注真实填写后的训练日志照片 pilot benchmark
- [ ] 采集并人工标注真实饮食 pilot benchmark
- [ ] 中国本地食物成分数字访问/授权方案确认，或正式接受 fallback
- [ ] 最终 Provider privacy profile 冻结

#### E. Domain & safety

- [x] 2026 ACSM resistance training 基线
- [x] 蛋白质与能量盈余研究基线
- [x] “可冻结领域原则 / 不可直接推出的数值阈值”分层
- [x] 运动中危险症状升级类别
- [x] severe injury / possible rhabdomyolysis safety baseline
- [x] 默认适用人群与特殊人群排除边界
- [ ] 对 production numeric intervention policy 进行专业审定
- [ ] 决定 public default Program / nutrition / safety 的专业审核机制并完成首轮 review

#### F. Quality & governance

- [x] Information Flow Eval 设计
- [x] Framing Invariance Eval 设计
- [x] Abstention / No-change Eval 设计
- [x] Source Fidelity Eval 设计
- [x] Safety Eval 设计
- [x] Golden Cases 第一版目录
- [x] Training Log / Diet Benchmark metric 设计
- [x] reviewer role / approval matrix
- [x] Phase 0 Exit Review checklist
- [ ] Product Owner 审核 Golden Cases
- [ ] Domain reviewer 审核 domain cases / numeric policy
- [ ] Safety reviewer 审核 safety cases
- [ ] 将 Golden Cases 标记 `FROZEN v0.1`

#### G. Privacy & rights

- [x] 数据最小化与 role-specific disclosure
- [x] 数据 lifecycle 分类与用户控制要求
- [x] Provider disclosure ledger 需求
- [x] benchmark 数据与运行数据授权分离
- [ ] 冻结 raw artifact 默认保留策略
- [ ] 教程内容权利处理
- [ ] XLSX 模板公开再分发权处理
- [ ] 中国食物成分数据权利处理
- [ ] 软件许可证

## 当前真正的下一批 Phase 0 工作

优先级：

1. **确认训练日志模板 provenance**：决定它能否同时解决 Week 4 Friday source gap；
2. **真实 benchmark pilot 准备**：用这份 XLSX 打印并产生真实手写照片与 ground truth；
3. **Golden Cases review**：让 Product / Domain / Safety reviewer 逐案确认；
4. **production numeric policy review**：如果无法得到可靠审核，明确 v1 缩减自动调整范围；
5. **source / rights resolution**：教程与 XLSX 模板分发权；
6. **privacy decisions**：raw image retention 与最终 Provider profile；
7. **Phase 0 Exit Review**。

## Phase 0 Exit Review

只有 [planning/phase0-exit-review.md](./planning/phase0-exit-review.md) 被正式签署为 `APPROVED FOR IMPLEMENTATION`，才允许创建 `src/` 和真实 Plugin 配置。

详细交接条件见 [planning/implementation-handoff.md](./planning/implementation-handoff.md)。

## 未来阶段（仅规划，不执行）

- **Phase 1 — Reliable Data Collection**：基于现成 XLSX 的训练日志照片、体重、可选饮食事实采集；
- **Phase 2 — Deterministic Evidence Layer**：Program / Metrics / Evidence；
- **Phase 3 — Supervision Pipeline**：Blind Diagnosis / Audit / Policy Gate；
- **Phase 4 — Periodic Supervision**：Cron、静默监督、异常通知；
- **Phase 5 — Public Release**：ClawHub 验证、发布、文档与版本治理。

当前不开展上述任何实现工作。
