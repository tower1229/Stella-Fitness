# 已知缺口与阻塞项

本文是 Stella Fitness 的未知项登记册。任何会阻断后续阶段的未关闭项必须映射到唯一门禁：`IMPLEMENTATION-BLOCKING`、`MODEL-SELECTION-BLOCKED`、`REVALIDATE_AT_KICKOFF`、`DEFAULT-PROGRAM-BLOCKED` 或 `RELEASE-BLOCKING`。已接受的 source-fidelity limitation 或 design constraint 可以保持显式存在，但不冒充门禁。任何门禁都不能由 LLM、开发者默认值或“看起来合理”的经验推断悄悄关闭。

## GAP-001：第 4 周周五训练内容

**状态：CLOSED / SOURCE RECONCILED**

原课程配套三阶段 XLSX 与用户课程背景确认已经补齐正式内容：

```text
第4周，周五，力量测试
高脚杯深蹲：12RM 测试重量
哑铃卧推：12RM 测试重量
哑铃硬拉：12RM 测试重量
引体向上：第一组最大完成次数
```

已进入 source Markdown 和 `program-spec.v0.2.yaml`。

## GAP-002：教程发行包再分发策略

**状态：RELEASE-BLOCKING / AUTHORIZATION PENDING**

用户已于 2026-08-08 明确确认允许将原始 DOCX 收录到公开 `tower1229/Stella-Fitness` GitHub 仓库，原件已归档至 `sources/originals/`。

已决定：卓叔计划将作为 v1 `Built-in Program` 直接随正式发行包提供，不采用本地导入作为默认产品方案。用户将协调发行授权。

制品边界已冻结：发行包包含运行时 ProgramSpec、必要结构化知识、生成式/空白日志模板及权利声明；原始 DOCX/XLSX 不进入安装包。仍需在发布前取得并保存覆盖派生、修改、署名及实际分发渠道的可核验授权。

## GAP-003：教程本身存在来源不确定性

**状态：DEFAULT-PROGRAM-BLOCKED / DOMAIN REVIEW PENDING**

教程末尾注明“部分内容可能由 AI 生成”。`knowledge/` 表示来源忠实，不等于专业背书。

已冻结处理边界：成为 v1 `Default Program` 前，所有 action-bearing 训练处方必须完成独立 Domain Review；教程饮食内容只保留为来源示例，不进入自动饮食 Supervision Policy。该审核本轮明确延后，因此 v0.2 可作为实现/验收用 `Default Program Candidate`，但不能标记或启用为已审核的 `Default Program`，也不能随正式发行包发布。

## GAP-004：饮食目标没有连续计算公式

**状态：PARTIALLY RESOLVED / SOURCE-FIDELITY LIMITATION**

保留 65/70 kg 示例，不自行发明线性公式，也不默认推广到所有人群。

## GAP-005：生产干预数值阈值

**状态：CLOSED FOR V1 / REDUCED SCOPE**

v1 不启用监督性 `ADJUST_DIET`、`ADJUST_TRAINING` 或 `RECOVERY`，也不新增 plateau 窗口、具体 kcal、负重、组数、减量比例等数值处方。Built-in Program 已确认的计划进阶与计划恢复继续确定性执行。未来扩展仍需专业审核、版本化 Policy 与 Golden Cases。

## GAP-006：健康安全与适用人群边界

**状态：IMPLEMENTATION-BLOCKING / SAFETY REVIEW PENDING**

v1 默认仅面向健康成年人 18+ 的一般增肌监督；危险症状优先 `ESCALATE`。特殊疾病、孕期、未成年人、康复等不进入默认普通 Policy。类别和负例已文档化，但仍需 Safety Reviewer 批准 red flags、ordinary soreness/DOMS negative controls 与升级文案后才能关闭实施门禁。

## GAP-007：食物照片无法提供可靠精确宏量营养素

**状态：KNOWN LIMITATION / DESIGN CONSTRAINT**

photo-only 只形成估算区间与低/中置信证据，不能单独触发高置信饮食调整。

## GAP-008：中国本地营养数据库的数字访问与许可

**状态：CLOSED FOR V1 / FUTURE QUALITY ENHANCEMENT**

