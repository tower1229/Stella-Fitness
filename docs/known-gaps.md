# 已知缺口与阻塞项

本文是 Stella Fitness 的未知项登记册。任何 `BLOCKING` / `RELEASE-BLOCKING` 项都不能由 LLM、开发者默认值或“看起来合理”的经验推断悄悄关闭。

## GAP-001：第 4 周周五训练内容缺失

**状态：OPEN / BLOCKING FOR CANONICAL PROGRAM**

源教程明确写为“周五（资料缺失，待补充）”。

当前处理：

- Markdown 保留缺失；
- ProgramSpec 保留 `status: unresolved`；
- 不根据前几周模式推导；
- 不允许模型生成后写回 canonical data。

关闭条件：获得可靠、可追溯的原始来源并完成逐项复核。

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

但以下**个体数值政策**仍不能从这些结论直接推出：

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
- 胸部不适、晕厥/接近晕厥、异常严重呼吸困难、严重急性伤害、possible rhabdomyolysis 等进入 `ESCALATE`；
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

该限制已经转化成明确产品约束，不需要“等待模型完美”才能继续设计。

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

**状态：OPEN / BLOCKING BEFORE MODEL SELECTION**

Benchmark 规则已经定义，但真实标注 artifacts 尚未准备。

训练日志详见 `quality/training-log-benchmark.md`，并优先覆盖：

```text
Tier A official printable template
Tier B noisy/edited official template
Tier C free-form logs
```

饮食 benchmark 需要覆盖混合中式菜、包装标签、固定个人餐和大份量 stress cases。

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

## 已关闭的 Phase 0 设计问题

### 默认适用范围

已冻结为：

```text
healthy adults, age >= 18,
general hypertrophy supervision,
not medical / rehabilitation care
```

### Offline-first logging interaction

已明确推荐官方可打印训练表：ProgramSpec 预填计划，用户训练时只记录 actual data，训练后拍照上传。

详见 `product/printable-log.md`。

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