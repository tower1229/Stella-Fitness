# 已知资料缺口与待确认项

本文集中记录 Stella Fitness 在进入实现阶段前仍未解决的资料问题。

任何列为 `blocking` 的条目都不能由 LLM、Program Engine 或开发者根据上下文自行猜测后当作正式事实。

## GAP-001：第 4 周周五训练内容缺失

**状态：** `OPEN / BLOCKING`

原始教程在第一阶段第 4 周中提供：

- 周一：主项 `A+2`，6×10；
- 周三：主项 `A+2`，5×12；
- 周五：明确写为“资料缺失，待补充”。

### 当前处理

ProgramSpec：

```yaml
- day: friday
  type: full-body
  status: unresolved
  reason: source_missing
  exercises: null
```

### 禁止行为

- 根据前 3 周规律自动推断周五训练；
- 让模型生成一个“最合理”的周五计划；
- 在 README 中宣称当前 canonical program 100% 可自动执行；
- 在用户实际进入第 4 周周五时悄悄采用推测值。

### 关闭条件

获得可追溯的可靠原始资料，并完成：

1. Markdown 修订；
2. ProgramSpec 修订；
3. fixture 更新；
4. changelog 记录。

---

## GAP-002：原始 DOCX 的版权/再发布许可

**状态：** `OPEN / RELEASE-BLOCKING`

当前用户提供的教程可用于本项目内部结构化与实现设计，但在准备把原文、完整 Markdown 转写或原始 DOCX 随 ClawHub / GitHub 正式公开发布前，需要确认内容的版权归属及再发布许可。

### 当前处理

- 本阶段先用于仓库设计和程序规格整理；
- 正式 release 前再次做版权检查；
- 如果不能公开再发布，应把训练计划改成用户本地导入的 program package，或仅保留获得许可的结构化规则。

> 此条是发布治理要求，不对现有教程内容本身作版权结论。

---

## GAP-003：营养目标的适用范围

**状态：** `OPEN / NON-BLOCKING FOR PROGRAM ENGINE`

原教程明确给出了 65 kg 与 70 kg 男生的饮食示例，并提出不同体重按比例调整主食和瘦肉量，但没有给出一个完整、严格定义的连续计算公式。

### 当前处理

- 保留 65 kg / 70 kg 原始目标；
- 不把“按比例调整”擅自固化成唯一确定算法；
- v0.1 饮食监督可以把教程目标当 reference，而不是未经验证的医学/营养处方引擎。

---

## 维护规则

新增资料缺口统一使用：

```text
GAP-XXX
status
source evidence
effect
current handling
closure criteria
```

这样可以让“未知”成为系统的一等状态，而不是被模型自动抹平。
