# 需求追踪矩阵

目标：让每项关键需求都有明确的来源、设计落点和未来验收方式，避免实施时只凭 README 印象开发。

| Requirement | 设计落点 | 依据/研究 | 未来验收 |
|---|---|---|---|
| 训练中零手机依赖 | `product/user-flows.md` | 用户场景约束 | 训练流程不要求 set-by-set 手机输入 |
| 官方可打印训练表作为首选 | `product/printable-log.md`, ADR-005 | offline-first UX + extraction reliability | Tier A printable-log benchmark |
| 训练后照片录入 | ingestion contract（未来） | `research/openclaw-platform.md` | `quality/training-log-benchmark.md` |
| Target 与 Actual 严格分离 | printable log / extraction schema | 训练日志数据完整性 | source/target confusion rate |
| 识别不确定时最小补充 | extraction uncertainty flow | low-friction principle | ambiguous/cropped Golden Cases |
| 用户纠错优先于模型 extraction | observation provenance | data integrity | correction case + metric recompute |
| 体重定期输入 | evidence model（未来） | 产品需求 | 时间序列可追溯、支持修正 |
| 单次体重变化不直接触发调整 | trend policy | `research/intervention-thresholds.md` | transient-noise Golden Cases |
| 饮食输入可选 | diet evidence model | 产品需求 | 缺失饮食不阻塞正常训练监督 |
| Food photo 不制造精确数字 | diet evidence policy, ADR-004/007 | food-image validation research | range/calibration/false-precision eval |
| 营养证据按来源分级 | ADR-007 | `research/nutrition-data-sources.md` | source-selection accuracy |
| 包装标签优先于图像猜测 | nutrition source hierarchy | NHC label context + product integrity | packaged-label Golden Cases |
| Personal Meal 可复用但可纠错 | local meal profile（未来） | private-agent continuity | fixed-meal benchmark cases |
| 原计划确定性解释 | Program Engine（未来） | ProgramSpec | 相同 program state 得到相同 prescription |
| Symbolic load 不解释成固定公斤 | ProgramSpec | source fidelity | G-SRC-002 |
| Recovery 不误判为退步 | Program/Metric semantics | source plan | G-SRC-003 / recovery eval |
| Unknown fail closed | `known-gaps.md`, ProgramSpec | source fidelity | Week 4 Friday 保持 unresolved |
| 源计划与外部证据分层 | source/program critique boundary | `research/domain-evidence.md` | external evidence 不静默改 ProgramSpec |
| 用户观点不进入盲诊 | Blind Diagnosis boundary, ADR-002 | sycophancy research + OpenClaw isolated runtime | Information Flow Test |
| 诊断冻结后再披露 belief | diagnosis/audit protocol | architecture | trajectory / payload audit |
| 同证据不同 framing 同诊断 | Blind isolation + Golden Cases | anti-sycophancy requirement | Framing Invariance Eval |
| Auditor 寻找反证但不无理由推翻 | audit contract | `quality/golden-cases.md` | Auditor effectiveness cases |
| 默认不干预 | decision policy | 产品定位 + balanced eval principle | No-change / Abstention Eval |
| 未经审定的 numeric threshold 禁止运行时创造 | ADR-008 | `research/intervention-thresholds.md` | Policy Gate / Golden Cases |
| Safety red flag 优先于增肌优化 | `quality/safety-escalation.md` | AHA/CDC/MedlinePlus research | Safety escalation cases |
| 普通 DOMS 不自动 emergency | safety negative controls | safety research | benign-soreness cases |
| v1 只面向健康成年人 18+ 的普通增肌监督 | `product/applicability.md`, ADR-006 | scope control + ACSM evidence population | onboarding/scope cases |
| 特殊人群不默认套普通 Policy | applicability policy | safety boundary | scope exclusion cases |
| 模型角色可替换 | ADR-003 + role contracts | `research/model-strategy.md` | same benchmark before model swap |
| 模型选择必须基于项目自有 Benchmark | quality benchmark docs | vendor-neutral principle | locked extraction/diagnosis eval |
| 敏感数据最小披露 | provider boundary | `quality/privacy-safety.md` | payload-level privacy tests |
| 原图默认不应永久保存 | `quality/data-lifecycle.md` | privacy/data minimization | retention/deletion tests |
| 用户可导出/删除/纠错 | data lifecycle | ownership requirement | export/delete/correction acceptance tests |
| 外部 Provider 数据流可审计 | disclosure ledger（未来） | multi-provider privacy | provider disclosure export |
| Phase 0 Golden Cases 在代码前冻结 | `quality/golden-cases.md` | anti-test-fitting governance | review approval record |
| 专业结论有 reviewer ownership | `planning/review-governance.md` | governance | signed review/version record |
| 周期监督默认静默 | Cron design（未来） | OpenClaw Cron capability | NO_REPLY/silence cases |
| 可公开安装 | release contract | ClawHub research | validate + dry-run + clean install |
| 首个教程合法发布范围明确 | source governance | rights gap | rights review before artifact inclusion |

## 需求变更规则

- 修改 `FROZEN` 需求时，必须同时修改本矩阵；
- 实施中发现平台能力与设计不符，先回到需求/架构层记录，不通过代码 workaround 偷偷改变产品语义；
- 一项能力没有未来可验证的方法时，默认认为需求还没有定义完整；
- reviewer 无法确认的专业阈值保持 Unknown，不能用模型意见替代批准；
- 新模型、数据源或特殊人群支持必须先补“依据 → 设计落点 → 验收”，再进入实现。