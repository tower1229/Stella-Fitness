# Printable Workout Log Requirements

**状态：Phase 0 product requirement**

Stella Fitness 的训练日志输入不应迫使用户在训练中操作手机。为了同时降低用户摩擦和图像结构化难度，项目应提供一套**可打印、对人友好、对机器也友好**的训练记录模板。

该模板是推荐路径，不是强制格式。Plugin 最终仍可支持自由格式纸质日志，但官方模板应成为 extraction benchmark 的第一优先级。

## 1. 目标

模板必须做到：

- 训练过程中只需纸笔；
- 用户不需要重新抄写计划；
- 实际训练结果与计划目标明显分区；
- 拍照后能稳定识别 week/day/exercise/load/reps；
- 用户只记录真正影响长期监督的最低限度字段；
- 不要求用户学习复杂 RPE/RIR 体系才能使用。

## 2. 推荐生成方式

未来 Program Engine 根据 ProgramSpec 生成打印表，而不是让用户手写计划。

例如一张 session sheet 已预填：

```text
Program: zhuoshu-12-week
Cycle: 2026-Q3
Week: 7
Day: Monday / Torso

Exercise            Target        Actual load      Actual reps
Pull-up             total 25      —                [ ][ ][ ][ ]
DB bench press      4 × 8         ______ kg        __ / __ / __ / __
DB overhead press   3 × 8–12      ______ kg        __ / __ / __
Plank               3 × 60s       —                __ / __ / __
```

用户只填实际数据。

## 3. 必需字段

### Document metadata

应预打印：

- `program_id`；
- `program_version`；
- `cycle_id` 或 cycle start；
- week；
- day/session id；
- 日期空白或预填日期。

### Exercise row

预打印：

- normalized exercise name；
- 人类可读动作名称；
- target prescription；
- target load symbol（如 `N+1`）。

用户填写：

- actual load；
- actual reps / duration / total reps；
- 完成状态。

## 4. 可选字段

仅允许低摩擦选项：

- `感觉明显异常` checkbox；
- `备注` 单行自由文本；
- `动作/器械发生替换` checkbox。

v1 默认**不要求**：

- 每组 RPE；
- 每组 RIR；
- 心率；
- 休息秒数实际记录；
- 情绪量表；
- 每组打卡手机交互。

这些字段可能有研究价值，但会显著增加执行成本，而且用户主观估计未必稳定。

## 5. 机器可读设计

未来模板可以使用以下设计提高视觉识别稳定性：

- 固定列布局；
- 清晰表格边界；
- 四角视觉定位标记；
- 大字号 week/day/session 标识；
- 可选二维码或短 ID，仅编码 program/session metadata，不编码私人身体数据；
- 足够大的手写数字区域；
- load 与 reps 分栏，避免语义混淆。

二维码不是训练过程交互入口，只用于训练后照片结构化时识别模板元数据。

## 6. 隐私原则

打印表默认不需要包含：

- 用户真实姓名；
- 联系方式；
- 医疗信息；
- 账户 ID。

`cycle_id` 应可使用本地随机标识。

## 7. Extraction contract

对于官方模板，模型/解析器可以使用 layout prior，但必须遵守：

- 计划目标不能被当成实际完成数据；
- 空白格必须保持 unknown；
- OCR 不确定数字必须进入 uncertainty flow；
- 被涂改字段必须优先识别最终修正，无法确认时请求用户确认；
- template metadata 只用于定位，不替代实际训练记录。

## 8. Photograph UX

用户训练结束后只需要：

1. 展平纸张；
2. 拍摄完整页面；
3. 上传。

系统应容忍轻微：

- 透视；
- 阴影；
- 纸张折痕；
- 圆珠笔/铅笔；
- 中文或数字手写。

如果图片裁切导致关键列缺失，应请求重拍，而不是猜。

## 9. Benchmark tiers

### Tier A — Official template

用于验证最优默认体验，是 v1 extraction 的首要发布门槛。

### Tier B — Modified official template

用户手写额外行、划线、改动作、涂改。

### Tier C — Free-form logs

笔记本、自制表格等。

公开产品可以逐步支持 B/C，但不能为了宣称“任意纸张都能识别”而牺牲可靠性。

## 10. Product implication

Stella Fitness 的一个重要资产不只是 AI pipeline，还包括：

> **ProgramSpec → print-friendly execution sheet → paper execution → photo ingestion**

这是将 Agent 能力放在训练之外、同时保持训练过程低干扰的关键交互闭环。
