# 已知缺口与阻塞项

本文是 Stella Fitness 的未知项登记册。任何 `BLOCKING` / `RELEASE-BLOCKING` 项都不能由 LLM、开发者默认值或“看起来合理”的经验推断悄悄关闭。

## GAP-001：第 4 周周五训练内容缺失

**状态：OPEN / NEW CANDIDATE EVIDENCE / BLOCKING FOR CANONICAL PROGRAM**

结构化教程明确写为“周五（资料缺失，待补充）”。

用户随后提供的三阶段训练日志 XLSX 中出现：

```text
第4周，周五，力量测试
```

并包含：

- 高脚杯深蹲 12RM 测试重量；
- 哑铃卧推 12RM 测试重量；
- 哑铃硬拉 12RM 测试重量；
- 引体向上第一组最大完成次数。

这是有价值的**候选补充证据**，但目前尚未确认该 workbook 与教程的来源关系，因此不能直接把 canonical ProgramSpec 从 `unresolved` 改成力量测试。

当前处理：

- ProgramSpec 继续保留 `status: unresolved`；
- 不根据前几周模式推导；
- workbook 内容登记为 candidate source evidence；
- 若确认 workbook 来自同一课程/原作者的可靠版本，再进行 source reconciliation。

详见 `sources/training-log-template-audit.md`。

关闭条件：确认模板 provenance 足以作为训练处方来源，并完成教程/Markdown/ProgramSpec 的逐项复核。

## GAP-002：教程版权与再发布许可未知

**状态：OPEN / RELEASE-BLOCKING**

当前仅确认用户提供了教程作为本项目需求/结构化工作的来源，没有证据证明可以将教程全文、等价 Markdown 或可还原结构随 GitHub/ClawHub 公开再分发。

关闭条件：明确权利来源、署名和许可范围；否则公开产品需改用用户本地导入或其他合法方案。

## GAP-003：教程本身存在来源不确定性

**状态：OPEN / CONTENT-REVIEW REQUIRED**

源文件末尾注明“部分内容可能由 AI 生成”。因此 `knowledge/` 代表**来源忠实**，不代表专业背书。

关闭条件：若要把该 program 作为默认公共训练方案，需要独立领域审核并留下审核版本。

## GAP-004：饮食目标没有连续计算公式

**状态：PARTIALLY RESOLVED / SOURCE-FIDELITY LIMITATION**

教程给出 65 kg / 70 kg 男生示例，并说不同体重按比例调整，但没有定义唯一连续算法。

已冻结：

- 保留源示例；
- 不发明线性公式；
- 不把男性示例默认推广给所有用户；
- nutrition supervision 与 source meal template 分层。

仍待决定：是否在专业审核后建立新的通用 nutrition policy。

## GAP-005：生产干预数值阈值尚未审定

**状态：PARTIALLY RESOLVED / BLOCKING FOR PRODUCTION SUPERVISION**

Phase 0 已建立高层证据边界：

- ACSM 2026 支持足够周训练量的重要性；
- 力竭并非普遍必要条件；
- 足够蛋白、保守能量盈余和多次体重趋势具有合理证据基础；
- recovery session 必须从普通 decline signal 中排除。

但以下个体数值政策仍不能从这些结论直接推出：

- plateau 观察窗口；
- 最低体重采样频率；
- training completion threshold；
- diet coverage threshold；
- 加热量/碳水幅度；
- 加重量/容量幅度；
- OBSERVE → ADJUST 的升级条件。

详见 `research/intervention-thresholds.md`。

关闭条件：形成有来源、适用人群、专业 reviewer、版本号和 Golden Cases 的 production policy。

## GAP-006：健康安全与适用人群边界

**状态：PARTIALLY RESOLVED**

已冻结：

- v1 默认面向 `healthy adults, age >= 18` 的一般增肌监督；
- 不属于医疗/康复护理；
- 明显危险症状进入 `ESCALATE`；
- safety precedence 高于训练/饮食优化。

详见：

- `product/applicability.md`；
- `quality/safety-escalation.md`。

仍未覆盖：所有特殊疾病/用药/孕期/康复场景的完整远程 triage 与地区化医疗入口。

这些特殊人群不进入 v1 默认普通 policy。

## GAP-007：食物照片无法提供可靠精确宏量营养素

**状态：KNOWN LIMITATION / DESIGN CONSTRAINT**

2025–2026 验证研究显示，通用视觉语言模型对食物识别可较好，但份量与营养定量误差显著，蛋白质估算尤其薄弱。

因此：

- photo-only 只能形成估算区间与低/中置信证据；
- 不显示虚假小数精度；
- 包装标签、用户确认重量、固定食谱/餐食、权威数据库具有更高证据等级；
- photo-only 不能单独触发高置信饮食调整。

该限制已经转化成明确产品约束。

## GAP-008：中国本地营养数据库的数字访问与许可

**状态：OPEN / QUALITY-BLOCKING FOR STRONG CHINESE-FOOD SUPPORT**

国家卫健委公开材料将《中国食物成分表》列为权威食物成分数据来源之一。Phase 0 已完成来源优先级设计，但尚未确认：

- 官方开放 API；
- 完整数字数据获取方式；
- 开源/ClawHub 场景的再分发授权。

