# Training Log Extraction Benchmark Specification

**状态：Phase 0 dataset specification**

本文定义未来训练日志图像模型如何被评估。Phase 0 不训练模型、不接 API，只冻结数据采集和验收方式。

> v1 的固定模板已经确定为用户提供的三阶段 XLSX。针对该模板的字段语义与专项指标见：`training-log-template-benchmark.md`。

## 1. Benchmark 目标

回答三个问题：

1. 模型能不能识别正确？
2. 模型不确定时能不能承认不知道？
3. 错误是否会影响长期监督结论？

因此不能只统计“整张图识别准确率”。

## 2. 样本分层

### Tier A — Supplied three-stage template

v1 首要发布门槛。

必须覆盖实际 workbook 的三阶段、普通训练块与第 4 周周五力量测试块。

详见 `training-log-template-benchmark.md`。

### Tier B — Noisy supplied template

加入：

- 涂改；
- 重写数字；
- 跨格书写；
- 勾选/箭头；
- 轻微污渍；
- 透视/阴影；
- 部分折痕；
- 局部裁切。

### Tier C — Free-form paper logs

包括：

- 笔记本；
- 自制表格；
- 简写动作名；
- 中英文混写；
- 没有固定列。

Tier C 是扩展能力，不应阻塞 v1 固定模板体验。

## 3. Ground truth 基础原则

每张图片都需要人工标注：

```text
artifact_id
image_quality
layout_type
stage?
week?
session?
rows[]
  raw_exercise_text
  normalized_exercise_id?
  actual values
  field semantics
  subjective fields
  annotation notes
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

任何会进入 progression/trend 的重量、次数、duration、测试值必须单独统计。

### Critical semantic

例如：

- kg 被当成 reps；
- duration 被当成 reps；
- 辅助方式被强制转成 kg；
- 特殊力量测试被当成普通训练。

### Identity

- exercise；
- stage/week/day/session。

### Subjective text

- 动作质量；
- 问题备注。

不能用自由文本高准确率掩盖关键数字错误。

## 5. Required metrics

至少报告：

- Exact field accuracy；
- Critical Numeric Error Rate；
- Structured validity；
- Abstention precision；
- Abstention recall；
- blank preservation accuracy；
- correction burden。

现成模板专项还必须报告：

- load semantic classification accuracy；
- reps/duration semantic accuracy；
- strength-test layout classification accuracy；
- plan leakage / inferred-actual rate。

详见 `training-log-template-benchmark.md`。

## 6. Error severity

### S0 — Harmless

排版、非关键文字。

### S1 — Recoverable

动作名称略有偏差但可由模板位置与 program 唯一解析。

### S2 — Decision-affecting

关键训练事实识别错误，但尚未触发健康安全风险。

### S3 — Safety / integrity critical

- 对空白/不可见字段制造高置信事实；
- 语义类型错误导致错误入库；
- 用户纠错后又被旧 extraction 覆盖。

Release gate 应优先限制 S2/S3，而不是只看总体 accuracy。

## 7. Sample collection protocol

未来采集应尽量来自真实使用环境，而不是只生成干净测试图。

每张 benchmark 图片记录：

- template version；
- stage/week/day；
- phone/device class；
- indoor light condition；
- pen/pencil type；
- angle；
- whether user intentionally introduced edits。

Benchmark ground truth 不保存 EXIF 中的无关位置隐私。运行契约还必须验证：Personal Data Directory 中原件保持不变，提交给 OpenClaw media runtime 的净化副本已应用方向、移除 EXIF/GPS，并在所有退出路径清理。

## 8. Privacy

如果使用真实用户日志：

- 采集前取得明确同意；
- benchmark 副本去除身份信息；
- 不把原图公开进 Git 仓库；
- public eval 如需图片，使用专门授权/合成/去身份样本；
- 原始 benchmark 存储和公开 fixture 分离。

## 9. Phase 0 状态

已经完成：

- v1 固定模板选择；
- workbook 结构审计；
- benchmark 规则设计。

尚未完成：

- 真实纸笔填写照片；
- 人工 ground truth；
- 模型横向比较。

模板源文件的存在不能替代真实 extraction benchmark。

## 10. Model selection rule

Extraction 默认模型不能仅依据通用 benchmark 或厂商宣传选择。

候选模型必须在同一 Stella Fitness benchmark 上比较关键错误、abstention、cost、latency 与 privacy mode。

模型替换后必须回归测试同一 benchmark。
