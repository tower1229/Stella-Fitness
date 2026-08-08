# Diet Evidence Benchmark Specification

**状态：Phase 0 dataset specification**

Stella Fitness 的饮食能力不是“从一张照片精确算宏量营养”，而是把不同质量的饮食证据统一成可追溯、带不确定性的 Observation。本 Benchmark 用来选择图像模型、营养数据源和证据合并策略。

## 1. Benchmark 目标

必须同时评估：

1. 食物识别是否正确；
2. 份量估算是否校准；
3. 营养值是否使用了正确的数据源；
4. 不确定时是否会 abstain / 给范围；
5. 是否会错误覆盖更可靠的标签或用户确认信息；
6. 最终 Evidence Grade 是否与输入质量匹配。

## 2. 样本类型

### D1 — Single simple food

例如：香蕉、白米饭、鸡蛋、牛奶。

用途：基础 food identity / portion sanity。

### D2 — Mixed Chinese dish

例如：盖饭、炒菜、面条、麻辣烫、组合套餐。

要求包含：

- 多种食材；
- 隐藏油/酱汁；
- 不规则份量；
- 容器遮挡。

### D3 — Packaged food with readable label

例如牛奶、面包、蛋白粉、方便食品。

Ground truth 以包装标签和 serving 信息为主，而不是视觉模型的常识猜测。

### D4 — User-confirmed fixed meal

用户已经确认典型配方/重量的重复餐食。

测试系统能否优先复用 Personal Meal Profile，而不是每次从零估算。

### D5 — Restaurant meal with published nutrition

当餐厅有官方营养数据时，测试 published data 与照片识别之间的融合。

### D6 — Portion stress

同一食物设置 small / medium / large / very large 份量，重点测系统性低估和 confidence calibration。

### D7 — Poor image quality

阴影、遮挡、俯拍角度差、图片只拍到部分餐食。

正确行为可以是请求额外信息，而不是强行完成宏量估算。

## 3. Ground truth hierarchy

Benchmark 自己也必须遵循产品的数据源层级：

```text
measured/weighed composition
> product nutrition label
> user-confirmed recipe
> official restaurant nutrition
> authoritative food-composition database + measured portion
> expert estimate
```

不能拿另一个 LLM 的估算当作“真实标签”。

## 4. Ground truth fields

```text
artifact_id
meal_type
foods[]
  canonical_food_id?
  raw_food_name
  measured_weight_g?
  portion_visibility
  protein_g?
  carbohydrate_g?
  fat_g?
  energy_kcal?
  nutrient_source
hidden_ingredient_risk
label_available
personal_meal_match?
notes
```

如果 ground truth 自己也有范围，应保存 range，而不是虚构单值。

## 5. Required outputs

未来 Diet Extraction 应至少能表达：

```text
food_identity
portion_estimate_or_range
nutrient_estimate_or_range
source_type
source_reference?
confidence
uncertainties[]
needs_user_input
```

## 6. Metrics

### Food identity accuracy

食物类别/主要食材识别。

### Portion error

只在存在可靠 measured portion 的样本上计算。

### Macro error

蛋白、碳水、脂肪、能量分别报告，不能只用总热量掩盖蛋白误差。

### Calibration / interval coverage

当系统给范围时，真实值落入估算范围的比例。

### Evidence-source selection accuracy

当包装标签存在时，是否正确优先标签；当 Personal Meal Profile 存在时是否优先用户确认数据。

### False precision rate

低证据质量场景中输出不合理精确单值的比例。

### Abstention appropriateness

图片不足时是否正确请求额外信息。

### Decision contamination rate

低置信 meal 是否错误成为高置信 `ADJUST_DIET` 的主要证据。

## 7. Error severity

### S0

非关键 food wording 差异。

### S1

食物大类正确、细分类有误，对趋势影响有限。

### S2

份量或 macro 明显错误，可能影响饮食归因。

### S3

- 忽略清晰营养标签并使用模型猜值；
- 把 low-confidence photo 变成确定 intake；
- false precision 直接触发正式调整；
- 用户确认的 recipe 被模型无依据覆盖。

## 8. Benchmark split

建议未来至少区分：

```text
selection/dev set
locked evaluation set
regression set
```

不要在同一组图片上反复调 Prompt 后再把结果当独立评测。

## 9. Chinese-food emphasis

Stella Fitness 面向中文用户时，Benchmark 不能只用西式标准餐盘。

应重点覆盖：

- 米饭 + 多菜组合；
- 带骨肉类；
- 炒菜中的油脂不可见；
- 汤/面；
- 火锅/麻辣烫等组合餐；
- 外卖餐盒；
- 常见中式早餐；
- 共享菜场景（仅凭整桌照片无法确定个人摄入，应 abstain）。

## 10. Personal Meal Profile benchmark

至少测试：

1. 同一固定餐重复出现；
2. 份量明显变大/变小；
3. 少了一项食物；
4. 增加了酱汁/饮料；
5. 图片相似但其实不是同一 meal。

目标是验证私人 Agent 的长期记忆优势，而不是把错误 profile 永久复用。

## 11. Release implication

v1 不需要证明“照片宏量营养精确到克”。

更现实的成功标准是：

- 能识别大多数可见主要食物；
- 知道何时不能可靠估份量；
- 会选择更高质量数据源；
- 不制造虚假精度；
- low-confidence evidence 不污染正式干预。

模型只有在这一 Benchmark 上通过，才有资格成为默认 Diet Extractor。
