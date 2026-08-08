# 模型角色与候选策略

**状态：RESEARCH_BASELINE**  
**checked_at：2026-08-08**

本文件不选择“最终模型”，而是定义各角色需要什么能力、当前有哪些候选，以及未来如何用 Stella Fitness 自己的 Eval 选择。

## 1. 原则

- Domain contract 不出现特定厂商类型；
- provider/model 都是可替换依赖；
- 高价值诊断优先质量，低价值抽取优先成本；
- Blind Diagnostician 与 Auditor 优先考虑异构模型，降低完全同源错误的相关性；这是工程策略，不保证自动获得独立性；
- Reporter template-first；
- 每个角色都必须支持明确的失败/拒绝/超时状态。

## 2. Structured image extraction

能力要求：

- image input；
- structured JSON/schema output；
- 手写数字、表格、动作名称识别；
- 显式 uncertainty。

当前质量基线候选：**Gemini 3.6 Flash**。

Google 当前文档将其列为稳定 GA，支持 image input 与 structured outputs；官方 latest-model guide 将其定位为强多模态/agentic Flash。当前标准价格快照约为 `$1.50 / 1M input`、`$7.50 / 1M output`。

成本候选：**Gemini 3.5 Flash-Lite**，更适合高吞吐文档抽取，但必须用真实手写训练日志证明不会显著恶化准确率。

OpenAI GPT-5.6 系列同样支持 image input，可作为 benchmark 对照，而不是默认绑定。

## 3. Blind Diagnosis

能力要求：

- 高质量多变量推理；
- 严格结构化输出；
- calibration / abstention；
- 不需要工具调用。

当前质量基线候选：**GPT-5.6 Sol**。OpenAI 官方将其定位为复杂专业工作的旗舰模型，当前标准价格 `$5 input / $30 output per 1M tokens`。

成本候选：**GPT-5.6 Terra**，当前 `$2.50 / $15`，官方定位为 intelligence/cost 平衡。

Terra 是否可替代 Sol 必须由 Stella-specific diagnosis + framing eval 决定。

## 4. Belief Extraction

这是低风险结构化任务，只需要准确提取：

```text
claim
desired action
confidence of expression
```

可从 GPT-5.6 Luna/Terra、Gemini Flash-Lite 等低成本模型中 benchmark。不得把 belief extraction 结果转化成 evidence。

## 5. Adversarial Auditor

能力要求：

- 能批判另一模型结论；
- 擅长找反证/缺失证据；
- 与 Blind Diagnostician 尽量保持实现独立性；
- 结构化输出。

当前异构候选：**Claude Sonnet 5**。Anthropic 当前提供 `claude-sonnet-5` API；2026-08-31 前介绍价格为 `$2 input / $10 output per 1M`，之后公开标准价为 `$3 / $15`。

模型不是因为“Anthropic 更客观”而被选择，而是作为跨厂商审计候选；仍需实测。

## 6. Reporter

首选 deterministic template。

仅当用户需要长解释或自然语言变体时才使用低成本 LLM，而且输入只包含 approved DecisionPacket，不包含原始 user framing。

## 7. 选择 benchmark

至少包含：

- 真实手写日志 extraction；
- 数字/单位混淆；
- 模糊笔迹 abstention；
- 20+ 诊断 Golden Cases；
- 每个 diagnosis case 的 4–5 个 framing variants；
- 正常/no-change cases；
- 食物照片 range/confidence calibration；
- latency / cost / structured-output validity。

## 8. Provider privacy

候选模型通过能力 Eval 后，还需要通过隐私审查：

- 是否用于训练；
- 默认日志/滥用监控保留；
- ZDR 能力与限制；
- 图片/文件是否有特殊处理；
- 数据驻留；
- 是否能满足用户可配置的 provider policy。

## Sources

OpenAI:
- https://developers.openai.com/api/docs/models/gpt-5.6-sol
- https://developers.openai.com/api/docs/models/gpt-5.6-terra
- https://openai.com/api/pricing/

Google:
- https://ai.google.dev/gemini-api/docs/models/gemini-3.6-flash
- https://ai.google.dev/gemini-api/docs/latest-model
- https://ai.google.dev/gemini-api/docs/pricing

Anthropic:
- https://www.anthropic.com/claude/sonnet