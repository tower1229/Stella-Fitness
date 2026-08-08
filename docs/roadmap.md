# Stella Fitness Roadmap

## Phase 0 — Foundation

目标：在实现真实监督行为前冻结需求、知识、运行时边界和可测试骨架。

### 已完成

- [x] 冻结产品定位与核心交互约束
- [x] 建立反迎合 / 信息隔离要求
- [x] 完成 12 周教程 Markdown 迁移
- [x] 定义 ProgramSpec v0.1 草案
- [x] 将第 4 周周五标记为 unresolved，而不是猜测补齐
- [x] 建立已知缺口登记机制
- [x] 建立 OpenClaw Plugin manifest / package skeleton
- [x] 建立 `before_agent_reply` / `before_agent_run` pass-through hook skeleton
- [x] 建立 Program / Evidence / Diagnosis / Audit / Decision 类型边界
- [x] 建立 Program Engine unresolved fail-closed 边界
- [x] 建立 Evidence whitelist builder
- [x] 建立 Plugin-owned SQLite 初始 Schema
- [x] 建立训练日志 / 饮食 / 体重 ingress contract
- [x] 建立 Information Flow 与 Program unresolved 初始可执行测试
- [x] 建立 CI workflow
- [x] 建立模型角色与当前候选策略
- [x] 建立安装、开发与来源治理文档

### 尚未完成

- [ ] ProgramSpec JSON Schema / parser / validator
- [ ] 对全部 12 周建立 fixture tests
- [ ] OpenClaw 实际加载测试
- [ ] npm pack → OpenClaw 本地安装测试
- [ ] ClawHub `package validate`
- [ ] 解决发布相关阻塞项

### Phase 0 Exit Criteria

进入真实数据收集实现前至少需要：

1. `npm install / check / build / test / pack` 全部通过；
2. Plugin skeleton 能被锁定版本 OpenClaw 加载；
3. ProgramSpec 可以被代码解析与结构校验；
4. 所有已解析训练日有 fixture，`unresolved` session 能 fail closed；
5. canonical program 的来源缺口已经有明确运行时处理；
6. 用户运行时数据与 `knowledge/` 完全分离；
7. 关键架构不变量进入 CI。

> GAP-001（第 4 周周五）和教程再发布许可会阻止首个 program 成为 production canonical，但不阻止通用 Plugin 数据基础设施继续开发。

## Phase 1 — Reliable Data Collection

目标：先可靠收集事实，不急于做“聪明诊断”。

### 1.1 Storage & repositories

- [ ] SQLite migration runner
- [ ] typed repositories
- [ ] artifact storage layout
- [ ] backup / restore test
- [ ] user correction audit trail

### 1.2 Body weight

- [ ] 自然语言输入路由
- [ ] unit / parsing policy
- [ ] 写库与查询
- [ ] 趋势 fixture

### 1.3 Training log image ingestion

- [ ] OpenClaw `mediaUnderstanding.extractStructuredWithModel` adapter
- [ ] TrainingLog extraction JSON Schema
- [ ] exercise alias / normalization
- [ ] low-confidence correction flow
- [ ] real handwritten fixture set
- [ ] field-level extraction metrics

### 1.4 Optional diet ingestion

- [ ] image/text schema
- [ ] range-based macro estimation
- [ ] uncertainty storage
- [ ] user-confirmed packaged nutrition values

### 1.5 Metrics Engine

- [ ] completion metrics
- [ ] load / rep / capacity trends
- [ ] body-weight trend
- [ ] evidence coverage
- [ ] planned recovery semantics

### Phase 1 Exit Criteria

- 真实训练日志样本有 extraction eval；
- 原始图片和结构化记录可追溯；
- 错误识别可以被用户修正；
- 体重、训练和可选饮食数据可形成时间序列；
- deterministic metrics 具有 fixture tests；
- 不需要诊断模型即可回答“事实是什么”。

## Phase 2 — Supervision Pipeline

目标：建立客观、可审计的长期监督链。

- [ ] OpenClaw isolated LLM adapter
- [ ] Blind Diagnostician
- [ ] User Belief Extractor
- [ ] Frozen Diagnosis storage
- [ ] Adversarial Auditor
- [ ] deterministic Policy Gate
- [ ] Restricted Reporter / templates
- [ ] `NO_CHANGE / OBSERVE / COLLECT_MORE_DATA / ADJUST_* / RECOVERY / ESCALATE`
- [ ] safety escalation policy
- [ ] model failure / timeout handling
- [ ] `before_agent_reply` 正式 claim 领域 turn
- [ ] `before_agent_run` fail-closed guard

### Phase 2 Exit Criteria

必须通过：

- Information Flow tests；
- Framing Invariance tests；
- Evidence Fidelity tests；
- Abstention tests；
- No-change tests；
- Source Fidelity tests；
- Recovery semantics tests；
- 模型调用失败时的 fail-closed tests。

## Phase 3 — Periodic Supervision

目标：把“后台长期监督”变成真正低打扰的 Agent 能力。

- [ ] deterministic review scheduler
- [ ] OpenClaw Cron integration
- [ ] normal state → silence / NO_REPLY
- [ ] anomaly / review-due → supervision pipeline
- [ ] deduplication / idempotency
- [ ] notification policy
- [ ] cost / latency telemetry

## Phase 4 — Public Release

目标：形成任何 OpenClaw 用户可安装的独立 Plugin。

- [x] 文档系统与 README 基础
- [x] 安装 / 开发文档基础
- [x] Provider 与模型策略基础
- [x] 隐私 / 来源治理原则
- [ ] software LICENSE
- [ ] program redistribution decision
- [ ] ClawHub owner / package scope verification
- [ ] OpenClaw plugin load test
- [ ] ClawHub package validation
- [ ] `publish --dry-run`
- [ ] example deployment
- [ ] Eval report
- [ ] final backup / restore guide
- [ ] CHANGELOG release entries
- [ ] v1.0 release

## 当前下一步

**完成 Phase 0 的真实构建验证与 ProgramSpec validator。**

随后优先进入 Phase 1 的事实采集层，不提前实现诊断模型。只有当训练日志、体重、来源追溯和 deterministic metrics 足够可靠后，才开始接 Blind Diagnosis / Audit。
