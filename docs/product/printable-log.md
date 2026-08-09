# Printable Workout Log Requirements

**状态：Phase 0 product requirement**

Stella Fitness 的训练日志输入不应迫使用户在训练中操作手机。

用户已提供一份覆盖三个训练阶段的现成 XLSX 训练情况记录模板。v1 不再要求重新设计或由 ProgramSpec 自动生成另一套默认训练表，而是**优先采用该现成模板作为标准记录格式**。

详见：[training-log-template.md](./training-log-template.md)。

## 1. v1 目标

首版记录流程必须做到：

- 训练过程中只需纸笔；
- 用户不需要在组间操作手机；
- 动作名称、week/day 等固定信息由模板提供；
- 用户只填写实际重量、每组结果、动作质量与必要备注；
- 训练后拍照即可进入结构化流程；
- 不要求用户学习复杂 RPE/RIR 体系。

## 2. 已采用的默认模板

现有 workbook：

```text
第一阶段  — 第 1~4 周
第二阶段  — 第 5~8 周
第三阶段  — 第 9~12 周
```

常规训练块固定为：

```text
动作 | 重量 | 第一组 | 第二组 | 第三组 | 第四组 | 第五组 | 第六组 | 动作质量 | 问题备注
```

因此 v1 不需要先开发：

```text
ProgramSpec → dynamically generate printable PDF/XLSX
```

这可以留到以后支持其他 program 时再做。

## 3. 用户实际填写字段

### 重量

该字段是**多态字段**，不能简单理解为 kilogram number：

- 哑铃动作：通常为实际总公斤数；
- 徒手引体：可留空；
- 弹力带辅助引体：可填写弹力带颜色；
- 俯卧撑：可以填写 `跪姿`、`标准` 或负重方式；
- 平板支撑：模板使用 `-`。

因此未来 schema 必须保留 `raw_value` 并允许 load type 分类，而不是强制 number parsing。

### 第一组～第六组

表示实际完成结果。

通常是 repetitions，但平板支撑等 duration 动作需要根据动作/ProgramSpec 解释为秒数或其他 duration value。

**不能默认所有组格都是 reps。**

### 动作质量

模板定义：

- `高`：动作标准、轻松完成；
- `中`：动作完成，变形不严重；
- `低`：动作完成但明显变形，或动作未完成。

这是低摩擦 subjective signal，不等价于 RPE / RIR。

### 问题备注

允许记录身体不适、动作问题、训练过轻或其他情况。

该字段可能同时包含：

- 普通用户观点；
- 恢复感受；
- 潜在安全红旗。

因此其安全信息与用户 belief 需要在系统中分流，而不是整段原文直接送入 Blind Diagnosis。

## 4. 特殊力量测试块

第一阶段模板中的第 4 周周五不是普通 10 列训练块，而是：

```text
第4周，周五，力量测试
```

包含：

- 高脚杯深蹲 12RM 测试重量；
- 哑铃卧推 12RM 测试重量；
- 哑铃硬拉 12RM 测试重量；
- 引体向上第一组最大完成次数。

因此 extraction pipeline 必须支持至少两类 layout：

```text
regular_training_block
strength_test_block
```

这份信息目前只是教程 GAP-001 的**候选补充证据**，不自动修改 canonical ProgramSpec，详见 `known-gaps.md`。

## 5. 模板是 Actual-first，而不是 Target/Actual 双栏

此前设想的新模板会同时打印 `Target` 和 `Actual`。现有模板实际上更简单：

- 动作/训练日预填；
- 用户填写实际训练结果；
- 不在每一行重复打印目标组次。

这对视觉识别是一个优势，因为大幅降低了 `Target → Actual` 混淆风险。

因此 v1 Benchmark 应把重点改为：

- 空白 vs 实际填写；
- 重量字段的多态识别；
- reps vs duration；
- 数字涂改；
- 动作质量分类；
- 问题备注；
- 特殊力量测试块。

`Target/Actual confusion` 仍作为未来动态生成模板时的回归项，但不再是当前模板的主要风险。

## 6. v1 不额外增加高摩擦字段

当前模板已经包含足够的监督信号。

首版默认不要求增加：

- 每组 RPE；
- 每组 RIR；
- 心率；
- 实际休息秒数；
- 情绪量表；
- 每组手机打卡。

如果未来研究证明某字段具有明确增量价值，再通过需求变更加入，而不是先把表做复杂。

## 7. Photograph UX

用户训练后：

1. 展平记录表；
2. 拍清完整的当前训练块或页面；
3. 上传。

系统应容忍轻微：

- 透视；
- 阴影；
- 折痕；
- 圆珠笔/铅笔；
- 涂改；
- 中文手写。

如果关键列被裁切，应请求重拍，而不是猜测。

## 8. Benchmark tiers

### Tier A — Supplied template

直接使用现成三阶段模板的打印/拍照样本，是 v1 extraction 的第一优先级。

### Tier B — Noisy supplied template

包含涂改、划线、光照、阴影、斜拍、跨格等真实噪声。

### Tier C — Free-form logs

笔记本、自制表格等，只作为扩展能力。

## 9. ProgramSpec 与模板的关系

v1：

```text
ProgramSpec = plan semantics / supervision baseline
Existing XLSX = human execution / logging interface
```

两者不要求由同一份数据实时生成，但需要在实施前进行一致性审计：

- week/day/action list 是否匹配；
- recovery day 是否正确解释；
- 特殊测试日是否存在来源冲突。

未来新增其他训练计划时，才考虑建立通用：

```text
ProgramSpec → printable template generator
```

## 10. 来源与发布

“项目可以使用该模板进行需求设计”与“公开 ClawHub 包可以再分发该 XLSX”是两个不同问题。

在模板来源/版权状态明确之前：

- Phase 0 可以记录结构和字段；
- Benchmark 可以围绕私有模板样本准备；
- 原始 XLSX 已作为不可静默改写的审计原件进入公开 Git 历史，但不进入安装包；
- public release 提供生成式/空白日志模板，不分发 raw XLSX。
