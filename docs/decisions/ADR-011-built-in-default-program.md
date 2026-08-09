# ADR-011 — Zhuoshu Program Will Be Built In

**Status:** Accepted; release authorization pending  
**Date:** 2026-08-08; artifact boundary confirmed 2026-08-09

卓叔 12 周计划将作为 v1 `Built-in Program` 直接随正式发行包提供，不采用“源码仓库归档后由用户本地导入”作为产品方案，因此本 ADR 取代 ADR-010。发行包包含运行时 ProgramSpec、执行所需结构化知识、生成式/空白训练日志模板及来源、署名和许可证声明；原始 DOCX/XLSX 继续只作公开源码仓库中的审计原件，不进入安装包。用户负责协调授权，且授权必须明确覆盖派生、修改、署名及实际 ClawHub/npm 分发渠道。在 Rights Reviewer 保存可核验授权、且 action-bearing 训练处方获得独立 Domain Review 签署前，该计划仍只是 `Default Program Candidate`，不得对外发布或标记为已审核的 `Default Program`。
