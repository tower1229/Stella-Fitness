# ADR-014：Observation canonical，事实视图可重建

Personal Data Directory 以带稳定 ID、发生时间、schema version 和 provenance 的 Observation Records 作为训练 actual、体重和原始备注的 canonical 事实；纠错显式关联被替代记录。Program State 与 Training Record View 可由这些记录重建，但不得成为覆盖 Observation 的第二事实源。Runtime Directory 可以保存物化索引，但删除后必须能从 Personal Data Directory 恢复相同事实视图。
