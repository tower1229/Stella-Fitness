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
- [ ] v1 已明确复用原课程三阶段 XLSX 训练日志，不为了首版重新设计默认记录表。
- [ ] 体重是定期低摩擦输入，不要求为制造数据而每日强制打卡。
- [ ] 饮食是可选证据，缺失时系统会降低诊断置信度，而不是阻止产品使用。
- [ ] `NO_CHANGE` / `OBSERVE` / `COLLECT_MORE_DATA` 被认可为完整产品结果。
- [ ] v1 默认适用范围为健康成年人 18+ 的一般增肌监督。
- [ ] 非目标与特殊人群边界已被 Product Owner 接受。

## 3. Source program & template

### 已完成的 source reconciliation

- [x] supplied XLSX 已确认属于原课程可靠同源配套资料。
- [x] 第 4 周周五正式内容已确认：三主项 12RM + 引体向上第一组最大次数。
- [x] Q1–Q6 已由用户基于课程背景确认。
- [x] `A` 已确认等于每个主项各自初始 12RM。
- [x] 第 4 周主项新 12RM 已确认分别直接绑定第二阶段对应 `N`。
- [x] 引体向上测试已确认用于第二阶段辅助带选择，尽量使每组达到 8 次以上，同时保持计划 total reps。
- [x] 第 4 周使用与周期结束相同的 12RM 测试协议。
- [x] “哑铃推举 / 哑铃推肩”已确认同一动作并统一为哑铃推肩；哑铃弯举保持独立动作。
- [x] 第一阶段详细逐周处方优先于“两周加重一次”的长期概括。
- [x] `program-spec.v0.2.yaml` 已生成并吸收上述确认。

### 仍需在 Phase 0 Exit 前检查

- [x] 教程、XLSX、Markdown 与 ProgramSpec v0.2 完成最终逐项 source cross-check。
- [ ] recovery session 语义完成最终核对，且不会因 workbook 使用普通训练块标题而丢失。
- [x] 卓叔计划确定作为 v1 Built-in Program。
- [x] Built-in Program 的具体发行制品边界已冻结：运行时派生制品随包，原始 DOCX/XLSX 不随包。
- [x] Plugin 代码、通用 schema 与非课程派生原创材料采用 Apache-2.0，课程内容和个人数据适用独立权利边界。
- [ ] 已取得并保存覆盖实际发行制品与渠道的可核验授权。
- [x] Default Program 的独立 Domain Review 范围已决策。
- [ ] Default Program 的 action-bearing 训练处方已完成独立 Domain Review 并获得合格签署。

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
- [ ] workout-log 真实填写照片 pilot 数据已经准备并标注。
- [ ] diet benchmark 的真实 pilot 数据已经准备并标注。
- [ ] diagnosis/framing Golden Cases 已冻结。
- [ ] 候选模型比较指标包含质量、abstention、成本、延迟、隐私，而非只看通用榜单。
- [x] OpenClaw 管 Provider/凭据/endpoint/授权与实际外发，Plugin 管内部编排、选择性披露和授权范围内的角色模型绑定。
- [ ] OpenClaw runtime 向 Plugin 返回的 execution metadata 已按锁定版本核验。

## 7. Domain policy

- [ ] Program supervision 与 Program critique/override 是两种显式能力，没有混在一起。
- [ ] 外部运动科学证据不会静默改写 source ProgramSpec。
- [x] v1 不启用未经审核的 numeric intervention，active actions 限于 `NO_CHANGE` / `OBSERVE` / `COLLECT_MORE_DATA` / `ESCALATE`。
- [x] ProgramSpec 已确认的计划进阶/恢复与监督模型新增干预已明确分离。
- [ ] Nutrition evidence hierarchy 已批准。
- [x] 中国本地营养数据库不阻断 v1；USDA/label/local-meal fallback 已接受，未授权仓库不接入。
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

- [x] Runtime Directory 与用户配置的 Personal Data Directory 已明确分离。
- [x] 原始上传文件和结构化个人产出均归入 Personal Data Directory。
- [x] Observation Records 是 canonical，Training Progress 与 runtime index 可重建。
- [x] 结构化 Analysis Records 进入 Personal Data Directory，原始模型交互默认不持久化。
- [x] raw image 默认保留策略已冻结为 Personal Data Directory 中由用户控制的持久保留。
- [x] 用户通过文件系统删除原图和结构化记录；Plugin 不提供数据维护 UI/命令。
- [x] Personal Data Directory 本身是可移植导出制品，不另做 export command。
- [x] correction provenance、文件缺失、无效手工编辑和派生重建语义已明确。
- [x] Processing provenance 仅覆盖 Plugin 提交给 OpenClaw runtime 的内容及 runtime 实际返回的元数据；边界已接受。
- [x] 原件可保留自带 metadata，但 Plugin 不结构化保存或外发无关 GPS/EXIF；媒体调用使用临时净化副本。
- [x] Plugin 无遥测/自动贡献功能；Benchmark 与真实运行数据采用 Plugin 外独立授权路径。

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
- [x] ClawHub 目标 owner/package 已冻结为 `tower1229` / `@tower1229/stella-fitness`；实时权限留在发布 gate 核验。
- [x] 软件 LICENSE 已选择为 Apache-2.0，课程内容与个人数据适用独立权利边界。

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
9. 首个 12 周计划的所有训练日是否已完整？其 `A/N/12RM` 与引体辅助关系是否均明确？
10. 用户原图和身体数据多久保存、如何删、哪些处理曾提交给 OpenClaw runtime？
11. 哪个模型坏了/换了以后，需要重跑什么 Eval？
12. 如果没有任何模型，Program/Metric 层仍能确定哪些事实？
13. 为什么 v1 直接复用现成 XLSX，而不是重新生成一份表？
14. `重量` 为什么不是一个单纯 number 字段？
15. 第 4 周周五力量测试的来源和语义是什么？

当前第 9 和第 15 项在**课程来源语义层面已经有明确答案**；仍需完成最终交叉核对和独立审核。

只要其他关键问题的答案仍是“模型自己应该能处理”，则结果应为 `CHANGES_REQUIRED`。

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
