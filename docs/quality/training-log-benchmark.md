# Training Log Extraction Benchmark Specification

**状态：Phase 0 dataset specification**

本文定义未来训练日志图像模型如何被评估。Phase 0 不训练模型、不接 API，只冻结数据采集和验收方式。

## 1. Benchmark 目标

回答三个问题：

1. 模型能不能识别正确？
2. 模型不确定时能不能承认不知道？
3. 错误是否会影响长期监督结论？

因此不能只统计“整张图识别准确率”。

## 2. 样本分层

### Tier A — Official printable template

必须覆盖：

- 三个训练阶段；
- sets/reps；
- total reps；
- duration；
- symbolic load；
- recovery sessions；
- 空白/未完成行。

### Tier B — Noisy official template

加入：

- 涂改；
- 重写数字；
- 跨格书写；
- 勾选/箭头；
- 轻微污渍；
- 透视/阴影；
- 部分折痕。

### Tier C — Free-form paper logs

包括：

- 笔记本；
- 自制表格；
- 简写动作名；
- 中英文混写；
- 没有固定列。

Tier C 是扩展能力，不应阻塞 v1 官方模板体验。

## 3. Ground truth schema

每张图片都需要人工标注：

```text
artifact_id
image_quality
layout_type
program_id?
week?
session?
date?
rows[]
  raw_exercise_text
  normalized_exercise_id?
  actual_load?
  load_unit?
  actual_reps[]?
  duration[]?
  total_reps?
  completed?
  annotation_notes?
```

还要标注：

```text
field_visibility:
  visible
  ambiguous
  absent
  cropped
```

“图片本身无法确认”不能在 ground truth 中强行给唯一答案。

## 4. Critical field classes

### Critical numeric

- actual load；
- each-set reps；
- total reps；
- duration。

这类错误会直接污染 trend / volume / progression，必须单独统计。

### Identity

- exercise；
- session/week/day；
- date。

### Non-critical text

- notes；
- free-form comment。

不能用 notes 的高准确率掩盖重量数字识别错误。

## 5. Required metrics

至少报告：

### Exact field accuracy

适合日期、动作 ID、整数次数。

### Critical Numeric Error Rate

任何 actual load/reps 错误单独统计。

### Structured validity

JSON/Schema 是否有效。

### Abstention precision

模型标记“不确定”的字段中，有多少确实需要人工确认。

### Abstention recall

所有真正 ambiguous/cropped 字段中，模型有多少没有擅自猜测。

### Source/target confusion rate

官方模板预填的 `Target 4×10` 是否被错误写成 `Actual 4×10`。

这是 Stella Fitness 特有的关键错误。

### Correction burden

平均每张表需要用户补几个字段。

目标不是追求零互动，而是把互动压缩到**最小必要纠错**。

## 6. Error severity

### S0 — Harmless

排版、非关键文字。

### S1 — Recoverable

动作名称略有偏差但可由 program/session 唯一解析。

### S2 — Decision-affecting

重量、次数、日期识别错误，但尚未触发健康安全风险。

### S3 — Safety / integrity critical

- 把 plan target 当 actual；
- 把 recovery session 当普通训练；
- 对不可见数字制造高置信值；
- 用户纠错后又被旧 extraction 覆盖。

Release gate 应优先限制 S2/S3，而不是只看总体 accuracy。

## 7. Sample collection protocol

未来采集应尽量来自真实使用环境，而不是只生成干净测试图。

每张 benchmark 图片记录：

- phone/device class；
- indoor light condition；
- pen/pencil type；
- angle；
- template version；
- whether user intentionally introduced edits。

不需要保存 EXIF 中无关位置隐私。

## 8. Privacy

如果使用真实用户日志：

- 采集前取得明确同意；
- benchmark 副本去除身份信息；
- 不把原图公开进 Git 仓库；
- public eval 如需图片，使用专门授权/合成/去身份样本；
- 原始 benchmark 存储和公开 fixture 分离。

## 9. Phase 0 recommended pilot

Phase 0 不规定“多少张就一定足够上线”。建议实施启动前至少准备一个能覆盖所有关键字段类型和主要噪声类型的人工标注 pilot set，再通过错误分布决定扩容。

不要把任意固定样本数当成科学保证。

## 10. Model selection rule

Extraction 默认模型不能仅依据通用 benchmark 或厂商宣传选择。

候选模型必须在同一 Stella Fitness benchmark 上比较：

```text
critical numeric error
abstention behavior
source/target confusion
cost
latency
privacy mode
```

模型替换后必须回归测试同一 benchmark。
