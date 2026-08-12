# Supplied Training Log Template

**状态：ADOPTED V1 TEMPLATE / RELIABLE SAME-SOURCE COURSE MATERIAL**  
**来源：用户于 2026-08-08 提供的三阶段 XLSX 训练情况记录模板**

用户已明确确认：该 XLSX 是原课程配套资料，来自原作者或其他可靠同源版本；其中第 4 周周五的力量测试就是训练计划正式内容。

用户已明确允许使用原始 XLSX。原件归档于 `sources/originals/zhuoshu-workout-log.xlsx`，并由构建按原始字节复制为 v1 内置打印模板；Plugin 在 binding 完成后直接发送完整工作簿，不生成替代 PDF。

## 1. Workbook 结构

工作簿包含三张工作表：

```text
第一阶段  — 第 1~4 周
第二阶段  — 第 5~8 周
第三阶段  — 第 9~12 周
```

每张表按 week/day 分块，动作名称已经预填，用户训练时主要填写实际结果。

v1 产品决定：

> **直接复用这份原课程配套模板，不重新发明默认训练记录表。**

ProgramSpec 未来可用于校验模板、支持其他 program 或生成新模板，但不是 v1 前置条件。

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

最多提供六组记录栏，覆盖当前三阶段计划的训练容量。

## 3. 动作质量语义

模板定义动作质量为最后一组总体动作情况：

- `高`：动作标准、轻松完成；
- `中`：动作完成，变形不严重；
- `低`：动作完成但明显变形，或动作未完成。

这是低摩擦主观信号，可作为 `Subjective Observation` 保存，但不能擅自映射为固定 RPE/RIR。

## 4. 问题备注

可记录用户希望保留的任何训练情况。Plugin 按原文保存该字段，只允许做版面识别与用户确认，不解释其训练表现、原因或健康含义。

## 5. `重量` 字段是多态值

### 普通哑铃动作

记录实际使用的总公斤数。

### 引体向上

- 徒手可留空；
- 弹力带辅助时填写弹力带颜色。

### 俯卧撑

可填写：

- `跪姿`；
- `标准`；
- 实际负重情况。

因此未来 extraction schema 不能简单定义为 `load_kg: number`，而应保留 load kind / raw value / unit / assistance / variant 等语义。

## 6. `第 x 组` 的单位依动作而异

大多数动作记录 repetitions；平板支撑等动作记录 duration。

未来解析必须结合动作类型/ProgramSpec 解释，不得默认 C:H 全是 repetitions。

## 7. 第 4 周周五：正式力量测试

原课程配套表明确：

```text
第4周，周五，力量测试
```

正式内容：

- 高脚杯深蹲：12RM 测试重量；
- 哑铃卧推：12RM 测试重量；
- 哑铃硬拉：12RM 测试重量；
- 引体向上：第一组最大完成次数。

该内容现已被接受为 source program 的正式组成部分，原先“Week 4 Friday 缺失”问题关闭。

测试结果与后续符号/目标的关系已经确认：三个主项的 12RM 分别直接成为对应动作的 `N`；引体测试用于辅助方式选择，不改变累计总次数目标。完整确认记录见：

`knowledge/programs/zhuoshu-12-week/open-questions.md`

## 8. 第二、第三阶段恢复周

第 8、12 周恢复日继续使用普通日志块布局。

recovery 语义来自 ProgramSpec/source program，而不是从日志标题样式判断。

## 9. v1 Extraction 最小字段

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

力量测试块另有：

```text
test_type: 12RM | max_reps
exercise
test_value
test_unit
```

## 10. Benchmark

Tier A 直接以这份 workbook 的真实打印/填写/拍照结果为主，覆盖：

- 三个阶段；
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

已经确认：

- 模板可用于 Stella Fitness 产品设计与 v1 工作流；
- 模板属于可靠同源课程资料；
- 模板可用于训练计划来源补全。

已确认的发行边界：

- 可依据模板结构设计 extraction；
- 可私下打印并准备 benchmark；
- raw XLSX 继续作为公开源码仓库中的不可静默改写来源归档；
- 不得在可核验授权完成前发布包含该来源计划的发行包；
- raw XLSX 以固定路径和 digest 进入正式发行包，并由 `/stella-print` 直接发送；
- 任意其他 raw Office 文件仍不得进入发行包。
