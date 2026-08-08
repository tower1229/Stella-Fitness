# Phase 0 → Implementation Handoff

本文定义“什么时候才算需求阶段完成”。未显式通过本清单前，不创建 `src/` 或真实 Plugin package。

正式签署入口见 [phase0-exit-review.md](./phase0-exit-review.md)，reviewer 职责见 [review-governance.md](./review-governance.md)。

## A. Product

- [x] 产品定位已冻结
- [x] 核心用户流程已冻结
- [x] 非目标已冻结
- [x] 默认不干预原则已冻结
- [x] 决策状态语义已定义
- [x] v1 默认适用范围冻结为健康成年人（18+）的一般增肌监督
- [x] v1 训练日志模板已选定：复用原课程三阶段 XLSX
- [x] Phase 0 Golden Case catalog 已起草
- [ ] Phase 0 Golden Cases 完成人工/专业复核并标记 `FROZEN v0.1`

## B. Source program

- [x] 教程完成 Markdown 重组
- [x] 原课程配套三阶段 XLSX 来源关系已确认
- [x] 第 4 周周五正式补齐为力量测试
- [x] Q1–Q6 课程关系语义集中确认完成
- [x] `A` = 各主项初始 12RM
- [x] 第 4 周主项新 12RM → 第二阶段对应 `N`
- [x] 第 4 周引体测试 → 第二阶段辅助带选择，尽量每组 ≥8 次
- [x] 第 4 周与周期末使用同一 12RM 测试协议
- [x] “哑铃推举 / 哑铃推肩”统一为哑铃推肩；哑铃弯举为独立动作
- [x] 第一阶段详细逐周处方优先于“两周加重一次”长期概括
- [x] `program-spec.v0.2.yaml` 已形成 source-reconciled draft
- [x] 教程/XLSX/Markdown/ProgramSpec v0.2 完成最终逐项 source cross-check
- [ ] ClawHub/npm 等发行包是否捆绑教程 / XLSX 已决策，或确定不捆绑源内容
- [ ] 默认 public program 的专业审核范围已决策并完成相应 review

> 最终 source cross-check 已完成。未来若新版本原件带来新的课程内部歧义，必须集中向用户确认，不允许通用运动科学文献或 LLM 反向猜测课程意图。

## C. Platform

- [x] OpenClaw hooks 可行性确认
- [x] isolated runtime 可行性确认
- [x] media extraction 可行性确认
- [x] Cron 可行性确认
- [x] ClawHub 当前要求已调研
- [ ] 实施启动日重新核验 OpenClaw stable API / hook semantics / model policy

## D. Model & extraction

- [x] 模型 role contracts 已定义
- [x] 当前候选模型已登记
- [x] 模型选择被冻结为 provider-neutral benchmark decision
- [x] workout-log benchmark 数据规范已定义
- [x] 真实 v1 workbook/template source 已获得并完成结构审计
- [x] supplied-template 专项 benchmark 规范已定义
- [x] food-image/diet benchmark 规范已定义
- [x] diagnosis/framing Golden Case catalog 已建立
- [ ] workout-log 真实填写照片 pilot 样本集准备并人工标注
- [ ] food-image 真实 benchmark 样本集准备并人工标注
- [ ] provider privacy profile 选择策略冻结

## E. Domain policy

- [x] ACSM/蛋白质/能量盈余研究基线建立
- [x] 训练量/力竭/蛋白/增重证据与“不能推出的产品阈值”已分层
- [x] food-photo 限制建立
- [x] nutrition evidence hierarchy 建立
- [x] safety escalation 红旗类别与优先级建立
- [x] v1 默认适用人群/排除范围冻结
- [x] 中国食物成分表 / USDA / 包装标签 / 个人餐食库的数据优先级完成调研
- [ ] 体重/训练/饮食具体数值干预阈值获得专业审定并版本化，或明确 v1 不自动执行该类精确调整
- [ ] 中国食物成分表数字访问/许可方案确认，或冻结 fallback

## F. Quality

- [x] Information Flow Eval 定义
- [x] Framing Invariance Eval 定义
- [x] Balanced Intervention Eval 定义
- [x] Safety Eval 定义
- [x] Source Fidelity Eval 定义
- [x] Training Log Extraction Benchmark 规范定义
- [x] Supplied Template 专项 Benchmark 规范定义
- [x] Diet Evidence Benchmark 规范定义
- [x] 初版 Golden Cases 文档化
- [x] Product / Domain / Safety / Privacy / Platform / Rights reviewer 角色定义
- [ ] 所有 Golden Cases 经 reviewer 批准
- [ ] 图片类 Golden Cases 对应真实 artifacts/ground truth 准备

## G. Privacy & Release

- [x] 数据最小化原则
- [x] provider privacy research baseline
- [x] 用户数据导出/删除需求
- [x] 数据生命周期分层与 Provider disclosure ledger 需求
- [x] 原图保留问题被明确为产品决策，而非默认永久保留
- [ ] provider/API 具体数据保留与训练策略按最终候选重新核验并冻结
- [ ] 软件许可证选择
- [ ] ClawHub owner/scope 确认
- [ ] 原始训练/饮食图片默认保留时长与删除策略冻结
- [ ] source program / nutrition data 的公开分发权处理完成
- [ ] 原课程训练日志 XLSX 的 public redistribution 权限确认，或确定不随 ClawHub 包分发原文件

## Phase transition rule

只有当剩余 `BLOCKING` 项被关闭，或者明确作出“移出 v1 scope / 使用保守 fallback”的产品决策后，才创建 Implementation PR。

实施 PR 的第一项工作应是重新验证依赖契约，而不是直接照搬 2026-08-08 的 SDK/模型版本。

## Phase 0 Exit Review 必须回答

在真正开工前，应能明确回答：

1. v1 到底服务谁，不服务谁？
2. 用户最少要提供什么数据？
3. 什么情况下系统必须保持沉默？
4. 什么情况下必须 `COLLECT_MORE_DATA`？
5. 什么情况下才允许调整？
6. 哪些健康信号必须优先 `ESCALATE`？
7. Blind Diagnostician 精确能看到哪些字段？
8. 各模型角色的 benchmark 和替换标准是什么？
9. 营养数据按什么来源优先级取得？
10. 首个 Program 是否所有训练日与关键符号/测试关系均已确认？
11. 用户数据存在哪里、哪些会发给外部 provider、如何删除/导出？
12. Golden Cases 是否已经在实现前被批准？
13. 每一项 domain/safety/privacy 决策由谁批准并如何版本化？
14. 哪些 numeric threshold 已获批准，哪些仍必须保持 Unknown？
15. 训练日志模板能否公开再分发，还是只作为用户侧/private artifact？

当前第 10 项在课程语义层已可以回答“是”，最终 source cross-check 也已完成；仍需完成发布与专业审核。

如果其他关键问题仍依赖“让模型到时候自己判断”，Phase 0 不应结束。

## 建议的实施起点（未来，不执行）

1. domain schemas + source fixture validation；
2. supplied XLSX layout contract + extraction benchmark harness；
3. local storage + correction/audit primitives；
4. training-log extraction；
5. deterministic Program/Metrics/Evidence；
6. isolated Blind Diagnosis；
7. Belief/Audit/Policy；
8. Cron；
9. release packaging。

ProgramSpec-driven generic template generator 已移出 v1 前置路径；只有未来支持其他 program 时再考虑。

该顺序只是交接建议，Phase 0 不执行。
