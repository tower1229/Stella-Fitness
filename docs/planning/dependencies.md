# 外部依赖与依赖策略

**状态：RESEARCH BASELINE / NO IMPLEMENTATION DEPENDENCIES INSTALLED**

Phase 0 只冻结“需要哪类依赖”和“选择标准”，不创建 package lock，不提前安装 SDK。

## 1. OpenClaw

角色：宿主运行时、Plugin hooks、model runtime、media runtime、Cron、分发入口。

当前已确认目标能力：

- conversation interception；
- isolated LLM completions；
- structured media extraction；
- model allowlist/operator policy；
- Cron silent jobs；
- Native Plugin / ClawHub distribution。

**实施时动作：** 重新核验稳定 OpenClaw 版本、Plugin API、Node 支持、manifest 与 ClawHub contract。

## 2. LLM Providers

不是硬编码依赖，而是 role candidates。

| Role | 当前候选 | 选择标准 |
|---|---|---|
| Workout log extraction | Gemini 3.6 Flash / other multimodal | handwriting field accuracy, abstention, cost |
| Diet extraction | Gemini 3.6 Flash / other multimodal | range calibration, food recognition |
| Belief extraction | low-cost structured model | schema validity, claim extraction |
| Blind diagnosis | GPT-5.6 Sol/Terra or equivalent | diagnosis quality, framing invariance |
| Auditor | Claude Sonnet 5 or independent equivalent | critique quality, false-overturn rate |
| Reporter | template first | no model needed when possible |

任何 provider 还必须通过 privacy review。

## 3. Nutrition database

候选：USDA FoodData Central / FNDDS。

优点：

- 官方 REST API；
- Food Search / Food Details；
- CC0；
- 可作为 RAG/grounding source。

未决：对中式混合菜品的覆盖、匹配策略、本地权威数据库替代/补充。

## 4. Persistent storage

需求：

- local-first；
- transactions；
- schema migrations；
- auditability；
- export/delete；
- 无需云服务即可运行。

当前只建议 SQLite 类方案作为方向，不在 Phase 0 冻结具体 Node library。实施时应优先减少 native install friction，并核验当时 Node/OpenClaw runtime。

## 5. Image/OCR

当前不引入独立 OCR 作为必需依赖，因为 OpenClaw media runtime 已支持 model-based structured extraction。

如果真实手写日志 benchmark 证明 VLM 不够可靠，再评估：

- OCR + VLM hybrid；
- template-aware parsing；
- 用户自定义打印表格带定位标记。

技术应由失败数据驱动，而不是先堆依赖。

## 6. ClawHub

仅作为未来发布依赖。Phase 0 不需要 ClawHub token、package scope 或 CI workflow。

## 7. 依赖选择规则

每个外部依赖必须回答：

1. 它解决什么不可替代问题？
2. 数据会发到哪里？
3. 失败时系统怎样降级？
4. 是否可以替换？
5. 版本/API 是否容易变化？
6. 有什么成本？
7. 是否需要用户单独配置凭证？
8. 是否影响 ClawHub 安装体验？

无法回答以上问题的依赖不得在实施初期成为核心路径。