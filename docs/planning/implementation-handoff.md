# Phase 0 → Implementation Handoff

本文定义“什么时候才算需求阶段完成”。未显式通过本清单前，不创建 `src/` 或真实 Plugin package。

## A. Product

- [x] 产品定位已冻结
- [x] 核心用户流程已冻结
- [x] 非目标已冻结
- [x] 默认不干预原则已冻结
- [x] 决策状态语义已定义
- [x] v1 默认适用范围冻结为健康成年人（18+）的一般增肌监督
- [x] offline-first printable workout log 作为推荐输入路径已定义
- [x] Phase 0 Golden Case catalog 已起草
- [ ] Phase 0 Golden Cases 完成人工/专业复核并标记 `FROZEN v0.1`

## B. Source program

- [x] 教程完成 Markdown 重组
- [x] ProgramSpec v0.1 设计完成
- [x] source audit 建立
- [ ] Week 4 Friday 可靠来源补齐，或决定不把该 program 作为完整默认计划
- [ ] 教程公开再发布权明确，或确定本地导入替代方案
- [ ] 默认 program 是否需要外部专业审核已决策

> Source Program 的缺口不允许由通用运动科学文献反向猜测补齐。

## C. Platform

- [x] OpenClaw hooks 可行性确认
- [x] isolated runtime 可行性确认
- [x] media extraction 可行性确认
- [x] Cron 可行性确认
- [x] ClawHub 当前要求已调研
- [ ] 实施启动日重新核验 OpenClaw stable API / hook semantics / model policy

## D. Model

- [x] 模型 role contracts 已定义
- [x] 当前候选模型已登记
- [x] 模型选择被冻结为 provider-neutral benchmark decision，而非固定厂商依赖
- [x] workout-log benchmark 数据规范已定义
- [x] food-image benchmark 评估方向已定义
- [x] diagnosis/framing Golden Case catalog 已建立
- [ ] workout-log 真实 pilot 样本集准备并人工标注
- [ ] food-image 真实 benchmark 样本集准备并人工标注
- [ ] provider privacy profile 选择策略冻结

## E. Domain policy

- [x] ACSM/蛋白质/能量盈余研究基线建立
- [x] 训练量/力竭/蛋白/增重证据与“不能推出的产品阈值”已分层
- [x] food-photo 限制建立
- [x] safety escalation 红旗类别与优先级建立
- [x] v1 默认适用人群/排除范围冻结
- [x] 中国食物成分表 / USDA / 包装标签 / 个人餐食库的数据优先级完成调研
- [ ] 体重/训练/饮食**具体数值干预阈值**获得专业审定并版本化
- [ ] 中国食物成分表数字访问/许可方案确认，或冻结 USDA + label + local meal library 的 v1 fallback

## F. Quality

- [x] Information Flow Eval 定义
- [x] Framing Invariance Eval 定义
- [x] Balanced Intervention Eval 定义
- [x] Safety Eval 定义
- [x] Source Fidelity Eval 定义
- [x] Training Log Extraction Benchmark 规范定义
- [x] 初版 Golden Cases 文档化
- [ ] 所有 Golden Cases 经 reviewer 批准
- [ ] 图片类 Golden Cases 对应真实 artifacts/ground truth 准备

## G. Privacy & Release

- [x] 数据最小化原则
- [x] provider privacy research baseline
- [x] 用户数据导出/删除需求
- [x] 原图保留问题被明确为产品决策，而非默认永久保留
- [ ] provider/API 具体数据保留与训练策略按最终候选重新核验并冻结
- [ ] 软件许可证选择
- [ ] ClawHub owner/scope 确认
- [ ] 原始训练/饮食图片默认保留时长与删除策略冻结

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
10. 首个 Program 的缺口和授权如何处理？
11. 用户数据存在哪里、哪些会发给外部 provider、如何删除/导出？
12. Golden Cases 是否已经在实现前被批准？

如果其中任何问题仍依赖“让模型到时候自己判断”，Phase 0 不应结束。

## 建议的实施起点（未来，不执行）

1. domain schemas + source fixture validation；
2. printable log specification → generated template contract；
3. local storage + correction/audit primitives；
4. training-log extraction benchmark implementation；
5. deterministic Program/Metrics/Evidence；
6. isolated Blind Diagnosis；
7. Belief/Audit/Policy；
8. Cron；
9. release packaging。

该顺序只是交接建议，Phase 0 不执行。