# 需求追踪矩阵

目标：让每项关键需求都有明确的来源、设计落点和未来验收方式，避免实施时只凭 README 印象开发。

| Requirement | 设计落点 | 依据/研究 | 未来验收 |
|---|---|---|---|
| 训练中零手机依赖 | `product/user-flows.md` | 用户场景约束 | 训练流程不要求 set-by-set 手机输入 |
| 训练后照片录入 | ingestion contract（未来） | `research/openclaw-platform.md` | 手写日志 extraction benchmark |
| 体重定期输入 | evidence model（未来） | 产品需求 | 时间序列可追溯、支持修正 |
| 饮食可选 | `food-image-estimation.md` | 图像营养研究 | 缺失饮食不阻塞训练日志；置信度显式 |
| 原计划确定性解释 | Program Engine（未来） | ProgramSpec | 相同 program state 得到相同 prescription |
| 用户观点不进入盲诊 | Blind Diagnosis boundary | sycophancy research + OpenClaw isolated runtime | Information Flow Test |
| 诊断冻结后再披露 belief | diagnosis/audit protocol | architecture | trajectory / payload audit |
| 默认不干预 | decision policy | 产品定位 + balanced eval principle | No-change / Abstention Eval |
| Unknown fail closed | `known-gaps.md`, ProgramSpec | source fidelity | unresolved 不被自动补齐 |
| Food photo 不制造精确数字 | diet evidence policy | `food-image-estimation.md` | photo-only 输出 range/confidence |
| 健康危险信号停止增肌优化 | safety gate | `quality/privacy-safety.md` | Safety escalation cases |
| 模型可替换 | role contracts | `research/model-strategy.md` | model swap 不改变 domain schema |
| 敏感数据最小披露 | provider boundary | provider privacy research | payload-level privacy tests |
| 周期监督默认静默 | Cron design（未来） | OpenClaw Cron capability | NO_REPLY/silence cases |
| 可公开安装 | release contract | ClawHub research | validate + dry-run + clean install |

## 需求变更规则

- 修改 `FROZEN` 需求时，必须同时修改本矩阵；
- 实施中发现平台能力与设计不符，先回到需求/架构层记录，不通过代码 workaround 偷偷改变产品语义；
- 一项能力没有未来可验证的方法时，默认认为需求还没有定义完整。