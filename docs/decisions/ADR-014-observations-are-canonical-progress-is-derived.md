# ADR-014 — Observations Are Canonical, Progress Is Derived

**Status:** Accepted for v1 requirements  
**Date:** 2026-08-09

Personal Data Directory 以带稳定 ID、发生时间、schema version 和 provenance 的结构化 Observation Records 作为训练 actual、体重、饮食及主观反馈的 canonical 事实；纠错显式关联被修正记录。当前训练进度、趋势和完成率由这些记录与 Program state 计算，可生成便于用户阅读的 profile/progress snapshot，但 snapshot 不是唯一事实源。原始文件通过相对路径和 hash 与 observation 关联。Runtime Directory 可以持久化 SQLite、索引或其他物化视图以加速查询，但必须能够从 Personal Data Directory 重建。
