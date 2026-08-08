# 文档系统与项目结构

## 1. 当前阶段原则

当前仓库处于 **Phase 0：Requirements & Research**。

本阶段的仓库结构应反映“我们知道什么、还不知道什么、未来准备怎样实现”，而不是提前生成实现空壳。

因此当前分支**不应存在**：

- `src/`
- `tests/`
- `.github/workflows/`
- `package.json`
- `openclaw.plugin.json`
- `tsconfig.json`
- 构建产物或发布配置

它们属于 Phase 1 之后的实施工作。

## 2. Phase 0 当前结构

```text
.
├── README.md
├── docs/
│   ├── README.md
│   ├── requirements.md
│   ├── requirements-traceability.md
│   ├── architecture.md
│   ├── program-spec.md
│   ├── known-gaps.md
│   ├── document-system.md
│   ├── product/
│   │   ├── user-flows.md
│   │   └── decision-policy.md
│   ├── research/
│   │   ├── openclaw-platform.md
│   │   ├── clawhub-publishing.md
│   │   ├── anti-sycophancy.md
│   │   ├── model-strategy.md
│   │   ├── domain-evidence.md
│   │   └── food-image-estimation.md
│   ├── quality/
│   │   ├── evaluation-plan.md
│   │   └── privacy-safety.md
│   ├── planning/
│   │   ├── dependencies.md
│   │   └── implementation-handoff.md
│   └── roadmap.md
├── knowledge/
│   └── programs/
│       └── zhuoshu-12-week/
└── sources/
    ├── README.md
    └── source-register.md
```

## 3. 三类资料必须分离

### 3.1 Requirements / Design

回答：产品必须做什么、不能做什么、为什么这样设计。

位置：`docs/`

### 3.2 Source-faithful Knowledge

回答：源教程究竟写了什么。

位置：`knowledge/`

规则：

- 不静默纠错；
- 不用外部研究覆盖；
- 缺失就是 `unresolved`；
- 所有推断必须与来源事实分开。

### 3.3 External Research

回答：OpenClaw 当前能力、模型能力、运动科学、隐私、安全和发布生态告诉我们什么。

位置：`docs/research/` 与 `sources/`。

外部资料可以影响未来 Policy，但不能悄悄改写原教程。

## 4. 文档状态

建议统一使用以下状态语义：

- `FROZEN`：已达成需求共识，修改需记录理由；
- `RESEARCH_BASELINE`：当前调研结论，实施前应检查时效性；
- `DRAFT_SPEC`：结构设计草案，不代表可执行；
- `OPEN`：仍待确认；
- `BLOCKING`：未解决前禁止进入相关实施/发布步骤。

## 5. 未来实施目标结构（仅蓝图）

当 Phase 0 Exit Review 明确通过后，才考虑建立类似：

```text
src/
├── plugin/
├── ingress/
├── domain/
├── programs/
├── engines/
├── llm/
├── policy/
└── storage/

tests/
├── program/
├── ingestion/
├── information-flow/
├── policy/
└── eval/
```

此结构不是现在的仓库状态，也不是实现承诺；实施时可根据届时 OpenClaw SDK 再调整。

## 6. 变更纪律

1. 新增需求先更新 `requirements.md`；
2. 未解决问题先进入 `known-gaps.md`，不得通过默认值隐藏；
3. 外部事实更新同时更新 `source-register.md`；
4. 训练教程修订必须带来源依据；
5. Phase 0 不接受“顺便实现一点”作为交付；
6. 进入实施阶段需要显式 Phase Transition，而不是因为目录已准备好就自动开始。