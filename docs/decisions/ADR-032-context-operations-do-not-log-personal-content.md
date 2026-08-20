# ADR-032：Context 操作不记录个人内容

Projection Builder、Context Resync、意图分类和 Fact-Preserving Reply 默认不记录 USER 内容、原始 prompt、模型自由文本、memory snippets 或隐藏推理，也不新增远程 telemetry。运行日志只包含状态、reason code、数量、耗时、版本、checksum 和不含个人内容的来源类别；需要查看来源与内容时，由用户主动打开本地 Context Diagnostics。
