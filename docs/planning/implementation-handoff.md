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
- [x] Product Owner 已批准 requirements 与 Golden Cases 的产品行为
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
- [x] 卓叔计划确定作为 v1 Built-in Program
- [x] Built-in Program 的具体发行制品边界已冻结：运行时派生制品随包，原始 DOCX/XLSX 不随包
- [ ] `[RELEASE-BLOCKING]` 已取得并保存覆盖实际发行制品与渠道的可核验授权
- [x] Default Program 的专业审核范围已决策
- [ ] `[DEFAULT-PROGRAM-BLOCKED]` action-bearing 训练处方完成独立 Domain Review 并获得合格签署

> 最终 source cross-check 已完成。未来若新版本原件带来新的课程内部歧义，必须集中向用户确认，不允许通用运动科学文献或 LLM 反向猜测课程意图。

## C. Platform

- [x] OpenClaw hooks 可行性确认
- [x] isolated runtime 可行性确认
- [x] media extraction 可行性确认
- [x] Cron 可行性确认
- [x] ClawHub 当前要求已调研
- [ ] `[REVALIDATE_AT_KICKOFF]` 实施启动日重新核验 OpenClaw stable API / hook semantics / model policy

## D. Model & extraction

- [x] 模型 role contracts 已定义
- [x] 当前候选模型已登记
- [x] 模型选择被冻结为 provider-neutral benchmark decision
- [x] workout-log benchmark 数据规范已定义
- [x] 真实 v1 workbook/template source 已获得并完成结构审计
- [x] supplied-template 专项 benchmark 规范已定义
- [x] food-image/diet benchmark 规范已定义
- [x] diagnosis/framing Golden Case catalog 已建立
- [ ] `[MODEL-SELECTION-BLOCKED]` workout-log 真实填写照片 pilot 样本集准备并人工标注
- [ ] `[MODEL-SELECTION-BLOCKED]` food-image 真实 benchmark 样本集准备并人工标注
- [x] OpenClaw 管 Provider/外发、Plugin 管内部编排/选择性披露/角色模型绑定的职责边界冻结
- [ ] `[REVALIDATE_AT_KICKOFF]` OpenClaw runtime execution metadata 可观测性已核验

## E. Domain policy

- [x] ACSM/蛋白质/能量盈余研究基线建立
- [x] 训练量/力竭/蛋白/增重证据与“不能推出的产品阈值”已分层
- [x] food-photo 限制建立
- [x] nutrition evidence hierarchy 建立
- [x] safety escalation 红旗类别与优先级建立
- [x] v1 默认适用人群/排除范围冻结
- [x] 中国食物成分表 / USDA / 包装标签 / 个人餐食库的数据优先级完成调研
- [x] v1 不自动执行未经专业审核的新增数值调整；未来扩展另行版本化审核
- [x] v1 nutrition fallback 已冻结；未授权的中国食物成分仓库不接入
- [ ] `[IMPLEMENTATION-BLOCKING]` Supervision/Nutrition Domain Reviewer 批准训练/营养解释、evidence hierarchy、估算置信度与建议边界
- [ ] `[IMPLEMENTATION-BLOCKING]` Safety Reviewer 批准 red flags、negative controls 与升级文案

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
- [ ] Supervision/Nutrition Domain 与 Safety Golden Cases 经对应 reviewer 批准
- [ ] `[MODEL-SELECTION-BLOCKED]` 图片类 Golden Cases 对应真实 artifacts/ground truth 准备

## G. Privacy & Release

- [x] 数据最小化原则
- [x] Runtime Directory 与用户配置的 Personal Data Directory 分离
- [x] 原始上传文件和结构化个人产出均归入 Personal Data Directory
- [x] 结构化 Analysis Records 持久化，原始模型交互默认不持久化
- [x] provider privacy research baseline
- [x] v1 不做 Plugin 数据维护功能；Personal Data Directory 通过文件系统管理并支持安全重建
- [x] 数据生命周期分层与 processing provenance 需求
- [x] 原图保留问题被明确为产品决策，而非默认永久保留
- [ ] `[IMPLEMENTATION-BLOCKING]` Privacy Reviewer 批准数据生命周期、payload 与用户控制边界
- [ ] `[MODEL-SELECTION-BLOCKED]` provider/API 具体数据保留与训练策略按最终候选重新核验并冻结
- [x] 软件许可证选择：Apache-2.0；课程内容与个人数据明确排除
- [x] ClawHub canonical identity 已冻结为 `@tower1229/stella-fitness`；实时权限在首次发布前验证
- [x] 原始训练/饮食图片默认持久保留；用户直接操作目录，Plugin 不提供删除/retention 功能
- [x] 上传原件字节保真；OpenClaw media payload 使用去 EXIF/GPS 的临时净化副本
- [x] 三类内容权利模型冻结：内置内容需授权，用户输入与用户派生产出均由用户控制
- [ ] `[RELEASE-BLOCKING]` Built-in Program 派生制品的独立发行授权取得并保存（v1 nutrition 已采用无未授权数据 fallback）
- [x] 原课程训练日志 XLSX 不随包分发，安装包使用生成式/空白模板

## Phase transition rule

只有当剩余 `IMPLEMENTATION-BLOCKING` 项被关闭，或者明确作出“移出 v1 scope / 使用保守 fallback”的产品决策后，才创建 Implementation PR。模型 pilot、实时平台契约、Default Program 专业签署和发行授权分别由 `MODEL-SELECTION-BLOCKED`、`REVALIDATE_AT_KICKOFF`、`DEFAULT-PROGRAM-BLOCKED` 和 `RELEASE-BLOCKING` 跟踪，不再制造 Phase 0 自循环。

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
15. Built-in Program 的发行包包含哪些来源与派生制品，授权覆盖哪些制品和渠道？

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

## Implementation acceptance（不属于 Phase 0 Exit）

- [ ] 卓叔 `Default Program Candidate` 作为主 fixture 覆盖完整开发与端到端验收；
- [ ] ProgramSpec Schema validator 通过；
- [ ] Program Engine 行为测试覆盖全部 12 周、recovery session 与 strength-test binding。

这些项目只能在真实实现存在后验收，不得倒置为创建实现前的条件。它们通过也不代表 Default Program 已获专业背书或发行授权。
