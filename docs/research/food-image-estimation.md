# 食物照片营养估算能力边界

**状态：RESEARCH_BASELINE**  
**checked_at：2026-08-08**

## 1. 核心结论

单张餐食照片适合做：

- 食物/菜品识别；
- 主要组成成分猜测；
- 粗略营养层级；
- 提示用户哪些信息最值得补充。

它目前不适合被当成：

- 精确称重；
- 精确蛋白质/碳水/脂肪计量；
- 临床营养评估；
- 唯一的高置信调整依据。

## 2. 研究证据

2025 年一项 meal-photo ChatGPT 评估中，食物识别准确性较好，但中/大份量重量估算表现差，16 种营养素中多数存在显著误差。

2026 年对 40 个 VLM 的研究显示，专业营养师显著优于全部 VLM；蛋白质估计是尤其薄弱的部分。研究还发现模型架构比多角度照片和复杂 prompt 更主导准确度。

这意味着产品不能靠“让用户多拍两张”“写更复杂 prompt”来假装解决根本误差。

## 3. Grounding 能改善，但不会消除视觉不确定性

DietAI24 报告将 MLLM 与 FNDDS/RAG 结合后，在 mixed dishes 上显著改善重量和营养估算。

USDA FoodData Central 官方提供 Food Search / Food Details REST API，FNDDS 是其中一个数据类型，并以 CC0 发布。

因此未来可设计：

```text
image → food/ingredient hypotheses
      ↓
portion estimate + uncertainty
      ↓
nutrition DB grounding
      ↓
range + confidence
```

而不是：

```text
image → LLM 自己凭记忆给 42.7g protein
```

## 4. Evidence policy

建议未来将饮食证据分级：

### Grade A

- 包装标签；
- 称重；
- 明确 recipe + quantities。

### Grade B

- 已经由用户校准的常吃餐/固定食谱；
- 餐厅有可信营养信息。

### Grade C

- 文字描述 + 粗份量；
- 照片 + 用户补充。

### Grade D

- 单张 photo-only。

Grade D 不能独立触发高置信 `ADJUST_DIET`。

## 5. 输出要求

照片估算输出：

- recognized_items[]；
- uncertain_items[]；
- portion_range；
- protein_range；
- carb_range；
- confidence；
- assumptions[]；
- optional_clarification。

禁止默认展示到小数点后一位的伪精度。

## 6. 中国饮食场景

USDA/FNDDS 是优秀开放候选，但不能假设对常见中国菜、混合炒菜、汤/火锅、地方菜系都有充分覆盖。

Phase 0 仍需调研本地权威营养数据库，并建立中式餐食 benchmark 后决定 production grounding source。

## Sources

- Meal photo evaluation: https://pubmed.ncbi.nlm.nih.gov/40004936/
- 40-VLM evaluation: https://pubmed.ncbi.nlm.nih.gov/42350490/
- DietAI24: https://www.nature.com/articles/s43856-025-01159-0
- USDA FoodData Central API: https://fdc.nal.usda.gov/api-guide/