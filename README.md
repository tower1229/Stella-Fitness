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
- `ProgramSpec v0.1` 历史草案及下一版来源审定路径；
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

实施必须等待 [Phase 0 Exit Review](docs/planning/phase0-exit-review.md) 明确通过。

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
- [Golden Cases](docs/quality/golden-cases.md)
- [Training Log Benchmark](docs/quality/training-log-benchmark.md)
- [Diet Benchmark](docs/quality/diet-benchmark.md)
- [Safety Escalation](docs/quality/safety-escalation.md)
- [已知缺口](docs/known-gaps.md)
- [Review Governance](docs/planning/review-governance.md)
- [Phase 0 Exit Review](docs/planning/phase0-exit-review.md)

## 首个训练计划资料

当前首个 program source 由两份可靠同源课程资料组成：

1. 《卓叔增重 · 结构化增肌增重教程》；
2. 原课程三阶段训练情况记录 XLSX。

配套 XLSX 已确认来自原作者或可靠同源版本，并补齐了结构化教程中此前缺失的第 4 周周五：

```text
第4周，周五，力量测试
高脚杯深蹲：12RM 测试重量
哑铃卧推：12RM 测试重量
哑铃硬拉：12RM 测试重量
引体向上：第一组最大完成次数
```

因此 12 周训练日来源覆盖已经完整。

当前仍有少量**关系语义**需要集中向用户确认，例如 12RM 与 `N` 的映射、初始 `A` 的定义和“哑铃推举/推肩”的命名一致性；这些问题集中在：

- [训练计划待确认问题](knowledge/programs/zhuoshu-12-week/open-questions.md)

此外，教程末尾注明部分内容可能由 AI 生成，且教程/XLSX 的公开再分发许可尚未确认。当前工作是**来源忠实的结构化和需求研究**，不是对教程进行专业背书。

详见：

- [知识包](knowledge/programs/zhuoshu-12-week/README.md)
- [源资料审计](knowledge/programs/zhuoshu-12-week/source-audit.md)
- [已知缺口](docs/known-gaps.md)

## 状态声明

**Stella Fitness 当前不是可运行产品。** 仓库中的架构、ProgramSpec、模型候选、研究阈值与领域策略均属于实施前设计基线。只有经过训练计划关系确认、Golden Cases 审核、专业策略审定、隐私审查与 Phase 0 Exit Review 后，才允许进入真实训练监督实现。
