# ADR-024：记录与计划执行，而不是训练监督

Stella Fitness v1 只负责来源忠实的 ProgramSpec、确定性 Program State，以及训练日志和体重 Observation 的低摩擦采集、纠错与事实视图。产品不评价训练表现，不推断停滞原因，不处理饮食或营养，不提取 User Belief，不运行 Blind Diagnosis、Adversarial Audit、Policy Gate 或周期监督，也不识别、判断或升级健康风险；用户独立选择训练计划并承担训练决策，必要时自行寻求合格专业人员意见。该收缩去除了原 Supervision/Nutrition Domain Review 与 Safety Review 门禁；已批准的隐私和数据生命周期边界继续适用。

增重目标只允许一个确定性例外：在用户主动查看状态、下一阶段或体重事实时，系统可从 canonical BodyWeight Observation 重建相对 baseline 和上一阶段 checkpoint 的 kg、百分比变化，并用 `toward-goal`、`away-from-goal`、`unchanged` 或 `insufficient-data` 表示纯数学方向。该方向不代表健康、理想程度或训练表现，不推断原因，不生成饮食/训练建议，也不触发后台轮询、通知或计划调整。第 4、8、12 周 checkpoint 只作为交互时的阶段事实门禁。
