# Source Register

**research snapshot：2026-08-08**

本表用于实施前重新核验。URL 是依赖资料来源，不表示项目接受来源中的所有结论。

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
| GPT-5.6 Sol | https://developers.openai.com/api/docs/models/gpt-5.6-sol |
| GPT-5.6 Terra | https://developers.openai.com/api/docs/models/gpt-5.6-terra |
| API pricing | https://openai.com/api/pricing/ |
| API data controls | https://platform.openai.com/docs/models/default-usage-policies-by-endpoint |
| Business data privacy | https://openai.com/business-data/ |

## Google Gemini

| Topic | Source |
|---|---|
| Gemini 3.6 Flash | https://ai.google.dev/gemini-api/docs/models/gemini-3.6-flash |
| Latest models | https://ai.google.dev/gemini-api/docs/latest-model |
| Structured output | https://ai.google.dev/gemini-api/docs/structured-output |
| Pricing | https://ai.google.dev/gemini-api/docs/pricing |
| Zero data retention | https://ai.google.dev/gemini-api/docs/zdr |

## Anthropic

| Topic | Source |
|---|---|
| Claude Sonnet 5 | https://www.anthropic.com/claude/sonnet |
| Commercial data training | https://privacy.anthropic.com/en/articles/7996868-is-my-data-used-for-model-training |
| ZDR | https://privacy.anthropic.com/en/articles/8956058-i-have-a-zero-data-retention-agreement-with-anthropic-what-products-does-it-apply-to |
| Sycophancy | https://www.anthropic.com/news/towards-understanding-sycophancy-in-language-models |
| Agent evals | https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents |

## Exercise science / nutrition

| Topic | Source |
|---|---|
| ACSM 2026 Position Stand | https://pubmed.ncbi.nlm.nih.gov/41843416/ |
| ACSM public summary | https://acsm.org/resistance-training-guidelines-update-2026/ |
| Protein + RT meta-analysis | https://pubmed.ncbi.nlm.nih.gov/28698222/ |
| Energy surplus review | https://pmc.ncbi.nlm.nih.gov/articles/PMC6710320/ |

## Food image estimation

| Topic | Source |
|---|---|
| ChatGPT meal-photo evaluation | https://pubmed.ncbi.nlm.nih.gov/40004936/ |
| 40-VLM nutrition evaluation | https://pubmed.ncbi.nlm.nih.gov/42350490/ |
| DietAI24 | https://www.nature.com/articles/s43856-025-01159-0 |
| USDA FoodData Central API | https://fdc.nal.usda.gov/api-guide/ |

## Safety

| Topic | Source |
|---|---|
| AHA physical activity warning signs | https://www.heart.org/en/health-topics/cardiac-rehab/getting-physically-active/develop-a-physical-activity-plan-for-you |
| AHA heart attack warning signs | https://www.heart.org/en/health-topics/heart-attack/warning-signs-of-a-heart-attack |

## Revalidation rule

以下节点必须重新访问 register 中的易变来源：

- Implementation Phase kickoff；
- first public beta；
- every major OpenClaw compatibility bump；
- model default change；
- privacy profile change；
- ClawHub release。