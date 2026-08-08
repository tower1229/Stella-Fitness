# 决策策略

本文件定义 Stella Fitness 的**产品级决策语义**。具体阈值尚未冻结，不能把示例数字实现成生产规则。

## 1. 决策集合

### `NO_CHANGE`

证据支持继续原计划，不需要改变训练或饮食。

### `OBSERVE`

存在轻微偏离，但不足以证明需要行动；继续观察指定窗口。

### `COLLECT_MORE_DATA`

当前最关键的问题是证据不足。输出应指出：缺什么、为什么重要、最小补充方式是什么。

### `ADJUST_DIET`

只有在饮食相关原因得到足够支持、替代解释被审视、数据质量达标时才允许。

### `ADJUST_TRAINING`

只有在计划执行与表现证据足够，并排除明显恢复/数据问题后才允许。

### `RECOVERY`

证据更支持降低负荷/暂停进阶/优先恢复，而不是继续增加刺激。具体健康和训练阈值需要专业审定。

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