# Stella Fitness 技术架构

> 本文描述 Stella Fitness 的目标架构。OpenClaw 相关接口以 2026-08-08 当前官方 Plugin SDK 文档为依据；实现时仍需用锁定版本的类型定义再次校验。

## 1. 总体结构

```text
OpenClaw channel / dedicated Agent
              │
              ▼
       Stella Fitness Plugin
              │
      ┌───────┴────────┐
      │ Ingress Router │
      └───────┬────────┘
              │
      ┌───────▼────────┐
      │ Extraction     │  image / text → observations
      └───────┬────────┘
              │
      ┌───────▼────────┐
      │ Plugin DB      │  raw / facts / beliefs / metrics
      └───────┬────────┘
              │
     Program Engine + Metrics Engine
              │
              ▼
        EvidencePacket
              │
      ┌───────┴────────┐
      ▼                ▼
Blind Diagnostician  Belief Extractor
(isolated runtime)   (isolated step)
      │                │
      └───────┬────────┘
              ▼
      Adversarial Auditor
       (isolated runtime)
              │
              ▼
        Policy Gate (code)
              │
              ▼
      FinalDecisionPacket
              │
       Template / Reporter
              │
              ▼
             User
```

核心原则：**自然语言聊天是输入输出界面，不是决策上下文。**

## 2. 为什么主体必须是 Plugin

Skill 的内容最终会进入同一个 Agent 上下文，无法为 Blind Diagnosis 建立可信的信息边界。

本项目依赖以下 Plugin 级能力：

- 在默认 Agent 模型调用前接管 / 阻断 turn；
- 读取媒体并执行结构化提取；
- 由 Plugin 明确构造每次内部模型调用的 payload；
- 运行 fresh isolated model context；
- 持久化领域数据；
- 定期执行监督任务；
- 直接返回 synthetic reply 或 silence。

因此 Skill 最多用于辅助说明，不能成为监督决策的安全边界。

## 3. OpenClaw 对话拦截

OpenClaw Plugin hooks 提供：

- `before_agent_reply`：在默认 LLM turn 前返回 synthetic reply 或 silence；
- `before_agent_run`：在最终 prompt/session messages 提交给模型前检查并可 block；
- `before_prompt_build`：可调整上下文/工具面，但 Stella Fitness 不把它作为主要隔离手段；
- `before_agent_finalize`：适用于普通 Agent 回复的最终修订，但不作为核心监督路径。

### 推荐路径

对于 Stella Fitness 识别为“领域监督输入”的 turn：

```text
inbound message
  ↓
before_agent_reply
  ↓
Plugin claims domain workflow
  ↓
run controlled supervision pipeline
  ↓
return synthetic final reply / silence
```

普通聊天 Agent 不参与核心诊断。

### 第二道保险

`before_agent_run` 用于防止本应由 Stella Fitness 接管的领域 turn 因路由错误落入普通 Agent。

如果 Plugin 已将当前 turn 标记为“claimed by supervisor”但默认模型仍准备运行，则 `before_agent_run` 应 fail closed：

```text
outcome: block
```

OpenClaw 当前文档明确说明该 hook 在模型读取输入之前运行；block 后原始用户文本不会作为未来 transcript context 被保留。

### Conversation access 配置

Stella Fitness 属于 non-bundled Plugin，并需要 `before_agent_reply` / `before_agent_run` 等 raw conversation hooks，因此安装文档必须指导用户显式启用：

```json
{
  "plugins": {
    "entries": {
      "stella-fitness": {
        "hooks": {
          "allowConversationAccess": true
        }
      }
    }
  }
}
```

这是显式权限，不应尝试绕过。

## 4. Hook 超时与长任务

OpenClaw hook 有 await budget；配置允许按 hook 设置更长 timeout，最高可到当前官方文档规定的上限。

Stella Fitness 不应假设 hook timeout 会取消 Plugin 自己发出的网络工作。因此所有模型/媒体调用应：

