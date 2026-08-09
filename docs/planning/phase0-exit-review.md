# Phase 0 Exit Review

**用途：** 在任何实现分支创建前，对 Stella Fitness 的需求、研究、数据和专业边界进行正式审查，并把实施、模型选择、启动复核与发布门禁明确分开。

**规则：** 该文件不是“项目进度打勾表”，而是开工许可。只有 `IMPLEMENTATION-BLOCKING` 项全部关闭或被明确移出 v1 scope，才能把结果标记为 `APPROVED FOR IMPLEMENTATION`。`MODEL-SELECTION-BLOCKED`、`REVALIDATE_AT_KICKOFF`、`DEFAULT-PROGRAM-BLOCKED` 和 `RELEASE-BLOCKING` 必须保留为对应阶段的真实门禁，但不与 Phase 0 开工许可混为一谈。

## 1. Review metadata

```text
review_version: phase0-exit/v0.1
review_date: 2026-08-09
product_owner: tower1229
domain_reviewer: PENDING — Supervision/Nutrition Policy + domain Golden Cases
safety_reviewer: PENDING
privacy_reviewer: PENDING
platform_reviewer: PENDING — REVALIDATE_AT_KICKOFF
rights_reviewer: PENDING — RELEASE_ONLY authorization review
result: CHANGES_REQUIRED
```

### 1.1 Staged gates

| Gate | Required before | Current state |
|---|---|---|
| `IMPLEMENTATION-BLOCKING` | 创建真实 Plugin 实现 | Product 已批准；Supervision/Nutrition Domain、Safety、Privacy 待审 |
| `MODEL-SELECTION-BLOCKED` | 选择或宣称默认模型 | 真实训练日志/饮食 pilot、ground truth 与候选 Provider 条款待核验 |
| `REVALIDATE_AT_KICKOFF` | 锁定实现契约 | OpenClaw hooks/runtime/metadata 与 ProgramSpec Schema validator/fixture 待按锁定版本核验 |
| `DEFAULT-PROGRAM-BLOCKED` | 把 Candidate 标记或启用为 `Default Program` | action-bearing 训练处方独立 Domain Review 待完成 |
| `RELEASE-BLOCKING` | 发布 Built-in Program 或 ClawHub/npm 制品 | 派生内容授权与实时发布权限待核验 |

Default Program 的专业签署本轮明确延后；在完成签署前，v0.2 只可作为 `Default Program Candidate` 和实现/验收 fixture，不得标记为已专业审核的默认计划。

## 2. Product definition

- [x] 能用一句话说明 Stella Fitness 的核心价值，而不是泛化为“AI 健身教练”。
- [x] 明确训练过程中不要求手机交互。
- [x] v1 已明确复用原课程三阶段 XLSX 训练日志，不为了首版重新设计默认记录表。
- [x] 体重是定期低摩擦输入，不要求为制造数据而每日强制打卡。
- [x] 饮食是可选证据，缺失时系统会降低诊断置信度，而不是阻止产品使用。
- [x] `NO_CHANGE` / `OBSERVE` / `COLLECT_MORE_DATA` 被认可为完整产品结果。
- [x] v1 默认适用范围为健康成年人 18+ 的一般增肌监督。
- [x] 非目标与特殊人群边界已被 Product Owner 接受。

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

### 分阶段状态

- [x] 教程、XLSX、Markdown 与 ProgramSpec v0.2 完成最终逐项 source cross-check。
- [x] recovery session 语义完成最终核对，且不会因 workbook 使用普通训练块标题而丢失。
- [x] 卓叔计划确定作为 v1 Built-in Program。
- [x] Built-in Program 的具体发行制品边界已冻结：运行时派生制品随包，原始 DOCX/XLSX 不随包。
- [x] Plugin 代码、通用 schema 与非课程派生原创材料采用 Apache-2.0，课程内容和个人数据适用独立权利边界。
- [ ] `[RELEASE-BLOCKING]` 已取得并保存覆盖实际发行制品与渠道的可核验授权。
- [x] Default Program 的独立 Domain Review 范围已决策。
- [ ] `[DEFAULT-PROGRAM-BLOCKED]` Default Program 的 action-bearing 训练处方已完成独立 Domain Review 并获得合格签署。

## 4. Workout-log extraction semantics

- [x] `重量` 明确允许 external kg / bodyweight / assisted / exercise variant / none 等多态语义。
- [x] 引体向上弹力带颜色不会被强制转成 kg。
- [x] 俯卧撑 `跪姿/标准/负重` 不会被丢失为普通 numeric load。
- [x] set columns 会根据动作解释为 reps 或 duration。
- [x] 平板支撑 `30/45/60` 等不会被错误当成 repetitions。
- [x] `高/中/低` 动作质量仅作为 subjective signal，不会映射为固定 RPE/RIR。
- [x] `问题备注` 已设计为 belief/safety 分流，而不是整段进入 Blind Diagnosis。
- [x] 空白 actual 永远不会根据 ProgramSpec 自动补成计划目标。
- [x] 第 4 周周五 `strength_test_block` 有独立 extraction schema/ground truth。

## 5. Evidence architecture

