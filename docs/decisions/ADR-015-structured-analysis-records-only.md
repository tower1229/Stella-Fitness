# ADR-015 — Persist Structured Analysis Records, Not Raw Model Transcripts

**Status:** Accepted for v1 requirements  
**Date:** 2026-08-09

Personal Data Directory 长期保存结构化 Analysis Records：EvidencePacket 引用与 hash、diagnosis、audit 的反证与不确定性、最终 Policy decision、实际用户报告，以及 operation、payload category、时间、ProgramSpec/Policy version 和 OpenClaw runtime 实际返回的可用执行元数据。失败调用只保存处理步骤、时间和错误类别。默认不保存完整 prompt、Provider 原始自由文本 response、隐藏推理、schema 校验失败的原始输出或 Provider 日志副本。详细原始交互仅可由用户显式开启诊断模式，并进入受控、可清理的临时位置。