v1 已接受包装标签、用户确认个人餐食、USDA FoodData Central 与低置信图片区间组成的 fallback；无法可靠映射的中式混合菜不得独立触发自动调整。`Sanotsu/china-food-composition-data` 因无明确复用许可、底层数据权利未解决及 OCR/视觉识别质量未验证而不作为 provider、package dependency 或默认下载源。强中国食物覆盖保留为未来增强项，见 ADR-019。

## GAP-009：最终模型组合未确定

**状态：MODEL-SELECTION-BLOCKED / BENCHMARK PENDING**

只冻结模型角色契约，不冻结厂商。默认模型必须通过 Stella Fitness 自有 Benchmark/Eval。

## GAP-010：OpenClaw execution metadata、Provider 条款与隐私分阶段确认

该 GAP 拆成三个独立门禁，避免一个状态同时承担不同阶段：

### GAP-010A：Plugin 隐私与 payload 边界

**状态：IMPLEMENTATION-BLOCKING / PRIVACY REVIEW PENDING**

OpenClaw 负责 Provider 注册、凭据、endpoint、授权与实际网络外发；Plugin 负责内部多阶段编排、选择性披露，并可在 `allowedModels` 范围内绑定角色模型。Plugin 不另建 privacy profile、route 或 consent 策略。当前数据生命周期、payload 和用户控制边界仍需 Privacy Reviewer 批准。

### GAP-010B：runtime execution metadata

**状态：REVALIDATE_AT_KICKOFF / LOCKED-VERSION CHECK PENDING**

OpenClaw runtime 实际返回哪些 provider/model execution metadata 必须在 kickoff 按锁定版本核验，并据此确认 processing provenance 能保存哪些字段。

### GAP-010C：候选 Provider 条款

**状态：MODEL-SELECTION-BLOCKED / PROVIDER TERMS CHECK PENDING**

具体候选 Provider 的数据用途、保留、ZDR 和 region 必须在模型选择前核验；Plugin 文档不得替 Provider 或 OpenClaw 声明其无法控制的网络层保证。

## GAP-011：ClawHub owner / package scope

**状态：CLOSED / TARGET IDENTITY FROZEN**

canonical owner 已确定为 `tower1229`，package 为 `@tower1229/stella-fitness`，source 为 `tower1229/Stella-Fitness`。首次真实发布前仍须通过当前 ClawHub CLI 核验登录身份、owner 权限、名称可用性、package validation 与 dry-run；失败时阻断发布，不静默改名。见 ADR-021。

## GAP-012：软件许可证

**状态：CLOSED — APACHE-2.0 WITH SEPARATE CONTENT RIGHTS**

Plugin 代码、通用 schema 与非课程派生的项目原创材料采用 Apache-2.0。课程原件、卓叔派生 Built-in Program 和用户个人数据不在该许可范围内；Built-in Program 的独立授权仍由 GAP-002 阻断发布。见 ADR-018、根目录 `LICENSE` 与 `NOTICE`。

## GAP-013：Golden Cases 已起草但尚未 reviewer approval

**状态：IMPLEMENTATION-BLOCKING / PRODUCT APPROVED; SUPERVISION/NUTRITION DOMAIN AND SAFETY REVIEW PENDING**

Product Owner 已于 2026-08-09 批准 requirements 与 Golden Cases 的产品行为。关闭条件：Supervision/Nutrition Domain Reviewer 与 Safety Reviewer 完成对应案例审核、反馈已回写、案例平衡复核完成并标记 `FROZEN v0.1`。Default Program 处方审核不属于本 GAP。

## GAP-014：真实训练日志与饮食图片 Benchmark 尚未准备

**状态：MODEL-SELECTION-BLOCKED / PILOT AND GROUND TRUTH PENDING**

训练日志固定模板已确定，专项 Benchmark 规范已建立；仍缺真实手写照片、噪声场景和人工 ground truth。饮食 benchmark 同样尚缺真实 artifacts。

## GAP-015：原始图片默认保留策略

**状态：CLOSED / USER-CONTROLLED PERSISTENCE**

原始图片进入用户配置的 Personal Data Directory，默认与结构化产出一起长期保留。v1 不提供 Plugin 删除、导出、备份或 retention-policy 功能；用户通过文件系统或 Personal Data Repository 工具管理。Plugin 必须尊重文件缺失、安全重建派生状态，并禁止 Runtime Directory 恢复已删除个人数据。见 ADR-020。

