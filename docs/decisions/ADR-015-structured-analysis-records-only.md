# ADR-015：只保存结构化 Processing Records

Personal Data Directory 只长期保存结构化处理记录，包括 operation、artifact/result 引用、payload category、时间、ProgramSpec/schema version、错误类别和 OpenClaw runtime 实际返回的可用执行元数据。默认不保存完整 prompt、Provider 自由文本 response、隐藏推理、schema-invalid 原始输出或 Provider 日志副本。
