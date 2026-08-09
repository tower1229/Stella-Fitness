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

v1 默认外部候选：USDA FoodData Central / FNDDS。

优点：

- 官方 REST API；
- Food Search / Food Details；
- CC0；
- 可作为 RAG/grounding source。

包装标签和用户确认个人餐食优先于数据库匹配。对无法可靠映射的中式混合菜，只允许低置信区间或请求更多数据，不把 USDA 映射包装成中国本地权威值。

`Sanotsu/china-food-composition-data` 已评估但不采用：无明确复用许可、底层书籍数据权利未解决，且 OCR/视觉识别准确率未验证。未来中国本地 provider 必须同时通过 rights review 与独立数据 QA。

## 4. Persistent storage

需求：

- local-first；
- Runtime Directory 与用户配置的 Personal Data Directory 分离；
- 原始上传文件和结构化个人产出都进入 Personal Data Directory；
- Observation Records 是 canonical，Training Progress 与查询索引可重建；
- transactions；
- schema migrations；
- auditability；
- filesystem-managed portability/deletion + deterministic rebuild；
- 无需云服务即可运行。

Personal Data Directory 是个人数据的 canonical boundary，并推荐与用户自己的 Personal Data Repository 配合。具体结构化文件格式、事务策略和可选索引实现不在 Phase 0 静默冻结；如使用 SQLite，必须明确它是个人数据制品还是可重建索引，不能形成隐藏的第二事实源。

## 5. Image/OCR

当前不引入独立 OCR 作为必需依赖，因为 OpenClaw media runtime 已支持 model-based structured extraction。

如果真实手写日志 benchmark 证明 VLM 不够可靠，再评估：

- OCR + VLM hybrid；
- template-aware parsing；
- 用户自定义打印表格带定位标记。

技术应由失败数据驱动，而不是先堆依赖。

## 6. ClawHub

仅作为未来发布依赖。canonical identity 已冻结为 `@tower1229/stella-fitness`（owner `tower1229`）；Phase 0 不需要 ClawHub token 或 CI workflow，首次发布前按当前 CLI 核验权限、validate 与 dry-run。

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
