# 决策策略

本文件定义 Stella Fitness 的**产品级决策语义**。v1 已明确不启用未经专业审核的新增数值干预；示例数字不能实现成生产规则。

## 1. 决策集合

### `NO_CHANGE`

证据支持继续原计划，不需要改变训练或饮食。

### `OBSERVE`

存在轻微偏离，但不足以证明需要行动；继续观察指定窗口。

### `COLLECT_MORE_DATA`

当前最关键的问题是证据不足。输出应指出：缺什么、为什么重要、最小补充方式是什么。

### `ADJUST_DIET`

保留为未来扩展 action。v1 不放行监督模型新增的具体饮食数值调整。

### `ADJUST_TRAINING`

保留为未来扩展 action。v1 不放行监督模型新增的负重、组数或训练量调整。ProgramSpec 已确认的原计划进阶不属于该 action。

### `RECOVERY`

保留为未来扩展 action。v1 不凭未审核阈值生成具体减量或暂停进阶处方。ProgramSpec 原有计划恢复日继续确定性执行。

### V1 active actions

```text
NO_CHANGE
OBSERVE
COLLECT_MORE_DATA
ESCALATE
```

系统可以指出偏离、可能原因和缺失证据，但不能借解释文本绕过 action 限制给出具体 kcal、负重、组数、减量比例、采样窗口或 plateau 天数。

### `ESCALATE`

进入系统能力边界或出现健康危险信号。此时停止增肌优化路径。

## 2. 默认优先级

当证据强度相近时，优先选择可逆、低风险、信息增益更高的动作：

```text
NO_CHANGE / OBSERVE
        ↑
COLLECT_MORE_DATA
        ↑
limited adjustment
        ↑
large intervention
```

这不是永远保守，而是防止模型因为“需要给一个答案”而过度干预。

## 3. 每个诊断假设必须包含

- `hypothesis`
- `supporting_evidence[]`
- `contradicting_evidence[]`
- `missing_evidence[]`
- `confidence`
- `candidate_action`

缺少反证与缺失信息的诊断不应直接进入 Policy Gate。

## 4. 数据质量是决策输入

同样的“体重没涨”在以下情况下不能得到同样置信度：

- 14 天 10 次晨重；
- 14 天 1 次随机晚间体重；
- 饮食每日有称重；
- 饮食只有两张照片。

EvidencePacket 必须把 `coverage / confidence / source_type` 与数值一起传递。

## 5. 用户愿望不是证据

以下内容可以用于理解用户，但不能提高诊断概率：

- “我肯定练得没问题”；
- “教练也说我应该加量”；
- “我希望快一点长肉”；
- “我觉得就是碳水不够”。

这些属于 `BeliefPacket`，只有 Blind Diagnosis 冻结后 Auditor 才能看到。

## 6. 安全优先

若输入出现明显胸部不适、异常/极端呼吸困难、晕厥或接近晕厥等危险信号，应优先 `ESCALATE`，不继续讨论加重、热量盈余或训练强度。

具体症状分类和地区化紧急指引需在生产前由安全文档与专业审核冻结。
