# ADR-013 — User Controls Raw Artifact Retention

**Status:** Accepted for v1 requirements  
**Date:** 2026-08-09

用户上传的训练日志和饮食原件属于 Personal Data Directory 中的 canonical 个人记录，默认与结构化产出一起长期保留，Plugin 不对用户目录执行静默的按时限自动删除。v1 不提供 Plugin retention policy 或删除功能；用户直接通过文件系统或 Personal Data Repository 工具删除原件。Runtime Directory 中的临时副本在处理完成后清理。删除原件后，仍存在的 Observation 必须明确标记 `source_missing`，且本地删除不代表能够追删 Provider 已接收的数据。具体文件系统契约见 ADR-020。