- [x] Raw Artifact / Observation / Subjective Claim / Derived Metric 分层清楚。
- [x] EvidencePacket 字段白名单完成文档一致性审查。
- [x] User Belief 明确不进入 Blind Diagnosis。
- [x] Blind Diagnosis 冻结后才允许 Auditor 查看 User Belief。
- [x] Reporter 不重新获得完整 conversation context。
- [x] Unknown / conflict / low-confidence 都有结构化表示。
- [x] 用户纠错能成为新的事实来源并触发派生结果更新。

## 6. Model roles

- [x] Extraction / Belief / Blind Diagnosis / Audit / Reporter 的 role contract 已定义并完成文档一致性审查。
- [x] 没有把模型厂商名称写成 domain semantics。
- [x] supplied XLSX 已作为 Tier A layout 固定。
- [ ] `[MODEL-SELECTION-BLOCKED]` workout-log 真实填写照片 pilot 数据已经准备并标注。
- [ ] `[MODEL-SELECTION-BLOCKED]` diet benchmark 的真实 pilot 数据已经准备并标注。
- [ ] diagnosis/framing Golden Cases 已冻结。
- [x] 候选模型比较指标包含质量、abstention、成本、延迟、隐私，而非只看通用榜单。
- [x] OpenClaw 管 Provider/凭据/endpoint/授权与实际外发，Plugin 管内部编排、选择性披露和授权范围内的角色模型绑定。
- [ ] `[REVALIDATE_AT_KICKOFF]` OpenClaw runtime 向 Plugin 返回的 execution metadata 已按锁定版本核验。

## 7. Domain policy

- [x] Program supervision 与 Program critique/override 是两种显式能力，没有混在一起。
- [x] 外部运动科学证据不会静默改写 source ProgramSpec。
- [x] v1 不启用未经审核的 numeric intervention，active actions 限于 `NO_CHANGE` / `OBSERVE` / `COLLECT_MORE_DATA` / `ESCALATE`。
- [x] ProgramSpec 已确认的计划进阶/恢复与监督模型新增干预已明确分离。
- [ ] `[IMPLEMENTATION-BLOCKING]` 训练/营养监督解释、Nutrition evidence hierarchy 与建议边界已由 Supervision/Nutrition Domain Reviewer 批准。
- [x] 中国本地营养数据库不阻断 v1；USDA/label/local-meal fallback 已接受，未授权仓库不接入。
- [x] Diet photo 在当前设计中只产生与证据质量匹配的范围/confidence；正式建议边界仍待 Nutrition Domain Review。

## 8. Safety

- [ ] `[IMPLEMENTATION-BLOCKING]` `ESCALATE` 优先级高于训练/饮食优化，且已获 Safety Reviewer 批准。
- [ ] `[IMPLEMENTATION-BLOCKING]` cardiovascular red flags 已审核。
- [ ] `[IMPLEMENTATION-BLOCKING]` severe acute injury red flags 已审核。
- [ ] `[IMPLEMENTATION-BLOCKING]` possible rhabdomyolysis pattern 已审核。
- [ ] `[IMPLEMENTATION-BLOCKING]` ordinary soreness / DOMS 作为 negative control 已审核，避免过度升级。
- [ ] `[IMPLEMENTATION-BLOCKING]` 特殊人群不默认套用 healthy-adult policy。
- [ ] `[IMPLEMENTATION-BLOCKING]` safety 文案不会让用户在 red flag 出现后继续完成计划。

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
- [ ] `[IMPLEMENTATION-BLOCKING]` Privacy Reviewer 已批准上述数据生命周期、payload 与用户控制边界。

## 10. Quality / Golden Cases

- [ ] `golden-cases.md` 已标记 `FROZEN v0.1`。
- [x] Product Owner 已批准全部产品行为 Expected/Forbidden。
- [ ] `[IMPLEMENTATION-BLOCKING]` Supervision/Nutrition Domain Reviewer 已批准 training/nutrition domain cases。
- [ ] `[IMPLEMENTATION-BLOCKING]` Safety Reviewer 已批准 safety cases。
- [ ] no-change 与 adjustment case 数量平衡，不是单向优化。
- [ ] Framing variants 已冻结，不允许实现后为了提高分数重写。
- [x] Training Log Benchmark 有 critical numeric / abstention / blank-preservation 指标。
- [x] supplied-template benchmark 有 load semantic / reps-duration / strength-test layout 指标。
- [x] Diet Benchmark 有 source-selection / false-precision / calibration 指标。
- [x] Auditor 同时测试“应该推翻”和“不应该推翻”的案例。

## 11. OpenClaw / Release dependencies

- [ ] `[REVALIDATE_AT_KICKOFF]` Implementation kickoff 当天重新核对 OpenClaw Plugin hooks。
- [ ] `[REVALIDATE_AT_KICKOFF]` isolated model runtime contract 重新核对。
- [ ] `[REVALIDATE_AT_KICKOFF]` media structured extraction contract 重新核对。
- [ ] `[REVALIDATE_AT_KICKOFF]` model override / permission contract 重新核对。
- [ ] `[REVALIDATE_AT_KICKOFF]` Cron 静默任务能力重新核对。
- [ ] `[RELEASE-BLOCKING]` ClawHub publish/owner/scope 规则重新核对。
- [x] ClawHub 目标 owner/package 已冻结为 `tower1229` / `@tower1229/stella-fitness`；实时权限留在发布 gate 核验。
- [x] 软件 LICENSE 已选择为 Apache-2.0，课程内容与个人数据适用独立权利边界。

