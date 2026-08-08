# Stella Fitness Roadmap

## Phase 0 — Foundation

目标：在写 Plugin 代码前冻结需求、知识和机器规格。

- [x] 冻结产品定位与核心交互约束
- [x] 建立反迎合/信息隔离要求
- [x] 完成 12 周教程 Markdown 迁移
- [x] 定义 ProgramSpec v0.1
- [x] 将第 4 周周五标记为 unresolved，而不是猜测补齐
- [x] 建立已知缺口登记机制
- [ ] 补齐第 4 周周五可靠来源
- [ ] 确认教程内容正式公开发布许可
- [ ] 建立 OpenClaw Plugin skeleton
- [ ] 为 ProgramSpec 建 schema validator 与 fixtures

### Phase 0 Exit Criteria

进入 Phase 1 前至少需要：

1. Plugin skeleton 可被 OpenClaw 加载；
2. ProgramSpec 可以被代码解析与验证；
3. unresolved session 能 fail closed；
4. canonical program 的来源缺口已经有明确运行时处理；
5. 不把用户运行时数据写入 knowledge。

## Phase 1 — Data Collection

目标：先可靠收集事实，不急于做“聪明诊断”。

- [ ] 纸质训练日志图片 ingestion
- [ ] Structured extraction schema
- [ ] 低置信字段纠错流程
- [ ] Body weight tracking
- [ ] Optional diet ingestion
- [ ] Plugin-managed SQLite storage
- [ ] Raw artifact → observation provenance
- [ ] Metrics Engine 基础指标

### Phase 1 Exit Criteria

- 真实训练日志样本有 extraction eval；
- 原始图片和结构化记录可追溯；
- 错误识别可以被用户修正；
- 体重、训练和可选饮食数据可形成时间序列。

## Phase 2 — Supervision Pipeline

目标：建立客观、可审计的长期监督链。

- [ ] EvidencePacket Builder
- [ ] Blind Diagnostician
- [ ] User Belief Extractor
- [ ] Adversarial Auditor
- [ ] Deterministic Policy Gate
- [ ] Restricted Reporter
- [ ] NO_CHANGE / OBSERVE / COLLECT_MORE_DATA 等决策语义
- [ ] OpenClaw Cron 周期监督

### Phase 2 Exit Criteria

必须通过：

- Information Flow tests；
- Framing Invariance tests；
- Abstention tests；
- No-change tests；
- Source Fidelity tests；
- 模型调用失败时的 fail-closed tests。

## Phase 3 — Release

目标：形成任何 OpenClaw 用户可安装的独立 Plugin。

- [ ] 完整 README
- [ ] 安装/升级/卸载文档
- [ ] Provider 与模型配置说明
- [ ] 隐私与数据备份说明
- [ ] ClawHub metadata
- [ ] ClawHub package validation
- [ ] Example deployment
- [ ] Eval report
- [ ] CHANGELOG
- [ ] v1.0 release

## 当前下一步

**建立 OpenClaw Plugin skeleton + ProgramSpec validator/tests。**

在此之前不继续扩展训练功能，避免在数据基础和执行契约未稳定时提前引入复杂 Agent 行为。
