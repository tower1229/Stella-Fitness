# Stella Fitness 文档系统

## 1. 目标

仓库文档分成五层，避免产品需求、技术设计、训练知识、来源治理和运行时数据相互混杂。

```text
Product / Architecture Docs
        ↓
Human-readable Knowledge
        ↓
Machine-readable ProgramSpec
        ↓
Source Governance
        ↓
Runtime User Data（仓库外 / Plugin storage）
```

## 2. 当前目录结构

```text
.
├── README.md
├── CHANGELOG.md
├── openclaw.plugin.json
├── package.json
├── tsconfig.json
│
├── docs/
│   ├── requirements.md          # 冻结需求基线
│   ├── architecture.md          # 总体技术架构
│   ├── program-spec.md          # ProgramSpec 规范
│   ├── model-strategy.md        # 模型角色、候选与资格测试
│   ├── installation.md          # 目标安装/配置方式
│   ├── development.md           # 开发约束与本地验证
│   ├── known-gaps.md            # 已知缺口/发布阻塞项
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
├── sources/
│   └── README.md                # 原始资料版权/再发布治理
│
├── src/
│   ├── plugin/
│   ├── ingress/
│   ├── engines/
│   ├── llm/
│   ├── storage/
│   ├── policy/
│   └── domain/
│
└── tests/
    ├── README.md
    ├── program/
    └── information-flow/
```

## 3. `docs/`：项目事实与决策

`docs/` 回答的是“这个项目为什么这样做，以及实现必须满足什么”。

### requirements.md

最高优先级产品约束。实现出现歧义时优先回到此文件，而不是从代码反推需求。

### architecture.md

描述 OpenClaw Plugin、hooks、隔离模型调用、数据流、SQLite、Cron、Policy Gate 和失败策略。

### program-spec.md

定义训练计划如何从自然语言资料转换成可执行规格，以及 `unresolved` 等状态的语义。

### model-strategy.md

定义每个模型角色的职责、当前推荐候选、外部披露边界与替换 Eval。

模型名会变化，因此业务代码不能把本文当前候选当成不可替换语义。

### installation.md

冻结用户最终应该如何安装、授权 conversation hooks、配置模型/provider 和管理数据。

开发期示例配置在真正 OpenClaw load test 后还需再次核对。

### development.md

开发人员的边界与检查顺序。特别用于防止“为了快速实现”把 Blind Diagnosis 重新合并进普通聊天上下文。

### known-gaps.md

所有已知来源缺口、发布阻塞、许可、namespace 和未审定 safety/policy 集中登记。禁止把未知内容埋在代码 TODO 中。

### roadmap.md

描述阶段与验收条件，不作为需求来源。

## 4. `knowledge/`：可迁移领域知识

训练知识与 Plugin 代码分离。

首个 program package：

```text
knowledge/programs/zhuoshu-12-week/
```

每个 program package 至少应包含：

- 人类可读说明；
- 训练规则；
- 逐阶段 / 逐周计划；
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

当前 `program-spec.v0.1.yaml` 是 **draft machine representation**，不是 production canonical program。

## 6. `sources/`：来源治理，而不是资料堆放区

原始资料是否进入公开仓库和 release artifact，取决于明确的版权 / 许可状态。

当前教程许可未知，因此：

- 原始 DOCX 不提交；
- `package.json#files` 不包含 `knowledge/`；
- `sources/README.md` 记录当前处理与未来两种发布策略。

不要因为仓库 public 就默认所有开发参考资料都可以公开再分发。

## 7. Runtime Data 不进入 Git Knowledge

以下数据属于 Plugin-managed storage：

- 用户体重；
- 训练日志；
- 训练表原图；
- 饮食照片与估算；
- 用户 subjective claims；
- derived metrics；
- diagnosis / audit / decision records。

不能把运行时用户数据写回 `knowledge/` 或 Git 历史作为事实来源。

## 8. 文档优先级

出现冲突时：

```text
可靠原始资料
  > docs/requirements.md
  > 审定后的 canonical ProgramSpec
  > knowledge Markdown
  > implementation comments
```

其中 ProgramSpec 与 Markdown 如果出现不一致，应视为缺陷并人工核对来源，而不是默认某一份自动覆盖另一份。

对于 OpenClaw API 行为，以锁定版本的官方文档 / Plugin SDK types 为实现依据；架构文档需要随兼容性变化更新。

## 9. 文档变更规则

会改变用户训练处方或监督行为的修改必须同时检查：

- requirements；
- knowledge Markdown；
- ProgramSpec；
- tests；
- changelog（发布后）。

会改变外部模型可见数据的修改必须同时检查：

- architecture；
- domain types；
- Evidence builder；
- Information Flow tests；
- installation / privacy documentation。

任何来源不确定内容必须进入 `known-gaps.md`；program 自身的来源完整性问题还应同步记录到对应的 `source-audit.md`。
