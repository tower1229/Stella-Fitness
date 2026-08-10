# ADR-013：用户控制 Raw Artifact 保留

用户上传的训练日志原件属于 Personal Data Directory 中的 canonical 个人记录，默认与结构化产出一起保留。Plugin 不执行静默定时删除，也不提供 retention policy；用户通过文件系统或 Personal Data Repository 管理原件。Runtime Directory 临时副本处理后清理。删除原件后，仍存在的 Observation 标记 `source_missing`，且本地删除不代表能够追删 Provider 已接收的数据。
