# ProgramSpec Design — current draft v0.2

## 1. 目的

`ProgramSpec` 是 Stella Fitness 中训练计划的 canonical machine-readable 表示。

它解决两个问题：

1. 让 Program Engine 不需要每次通过 LLM 阅读教程文本来判断“今天应该练什么”；
2. 让来源中的测试、相对重量节点、恢复日、别名和未知状态可以显式存在，而不是靠模型临场解释。

Markdown 知识文档负责**解释与审阅**；ProgramSpec 负责**确定性计划语义**。

当前实例：

- `program-spec.v0.1.yaml`：历史草案；
- `program-spec.v0.2.yaml`：吸收原课程配套 XLSX 和用户 Q1–Q6 确认后的当前 `Default Program Candidate`。

## 2. 设计原则

### 2.1 Source-faithful

ProgramSpec 只能编码来源资料与明确 source interpretation 支持的内容。

如果课程内容存在歧义，必须先集中确认，不能因为训练规律“明显”就自动推导。

### 2.2 Unknown remains explicit

Schema 必须保留 unknown/unresolved 能力，即使当前 zhuoshu v0.2 已没有训练处方来源缺口。

未来其他 program 仍可能需要：

```yaml
status: unresolved
reason: source_missing
```

Program Engine 遇到 unresolved session 时必须 fail closed。

### 2.3 Relative load is not absolute load

`A`、`A+1`、`N`、`N+1` 等是计划中的**每个动作各自**的相对重量节点。

例如：

```yaml
load:
  mode: symbolic
  value: N+1
```

不能自动解释成：

```text
N + 2.5kg
```

也不能把三个主项的 `N` 当成一个共享公斤数。

实际公斤映射属于用户 program state。

### 2.4 Test result can bind a future load symbol

v0.2 新增明确需求：训练计划中的测试可以改变后续 symbolic-load binding。

例如：

```yaml
- week: 4
  day: friday
  type: strength-test
  tests:
    - exercise: dumbbell-bench-press
      test: 12RM
      result_binding: N
```

其语义是：

> 该动作本次 12RM 测试结果成为该动作后续 `N` 的实际公斤值。

测试结果属于运行时用户事实；ProgramSpec 只定义绑定关系。

### 2.5 Prescription types are explicit

动作目标至少区分：

- `sets_reps`：固定组数 × 次数；
- `rep_range`：固定组数 + 次数区间；
- `total_reps`：只要求累计次数；
- `duration`：按秒数完成；
- `to_failure`：做到力竭；
- `test` / strength-test session：测试能力并产生结果绑定。

这样可避免把“引体向上共 30 次”或“平板支撑 60 秒”错误转换成普通 reps。

### 2.6 Program rule != supervisor recommendation

运行时必须同时保留：

```text
planned prescription
actual execution
supervisor recommendation
```

三者不能相互覆盖。

课程本身的 `A/N` 绑定、加重、恢复规则属于 planned prescription；监督模型不能修改 source program 后再假装那是原计划。

## 3. Source interpretation record

当多个同源资料需要人为确认关系时，应记录确认，而不是只修改最终字段。

v0.2 当前包含：

```text
initial-a-is-12rm
week4-retest-becomes-n
pullup-test-assistance
week4-test-protocol
overhead-press-alias
phase1-loading-summary
pullup-total-reps-rest-self-selected
warmup-user-discretion
```

这样未来可以解释某条机器规则为什么成立。

## 4. 顶层结构建议

```yaml
schema_version: stella-fitness/program/v0.1
id: string
version: string
status: draft | active | deprecated
source:
  title: string
  provenance: []
  fidelity_policy: string
known_gaps: []
source_interpretations: []
equipment: object
exercise_aliases: object
session_defaults: object
load_symbols: object
testing_protocols: object
phase_transitions: object
phases: []
weeks: []
templates: object
optional_substitutions: []
cycle_completion: object
```

## 5. Week / Session

普通训练：

```yaml
- week: 7
  phase: phase-2
  sessions:
    - day: monday
      type: torso
      status: resolved
      template: phase2-torso
      load: N+1
      main_sets: 4
      main_reps: 8
      pullup_total: 25
```

力量测试：

```yaml
- week: 4
  phase: phase-1
  sessions:
    - day: friday
      type: strength-test
      status: resolved
      tests:
        - exercise: goblet-squat
          test: 12RM
          protocol_ref: main-12rm
          result_binding: N
```

