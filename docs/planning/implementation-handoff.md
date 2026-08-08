# Phase 0 → Implementation Handoff

本文定义“什么时候才算需求阶段完成”。未显式通过本清单前，不创建 `src/` 或真实 Plugin package。

## A. Product

- [x] 产品定位已冻结
- [x] 核心用户流程已冻结
- [x] 非目标已冻结
- [x] 默认不干预原则已冻结
- [x] 决策状态语义已定义
- [ ] Phase 0 Golden Cases 完成并人工复核

## B. Source program

- [x] 教程完成 Markdown 重组
- [x] ProgramSpec v0.1 设计完成
- [x] source audit 建立
- [ ] Week 4 Friday 可靠来源补齐，或决定不把该 program 作为完整默认计划
- [ ] 教程公开再发布权明确，或确定本地导入替代方案
- [ ] 默认 program 是否需要外部专业审核已决策

## C. Platform

- [x] OpenClaw hooks 可行性确认
- [x] isolated runtime 可行性确认
- [x] media extraction 可行性确认
- [x] Cron 可行性确认
- [x] ClawHub 当前要求已调研
- [ ] 实施启动日重新核验 OpenClaw stable API

## D. Model

- [x] 模型 role contracts 已定义
- [x] 当前候选模型已登记
- [ ] workout-log benchmark 样本集准备
- [ ] food-image benchmark 样本集准备
- [ ] diagnosis/framing Golden Cases 准备
- [ ] provider privacy profile 选择策略冻结

## E. Domain policy

- [x] ACSM/蛋白质/能量盈余研究基线建立
- [x] food-photo 限制建立
- [x] safety escalation 高层原则建立
- [ ] 体重/训练/饮食干预阈值获得专业审定
- [ ] 默认适用人群/排除人群冻结
- [ ] 中式营养数据库候选完成调研

## F. Quality

- [x] Information Flow Eval 定义
- [x] Framing Invariance Eval 定义
- [x] Balanced Intervention Eval 定义
- [x] Safety Eval 定义
- [x] Source Fidelity Eval 定义
- [ ] 所有 Golden Case fixtures 在代码实现前以数据/文档形式冻结

## G. Privacy & Release

- [x] 数据最小化原则
- [x] provider privacy research baseline
- [x] 用户数据导出/删除需求
- [ ] 软件许可证选择
- [ ] ClawHub owner/scope 确认
- [ ] 对原图保留策略做产品决策

## Phase transition rule

只有当剩余 `BLOCKING` 项被关闭或明确作出“移出 v1 scope”的产品决策后，才创建 Implementation PR。

实施 PR 的第一项工作应是重新验证依赖契约，而不是直接照搬 2026-08-08 的 SDK/模型版本。

## 建议的实施起点（未来，不执行）

1. domain schemas + source fixture validation；
2. local storage + correction/audit primitives；
3. training-log extraction benchmark implementation；
4. deterministic Program/Metrics/Evidence；
5. isolated Blind Diagnosis；
6. Belief/Audit/Policy；
7. Cron；
8. release packaging。

该顺序只是交接建议，Phase 0 不执行。