## GAP-016：外部专业审核机制尚未完成

**状态：STAGED REVIEW PENDING**

Product / Domain / Safety / Privacy / Platform / Rights reviewer 的职责和签署机制已经定义。Product Owner 已完成产品行为批准；其余角色按阶段跟踪：

- Supervision/Nutrition Domain、Safety、Privacy：`IMPLEMENTATION-BLOCKING`；
- Platform 当前契约：`REVALIDATE_AT_KICKOFF`；
- Default Program 训练处方 Domain Review：`DEFAULT-PROGRAM-BLOCKED`；
- 内容授权与 Rights Review：`RELEASE-BLOCKING`。

Default Program 的 Domain Review 范围已冻结且本轮明确延后；剩余工作是确定合格 reviewer 并完成实际签署，不是重新讨论审核边界。

## GAP-017：训练日志 XLSX 发行包分发策略

**状态：CLOSED / RAW XLSX EXCLUDED FROM PACKAGE**

已确认：

- XLSX 为原课程可靠同源配套资料；
- 可作为 Stella Fitness v1 的训练日志模板；
- 可作为第 4 周周五处方来源；
- 用户已明确允许将原始 XLSX 收录到本公开 GitHub 仓库；
- 原件已归档到 `sources/originals/zhuoshu-workout-log.xlsx`。

raw XLSX 只作公开源码仓库审计原件，不进入安装包。发行包使用派生的运行时 ProgramSpec、必要结构化知识和生成式/空白日志模板；授权 blocker 统一由 GAP-002 跟踪。

## GAP-018：训练计划关系语义

**状态：CLOSED / USER-CONFIRMED SOURCE INTERPRETATION**

Q1–Q6 已由用户基于原课程背景一次性确认：

1. `A` 是三个主项各自的初始 12RM；
2. 第 4 周周五三个主项新 12RM 分别直接成为第二阶段对应动作的 `N`；
3. 引体向上第一组最大次数用于辅助带选择，尽量让每组能完成 8 次以上，同时保持计划总次数；
4. 第 4 周使用与完整周期结束相同的 12RM 测试协议；
5. “哑铃推举”和“哑铃推肩”是同一动作，统一为哑铃推肩；第三个月新增“哑铃弯举”，不得混淆；
6. 第一阶段以详细逐周处方为准；“两周加重一次”只作为长期一般节奏概括，第一个月属于特殊阶段。

已同步到 source Markdown、确认记录和 `program-spec.v0.2.yaml`。

目前**没有新的已知训练计划语义问题需要用户确认**。后续发现新冲突时继续采用“集中提问、不自行猜测”原则。

## GAP-019：上传图片 EXIF/GPS 处理边界

**状态：CLOSED / RAW PRESERVED, PAYLOAD SANITIZED**

Personal Data Directory 中的用户上传原件保持字节不变。Plugin 不把无关 EXIF/GPS/设备 metadata 结构化保存；提交 OpenClaw media runtime 前生成已应用方向并移除 metadata 的临时净化副本，且在所有退出路径清理。见 ADR-022。

## GAP-020：数据权利分类与 Benchmark 二次使用

**状态：CLOSED / THREE CONTENT CLASSES**

内置计划内容由发布方取得授权；User Input Data 与 User Derived Data 均由用户控制，Plugin 不取得再利用、公开、Benchmark 或训练权。Runtime Directory 只是可重建技术状态。Plugin 不提供遥测或自动贡献功能，真实样本进入研发 Benchmark 必须走 Plugin 外独立授权流程。见 ADR-023。

## 已关闭的 Phase 0 设计问题

- 默认适用范围：健康成年人 18+、一般增肌监督、非医疗/康复；
- Offline-first：使用原课程配套三阶段 XLSX → 打印 → 纸笔 actuals → 训练后拍照；
- 第 4 周周五：力量测试；
- `A / N / 12RM` 的关键绑定关系；
- 哑铃推肩/哑铃弯举命名边界；
- 第一阶段详细逐周计划的优先级；
- 原始 DOCX/XLSX：公开 GitHub 仓库收录已确认；
- Safety：必须存在结构化 red flags 和 `ESCALATE` 优先路径。

## 维护模板

```text
GAP-XXX
status
source/evidence
effect
current handling
closure criteria
```

未知必须显式存在。