- 自己持有 `AbortController`；
- 设置显式 timeout；
- 在 Plugin shutdown / request cancel 时中止；
- 使用幂等 run id，避免超时后后台结果重复写库。

如果监督 pipeline 的实时耗时在真实环境中不可接受，后续可演进为“快速接管 + 后台任务 + 完成后主动消息”，但 v1 优先保持单 turn 可理解性。

## 5. 媒体结构化

训练日志图片优先通过 OpenClaw Plugin runtime：

```text
api.runtime.mediaUnderstanding.extractStructuredWithModel(...)
```

该接口支持由 Plugin 提供：

- provider / model；
- 图片输入；
- supplemental text；
- instructions；
- `jsonSchema`。

### TrainingLogExtraction

输出应包含：

```text
date?
program week/day?
exercises[]
  normalized exercise id?
  raw label
  load?
  reps?
notes?
uncertain_fields[]
```

每个不可靠字段保留 confidence / uncertainty；不能因为 Schema 要求就猜测不存在的信息。

### 饮食图片

饮食照片也可使用该能力，但 Schema 应表达范围和不确定性，而不是强迫模型返回伪精确宏量营养值。

## 6. 内部 LLM：真正的信息隔离

OpenClaw 当前 `api.runtime.llm.complete()` 支持：

```ts
execution: {
  mode: "isolated-agent-runtime"
}
```

官方语义包括：

- 只接受一条 user message；
- fresh context；
- 0 个 model-callable tools；
- 不回退到普通 direct provider transport；
- unsupported runtime 在 inference 前失败。

这正是 Blind Diagnostician / Auditor 的首选隔离边界。

### Blind Diagnostician payload

只允许：

```text
Program facts
Derived metrics
Objective observations
Evidence coverage
Relevant safety flags
```

禁止：

```text
raw conversation history
user belief
user desired action
user emotional reaction
previous reporter wording
```

### Belief Extractor

单独处理用户原始陈述，输出：

```text
claims[]
desired_actions[]
certainty_of_user_statement
```

它不产生训练诊断。

### Adversarial Auditor

只有 Blind Diagnosis 已冻结后才获得：

```text
EvidencePacket
FrozenDiagnosis
UserBelief
```

任务是寻找反证、证据不足、过度推断及 framing 风险。

## 7. 模型权限

模型 override 需要 OpenClaw operator 显式 opt-in。

安装配置需要使用：

```text
plugins.entries.stella-fitness.llm.allowModelOverride
plugins.entries.stella-fitness.llm.allowedModels
plugins.entries.stella-fitness.llm.allowedCompletionModels
```

原则：

- 默认给出推荐白名单；
- Plugin 不能任意调用用户未授权的模型；
- Blind / Audit 的模型角色由配置解析，不由聊天 Agent 临时选择；
- 模型降级必须经过 Eval。

如果使用独立 `model@profile` / auth profile，还需要遵守 OpenClaw 对 auth profile override 的显式授权要求。

## 8. Deterministic Core

### Program Engine

输入：

```text
program_id
program_version
cycle_start
current date / target session
```

输出：

```text
ProgramSession
```

职责仅限解释 ProgramSpec。

遇到 `status: unresolved` 必须返回显式错误 / unresolved 结果，不允许推导。

### Metrics Engine

只处理结构化事实，计算：

- completion；
- volume/load trend；
- body-weight trend；
- diet data coverage；
- missing-data rate；
- deviation from planned session。

所有数学计算用代码完成，LLM 只看到结果。

### Evidence Builder

采用字段白名单构造 Blind Diagnostician payload；这是 Information Flow Test 的直接测试目标。

### Policy Gate

模型输出只是候选判断。

最终决策类型：

```text
NO_CHANGE
OBSERVE
COLLECT_MORE_DATA
ADJUST_DIET
ADJUST_TRAINING
RECOVERY
ESCALATE
```

Gate 应拒绝：

