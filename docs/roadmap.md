# Stella Fitness Roadmap

## Phase 0 — Requirements & Research

### 已完成

- [x] 冻结记录型产品定位与非目标；
- [x] 冻结 offline-first 训练流程；
- [x] 确定复用原课程三阶段 XLSX；
- [x] 完成教程、XLSX、Markdown 与 ProgramSpec v0.2 最终 source cross-check；
- [x] 确认 `A/N/12RM`、Week 4 strength test、引体辅助与动作别名；
- [x] 建立 ProgramSpec、训练日志抽取和持久化设计；
- [x] 冻结 Observation canonical、纠错、去重和重建语义；
- [x] 冻结 Personal Data Directory、媒体净化和用户数据控制边界；
- [x] Product Owner 于 2026-08-10 批准 Privacy Review；
- [x] 移除训练表现诊断、营养、健康风险、Policy Gate 和周期监督范围；
- [x] 关闭不再适用的 Domain/Safety 实施审核门禁。

### Phase 0 结论

产品与隐私范围已批准，可以进入 implementation kickoff。公开发行权利不是开工门禁，但必须继续 fail closed。

## Phase 1 — Plugin Foundation

- 锁定 OpenClaw 版本与 Plugin/media/model permission 契约；
- 创建可安装、可加载的 Native Plugin；
- 建立 scenario harness；
- 实现配置 preflight 和 readiness states；
- 实现 Personal Data Directory / Runtime Directory 边界。

## Phase 2 — Program Execution

- ProgramSpec schema validator；
- 全 12 周 fixture validation；
- Program Engine 与 Program State；
- strength-test binding、recovery 和 next-cycle 行为。

## Phase 3 — Reliable Recording

- 体重 Observation；
- 媒体净化与 Raw Artifact ingest；
- 固定 XLSX 训练日志抽取、确认与写入；
- correction、dedupe 与 deterministic rebuild；
- Training Record View。

## Phase 4 — Packaging & Release

- clean install 与 packaged Plugin 端到端验收；
- 排除 raw DOCX/XLSX、用户数据和未授权内容；
- 取得课程派生制品发行授权；
- 核验 ClawHub owner、package identity 和实时发布权限。

## 不进入路线图

- 训练表现分析与计划调整；
- 饮食/营养功能；
- 健康风险识别与升级；
- 反迎合诊断流水线；
- 周期主动监督或异常通知。
