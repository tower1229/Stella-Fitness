# Nutrition Data Source Strategy

**research snapshot：2026-08-08**

Stella Fitness 不应把视觉模型本身当作营养数据库。更可靠的架构是：视觉负责识别“可能是什么/大约多少”，营养值尽量来自可追溯标签、用户确认配方或权威食物成分数据。

## 1. Evidence hierarchy

推荐优先级：

```text
1. Product nutrition label / manufacturer data
2. User-confirmed weighed recipe or fixed personal meal
3. Authoritative food-composition database + known portion
4. Restaurant published nutrition data
5. Image-only estimate
6. Unknown
```

越靠后，不确定性越高。

## 2. 中国食物成分数据

中国国家卫生健康委员会关于营养标签的公开问答明确把《中国食物成分表》列为可用于计算原料营养成分的权威来源之一。

《中国食物成分表（标准版第6版）》由中国疾病预防控制中心营养与健康所编著，已出版植物性食物、动物性食物等分册。

### 优势

- 中国食品语境更匹配；
- 中式基础食材覆盖更适合本项目目标用户；
- 属于国内权威食物成分参考体系。

### 当前限制

Phase 0 没有确认：

- 是否存在面向第三方应用的官方开放 API；
- 数据数字化再分发许可；
- 商业/开源 Plugin 中是否可以打包完整数据；
- 第6版各册完整数字数据的合法获取方式。

因此不能把书籍内容直接复制进公开仓库或 ClawHub package。

### Product decision

将《中国食物成分表》定义为**首选中国本地 food-composition source 候选**，但其 API/许可状态保持 blocker。

## 3. USDA FoodData Central

FoodData Central 提供：

- 官方 REST API；
- Foundation Foods；
- FNDDS；
- Branded Foods；
- 可下载 JSON / CSV；
- 默认 1000 requests/hour/IP 的 API limit；
- CC0 / public-domain 数据政策。

### 优势

- API 完整；
- provenance 清晰；
- 可缓存；
- 许可非常适合开源软件集成；
- branded / generic 两类数据均可用。

### 局限

- 中式菜肴和中国包装食品覆盖不是本地最优；
- 英文名称 mapping 可能引入额外误差；
- 不能因为 API 方便就把美国数据库视作中国食物的唯一真相。

### Product decision

USDA FoodData Central 是当前最清晰的**开放 API fallback / global generic source**。

## 4. Packaged foods

对预包装食品，照片如果包含清晰营养成分表，应优先：

```text
label OCR / VLM extraction
      ↓
user confirmation if ambiguous
      ↓
store product profile
```

而不是：

```text
看包装外观 → LLM 猜营养
```

中国 GB 28050-2025 继续要求营养成分表规范标示能量和营养成分信息，因此标签是更高质量的数据源。

## 5. User-confirmed personal meal library

长期私人 Agent 有一个通用营养 App 没有的优势：它可以记住用户重复吃的固定餐食。

例如：

```text
“公司鸡腿饭 A”
- rice: user-confirmed portion
- chicken: user-confirmed typical portion
- sauce/oil: estimated range
- confidence: medium/high
```

后续图片主要确认：

- 是否仍是同一 meal；
- 份量是否显著变化；
- 是否出现新增/缺少食物。

这比每顿都从零估算更适合 Stella Fitness 的长期监督定位。

## 6. Image-only nutrition

2025 的 meal-photo 研究显示，通用视觉语言模型对食物识别可较好，但中大型份量重量估算与多数营养素定量存在明显误差。

2026 一项对 40 个 VLM 的研究进一步发现：

- 模型架构是主要性能差异来源；
- 专业营养师显著优于全部 VLM；
- AI 的蛋白质估算尤其弱；
- 增加多角度图片并没有稳定解决核心问题。

因此 image-only 数据只适合：

- 大致分类；
- 排序/趋势；
- 判断“明显缺少蛋白质来源”这类低精度语义；
- 构建范围；
- 提醒需要额外信息。

不适合：

- athletic-grade precise macro accounting；
- 仅凭照片做高置信蛋白/碳水差额计算；
- 输出小数点级营养值。

## 7. Nutrition observation schema requirement

未来数据层应保存：

```text
food_identity
portion
protein
carbohydrate
fat?
energy?
source_type
source_reference
confidence
range?
user_confirmed
```

`source_type` 至少区分：

```text
PRODUCT_LABEL
USER_RECIPE
CHINA_FOOD_COMPOSITION
USDA_FDC
RESTAURANT_PUBLISHED
IMAGE_ESTIMATE
UNKNOWN
```

## 8. Decision policy implication

### High-confidence data

可用于长期摄入趋势和 adjustment candidate。

### Medium-confidence data

可参与 hypothesis，但不宜独立触发大幅调整。

### Low-confidence image estimate

主要作为弱证据；如果决策高度依赖它，优先要求用户补充：

- 大致份量；
- 包装标签；
- 食材/配方；
- 是否为已保存固定餐。

## 9. External dependency recommendation

未来实现优先支持可插拔 `NutritionDataProvider`，而不是把单一数据库写死。

概念接口：

```text
searchFood(query, locale)
getNutrients(foodId)
getSourceMetadata(foodId)
```

候选：

```text
China Food Composition provider  // license/access pending
USDA FoodData Central provider   // open API baseline
User Meal Library provider       // local-first
Product Label provider           // extraction-derived
```

## 10. Open issue

`GAP-NUTRITION-DATA`：中国本地食物成分数据库的**数字访问和再分发许可**仍需在实施前解决。

这不会阻止产品需求冻结，但会影响 v1 对中餐饮食监督的精度和默认 provider。

## Sources

- NHC nutrition-label Q&A / authoritative food database references: https://www.nhc.gov.cn/zwgk/zcjd/201402/6f68ec6692594cf28d190cb47b770c11.shtml
- NHC food composition data expression standard: https://www.nhc.gov.cn/wjw/yingyang/201505/3cbe4ecd6e48465899557a25a5ae1be9.shtml
- NHC GB 28050-2025 Q&A: https://www.nhc.gov.cn/sps/c100087/202509/470fa4ff5de14dd38619223cce9da4e7.shtml
- USDA FoodData Central API: https://fdc.nal.usda.gov/api-guide/
- USDA downloads: https://fdc.nal.usda.gov/download-datasets/
- ChatGPT meal-photo validation: https://pubmed.ncbi.nlm.nih.gov/40004936/
- 40-VLM evaluation: https://pubmed.ncbi.nlm.nih.gov/42350490/
