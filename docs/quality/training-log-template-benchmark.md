# Supplied Template Extraction Benchmark

**状态：Phase 0 dataset specification**

本文件补充 `training-log-benchmark.md`，把用户提供的三阶段 XLSX 训练日志确定为 v1 Tier A 的实际模板。

## 必须覆盖的布局

1. 第一阶段常规全身训练块；
2. 第二阶段躯干/四肢训练块；
3. 第三阶段躯干/四肢训练块；
4. 第 4 周周五特殊 `力量测试` 块。

## 常规字段

固定列为：

```text
动作 | 重量 | 第一组 | 第二组 | 第三组 | 第四组 | 第五组 | 第六组 | 动作质量 | 问题备注
```

Benchmark 必须验证：

- 空白格保持 unknown，不根据计划自动补值；
- 1~6 组数字识别；
- `高/中/低` 动作质量；
- 中文问题备注；
- 涂改、阴影、透视、局部裁切。

## `重量` 多态语义

B 列不能只评估 `kg number`：

```text
普通哑铃：10kg / 10
徒手引体：blank
弹力带引体：红色弹力带等描述
俯卧撑：跪姿 / 标准 / 实际负重
平板支撑：-
```

需要单独报告 load semantic classification accuracy。

## 组格语义

C:H 通常是 reps，但平板支撑属于 duration。

Benchmark 必须验证 `30 / 45 / 60` 等平板支撑记录不会被写成 reps。

需要单独报告 set-value semantic accuracy：

```text
reps | duration | other
```

## 第 4 周周五力量测试

特殊块要求支持：

- 高脚杯深蹲 12RM 测试重量；
- 哑铃卧推 12RM 测试重量；
- 哑铃硬拉 12RM 测试重量；
- 引体向上第一组最大完成次数。

需要单独报告 layout classification：

```text
regular_training_block | strength_test_block
```

## 主要错误指标

- Critical Numeric Error Rate；
- blank preservation accuracy；
- load semantic classification accuracy；
- reps/duration semantic accuracy；
- layout classification accuracy；
- abstention precision / recall；
- correction burden；
- plan leakage / inferred-actual rate。

其中 `plan leakage / inferred-actual` 指：图片实际填写为空时，模型因知道训练计划而虚构一个“应该完成”的 actual 值。该错误必须接近 0。

## 当前 Phase 0 状态

- 模板源文件：已提供；
- 模板结构审计：已完成；
- 真实手写照片集：未准备；
- 人工 ground truth：未准备；
- 模型选择：仍不得开始冻结。

因此“训练日志模板选择”可以关闭，但 `GAP-014` 的真实 benchmark artifact 仍保持 OPEN。
