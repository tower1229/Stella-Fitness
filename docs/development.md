# 开发指南

Phase 0 已批准进入实现，Plugin foundation 与 scenario harness 已建立。

## 第一个实施切片

1. 以本机 OpenClaw extended-stable `2026.6.34` 为开发基线，声明 `>=2026.6.34` 兼容范围，并以能力预检替代精确版本白名单；
2. 核验 hooks、structured media、model permission、execution metadata 与 timeout/cancellation；
3. 创建可安装、可启用、可加载并返回 deterministic status 的 Native Plugin；
4. 建立 controlled extraction result scenario harness；
5. 建立配置 preflight 和 Personal/Runtime directory 边界。

## 实施顺序

1. Plugin foundation + scenario harness；
2. ProgramSpec validator + Program Engine；
3. Personal Data storage + correction/rebuild primitives；
4. body-weight Observation；
5. media sanitizer + Raw Artifact ingest；
6. fixed-workbook workout extraction + confirmation；
7. dedupe/correction + Training Record View；
8. packaging + clean install。

## 规则

- 每个切片必须有用户可观察的 scenario-level acceptance；
- 模型仅用于候选字段抽取；`npm run test:deterministic` 使用 fake/recorded outputs，`npm run test:live-model` 是独立 fail-closed gate，在 #3 的真实填写照片与人工 ground truth 可用前明确保持 blocked；
- 无效配置、ProgramSpec 和关键字段歧义 fail closed；
- 不实现训练表现、营养、健康风险、诊断、Policy Gate 或周期监督；
- 公开发行前保留课程授权和制品 gate。
