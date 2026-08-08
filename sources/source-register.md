# Source Register

**research snapshot：2026-08-08**

本表用于实施前重新核验。URL 是依赖资料来源，不表示项目接受来源中的所有结论。

## User-provided project artifacts

| Artifact | Status | Use |
|---|---|---|
| 《卓叔增重 · 结构化增肌增重教程》DOCX | private source artifact | source-faithful program knowledge / ProgramSpec design |
| 三阶段训练情况记录 XLSX | adopted v1 template candidate; public redistribution not yet established | fixed-layout workout logging / extraction benchmark / candidate evidence for Week 4 Friday |

详见：

- `knowledge/programs/zhuoshu-12-week/source-audit.md`
- `sources/training-log-template-audit.md`

## OpenClaw

| Topic | Source | Use |
|---|---|---|
| Plugin hooks | https://docs.openclaw.ai/plugins/hooks | conversation interception / permissions |
| Plugin runtime | https://docs.openclaw.ai/plugins/sdk-runtime | isolated completions / media runtime / model policy |
| Plugin manifest | https://docs.openclaw.ai/plugins/manifest | future native manifest contract |
| Building plugins | https://docs.openclaw.ai/plugins/building-plugins | future runtime/build prerequisites |
| Cron | https://docs.openclaw.ai/automation/cron-jobs | periodic silent supervision |
| ClawHub publishing | https://docs.openclaw.ai/clawhub/publishing | package scope / validation / publish |
| ClawHub CLI | https://docs.openclaw.ai/clawhub/cli | future dry-run/publish workflow |

## OpenAI

| Topic | Source |
|---|---|
| Current model docs | https://developers.openai.com/api/docs/models |
| API pricing | https://openai.com/api/pricing/ |
| API data controls | https://platform.openai.com/docs/models/default-usage-policies-by-endpoint |
| Business data privacy | https://openai.com/business-data/ |

> 具体模型名属于 implementation-time candidate，不作为 Phase 0 hard dependency。

## Google Gemini

| Topic | Source |
|---|---|
| Latest models | https://ai.google.dev/gemini-api/docs/latest-model |
| Structured output | https://ai.google.dev/gemini-api/docs/structured-output |
| Pricing | https://ai.google.dev/gemini-api/docs/pricing |
| Zero data retention | https://ai.google.dev/gemini-api/docs/zdr |

## Anthropic

| Topic | Source |
|---|---|
| Claude models | https://docs.anthropic.com/en/docs/about-claude/models |
| Commercial data training | https://privacy.anthropic.com/en/articles/7996868-is-my-data-used-for-model-training |
| ZDR | https://privacy.anthropic.com/en/articles/8956058-i-have-a-zero-data-retention-agreement-with-anthropic-what-products-does-it-apply-to |
| Sycophancy | https://www.anthropic.com/news/towards-understanding-sycophancy-in-language-models |
| Agent evals | https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents |

## Resistance training / hypertrophy

| Topic | Source | Phase 0 use |
|---|---|---|
| ACSM 2026 Position Stand | https://pubmed.ncbi.nlm.nih.gov/41843416/ | healthy-adult RT evidence baseline; volume/failure/strength variables |
| ACSM public summary | https://acsm.org/resistance-training-guidelines-update-2026/ | public interpretation of Position Stand |
| Failure proximity meta-analysis | https://pubmed.ncbi.nlm.nih.gov/36334240/ | failure vs non-failure context |
| Failure vs non-failure meta-analysis | https://pubmed.ncbi.nlm.nih.gov/33497853/ | failure not universally required |

## Sports nutrition / weight gain

| Topic | Source | Phase 0 use |
|---|---|---|
| ISSN protein position stand | https://pubmed.ncbi.nlm.nih.gov/28642676/ | general healthy exercising adult protein reference |
| Protein + RT meta-analysis | https://pubmed.ncbi.nlm.nih.gov/28698222/ | protein supplementation / RT context |
| Off-season bodybuilding nutrition review | https://pubmed.ncbi.nlm.nih.gov/31247944/ | conservative surplus/rate-of-gain candidate reference; lower evidence tier than formal guideline |
| Energy surplus resistance-trained study | https://pmc.ncbi.nlm.nih.gov/articles/PMC10620361/ | larger surplus vs body-fat tradeoff context |

## Food image estimation

| Topic | Source | Phase 0 use |
|---|---|---|
| ChatGPT meal-photo evaluation | https://pubmed.ncbi.nlm.nih.gov/40004936/ | food recognition good; medium/large portion and nutrient quantification weak |
| Three-LLM food-image evaluation | https://pubmed.ncbi.nlm.nih.gov/41081011/ | high MAPE / systematic underestimation context |
| 40-VLM nutrition evaluation | https://pubmed.ncbi.nlm.nih.gov/42350490/ | model architecture dominates; nutritionists outperform VLMs; protein error warning |
| DietAI24 | https://pubmed.ncbi.nlm.nih.gov/41193610/ | database-grounded multimodal pipeline reference |

## Food composition data

| Topic | Source | Phase 0 use |
|---|---|---|
| NHC food composition data expression standard | https://www.nhc.gov.cn/wjw/yingyang/201505/3cbe4ecd6e48465899557a25a5ae1be9.shtml | China food-composition data semantics |
| NHC nutrition-label Q&A | https://www.nhc.gov.cn/zwgk/zcjd/201402/6f68ec6692594cf28d190cb47b770c11.shtml | recognizes《中国食物成分表》as authoritative data source |
| NHC GB 28050-2025 Q&A | https://www.nhc.gov.cn/sps/c100087/202509/470fa4ff5de14dd38619223cce9da4e7.shtml | current packaged nutrition-label context |
| USDA FoodData Central API | https://fdc.nal.usda.gov/api-guide/ | open API candidate, CC0 |
| USDA downloadable datasets | https://fdc.nal.usda.gov/download-datasets/ | local cache/offline data option |
| USDA data documentation | https://fdc.nal.usda.gov/data-documentation/ | provenance and data type semantics |

## Safety

| Topic | Source | Phase 0 use |
|---|---|---|
| AHA physical activity warning signs | https://www.heart.org/en/health-topics/cardiac-rehab/getting-physically-active/develop-a-physical-activity-plan-for-you | exertional warning symptoms |
| AHA heart attack warning signs | https://www.heart.org/en/health-topics/heart-attack/warning-signs-of-a-heart-attack | emergency-style chest/sob symptoms |
| AHA exercise-related CV events | https://professional.heart.org/en/science-news/exercise-related-acute-cardiovascular-events-and-potential-deleterious-adaptations/top-things-to-know | stop exercise when warning symptoms occur |
| CDC/NIOSH rhabdomyolysis | https://www.cdc.gov/niosh/rhabdo/signs-symptoms/index.html | severe muscle pain/dark urine/weakness pattern |
| MedlinePlus exercise injuries | https://medlineplus.gov/ency/patientinstructions/000859.htm | severe acute injury escalation |
| ACSM PPE resource | https://acsm.org/education-resources/books/preparticipation-physical-evaluation-monograph/ | medical eligibility / special population boundary |

## Source quality rules

优先：

```text
official platform docs / official standards
> formal position statements / public-health guidance
> peer-reviewed systematic review / validation study
> narrative review / individual trial
> secondary commentary
```

单个 narrative review 中的精确数字不能自动升级为 production Policy。

## Revalidation rule

以下节点必须重新访问 register 中的易变来源：

- Implementation Phase kickoff；
- first public beta；
- every major OpenClaw compatibility bump；
- model default change；
- privacy profile change；
- ClawHub release；
- default nutrition data provider change；
- production safety policy change。
