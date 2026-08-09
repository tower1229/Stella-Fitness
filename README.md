# Stella Fitness

> Evidence-first hypertrophy supervision for OpenClaw.
>
> **正常训练，低摩擦记录；AI 长期观察，只在证据足够时干预。**

Stella Fitness 是一个拟以 **OpenClaw Native Plugin** 为主体实现的个人增肌长期监督智能体。当前仓库处于 **Phase 0：Requirements & Research**，只做需求冻结、技术调研、知识整理、质量基线、风险识别与实施准备，**尚未进入 Plugin 实现阶段，也不可安装使用**。

```text
Human executes
      ↓
Agent observes
      ↓
Evidence decides
      ↓
Intervene only when warranted
```

## 产品边界

Stella Fitness 不做训练中的高频交互，也不把“每天重新生成训练计划”作为核心价值。

v1 推荐体验已经明确为：

```text
原课程三阶段 XLSX
      ↓
打印对应阶段训练日志
      ↓
正常训练 + 纸笔记录 Actual
      ↓
训练后拍照上传
      ↓
结构化事实 + 定期体重 + 可选饮食证据
      ↓
长期监督
```

不需要为了使用 AI 改变训练时的习惯。

长期监督重点回答四个问题：

1. 原计划要求什么？
2. 用户实际上执行得怎样？
3. 近期趋势是否真的出现异常？
4. 现有证据是否足以支持调整？

正常状态下，`NO_CHANGE`、`OBSERVE` 或保持静默都是完整且正确的结果。

## 客观性不是 Prompt，而是信息隔离

目标架构把用户观点与第一次诊断物理分开：

```text
Program / Metrics
      ↓
EvidencePacket
      ↓
Blind Diagnosis       ← 看不到 user belief / desired action
      ↓ freeze
User Belief ──→ Adversarial Audit
      ↓
Deterministic Policy Gate
      ↓
DecisionPacket
      ↓
Template / Restricted Reporter
```

原则：**Same evidence, same conclusion, regardless of what the user wants to hear.**

未经审核的模型无权临场创造正式干预阈值。任何会改变训练/饮食的 production numeric policy，未来都必须有来源、适用人群、reviewer、版本和 Golden Cases。

## V1 适用范围

```text
healthy adults
age >= 18
general hypertrophy supervision
not medical / rehabilitation care
```

特殊疾病、孕期、未成年人、术后/伤病康复、医生限制运动等情况不默认套用普通 hypertrophy policy。

## 饮食证据原则

食物照片不是营养 Ground Truth。

默认来源优先级：

```text
Product nutrition label
> User-confirmed weighed recipe / fixed meal
> Authoritative food-composition database + known portion
> Restaurant published nutrition
> Image-only estimate
> Unknown
```

低置信照片不能单独触发高置信饮食调整。

## 当前阶段

### 已完成的 Phase 0 准备

- 产品定位、非目标、v1 适用范围与核心用户流程；
- 原课程三阶段 XLSX 作为 v1 默认训练日志模板；
- 反迎合、Blind Diagnosis、Audit 与 Policy Gate 系统不变量；
- OpenClaw Plugin hooks、isolated runtime、media extraction、Cron 与 ClawHub 技术调研；
- 首个 12 周教程的可审计 Markdown 知识包；
- 第 4 周周五通过原课程同源 XLSX 补齐为力量测试；
- `A` / `N` / 12RM、引体辅助、动作别名和第一阶段加重节奏等课程语义已集中确认；
- `ProgramSpec v0.2` source-reconciled draft；
- 运动科学、营养、食物图像能力、安全升级和营养数据源研究基线；
- Golden Cases 第一版目录；
- Training Log / Diet Benchmark 规范；
- Provider-neutral 模型角色与选择原则；
- 数据生命周期、隐私、审核治理与 Phase 0 Exit Review；
- 已知资料缺口与发布阻塞项集中登记。

### 当前明确不做

- 不创建 `src/`；
- 不创建 `package.json` / `openclaw.plugin.json`；
- 不写 hooks、数据库、模型 adapter 或 Cron；
- 不建立可执行测试或 CI；
- 不发布 npm / ClawHub 包；
- 不把任何候选模型或未经审核的阈值当作已定生产依赖。

实施必须等待 [Phase 0 Exit Review](docs/planning/phase0-exit-review.md) 的 `IMPLEMENTATION-BLOCKING` 项关闭。真实图片 pilot、OpenClaw 实时契约、Default Program 专业签署和内容发行授权分别由模型选择、kickoff、Default Program 与 release gate 跟踪，不再作为同一个开工条件。

