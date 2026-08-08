# 开发指南

> 当前阶段：Foundation / pre-implementation。核心架构已经冻结，业务诊断逻辑尚未实现。

## 1. 环境要求

- Node.js `>=22.22.3`
- npm
- OpenClaw `>=2026.7.1`

项目使用 TypeScript ESM，并以编译后的 `dist/index.js` 作为 OpenClaw Plugin 入口。

## 2. 安装依赖

```bash
npm install
```

## 3. 检查与构建

```bash
npm run check
npm run build
npm test
npm run pack:check
```

其中：

- `check`：TypeScript 类型检查；
- `build`：编译 `src/` 到 `dist/`；
- `test`：运行 Node test runner；
- `pack:check`：查看最终 npm 包实际包含的文件。

## 4. 当前测试不变量

当前最重要的两个程序级不变量：

1. **Information Flow**：`EvidencePacket` 采用字段白名单，额外传入的 raw message / user belief / desired action 不得进入序列化结果；
2. **Source Fidelity**：Program Engine 遇到 `unresolved` session 必须 fail closed。

后续任何实现如果破坏这两条，都属于架构级回归。

## 5. Plugin 入口

```text
src/index.ts
```

当前注册：

- `before_agent_reply`
- `before_agent_run`

Phase 0 中两个 hook 故意保持 pass-through。只有当 ingress routing、受控 supervision pipeline 与回归测试完成后，才允许真正 claim Stella Fitness 领域 turn。

## 6. 开发边界

### 不要在普通 Agent 上实现“伪盲诊”

禁止：

```text
Agent 已看完整聊天历史
→ Prompt 告诉它“忽略用户观点”
→ 叫做 Blind Diagnosis
```

Blind Diagnostician 的真正边界必须由 Plugin 构造最小 `EvidencePacket`，并通过 isolated model runtime 调用。

### 不要把用户数据写回 knowledge

`knowledge/` 是静态领域资料；用户训练、体重、饮食、诊断记录属于 Plugin-managed runtime storage。

### 不要自行补齐 ProgramSpec

源资料缺失就是 `unresolved`。尤其是第 4 周周五，不允许根据周内规律补齐。

### 不要自行发明健康阈值

Phase 0 不写任意：

- 体重“合理范围”；
- 停滞天数；
- 应增加多少热量；
- 疼痛分级；
- 自动减量百分比。

这些必须经过可靠依据、专业审核与 Golden Cases 后进入版本化 policy。

## 7. 存储

首版采用 Node 内置 `node:sqlite`，避免 OpenClaw 托管插件安装使用 `--ignore-scripts` 时依赖原生 npm postinstall。

当前 Schema 已覆盖：

```text
profiles
program_cycles
raw_artifacts
training_sessions
exercise_observations
body_weights
diet_observations
subjective_claims
derived_metrics
diagnosis_runs
audit_runs
decisions
```

诊断链需要保留：

- evidence hash；
- model ref；
- structured output；
- policy version；
- success / failure。

## 8. 模型开发

角色和当前候选见 [model-strategy.md](./model-strategy.md)。

模型实现必须遵循接口边界：

```text
BlindDiagnostician(EvidencePacket)
BeliefExtractor(userText)
AdversarialAuditor(Evidence + FrozenDiagnosis + UserBelief)
Reporter(FinalDecisionPacket)
```

不能为了方便把四个角色重新合并成一个共享对话上下文。

## 9. 推荐实现顺序

1. ProgramSpec parser / validator；
2. Program Engine fixture tests；
3. SQLite migrations / repositories；
4. body-weight text ingestion；
5. training-log image structured extraction；
6. extraction eval dataset；
7. Metrics Engine；
8. Evidence Builder；
9. isolated Blind Diagnosis；
10. Belief Extraction；
11. Adversarial Audit；
12. Policy Gate；
13. hooks 正式接管领域 turn；
14. Cron 周期监督；
15. ClawHub release validation。

## 10. 提交前检查

至少运行：

```bash
npm run check && npm run build && npm test && npm run pack:check
```

如果修改 ProgramSpec / knowledge，还需要人工检查：

- 原始资料；
- Markdown；
- ProgramSpec；
- fixtures；
- known gaps。

四者必须保持可追溯一致。
