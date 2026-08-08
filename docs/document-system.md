# Stella Fitness 文档系统

## 1. 目标

仓库文档分成四层，避免产品需求、技术设计、训练知识和运行时数据相互混杂。

```text
Product / Architecture Docs
        ↓
Human-readable Knowledge
        ↓
Machine-readable ProgramSpec
        ↓
Runtime User Data
```

## 2. 目标目录结构

```text
.
├── README.md
├── docs/
│   ├── requirements.md          # 冻结需求基线
│   ├── architecture.md          # 总体技术架构
│   ├── program-spec.md          # ProgramSpec 规范
│   ├── known-gaps.md            # 项目级资料缺口/发布阻塞项
│   ├── document-system.md       # 本文
│   └── roadmap.md               # 实施路线
│
├── knowledge/
│   ├── README.md
│   └── programs/
│       └── zhuoshu-12-week/
│           ├── README.md
│           ├── overview.md
│           ├── nutrition.md
│           ├── rules.md
│           ├── warmup-and-recovery.md
│           ├── phase-1-weeks-01-04.md
│           ├── phase-2-weeks-05-08.md
│           ├── phase-3-weeks-09-12.md
│           ├── cycle.md
│           ├── source-audit.md
│           └── program-spec.v0.1.yaml
│
├── src/                         # Phase 0 后续建立
│   ├── plugin/
│   ├── ingress/
│   ├── engines/
│   ├── llm/
│   ├── storage/
│   └── policy/
│
└── tests/
    ├── program/
    ├── extraction/
    ├── supervision/
    └── information-flow/
```

## 3. `docs/`：项目事实与决策

`docs/` 回答的是“这个项目为什么这样做”。

### requirements.md

最高优先级产品约束。实现出现歧义时优先回到此文件，而不是从代码反推需求。

### architecture.md

描述 OpenClaw Plugin、数据流、隔离模型调用、Policy Gate 等系统结构。

### program-spec.md

定义训练计划如何从自然语言知识转换成可执行规格，以及 unresolved 等状态的语义。

### known-gaps.md

项目级已知来源缺口、发布阻塞和待确认事项集中登记。禁止把未知内容埋在代码 TODO 中。

### roadmap.md

只描述阶段与验收条件，不作为需求来源。

## 4. `knowledge/`：可迁移领域知识

训练知识与 Plugin 代码分离。

首个 program package：

```text
knowledge/programs/zhuoshu-12-week/
```

每个 program package 至少应包含：

- 人类可读说明；
- 训练规则；
- 逐阶段/逐周计划；
- 周期循环说明；
- 源资料审计；
- 机器可读 ProgramSpec；
- 来源与已知缺口说明。

未来可以新增其他 program，而无需修改监督系统核心架构。

## 5. Markdown 与 ProgramSpec 的职责边界

### Markdown

适合：

- 人工阅读；
- 来源核对；
- 解释原计划；
- 审查资料缺口。

### ProgramSpec

适合：

- Program Engine；
- fixture tests；
- 当前训练日解析；
- 与实际日志做确定性比较。

ProgramSpec 不应包含用户实际重量、体重或个人日志。

## 6. Runtime Data 不进入 Knowledge

以下数据属于 Plugin-managed storage：

- 用户体重；
- 训练日志；
- 训练表原图；
- 饮食照片与估算；
- 用户 subjective claims；
- derived metrics；
- diagnosis / audit / decision records。

不能把运行时用户数据写回 `knowledge/` 目录作为事实来源。

## 7. 文档优先级

出现冲突时：

```text
可靠原始资料
  > docs/requirements.md
  > canonical ProgramSpec
  > knowledge Markdown
  > implementation comments
```

其中 ProgramSpec 与 Markdown 如果出现不一致，应视为缺陷并人工核对来源，而不是默认某一份自动覆盖另一份。

## 8. 文档变更规则

会改变用户训练处方或监督行为的修改必须同时检查：

- requirements；
- knowledge Markdown；
- ProgramSpec；
- tests；
- changelog（发布后）。

任何来源不确定内容必须进入 `known-gaps.md`；program 自身的来源完整性问题还应同步记录到对应的 `source-audit.md`。