## 当前仓库结构

```text
.
├── README.md
├── docs/                 # 需求、产品、调研、质量、ADR 与实施准备
├── knowledge/            # 来源忠实的训练计划知识层
└── sources/              # 外部资料登记、来源治理与引用索引
```

未来实现期的目标代码结构只记录在 [文档系统](docs/document-system.md) 中，不在当前分支提前创建空壳。

## 文档入口

从 **[docs/README.md](docs/README.md)** 开始阅读。

重点：

- [冻结需求](docs/requirements.md)
- [需求追踪矩阵](docs/requirements-traceability.md)
- [目标架构](docs/architecture.md)
- [用户流程](docs/product/user-flows.md)
- [现成训练日志模板语义](docs/product/training-log-template.md)
- [V1 适用范围](docs/product/applicability.md)
- [决策策略](docs/product/decision-policy.md)
- [ProgramSpec 设计](docs/program-spec.md)
- [Golden Cases](docs/quality/golden-cases.md)
- [Training Log Benchmark](docs/quality/training-log-benchmark.md)
- [Diet Benchmark](docs/quality/diet-benchmark.md)
- [Safety Escalation](docs/quality/safety-escalation.md)
- [已知缺口](docs/known-gaps.md)
- [Review Governance](docs/planning/review-governance.md)
- [Phase 0 Exit Review](docs/planning/phase0-exit-review.md)

## 许可证与内容权利

Stella Fitness Plugin 代码、通用 schema 及非课程派生的项目原创材料采用 [Apache License 2.0](LICENSE)。该许可不覆盖 `sources/originals/` 中的原始 DOCX/XLSX、卓叔课程派生的 Built-in Program/结构化知识，也不覆盖用户 Personal Data Directory 中的任何数据；这些内容适用独立权利与授权要求，详见 [NOTICE](NOTICE) 与 [ADR-018](docs/decisions/ADR-018-apache-2-code-separate-content-rights.md)。

## 首个训练计划资料

当前首个 program source 由两份可靠同源课程资料组成：

1. 《卓叔增重 · 结构化增肌增重教程》；
2. 原课程三阶段训练情况记录 XLSX。

训练处方与关键关系目前已经收敛：

- 第一次开始课程时，三个主项各自测试 12RM，并分别绑定为 `A`；
- 第 4 周周五是力量测试：三个主项重新测试 12RM，并分别直接绑定第二阶段对应的 `N`；
- 同日引体向上测试第一组最大次数，用于第二阶段辅助带选择，目标是尽量让每组能完成 8 次以上，同时保持计划规定的累计总次数；
- 第 4 周与完整周期结束后的 12RM 测试采用同一基本协议；
- “哑铃推举”和“哑铃推肩”是同一动作，统一为哑铃推肩；第三个月新增的哑铃弯举是独立动作；
- 第一阶段以详细逐周计划 `A → A+1 → A+2 → A+2 + retest` 为准，“两周加重一次”仅视为长期一般节奏概括。

当前 [ProgramSpec v0.2](knowledge/programs/zhuoshu-12-week/program-spec.v0.2.yaml) 已吸收这些确认；`v0.1` 仅保留为历史草案。

目前没有已知、仍需用户解释的训练计划语义问题。后续若交叉核对发现新歧义，会集中整理后向用户确认，不自行猜测。

教程末尾注明部分内容可能由 AI 生成。用户已允许将教程/XLSX 原件收录到本公开 GitHub 仓库，并决定将卓叔计划作为 v1 `Built-in Program`。安装包包含运行时派生制品，不包含原始 DOCX/XLSX；覆盖派生、修改、署名和实际分发渠道的可核验授权仍是 release blocker。当前工作是**来源忠实的结构化和需求研究**，不是对教程进行专业背书。

详见：

- [知识包](knowledge/programs/zhuoshu-12-week/README.md)
- [课程语义确认记录](knowledge/programs/zhuoshu-12-week/open-questions.md)
- [源资料审计](knowledge/programs/zhuoshu-12-week/source-audit.md)
- [已知缺口](docs/known-gaps.md)

## 状态声明

**Stella Fitness 当前不是可运行产品。** 训练计划最终 source cross-check 与 Product Owner 产品行为审核已完成；Supervision/Nutrition Domain、Safety、Privacy 仍是实施 blocker。Default Program 训练处方专业签署与课程派生制品授权已明确延后，分别阻断 Default Program 启用和正式发行，而不制造 Phase 0 开工自循环。
