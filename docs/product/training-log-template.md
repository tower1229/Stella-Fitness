# Supplied Training Log Template

**状态：Phase 0 adopted v1 template candidate**  
**来源：用户于 2026-08-08 提供的三阶段 XLSX 训练情况记录模板**

本文记录现成训练日志模板的实际结构及其对 Stella Fitness 的需求影响。原始 XLSX 暂不提交到公开仓库，直到来源/再发布权限被确认。

## 1. Workbook 结构

工作簿包含三张工作表：

```text
第一阶段  — 第 1~4 周
第二阶段  — 第 5~8 周
第三阶段  — 第 9~12 周
```

每张表按 week/day 分块，动作名称已经预填，用户训练时主要填写实际结果。

这比重新设计一套 ProgramSpec 自动生成表更符合 v1 的低摩擦目标，因此当前需求决定为：

> **优先复用这份现成模板，不在 v1 为了“更 AI”而重新发明训练记录表。**

ProgramSpec 未来可以用于校验模板、生成其他 program 的表格，但不要求首版替换现有模板。

## 2. 常规训练块字段

标准训练块采用固定 10 列：

| 列 | 字段 | 用户输入性质 |
|---|---|---|
| A | 动作 | 模板预填 |
| B | 重量 | 用户填写 / 部分动作固定 `-` |
| C | 第一组 | 用户填写 |
| D | 第二组 | 用户填写 |
| E | 第三组 | 用户填写 |
| F | 第四组 | 用户填写 |
| G | 第五组 | 用户填写 |
| H | 第六组 | 用户填写 |
| I | 动作质量 | 用户主观填写 |
| J | 问题备注 | 用户自由文本 |

最多提供六组记录栏，能够覆盖当前三阶段计划的训练容量。

## 3. 动作质量语义

模板定义动作质量为**最后一组的总体动作情况**：

- `高`：动作标准、轻松完成；
- `中`：动作完成，变形不严重；
- `低`：动作完成但明显变形，或动作未完成。

这是一个低摩擦主观信号，可以作为 `Subjective Observation` 保存，但不能被当作等价于 RPE/RIR 的精确强度量表。

Stella Fitness 不应擅自把：

```text
高 / 中 / 低
```

映射为固定 RPE、RIR 或百分比强度。

## 4. 问题备注

模板允许用户记录：

- 膝盖或其他部位不适；
- 感觉过轻；
- 动作异常；
- 其他训练情况。

`问题备注` 必须进入 Subjective Claim / Safety pre-screen 流程，而不能直接混入 Blind Diagnosis 的 objective EvidencePacket。

其中可能出现安全红旗，因此在信息隔离前可以先经过**确定性/专用 Safety extraction**，但普通“我觉得练得不够”等观点不能因此泄露给 Blind Diagnostician。

## 5. 不同动作的 `重量` 字段不是同一数据类型

模板本身已经体现 `重量` 列具有多态语义：

### 普通哑铃动作

记录实际使用的总公斤数，例如：

```text
10 kg
```

### 引体向上

- 徒手可留空；
- 使用弹力带辅助时，填写弹力带颜色。

### 俯卧撑

可填写：

- `跪姿`；
- `标准`；
- 实际负重情况。

因此未来 extraction schema **不能把 B 列简单定义为 `load_kg: number`**。

建议领域表示至少区分：

```text
load_kind:
  external_weight
  bodyweight
  assisted
  exercise_variant
  none

load_value?
load_unit?
assistance_description?
variant_description?
raw_value
```

这属于需求层 schema 约束，不要求 Phase 0 写代码。

## 6. `第 x 组` 的单位依动作而异

模板说明把组栏描述为“实际次数”，但计划中存在平板支撑等 duration 动作。

因此未来解析不能默认所有 C:H 都是 reps。

应根据 ProgramSpec / exercise type 解释为：

```text
reps
seconds / duration
other exercise-specific quantity
```

如果模板实际填写习惯尚未确认，应在 benchmark 中专门加入平板支撑样本。

## 7. 第一阶段第 4 周周五的特殊结构

这份模板出现了一个非常重要的新信息：

```text
第4周，周五，力量测试
```

并提供：

- 高脚杯深蹲 `12RM 测试重量`；
- 哑铃卧推 `12RM 测试重量`；
- 哑铃硬拉 `12RM 测试重量`；
- 引体向上 `测试次数`，说明为第一组能完成的总次数。

这与当前结构化教程中的“第 4 周周五资料缺失”不同。

### 当前处理

该模板被视为 **GAP-001 的候选补充证据**，但暂不直接修改 canonical program：

1. 需要确认模板与教程的来源关系；
2. 如果模板来自同一课程/原作者且版本可信，则可用于补齐 source program；
3. 如果只是后来整理者自行设计的日志，则只能作为产品日志模板，不足以证明原训练处方。

在确认前：

```text
ProgramSpec Week 4 Friday = unresolved
Template Week 4 Friday = candidate evidence: strength test
```

两者必须同时保留，不能静默选择一个版本。

## 8. 第二、第三阶段的恢复周表示

模板第 8 周、12 周的周四/周五仍采用普通训练记录块标题，并没有在日志布局层单独标记 `recovery`。

这不自动构成与教程的冲突，因为日志表可以用相同字段记录恢复训练。

要求：

- recovery 语义仍来自 ProgramSpec / source program；
- 不能仅从模板标题判断该日是否为 recovery；
- extraction 只负责“实际写了什么”，Program Engine 负责“该日计划语义是什么”。

## 9. v1 Extraction 最小字段

针对这份固定模板，首版 extraction contract 应优先支持：

```text
stage
week
weekday
session_label
exercise_raw
exercise_normalized?
load_raw
load_kind?
load_value?
load_unit?
set_values[]
action_quality?
problem_note?
field_confidence
uncertain_fields[]
```

特殊力量测试块另有：

```text
test_type: 12RM | max_reps
exercise
test_value
test_unit
```

## 10. 对 Benchmark 的影响

未来训练日志 benchmark 的 Tier A 不再是假想“官方模板”，而应以**这份实际 workbook 的打印/拍照结果**为主。

必须覆盖：

- 三张阶段表；
- 普通哑铃重量；
- 引体向上徒手/弹力带；
- 俯卧撑姿势/负重；
- 平板支撑 duration；
- 1~6 组数字；
- `高/中/低` 动作质量；
- 中文问题备注；
- 空白字段；
- 涂改；
- 第 4 周周五力量测试特殊块。

## 11. 发布与来源治理

用户已经明确该模板可用于 Stella Fitness 产品设计，但这不自动等价于“可以随 public GitHub / ClawHub artifact 再分发原 XLSX”。

在来源/许可确认前：

- 可以基于模板结构做需求、schema 和 benchmark 设计；
- 不把原始 XLSX 二进制文件提交到公开仓库；
- public release 是否携带模板文件单独做 rights decision。
