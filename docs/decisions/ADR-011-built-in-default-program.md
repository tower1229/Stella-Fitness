# ADR-011：内置来源忠实的 ProgramSpec

卓叔 12 周 ProgramSpec 计划作为 v1 Built-in Program 随正式发行包提供。发行包可包含授权的运行时 ProgramSpec、必要结构化知识、固定 digest 的原始训练日志 XLSX 和 notice；原始 DOCX 只作源码审计材料，不进入安装包。Plugin 直接发送完整静态 XLSX，不在运行时生成 PDF。启用要求是来源忠实性、schema/fixture validation 和覆盖实际制品与渠道的可核验授权，不代表 Stella Fitness 作专业背书。
