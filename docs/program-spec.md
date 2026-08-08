# ProgramSpec v0.1

## 1. 目的

`ProgramSpec` 是 Stella Fitness 中训练计划的 canonical machine-readable 表示。

它解决两个问题：

1. 让 Program Engine 不需要每次通过 LLM 阅读教程文本来判断“今天应该练什么”；
2. 让原始资料中的缺失、不确定性和来源状态可以显式存在，而不是被模型自动补齐。

Markdown 知识文档负责**解释与审阅**；ProgramSpec 负责**确定性执行**。

## 2. 设计原则

### 2.1 Source-faithful

ProgramSpec 只能编码来源资料明确支持的内容。不能因为训练规律明显，就自动推导来源中缺失的训练日。

### 2.2 Explicit unresolved state

未知不是错误值。

当资料缺失时必须允许：

```yaml
status: unresolved
reason: source_missing
```

Program Engine 遇到 unresolved session 时必须停止自动计划解析，并把缺口暴露给上层。

### 2.3 Relative load is not absolute load

`A`、`A+1`、`N`、`N+1` 等是计划中的相对重量节点。

因此：

```yaml
load:
  mode: symbolic
  value: N+1
```

不能被 Program Engine 自动解释为：

```text
N + 2.5kg
```

用户实际公斤数属于训练日志和用户状态，不属于静态 ProgramSpec。

### 2.4 Prescription types are explicit

动作目标至少区分：

- `sets_reps`：固定组数 × 次数；
- `rep_range`：固定组数 + 次数区间；
- `total_reps`：只要求累计次数；
- `duration`：按秒数完成；
- `to_failure`：做到力竭。

这样可以避免把“引体向上共 30 次”错误转换成固定组次。

### 2.5 Program rule != supervisor recommendation

ProgramSpec 表示原计划的要求，不表示 Agent 的动态调整建议。

运行时必须同时保留三层：

```text
planned prescription
actual execution
supervisor recommendation
```

三者不能相互覆盖。

## 3. 顶层结构

```yaml
schema_version: stella-fitness/program/v0.1
id: string
version: string
status: draft | active | deprecated
source:
  title: string
  provenance: string
known_gaps: []
equipment: []
nutrition_reference: object
session_defaults: object
phases: []
weeks: []
cycle_completion: object
```

## 4. Week / Session

```yaml
weeks:
  - week: 1
    phase: phase-1
    sessions:
      - day: monday
        type: full-body
        status: resolved
        exercises: []
```

允许的 session status：

- `resolved`
- `unresolved`

v0.1 不引入“AI 推测但待确认”的中间状态。推测内容不得进入 canonical spec。

## 5. Exercise prescription

示例：

```yaml
- exercise: dumbbell-bench-press
  load:
    mode: symbolic
    value: N+1
  prescription:
    type: sets_reps
    sets: 4
    reps: 10
  rest_seconds:
    min: 90
    max: 120
  effort:
    mode: last_set_to_failure
```

引体向上：

```yaml
- exercise: pull-up
  prescription:
    type: total_reps
    reps: 30
    sets: self_selected
```

平板支撑：

```yaml
- exercise: plank
  prescription:
    type: duration
    sets: 3
    seconds: 60
```

## 6. Load model

```yaml
load:
  mode: symbolic | self_selected | none
  value: A | A+1 | A+2 | N | N+1 | N+2 | N+3 | N+4
```

实际重量映射属于用户状态，例如：

```text
user_program_state.load_bindings
```

而不修改原始 ProgramSpec。

## 7. Effort model

当前资料支持的主要 effort 类型：

```text
last_set_to_failure
every_set_to_failure
complete_prescribed_reps
as_long_as_possible
```

注意：原教程中“尽量坚持”与“力竭”不是同一语义，应分别保存。

## 8. Progression rule

明确阈值可编码，例如：

```yaml
progression:
  trigger:
    type: reps_above
    reps: 12
  action:
    type: increase_load
    amount: unspecified
```

这里 `amount: unspecified` 很重要：来源要求加重，但没有给出固定幅度。

## 9. 已知缺口

v0.1 必须至少包含：

```yaml
known_gaps:
  - id: week-04-friday
    severity: blocking
    reason: source_missing
    description: 原教程第 4 周周五明确标记“资料缺失，待补充”。
```

## 10. 版本策略

- `v0.1`：从现有教程忠实转换的草案；
- 补齐来源缺口后可发布 `v0.2`；
- ProgramSpec schema 与具体 program version 分开版本化；
- 任何会改变用户实际训练处方的修改都必须提升 program version，并记录 changelog。

## 11. 下一步实现要求

实现 Program Engine 前必须完成：

1. YAML schema validation；
2. 所有 12 周 session 的 fixture tests；
3. unresolved session fail-closed test；
4. symbolic load 不被自动转换成公斤数的测试；
5. Markdown 与 ProgramSpec 的人工交叉核对。
