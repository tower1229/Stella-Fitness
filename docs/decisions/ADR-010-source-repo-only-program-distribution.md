# ADR-010 — Source Program Stays Outside the Release Package

**Status:** Superseded by ADR-011  
**Date:** 2026-08-08

v1 ClawHub/npm 发行包不捆绑卓叔计划的原始 DOCX/XLSX，也不捆绑足以还原教程内容的 Markdown/ProgramSpec；发行包只包含 Plugin 代码、Schema 与不含教程内容的空白模板。卓叔计划继续作为公开源码仓库中的来源归档，并通过低摩擦本地导入进入用户实例。在权利与专业审核 gate 完成前，它是开发与验收全程使用的 `Default Program Candidate`，不是发行包内置的 `Default Program`。打包测试必须证明受限来源内容未进入发行产物，端到端测试必须使用该 Candidate 覆盖完整计划流程。