- Schema invalid；
- evidence reference 不存在；
- 关键数据覆盖不足却给出高置信调整；
- 超出训练监督安全边界的建议；
- unresolved ProgramSpec 被当成确定事实。

## 9. Reporter

Reporter 只读取 FinalDecisionPacket。

优先级：

```text
Template
  > low-cost isolated LLM rewrite
  > full conversational Agent（不使用）
```

这样可避免在最后一步重新把完整会话历史混入决策结果。

## 10. 数据持久化

推荐：Plugin-owned SQLite。

原因：

- 数据属于长期领域事实，不属于聊天 session；
- 需要时间序列和聚合查询；
- 需要版本化 migration；
- 易于备份和用户迁移；
- 避免耦合 OpenClaw 内部 transcript/store 实现。

建议逻辑表：

```text
users / profiles
program_cycles
raw_artifacts
training_sessions
exercise_observations
body_weights
diet_observations
subjective_claims
derived_metrics
diagnosis_runs
audit_runs
decisions
```

每个 diagnosis/audit/decision 保存输入 evidence hash、模型标识、ProgramSpec version 与时间戳，用于复现。

## 11. 周期监督

OpenClaw Cron 运行在 Gateway 内并持久化任务。

推荐两层：

### Deterministic cron

先执行纯代码任务：

```text
update metrics
check evidence coverage
check whether review is due
```

无事项：输出 `NO_REPLY` / 无消息。

### Model analysis

只有满足 review 条件时才启动诊断 pipeline。

这样可同时降低：

- 模型成本；
- 不必要通知；
- “为了每周汇报而生成建议”的行为偏差。

## 12. 失败策略

核心原则：**fail closed for decisions, fail soft for data collection**。

| 故障 | 行为 |
|---|---|
| 图片提取失败 | 保存 raw artifact；请求必要补充，不写假 observation |
| Blind model 失败 | 不给调整建议；记录 run failure |
| Auditor 失败 | 不产生高风险自动调整；可降级为 OBSERVE |
| Policy schema invalid | 拒绝 decision |
| ProgramSpec unresolved | 显式告知缺口 |
| Cron 失败 | 记录失败；不制造正常状态 |

## 13. Eval 架构

### 程序级

- ProgramSpec fixtures；
- unresolved fail-closed；
- recovery semantic；
- metrics calculations；
- Evidence whitelist / information leak。

### 模型级

- real handwritten extraction set；
- Framing Invariance；
- Evidence Fidelity；
- Abstention；
- adversarial audit usefulness；
- model replacement regression。

同一 EvidencePacket 的 Blind Diagnosis 应在不同 user framing 下保持稳定。

## 14. 推荐代码边界

```text
src/
├── index.ts
├── plugin/
│   ├── hooks.ts
│   ├── config.ts
│   └── runtime.ts
├── ingress/
│   ├── router.ts
│   ├── training-log.ts
│   ├── diet.ts
│   └── body-weight.ts
├── engines/
│   ├── program-engine.ts
│   ├── metrics-engine.ts
│   └── evidence-builder.ts
├── llm/
│   ├── blind-diagnostician.ts
│   ├── belief-extractor.ts
│   ├── adversarial-auditor.ts
│   └── reporter.ts
├── policy/
│   ├── gate.ts
│   └── safety.ts
├── storage/
│   ├── db.ts
│   ├── schema.ts
│   └── migrations/
└── domain/
    ├── program.ts
    ├── evidence.ts
    └── decision.ts
```

## 15. 官方接口依据

实现时优先核对：

- OpenClaw Plugin hooks：`https://docs.openclaw.ai/plugins/hooks`
- Plugin runtime helpers：`https://docs.openclaw.ai/plugins/sdk-runtime`
- Plugin architecture internals：`https://docs.openclaw.ai/plugins/architecture-internals`
- Cron：`https://docs.openclaw.ai/cron-jobs`

不得从 OpenClaw host internals 私有路径直接 import；应使用公开 `openclaw/plugin-sdk/*` contract。
