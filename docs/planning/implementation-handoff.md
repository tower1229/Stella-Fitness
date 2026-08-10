# Phase 0 → Implementation Handoff

Phase 0 已由 [phase0-exit-review.md](./phase0-exit-review.md) 签署为 `APPROVED FOR IMPLEMENTATION`。

## 已冻结

- [x] 记录型产品定位与非目标；
- [x] Offline-first + fixed XLSX 用户流程；
- [x] ProgramSpec v0.2 source reconciliation；
- [x] strength-test、recovery、symbolic-load 和 alias 语义；
- [x] Observation canonical、correction、dedupe 与 rebuild；
- [x] Personal Data Directory / Runtime Directory 边界；
- [x] 原件保真和 sanitized media payload；
- [x] Privacy Review；
- [x] 训练监督、营养与健康风险能力移出范围；
- [x] Recording-scope Golden Cases `FROZEN v0.2`。

## Kickoff 必做

- [ ] 锁定 OpenClaw stable 版本；
- [ ] 核验 Plugin hooks 与权限；
- [ ] 核验 structured media extraction 与 execution metadata；
- [ ] 核验 timeout/cancellation；
- [ ] 核验 manifest、package、install/enable/load；
- [ ] 建立 deterministic scenario harness。

## Implementation acceptance

- [ ] ProgramSpec schema validator 通过；
- [ ] Program Engine 覆盖全部 12 周及特殊 session；
- [ ] clean configuration preflight；
- [ ] workout photo → confirmation → Observation 端到端；
- [ ] correction/dedupe/restart/deletion/rebuild；
- [ ] media byte-integrity/metadata/cleanup；
- [ ] packaged Plugin clean install。

## 分阶段门禁

- `MODEL-SELECTION-BLOCKED`：真实训练日志 pilot 未完成前不得冻结默认 extraction model；
- `RELEASE-BLOCKING`：课程派生制品授权和 ClawHub 实时权限未完成前不得公开发行；
- 两者均不阻止使用 deterministic fixtures 开始基础实现。

## 禁止恢复的旧范围

Blind Diagnosis、User Belief、Audit、Policy Gate、饮食营养、健康风险和周期监督已经删除。若未来重新提出，必须作为全新需求重新评审，不得复用旧文件或隐藏 capability flag。