## 12. Blocking GAP review

逐项检查 `known-gaps.md`。

每个 `IMPLEMENTATION-BLOCKING` GAP 必须满足之一：

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

当前第 9 和第 15 项在**课程来源语义层面已经有明确答案**，最终 source cross-check 也已完成；剩余工作属于明确标注的专业审核、模型选择、kickoff 或发布门禁。

只要其他关键问题的答案仍是“模型自己应该能处理”，则结果应为 `CHANGES_REQUIRED`。

## 14. Review records

### Product

```text
artifact: requirements.md + golden-cases.md product behavior
version: phase0-exit/v0.1
reviewer_role: Product Owner
reviewer_identity/reference: tower1229 / Phase 0 Exit Review user confirmation, 2026-08-09
review_date: 2026-08-09
scope: v1 product definition; Expected/Forbidden product behavior; non-goals; staged gates
status: approved
notes: Does not approve training science, nutrition policy, safety, privacy, or content rights.
```

### Supervision/Nutrition Domain — pending review packet

```text
artifact: decision-policy.md + nutrition evidence hierarchy + diet benchmark + training/nutrition domain Golden Cases
version: phase0-exit/v0.1
reviewer_role: Supervision/Nutrition Domain Reviewer
reviewer_identity/reference: PENDING
review_date: PENDING
reviewer_requirements: 抗阻训练监督、训练表现解释、增肌期能量/蛋白建议及不确定性边界相关专业能力；可由多名 reviewer 联合覆盖
scope: training/nutrition hypotheses; evidence hierarchy; estimate ranges/confidence; advice boundaries; forbidden false precision
status: pending
gate: IMPLEMENTATION-BLOCKING
required_questions: Which training/nutrition hypotheses are professionally defensible? Which evidence may support advice? Which uncertainty forces abstention? Which numeric policies remain disabled?
effect_while_pending: No production supervision diagnosis or nutrition advice implementation.
```

### Safety — pending review packet

```text
artifact: safety-escalation.md + G-SAFE-* + applicability exclusions
version: phase0-exit/v0.1
reviewer_role: Safety Reviewer
reviewer_identity/reference: PENDING
review_date: PENDING
reviewer_requirements: 能审核运动相关临床红旗、急性损伤边界与安全沟通；训练专家不能自动替代相关临床资质
scope: escalation precedence; cardiovascular/injury/rhabdomyolysis red flags; DOMS negative controls; user wording
status: pending
gate: IMPLEMENTATION-BLOCKING
required_questions: Which signals exit ordinary hypertrophy supervision? Which benign cases must not escalate? Does wording always stop optimization first?
effect_while_pending: No production safety escalation implementation.
```

### Privacy — pending review packet

```text
artifact: privacy-safety.md + data-lifecycle.md + ADR-012..016 + ADR-020 + ADR-022..023
version: phase0-exit/v0.1
reviewer_role: Privacy Reviewer
reviewer_identity/reference: PENDING
review_date: PENDING
reviewer_requirements: 能审核健康/身体数据生命周期、外部模型 payload、用户删除与数据集二次使用边界
scope: Personal Data Directory; retention/deletion/export; provider payload; sanitized media; benchmark separation
status: pending
gate: IMPLEMENTATION-BLOCKING
required_questions: Is user control accurate? Is every external payload minimized and disclosed? Can deleted personal data be reconstructed improperly?
effect_while_pending: No production personal-data flow implementation.
```

### Rights — release-only review packet

```text
artifact: Built-in Program runtime derivatives + NOTICE + package rights boundary
version: phase0-exit/v0.1
reviewer_role: Rights Reviewer
reviewer_identity/reference: PENDING
review_date: PENDING
reviewer_requirements: 能核验课程派生、修改、署名与目标分发渠道授权范围
scope: derivative rights; modification; attribution; ClawHub/npm channels; package contents
status: pending
gate: RELEASE-BLOCKING
required_questions: Which exact artifacts and versions may ship? Which channels are covered? What attribution or notice is mandatory?
effect_while_pending: Candidate may be used internally as a fixture; no Built-in Program or public package release.
```

Default Program action-bearing prescription review is deliberately deferred and remains `DEFAULT-PROGRAM-BLOCKED`; it is not included in the Product or Supervision/Nutrition Domain approval above.

## 15. Sign-off

```text
Product:  APPROVED
Domain:   SUPERVISION_NUTRITION_REVIEW_PENDING / DEFAULT_PROGRAM_REVIEW_DEFERRED
Safety:   CHANGES_REQUIRED
Privacy:  CHANGES_REQUIRED
Platform: REVALIDATE_AT_KICKOFF
Rights:   RELEASE_ONLY

Overall:  CHANGES_REQUIRED
```