## 6. 12RM 与 load binding

当前课程确认：

### 首轮开始

```text
initial 12RM → A
```

三个主项分别绑定。

### 第 4 周周五

```text
new 12RM → N
```

三个主项分别绑定。

### 完整 12 周结束

```text
new 12RM → next cycle A
```

不得用固定百分比代替真实测试结果。

## 7. 引体向上能力测试与辅助方式

第 4 周周五：

```yaml
- exercise: pull-up
  test: max_reps_first_set
  result_binding: phase2_pullup_assistance_baseline
```

第二阶段 template 可表达：

```yaml
pullup_assistance:
  allowed_modes:
    - bodyweight
    - resistance-band-assisted
  target_min_reps_per_set: 8
  target_mode: best_effort
  preserve_programmed_total_reps: true
```

这里 `8` 是选择辅助方式的目标，不是覆盖原计划 total-reps 的固定训练处方。

普通引体向上只约束累计总次数；组数和组间休息时间都由用户自行安排：

```yaml
- exercise: pull-up
  prescription: total_reps
  sets: self_selected
  rest: self_selected
```

各周 session 的 `main_rest` 只适用于该阶段的负重主项，不适用于引体向上。

## 8. Exercise alias / identity

动作名称不能只靠模糊文本匹配。

当前确认：

```yaml
exercise_aliases:
  dumbbell-overhead-press:
    canonical_display_name: 哑铃推肩
    aliases:
      - 哑铃推肩
      - 哑铃推举

  dumbbell-curl:
    canonical_display_name: 哑铃弯举
```

`dumbbell-overhead-press` 与 `dumbbell-curl` 是两个独立动作，不能因为中文名相近而归一到同一 ID。

## 9. Phase summary vs detailed schedule

ProgramSpec 对计划事实的优先级应明确：

```text
detailed week/session prescription
> confirmed source interpretation
> phase-level summary text
```

本课程的具体例子：

```text
第1周 A
第2周 A+1
第3周 A+2
第4周 A+2 + retest
```

必须优先于“第一阶段两周加重一次”的长期概括。

## 10. Load model

计划层：

```yaml
load:
  mode: symbolic | self_selected | none | historical_reference
```

运行时 actual 日志的 `重量` 更复杂，尤其现成 XLSX 支持：

- external kg；
- bodyweight；
- resistance-band assistance；
- push-up variant；
- none。

这些属于 Training Observation schema，不应强塞进静态 ProgramSpec load model。

## 11. Effort model

当前资料支持：

```text
last_set_to_failure
every_set_to_failure
complete_prescribed_reps
as_long_as_possible
```

“尽量坚持”与“力竭”不是同一语义。

## 12. Progression rule

来源明确阈值可编码：

```yaml
progression:
  trigger:
    type: reps_above
    reps: 12
  action:
    type: increase_load
    amount: unspecified
```

`amount: unspecified` 必须保留，因为来源没有固定加重公斤数。

## 13. 版本策略

- `program-spec.v0.1.yaml`：来源补全前历史草案，保留审计；
- `program-spec.v0.2.yaml`：当前 source-reconciled `Default Program Candidate`，也是开发与验收主 fixture；
- 未来 `program-spec.v1`：经过完整 source review、schema validation、fixtures 与规定范围的独立 Domain Review 后，才能成为 `Default Program`。

ProgramSpec schema version 与具体 program version 分开版本化。

任何改变用户原计划处方的来源修订都必须提升 program version，并留下来源记录。

## 14. Phase 0 状态

v0.2 当前在**训练计划来源语义层面没有已知缺口**，但仍不是 production canonical program。

最终 source cross-check 已基于仓库归档的 DOCX/XLSX 与用户确认完成。剩余工作属于：

- 默认 Program 的独立领域审核与签署；
- Built-in Program 的派生、修改、署名与分发授权；
- 实施阶段 Schema validator 与完整 12 周 fixture 验证。

独立 Domain Review 的范围已经冻结：审核所有会驱动用户行为的训练处方，包括动作、频率/训练量、负重递进、12RM 测试、恢复周和引体辅助规则。教程饮食内容仅作为来源示例，不能进入自动饮食 Supervision Policy。v0.2 是预定随包提供的 `Built-in Program`，但在合格签署和可核验发行授权完成前仍只能标记为 `Default Program Candidate`，不得发布或驱动自动数值调整。

这些不应重新被描述成“训练计划本身未知”。