已冻结 fallback：

```text
product label
> user-confirmed recipe/meal
> authoritative composition DB
> restaurant published data
> image-only estimate
```

USDA FoodData Central 可作为开放 API / global generic fallback。

详见 `research/nutrition-data-sources.md`。

## GAP-009：最终模型组合未确定

**状态：OPEN / IMPLEMENTATION-TIME BENCHMARK**

当前只冻结角色能力，不冻结厂商：

- structured vision extraction；
- blind high-quality reasoning；
- independent adversarial audit；
- low-cost belief extraction；
- template-first reporting。

任何候选模型都必须在 Stella Fitness 自己的 Eval 上通过后才能成为默认值。

## GAP-010：Provider 数据保留策略需部署时确认

**状态：OPEN / PRIVACY REVIEW**

模型供应商的数据政策、ZDR 可用性和功能限制可能变化。生产配置必须记录每个 Provider 的数据用途、默认保留、ZDR/企业选项、region 和是否允许发送图片。

关闭条件：最终候选模型确定后，对每个外部数据流逐项核验并版本化。

## GAP-011：ClawHub owner / package scope 未确认

**状态：OPEN / RELEASE-BLOCKING**

当前仓库 owner 不能自动等价为最终 ClawHub publish owner。包名和 scope 在首次发布前才冻结，并必须与 ClawHub 实际 owner 匹配。

## GAP-012：软件许可证未选择

**状态：OPEN / RELEASE-BLOCKING**

代码许可证与教程内容许可是两个独立问题。当前 Phase 0 没有 package，因此不设置虚假的 `UNLICENSED` package 状态。

## GAP-013：Golden Cases 已起草但尚未 reviewer approval

**状态：OPEN / BLOCKING FOR IMPLEMENTATION**

`quality/golden-cases.md` 已定义第一版案例目录，覆盖：

- source fidelity；
- extraction；
- no-change/observe；
- data-insufficient；
- anti-sycophancy；
- diet-photo；
- safety；
- auditor；
- longitudinal behavior。

关闭条件：product/domain/safety reviewer 完成复核并标记 `FROZEN v0.1`。

## GAP-014：真实训练日志与饮食图片 Benchmark 尚未准备

**状态：PARTIALLY RESOLVED / BLOCKING BEFORE MODEL SELECTION**

### 已完成

- v1 训练日志模板已经确定：使用用户提供的三阶段 XLSX；
- 模板结构审计已完成；
- 专门的 template benchmark 规范已建立。

详见：

- `product/training-log-template.md`；
- `quality/training-log-template-benchmark.md`。

### 仍未完成

- 真实填写后的纸质训练日志照片；
- 不同笔迹/光照/斜拍/涂改样本；
- 人工 ground truth；
- 饮食 benchmark artifacts。

因此“模板选择”已解决，但 extraction 模型 benchmark 仍不能开始冻结结果。

## GAP-015：原始图片默认保留策略未冻结

**状态：OPEN / PRIVACY DECISION**

训练/饮食原图对纠错和再抽取有价值，但永久保留增加隐私风险。

实施前需要明确默认策略，例如：

```text
retain until verified
retain configurable period
indefinite retention only by opt-in
```

在决策前不得默认永久保存。

## GAP-016：外部专业审核机制未冻结

**状态：OPEN / BLOCKING FOR CLAIMING PROFESSIONAL SUPERVISION**

项目可以定位为 evidence-first supervision tool，但在没有专业审核记录前，不应声称经过运动医学、运动营养或其他专业机构认证。

需要决定：

- 谁审核默认 policy；
- 审核 source program / nutrition / safety 的哪些部分；
- reviewer approval 如何和 policy version 绑定。

## GAP-017：训练日志 XLSX 的 provenance 与公开再发布权限

**状态：OPEN / RELEASE-BLOCKING FOR BUNDLING TEMPLATE**

用户已经明确 Stella Fitness 可以采用这份现成模板作为训练日志体验，因此**产品模板选择已完成**。

但仍需区分两个问题：

1. 是否足以作为第 4 周周五训练处方的权威来源；
2. 是否可以把原始 XLSX 随 public GitHub / ClawHub 包一起再分发。

在确认前：

- 可以依据模板结构设计 extraction；
- 可以私下打印并准备 benchmark；
- 不把原始 XLSX 提交公开仓库；
- 不用模板内容自动关闭 GAP-001。

详见 `sources/training-log-template-audit.md`。

## 已关闭的 Phase 0 设计问题

### 默认适用范围

已冻结为：

```text
healthy adults, age >= 18,
general hypertrophy supervision,
not medical / rehabilitation care
```

### Offline-first logging interaction / v1 template choice

已冻结：

```text
supplied three-stage XLSX
→ print
→ paper actuals
→ post-workout photo
→ extraction
```

首版不重新发明训练日志表，也不要求先完成 ProgramSpec-driven template generator。

详见：

- `product/training-log-template.md`；
- `product/printable-log.md`；
- `decisions/ADR-005-printable-log-first.md`。

### Safety red-flag category existence

已冻结必须存在结构化 safety flags 和 `ESCALATE` 优先路径，但不声称完成全部医学远程分诊。

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
