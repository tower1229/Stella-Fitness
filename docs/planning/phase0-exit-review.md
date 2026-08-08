# Phase 0 Exit Review

**用途：** 在任何实现分支创建前，对 Stella Fitness 的需求、研究、数据、专业边界和发布前置条件进行一次正式审查。

**规则：** 该文件不是“项目进度打勾表”，而是开工许可。只有 `BLOCKING` 项全部关闭或被明确移出 v1 scope，才能把结果标记为 `APPROVED FOR IMPLEMENTATION`。

## 1. Review metadata

```text
review_version: phase0-exit/v0.1
review_date:
product_owner:
domain_reviewer:
safety_reviewer:
privacy_reviewer:
platform_reviewer:
rights_reviewer:
result: PENDING | APPROVED | CHANGES_REQUIRED
```

## 2. Product definition

- [ ] 能用一句话说明 Stella Fitness 的核心价值，而不是泛化为“AI 健身教练”。
- [ ] 明确训练过程中不要求手机交互。
- [ ] **v1 已明确复用用户提供的三阶段 XLSX 训练日志，不为了首版重新设计默认记录表。**
- [ ] 体重是定期低摩擦输入，不要求为制造数据而每日强制打卡。
- [ ] 饮食是可选证据，缺失时系统会降低诊断置信度，而不是阻止产品使用。
- [ ] `NO_CHANGE` / `OBSERVE` / `COLLECT_MORE_DATA` 被认可为完整产品结果。
- [ ] v1 默认适用范围为健康成年人 18+ 的一般增肌监督。
- [ ] 非目标与特殊人群边界已被 Product Owner 接受。

## 3. Source program & template

- [ ] 12 周教程 Markdown 与 ProgramSpec 草案经过来源逐项核对。
- [ ] supplied XLSX 与教程的 week/day/action 对应关系完成审计。
- [ ] Week 4 Friday 的冲突已解决：教程缺失 vs workbook 力量测试，**或**继续明确保持 canonical unresolved。
- [ ] `A / A+1 / N / N+1` 等 symbolic load 语义没有被误写成固定公斤增量。
- [ ] recovery session 语义明确，且不会因 workbook 使用普通训练块标题而丢失。
- [ ] 教程公开再分发权已经确认，**或**采用不分发受限内容的明确 fallback。
- [ ] XLSX 模板公开再分发权已经确认，**或**明确只把模板视为用户侧/private artifact。
- [ ] 是否需要专业审核该 source program 已决策并完成对应 review。

## 4. Workout-log extraction semantics

- [ ] `重量` 明确允许 external kg / bodyweight / assisted / exercise variant / none 等多态语义。
- [ ] 引体向上弹力带颜色不会被强制转成 kg。
- [ ] 俯卧撑 `跪姿/标准/负重` 不会被丢失为普通 numeric load。
- [ ] set columns 会根据动作解释为 reps 或 duration。
- [ ] 平板支撑 `30/45/60` 等不会被错误当成 repetitions。
- [ ] `高/中/低` 动作质量仅作为 subjective signal，不会映射为固定 RPE/RIR。
- [ ] `问题备注` 已设计为 belief/safety 分流，而不是整段进入 Blind Diagnosis。
- [ ] 空白 actual 永远不会根据 ProgramSpec 自动补成计划目标。
- [ ] 第 4 周周五 `strength_test_block` 有独立 extraction schema/ground truth。

## 5. Evidence architecture

- [ ] Raw Artifact / Observation / Subjective Claim / Derived Metric 分层清楚。
- [ ] EvidencePacket 字段白名单完成设计审查。
- [ ] User Belief 明确不进入 Blind Diagnosis。
- [ ] Blind Diagnosis 冻结后才允许 Auditor 查看 User Belief。
- [ ] Reporter 不重新获得完整 conversation context。
- [ ] Unknown / conflict / low-confidence 都有结构化表示。
- [ ] 用户纠错能成为新的事实来源并触发派生结果更新。

## 6. Model roles

- [ ] Extraction / Belief / Blind Diagnosis / Audit / Reporter 的 role contract 已审核。
- [ ] 没有把模型厂商名称写成 domain semantics。
- [ ] supplied XLSX 已作为 Tier A layout 固定。
- [ ] workout-log **真实填写照片** pilot 数据已经准备并标注。
- [ ] diet benchmark 的真实 pilot 数据已经准备并标注。
- [ ] diagnosis/framing Golden Cases 已冻结。
- [ ] 候选模型比较指标包含质量、abstention、成本、延迟、隐私，而非只看通用榜单。
- [ ] Provider privacy profile 已重新核对当前官方政策。

## 7. Domain policy

