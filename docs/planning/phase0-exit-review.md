# Phase 0 Exit Review

## 1. Review metadata

```text
review_version: phase0-exit/v0.2
review_date: 2026-08-10
product_owner: tower1229
privacy_reviewer: tower1229 / Product Owner approval
domain_reviewer: NOT REQUIRED — supervision and nutrition capabilities removed
safety_reviewer: NOT REQUIRED — health-risk capability removed
platform_reviewer: REVALIDATE_AT_KICKOFF
rights_reviewer: RELEASE_ONLY
result: APPROVED FOR IMPLEMENTATION
```

## 2. Scope decision

Stella Fitness v1 是训练计划执行与记录工具，不是训练监督系统。

允许实现：

- ProgramSpec validation 和确定性 Program State；
- 当前 Planned Session 解析；
- 固定 XLSX 训练日志照片抽取、最小确认和纠错；
- 体重 Observation；
- Raw Artifact、Observation、Processing Record 与事实视图；
- Personal Data Directory、Runtime Directory 和媒体净化边界；
- 安装、配置、状态和发行制品。

禁止实现：

- 训练表现评价、趋势诊断、停滞归因或训练调整；
- 饮食图片、营养估算、餐量判断或营养建议；
- User Belief、Blind Diagnosis、Adversarial Audit 或 Policy Gate；
- 健康风险、症状、伤病或特殊人群识别与升级；
- 周期主动监督和异常通知。

## 3. Product review

- [x] 核心价值已收敛为来源忠实的计划执行与低摩擦记录；
- [x] 训练过程保持 offline-first；
- [x] v1 复用原课程三阶段 XLSX；
- [x] 空白 actual、低置信、load 多态和 reps/duration 语义已冻结；
- [x] strength-test、recovery 和 symbolic binding 语义已冻结；
- [x] 用户纠错、去重和 deterministic rebuild 已定义；
- [x] 训练监督、营养和健康风险能力已从需求、架构和路线图移除。

## 4. Source program

- [x] 教程、XLSX、Markdown 与 ProgramSpec v0.2 完成 source cross-check；
- [x] 所有训练日与关键关系语义已确认；
- [x] 原始 Office 文件只作源码审计材料；
- [x] 来源忠实性与专业背书已明确分离；
- [ ] `[IMPLEMENTATION TASK]` schema validator 与完整 fixture test；
- [ ] `[RELEASE-BLOCKING]` 取得课程派生制品发行授权。

ProgramSpec 可作为实现 fixture。Stella Fitness 不评价该计划的专业质量，也不基于用户表现修改它。

## 5. Privacy review

Product Owner 于 2026-08-10 批准以下边界：

- [x] 用户显式配置 Personal Data Directory；
- [x] canonical 用户数据不回退到 Runtime Directory；
- [x] Runtime Directory 只保存临时和可重建状态；
- [x] 原始上传保持字节不变；
- [x] 模型 payload 使用应用方向、移除 EXIF/GPS 的临时副本；
- [x] 临时副本覆盖全部退出路径清理；
- [x] Observation canonical、事实视图可重建；
- [x] 用户删除有效，runtime 不恢复已删除数据；
- [x] Processing Record 只保存 Plugin 可观察的最小元数据；
- [x] 无遥测、自动数据贡献或隐式 Benchmark 复用。

```text
artifact: requirements.md + privacy-safety.md + data-lifecycle.md + applicable ADRs
reviewer_identity/reference: tower1229 / user decision 2026-08-10
status: approved
effect: implementation must conform; scope changes require a new review
```

## 6. Removed review gates

### Supervision/Nutrition Domain

```text
status: not required
reason: no training-performance diagnosis, nutrition analysis, recommendation or adjustment exists in scope
```

### Safety

```text
status: not required
reason: no health-risk detection, classification, escalation or medical/special-population handling exists in scope
```

这些能力是被删除，不是“未审核但内部可用”。未来若重新引入，必须作为新 scope 重新建立需求、review 和 acceptance，不得复活旧设计。

## 7. Kickoff gate

implementation kickoff 的第一项工作是按本机 OpenClaw stable 基线核验：

- Plugin hooks 与 conversation-access permission；
- structured media extraction；
- model allowlist/override；
- execution metadata；
- timeout/cancellation；
- package install/enable/load。

这是实施任务 #4 的内容，不是 Phase 0 外部审核 blocker。

## 8. Model selection gate

真实手写训练日志照片、噪声场景和人工 ground truth 仍未准备，因此不得宣称默认 extraction model 已确定。基础实现和 deterministic fixture test 可以先行。

## 9. Release gate

公开发布前仍须：

- 取得覆盖实际课程派生制品和渠道的授权；
- 核验 ClawHub owner/package 权限；
- 检查制品不包含 raw DOCX/XLSX、用户数据或未授权内容；
- 在 clean environment 安装、启用、加载并执行关键记录流程。

## 10. Sign-off

```text
Product:  APPROVED
Privacy:  APPROVED
Domain:   NOT REQUIRED — CAPABILITY REMOVED
Safety:   NOT REQUIRED — CAPABILITY REMOVED
Platform: REVALIDATE AT KICKOFF
Rights:   RELEASE ONLY

Overall:  APPROVED FOR IMPLEMENTATION
```
