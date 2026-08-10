# ADR-024：记录与计划执行，而不是训练监督

Stella Fitness v1 只负责来源忠实的 ProgramSpec、确定性 Program State，以及训练日志和体重 Observation 的低摩擦采集、纠错与事实视图。产品不评价训练表现，不推断停滞原因，不处理饮食或营养，不提取 User Belief，不运行 Blind Diagnosis、Adversarial Audit、Policy Gate 或周期监督，也不识别、判断或升级健康风险；用户独立选择训练计划并承担训练决策，必要时自行寻求合格专业人员意见。该收缩去除了原 Supervision/Nutrition Domain Review 与 Safety Review 门禁；已批准的隐私和数据生命周期边界继续适用。