- [ ] Program supervision 与 Program critique/override 是两种显式能力，没有混在一起。
- [ ] 外部运动科学证据不会静默改写 source ProgramSpec。
- [ ] 所有 production numeric intervention threshold 均有来源、适用人群、reviewer 和 policy version。
- [ ] 如果 numeric policy 尚未批准，v1 已明确采用何种保守 fallback。
- [ ] Nutrition evidence hierarchy 已批准。
- [ ] 中国本地营养数据库方案已确认，或 USDA/label/local-meal fallback 已明确接受。
- [ ] Diet photo 只产生与证据质量匹配的范围/confidence。

## 8. Safety

- [ ] `ESCALATE` 优先级高于训练/饮食优化。
- [ ] cardiovascular red flags 已审核。
- [ ] severe acute injury red flags 已审核。
- [ ] possible rhabdomyolysis pattern 已审核。
- [ ] ordinary soreness / DOMS 作为 negative control 已审核，避免过度升级。
- [ ] 特殊人群不默认套用 healthy-adult policy。
- [ ] safety 文案不会让用户在 red flag 出现后继续完成计划。

## 9. Privacy & data lifecycle

- [ ] raw image 默认保留策略已冻结。
- [ ] 用户可以删除原图和结构化记录。
- [ ] 用户可以导出个人数据。
- [ ] correction provenance 与删除语义已明确。
- [ ] Provider disclosure ledger 需求已接受。
- [ ] 不保存无关 GPS/EXIF/其他 Agent 私人上下文。
- [ ] benchmark 图片与真实运行数据的授权路径分离。

## 10. Quality / Golden Cases

- [ ] `golden-cases.md` 已标记 `FROZEN v0.1`。
- [ ] Product Owner 已批准全部产品行为 Expected/Forbidden。
- [ ] Domain reviewer 已批准 domain cases。
- [ ] Safety reviewer 已批准 safety cases。
- [ ] no-change 与 adjustment case 数量平衡，不是单向优化。
- [ ] Framing variants 已冻结，不允许实现后为了提高分数重写。
- [ ] Training Log Benchmark 有 critical numeric / abstention / blank-preservation 指标。
- [ ] supplied-template benchmark 有 load semantic / reps-duration / strength-test layout 指标。
- [ ] Diet Benchmark 有 source-selection / false-precision / calibration 指标。
- [ ] Auditor 同时测试“应该推翻”和“不应该推翻”的案例。

## 11. OpenClaw / Release dependencies

- [ ] Implementation kickoff 当天重新核对 OpenClaw Plugin hooks。
- [ ] isolated model runtime contract 重新核对。
- [ ] media structured extraction contract 重新核对。
- [ ] model override / permission contract 重新核对。
- [ ] Cron 静默任务能力重新核对。
- [ ] ClawHub publish/owner/scope 规则重新核对。
- [ ] 软件 LICENSE 已选择或明确不进入公开发布阶段。

## 12. Blocking GAP review

逐项检查 `known-gaps.md`。

每个 blocking GAP 必须满足之一：

```text
CLOSED
MOVED_OUT_OF_V1_WITH_EXPLICIT_DECISION
ACCEPTED_WITH_DOCUMENTED_CONSERVATIVE_FALLBACK
```

禁止使用：

```text
“实现时让 AI 判断”
“先做了再说”
“应该问题不大”
```

作为关闭理由。

## 13. Final questions

Review meeting 必须能清楚回答：

1. 用户训练当天最少需要做什么？
2. Agent 什么时候应该什么都不说？
3. 哪些输入算事实，哪些只是用户观点？
4. Blind Diagnostician 到底看不到什么？
5. 哪些数据质量不足会阻止调整？
6. Diet photo 为什么不能当精确营养计量？
7. 哪些安全信息会强制退出普通增肌路径？
8. 哪些数字是经过审核的 Policy，哪些仍然只是研究参考？
9. 首个 12 周计划哪些地方仍然不完整？
10. 用户原图和身体数据多久保存、如何删、发给过谁？
11. 哪个模型坏了/换了以后，需要重跑什么 Eval？
12. 如果没有任何模型，Program/Metric 层仍能确定哪些事实？
13. 为什么 v1 直接复用现成 XLSX，而不是重新生成一份表？
14. `重量` 为什么不是一个单纯 number 字段？
15. 第 4 周周五的 XLSX 力量测试是否已经具有足够 provenance 成为 canonical source？

只要其中一个关键问题的答案仍是“模型自己应该能处理”，则结果应为 `CHANGES_REQUIRED`。

## 14. Sign-off

```text
Product:  APPROVED / CHANGES_REQUIRED
Domain:   APPROVED / CHANGES_REQUIRED / NOT_REQUIRED_FOR_REDUCED_SCOPE
Safety:   APPROVED / CHANGES_REQUIRED
Privacy:  APPROVED / CHANGES_REQUIRED
Platform: APPROVED / REVALIDATE_AT_KICKOFF
Rights:   APPROVED / CHANGES_REQUIRED / RELEASE_ONLY

Overall:  PENDING / APPROVED FOR IMPLEMENTATION / CHANGES_REQUIRED
```
