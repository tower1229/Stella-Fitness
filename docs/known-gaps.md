# 已知资料缺口与待确认项

本文集中记录 Stella Fitness 在进入实现和发布阶段前仍未解决的问题。

任何列为 `BLOCKING` 或 `RELEASE-BLOCKING` 的条目都不能由 LLM、Program Engine 或开发者根据上下文自行猜测后当作正式事实。

## GAP-001：第 4 周周五训练内容缺失

**状态：** `OPEN / BLOCKING`

原始教程在第一阶段第 4 周中提供：

- 周一：主项 `A+2`，6×10；
- 周三：主项 `A+2`，5×12；
- 周五：明确写为“资料缺失，待补充”。

### 当前处理

ProgramSpec：

```yaml
- day: friday
  type: full-body
  status: unresolved
  reason: source_missing
  exercises: null
```

### 禁止行为

- 根据前 3 周规律自动推断周五训练；
- 让模型生成一个“最合理”的周五计划；
- 在 README 中宣称当前 canonical program 100% 可自动执行；
- 在用户实际进入第 4 周周五时悄悄采用推测值。

### 关闭条件

获得可追溯的可靠原始资料，并完成：

1. Markdown 修订；
2. ProgramSpec 修订；
3. fixture 更新；
4. changelog 记录。

---

## GAP-002：原始教程的版权 / 再发布许可

**状态：** `OPEN / RELEASE-BLOCKING`

当前提供的教程可作为本项目结构化与实现设计的来源，但在把原文、完整 Markdown 转写、原始 DOCX 或等价的可还原内容随 GitHub / ClawHub 正式公开发布前，需要确认版权归属及再发布许可。

### 当前处理

- `knowledge/` 用于开发阶段的来源审计；
- `package.json#files` **当前故意不包含 `knowledge/`**，避免 npm / ClawHub artifact 自动携带教程内容；
- 原始 DOCX 当前也不进入 release artifact；
- 若最终无法公开再发布，可切换为用户本地导入 program package，或仅分发获得许可的规则数据。

> 此条是发布治理要求，不对教程内容本身作版权结论。

---

## GAP-003：营养目标的适用范围

**状态：** `OPEN / NON-BLOCKING FOR PROGRAM ENGINE`

原教程明确给出了 65 kg 与 70 kg 男生的饮食示例，并提出不同体重按比例调整主食和瘦肉量，但没有给出完整、严格定义的连续计算公式。

### 当前处理

- 保留 65 kg / 70 kg 原始目标；
- 不把“按比例调整”擅自固化成唯一确定算法；
- v0.1 饮食监督把教程目标当 reference，而不是未经验证的医学/营养处方引擎。

---

## GAP-004：项目代码许可证尚未选择

**状态：** `OPEN / RELEASE-BLOCKING`

仓库目前是 public，但项目作者尚未明确选择软件许可证。

### 当前处理

- `package.json` 使用 `"license": "UNLICENSED"`，避免在未确认前错误授予许可；
- 不自动创建 MIT / Apache / GPL 等许可证文件；
- 正式公开发行和 ClawHub 首次发布前由项目作者确定软件许可证。

### 关闭条件

- 选定项目代码许可证；
- 新增对应 `LICENSE`；
- 同步 `package.json`；
- 明确该软件许可证与教程内容许可是两个独立问题。

---

## GAP-005：ClawHub owner / package scope 尚未最终验证

**状态：** `OPEN / RELEASE-BLOCKING`

当前开发包名暂定：

```text
@tower1229/stella-fitness
```

ClawHub 当前要求 scoped package 的 scope 与实际 publish owner 匹配。GitHub owner 为 `tower1229`，但尚未执行 ClawHub owner/namespace 首次发布验证。

### 当前处理

- 将 `@tower1229/stella-fitness` 作为**开发期 provisional package name**；
- 首次 publish 前验证 / 认领对应 ClawHub owner；
- 如果实际 owner 不同，在第一版公开发行前统一重命名，避免发布后迁移包名。

---

## GAP-006：干预阈值与安全策略尚未专业审定

**状态：** `OPEN / BLOCKING FOR PRODUCTION SUPERVISION`

当前已经冻结系统架构，但以下规则仍没有足够依据进入 production policy：

- 体重趋势需要多长窗口才算停滞；
- 训练完成度 / 负荷趋势达到什么条件才触发调整；
- 饮食覆盖度达到什么程度才允许高置信归因；
- 哪些疼痛、损伤、疾病或异常症状必须 `ESCALATE`；
- 训练 / 饮食调整的具体幅度边界。

### 当前处理

- `Metrics Engine` 只定义接口，不写任意阈值；
- `Policy Gate` 只定义决策边界，不实现未经审核的规则；
- 身体数据 ingestion 不写任意“正常范围”；
- 后续通过可靠指南、专业审定与 Golden Cases 共同冻结 policy version。

---

## 维护规则

新增缺口统一使用：

```text
GAP-XXX
status
source evidence
effect
current handling
closure criteria
```

让“未知”成为系统的一等状态，而不是被模型或开发默认值自动抹平。
