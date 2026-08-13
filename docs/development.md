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
- `verify:clean-install` 默认使用隔离的临时 npm cache；需要跨次复用下载时，只接受绝对路径的 `STELLA_CLEAN_INSTALL_NPM_CACHE`，不得回退到用户级 npm cache；
- 模型仅用于候选字段抽取；`npm run test:deterministic` 使用 fake/recorded outputs，`npm run test:live-model` 从 Git 忽略的 `.stella-benchmark/manifest.json`（或绝对路径 `STELLA_LIVE_MODEL_BENCHMARK`）读取经人工批准的私有样本，并通过绝对路径 `STELLA_LIVE_MODEL_ADAPTER` 指向的本地 operator adapter 调用真实 Provider；仓库不发现、内置或打包 Provider 私有实现。样本、adapter 缺失或未批准，布局覆盖不足或任一关键指标失败时保持 fail closed，结果仅写入本地 benchmark 目录；
- 无效配置、ProgramSpec 和关键字段歧义 fail closed；
- 不实现训练表现、营养、健康风险、诊断、Policy Gate 或周期监督；
- 公开发行前保留课程授权和制品 gate。
