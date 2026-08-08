# Stella Fitness

> Evidence-first hypertrophy supervision for OpenClaw.
>
> **正常训练，低摩擦记录；AI 长期观察，只在证据足够时干预。**

Stella Fitness 是一个拟以 **OpenClaw Native Plugin** 为主体实现的个人增肌长期监督智能体。当前仓库处于 **Phase 0：Requirements & Research**，只做需求冻结、技术调研、知识整理、风险识别与实施准备，**尚未进入 Plugin 实现阶段，也不可安装使用**。

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

Stella Fitness 不做训练中的高频交互，也不把“每天重新生成训练计划”作为核心价值。目标用户仍然可以打印计划、训练时用纸笔记录；训练结束后上传日志照片，定期记录体重，饮食按需补充。

长期监督重点回答四个问题：

1. 原计划要求什么？
2. 用户实际上执行得怎样？
3. 近期趋势是否真的出现异常？
4. 现有证据是否足以支持调整？

正常状态下，`NO_CHANGE`、`OBSERVE` 或保持静默都是完整且正确的结果。

## 为什么不是一个 Skill

核心可靠性要求是**信息隔离**，而不是一句“请保持客观”的 Prompt。目标架构把用户观点与第一次诊断物理分开：

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

## 当前阶段

### 已完成的准备工作

- 产品定位、非目标与核心用户流程已冻结；
- 反迎合、信息隔离、默认不干预等系统不变量已明确；
- OpenClaw Plugin hooks、isolated model runtime、media extraction、Cron 与 ClawHub 发布路径已调研；
- 首个 12 周训练教程已重新组织为可审计 Markdown 知识包；
- `ProgramSpec v0.1` 仅作为**规格设计草案**保留；
- 外部模型、数据隐私、运动科学、营养图像识别、安全升级策略已建立研究基线；
- 已知资料缺口与发布阻塞项集中登记。

### 当前明确不做

- 不创建 `src/`；
- 不创建 `package.json` / `openclaw.plugin.json`；
- 不写 hooks、数据库、模型 adapter 或 Cron；
- 不建立可执行测试或 CI；
- 不发布 npm / ClawHub 包；
- 不把任何候选模型或阈值当作已定生产依赖。

实施必须等待 Phase 0 Exit Review 明确通过。

## 当前仓库结构

```text
.
├── README.md
├── docs/                 # 需求、架构、调研、质量与实施准备
├── knowledge/            # 来源忠实的训练计划知识层
└── sources/              # 外部资料登记、来源治理与引用索引
```

未来实现期的目标代码结构只记录在 [文档系统](docs/document-system.md) 中，不在当前分支提前创建空壳。

## 文档入口

从 **[docs/README.md](docs/README.md)** 开始阅读。

核心文件：

- [冻结需求](docs/requirements.md)
- [目标架构](docs/architecture.md)
- [需求追踪矩阵](docs/requirements-traceability.md)
- [用户流程](docs/product/user-flows.md)
- [决策策略](docs/product/decision-policy.md)
- [ProgramSpec 设计](docs/program-spec.md)
- [已知缺口](docs/known-gaps.md)
- [实施前退出条件](docs/planning/implementation-handoff.md)

## 首个训练计划资料

当前使用《卓叔增重 · 结构化增肌增重教程》作为首个 program source。资料描述一个 12 周、三阶段训练周期，并包含饮食、加重、恢复和周期循环信息。

但源资料第 4 周周五明确标记为“资料缺失，待补充”，因此知识包和 ProgramSpec 都必须保留 `unresolved`，不能根据前后规律自动补齐。

此外，教程末尾注明部分内容可能由 AI 生成，且公开再分发许可尚未确认。当前工作是**来源忠实的结构化和需求研究**，不是对教程进行专业背书。

详见：

- [知识包](knowledge/programs/zhuoshu-12-week/README.md)
- [源资料审计](knowledge/programs/zhuoshu-12-week/source-audit.md)
- [已知缺口](docs/known-gaps.md)

## 状态声明

**Stella Fitness 当前不是可运行产品。** 仓库中的架构、ProgramSpec、模型候选与领域策略均属于实施前设计基线；只有经过来源补全、专业策略审定、隐私审查与系统 Eval 后，才允许进入真实训练监督实现。