# Intervention Threshold Evidence Boundary

**research snapshot：2026-08-08**

Stella Fitness 最容易出现的一类伪专业行为，是把一些“总体上成立的训练学结论”直接变成看似精确的个体干预阈值。本文件明确哪些结论目前有外部依据，哪些参数仍然不能直接冻结。

## 1. 可以作为领域 sanity check 的证据

### Resistance training volume

2026 ACSM Position Stand 综合 137 篇系统综述、超过 30,000 名参与者，指出更高训练量与肌肥大收益相关，其中肌肥大在较高周训练量（约 `≥10 sets/week`）下增强。

这可以作为**计划审查和异常解释的外部背景**，但不能推出：

```text
只要用户一周少于 10 组，Stella Fitness 就必须自动加量。
```

因为：

- “每肌群周组数”与当前教程动作分布的映射需要明确；
- 个体训练经历、动作选择、恢复和依从性不同；
- Stella Fitness 的首要职责是监督已选计划，而不是无条件重写它。

### Training to failure

同一 ACSM 2026 立场指出，练到瞬时肌肉疲劳/力竭并没有一致地改善力量、肌肥大或功率结果，并提出充分努力可通过 near-failure / 约 2–3 RIR 等方式获得。

这意味着原教程中的大量“力竭”要求应被保留为 source program 事实，但未来安全/专业审查不能把“必须力竭”视作当前科学共识。

### Protein

ISSN position stand 对健康、规律运动人群的通用建议为约 `1.4–2.0 g/kg/day` 足以支持多数训练适应；其他研究/综述常给出接近范围。

这只能作为健康成人增肌饮食的参考区间，不能直接覆盖：

- 肾脏疾病等特殊健康情况；
- 医疗营养需求；
- 用户自己医生/营养师的个体建议。

### Energy surplus / rate of gain

自然健美 off-season 的 narrative review 提出约 `10–20%` 热量盈余以及初中级训练者约 `0.25–0.5% bodyweight/week` 的增重目标；后续 resistance-trained 人群研究也支持较保守盈余能减少额外脂肪增加的思路。

但这类证据不是适用于所有 Stella Fitness 用户的高等级生产阈值，因此当前只登记为**候选参考**。

## 2. 当前不能从文献直接推出的产品阈值

以下参数仍然是 `OPEN`：

- 需要连续多少天/周体重不涨才叫 plateau；
- 每周至少需要几次体重记录才允许诊断；
- 训练完成率低于多少百分比才应干预；
- 某动作连续几次表现下降才算真实退步；
- 饮食数据覆盖多少天才能高置信判断“摄入不足”；
- 一次饮食调整应增加多少 kcal / 蛋白 / 碳水；
- 一次训练调整应加多少重量/组数；
- 恢复建议应该持续多少天。

这些参数不能靠 LLM “根据经验”填上。

## 3. 推荐的阈值设计方式

未来 Policy version 应把阈值分成三层：

### Layer A — Evidence quality gates

先判断数据是否足够：

```text
minimum measurement count
observation window length
missing-data ratio
source confidence
conflict flags
```

不足时直接 `COLLECT_MORE_DATA`，不进入干预幅度计算。

### Layer B — Trend state

使用确定性统计定义：

```text
stable
improving
declining
uncertain
```

不要求 LLM从原始数字凭感觉判断趋势。

### Layer C — Intervention policy

只有 A/B 通过后，才由版本化 policy 决定：

```text
NO_CHANGE
OBSERVE
ADJUST_DIET
ADJUST_TRAINING
RECOVERY
```

具体数值必须有：

- 来源；
- 适用人群；
- reviewer；
- policy version；
- Golden Cases。

## 4. 体重趋势的产品原则

当前可以冻结的是方法原则，而不是天数：

- 单日体重不能独立触发调整；
- 优先使用多次测量形成的趋势；
- 测量条件变化会增加噪声；
- 如果数据稀疏，confidence 必须降低；
- “用户说最近没涨”不能覆盖实际测量数据。

未来可以研究 rolling average / robust regression 等算法，但 Phase 0 不选择具体算法。

## 5. Training trend 原则

训练表现不能只用总重量比较：

必须结合 prescription type：

- sets × reps；
- total reps；
- duration；
- symbolic load；
- planned recovery。

恢复周容量下降属于 program fact，不是 decline signal。

## 6. Diet evidence 原则

饮食证据分级：

```text
HIGH    label / weighed recipe / user-confirmed fixed meal
MEDIUM  trusted database + known portion
LOW     photo-only estimate / restaurant mixed dish
UNKNOWN missing / ambiguous
```

高影响饮食调整不能主要建立在单顿 `LOW` evidence 上。

## 7. Source program vs evidence-based override

Stella Fitness 首版应区分：

### Program supervision

回答：

> 用户是否按当前 ProgramSpec 执行？

### Program critique

回答：

> 当前计划本身是否与外部证据存在值得注意的差异？

二者不能在一次隐式操作里混合。

如果未来支持“AI 建议修改原计划”，必须是显式能力，并输出：

- source plan；
- proposed override；
- external evidence；
- confidence；
- user confirmation / policy requirement。

## 8. 当前结论

Phase 0 可以冻结：

- sufficient volume matters；
- failure is not universally necessary；
- daily protein adequacy matters；
- conservative surplus / trend monitoring is more defensible than aggressive bulk；
- multi-day evidence beats single-event reaction。

Phase 0 **不能冻结**未经审定的个体干预数字。

因此 `GAP-006` 应从“完全未知”更新为：

> high-level evidence boundary resolved；production numeric policy still blocking。

## Sources

- ACSM 2026 Position Stand: https://pubmed.ncbi.nlm.nih.gov/41843416/
- ACSM summary: https://acsm.org/resistance-training-guidelines-update-2026/
- ISSN protein position stand: https://pubmed.ncbi.nlm.nih.gov/28642676/
- Off-season bodybuilding nutrition review: https://pubmed.ncbi.nlm.nih.gov/31247944/
- Energy surplus trial: https://pmc.ncbi.nlm.nih.gov/articles/PMC10620361/
