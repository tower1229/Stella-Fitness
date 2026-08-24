# Stella Fitness 技术架构

> 本文描述记录型 v1 的目标架构。OpenClaw 接口以本机 stable 基线实机核验，并通过最低版本声明与能力预检保持向后续 stable 版本兼容，不使用精确版本白名单。

## 1. 总体结构

```text
OpenClaw WebChat / channel
              │
      route to configured dedicated Agent
              │
              ▼
       Stella Fitness Plugin
              │
      ┌───────┴────────┐
      │ Ingress Router │
      └───────┬────────┘
              │
      ┌───────▼────────┐
      │ Media Sanitizer│ raw preserved; payload metadata removed
      └───────┬────────┘
              │
      ┌───────▼────────┐
      │ Extraction     │ image / text → typed candidate fields
      └───────┬────────┘
              │
      ┌───────▼────────┐
      │ Confirmation   │ critical ambiguity → minimal question
      └───────┬────────┘
              │
      ┌───────▼────────┐
      │ Personal Data  │ Raw Artifact / Observation / Processing
      └───────┬────────┘
              │
      Program Engine + deterministic rebuild
              │
              ▼
      Training Record View
```

核心原则：**模型只抽取候选事实；确定性代码验证、确认、保存和重建。**

## 2. 为什么使用 Native Plugin

本项目需要：

- 在默认 Agent 回复前接管训练记录输入；
- 调用 structured media extraction；
- 精确控制媒体 payload 和临时文件生命周期；
- 通过 Runtime-owned locator 写入固定 `<repository>/stella/fitness` Personal Data Directory；
- 运行确定性 Program Engine；
- 返回 synthetic status、confirmation 和 recording reply。

Runtime projection 是独立的派生能力：projection 目录缺失或合同不兼容只会使个人上下文 degraded，不得阻断上述确定性训练记录核心。当前仓库仅提供 locator 与文件系统消费 seam；在 Runtime #38 发布 schemas、declarations、checksum vectors 和 fixtures，且 #33 producer 可消费前，不声称正式 Context Projection 合同验收通过。

这些是 Plugin 集成与数据边界需求，不是训练诊断或风险控制需求。Skill 可以辅助说明，但不能替代持久化和媒体处理边界。

## 3. 输入路由

Stella Fitness 只处理 Host `agentId`、session key 或顶层 Channel routing binding 归属于 manifest 配置 `dedicatedAgentId` 的输入。WebChat 选择该 agent 后可直接使用；Telegram 等 Channel 必须通过 OpenClaw 顶层 routing binding 路由到该 agent。Plugin 不再创建或要求 conversation binding。

对于 dedicated agent 中 Stella Fitness 明确认领的记录型输入：

```text
inbound message
  → routed text: before_agent_reply / before_agent_run
  → routed media: message_received → reply_dispatch
  → Plugin claims recording workflow
  → extract / confirm / persist / rebuild
  → synthetic reply
```

`before_agent_run` 是文本路由保险；`message_received` 在 agent routing 后按 session 与 message/run identity 暂存全部受支持的 Host 图片 metadata，`reply_dispatch` 一次消费一个暂存项，使未使用 Plugin conversation binding、且没有 caption 的图片仍能进入同一 Runtime 入口。ACTIVE Program 中，普通图片经分类后返回 `ignored`，继续原通用回复且不保存 Stella 数据；暂存项在消费、Plugin stop 或 shutdown 时移除。

训练日志进入字段确认后，Plugin 在自管的 Runtime Directory 原子文件存储中保存当前 dedicated-agent session 到 active confirmation 的可重建关联。当前 OpenClaw 仅向 trusted bundled plugin 开放 `runtime.state.openKeyedStore`，因此可安装的第三方 Plugin 不能依赖该接口。`inbound_claim` 先把自然语言确认交给 Confirmation Coordinator：明确常见表达由确定性 parser 处理，其余只提交当前文本、权威目标摘要和有限字段标签给 `runtime.llm.complete` 做受约束意图分类。分类结果本身没有写权限；Coordinator 只能接受原 candidate 的候选值或用户明确提供的字段覆盖，字段完整后仍由 Runtime 原子验证并保存。部分接受、session 关联和分类草稿不属于 canonical 用户事实；删除 Runtime Directory 不会恢复或改变 Personal Data Directory。

普通确认回复使用字段名称和自然语言，不暴露 confirmation ID 或 JSON。精确 `/stella-confirm` 继续作为兼容和故障恢复入口。当前 session 存在待确认状态时，“确认”“全部确认”和“确认全部”由 Coordinator 确定性解释为接受当前提示中的已有候选；`unknown` 必须继续追问，除非用户明确确认原表未填写。明确字段值仍由确定性 parser 处理，只有修改说明、取消或混合表达等复杂输入才交给 `runtime.llm.complete` 做受约束分类。分类缺少 agent、超时、Provider 失败、非法输出或低置信时均 fail closed，Plugin 只记录不含用户原文和候选值的原因码。确认、取消或失效后清除 session 关联，wrong agent、wrong session 和冲突同样 fail closed。

non-bundled Plugin 所需 conversation-access 权限必须由 operator 显式启用，不得绕过。`dedicatedAgentId` 缺失、session key 缺失或 agent 不匹配时，所有写入口 fail closed；旧 Plugin conversation binding 记录不参与授权判断。

## 4. 媒体处理

显式训练日志入口保留“原始上传先按字节写入 Personal Data Directory”的审计语义。ACTIVE Program 的自动图片入口先只在 Runtime Directory 生成 `Sanitized Media Copy` 并分类；仅当输出是 schema-valid 的权威目标 candidate 或确认请求时，才保存原始上传、Processing Record 和后续 Observation。普通图片、目标缺失和 provider 失败不会长期保存。模型调用统一使用 `Sanitized Media Copy`：

1. 应用 EXIF orientation 到像素；
2. 移除 EXIF、GPS、设备、软件、缩略图等非必要 metadata；
3. 只提交完成当前抽取所需的图片与最小文字上下文；
4. 在成功、失败、超时和取消路径清理副本。

所有调用必须有显式 timeout、`AbortController` 和幂等 run ID。

## 5. 训练日志抽取

抽取输出是候选事实，不是评价：

```text
layout / stage / week / weekday / session type
exercises[]
  normalized exercise id?
  raw label
  load semantic + value?
  set values + reps|duration semantic
action quality raw value?
note raw text?
uncertain_fields[]
```

规则：

- 自动模式使用 `agents.defaults.userTimezone` 将上传时间换算为本地日期，从当前 Program 周期开始按计划顺序选择截至该日最早、尚未记录的 Planned Session；它读取 Personal Data Directory 中的 canonical Observation 来跳过已记录槽位，不跨周期且不选择未来日；
- 自动模式先解析确定性目标再处理图片去重；同一张工作簿照片可按进度依次抽取不同 session，不能因文件 SHA 相同而返回其他训练槽位的 Observation；显式录入和纠错仍保留原有幂等语义；
- 模型同时完成固定工作簿分类与目标区块抽取；只读权威标题至下一标题之间的区块，忽略照片中的其他 session；
- candidate 的阶段、周次、星期、session 类型和动作集合必须与权威目标完全一致，否则不保存、不计入完成度；
- 空白 actual 保持空白；
- 关键数字低置信时必须确认；
- `重量` 不强制为 number；
- 第 4 周力量测试使用独立 schema；
- recovery session 不因普通布局标题丢失计划身份；
- 备注按原始用户记录保存，不作表现、心理或健康解释。

Observation 仍是唯一训练事实。“本周已记录 X/Y 次”和下一 Planned Session 每次都从 Training Record View 与 ProgramSpec 派生，不保存独立进度游标。Training Record View 按 Program Context 与训练槽位组成的逻辑身份去重，不按图片 SHA 合并不同槽位；同一张工作簿照片可以形成多个不同 Planned Session 的 Observation。

## 6. 体重输入

明确的体重文本可通过确定性 parser 转换为 Observation。歧义单位或时间必须确认。系统只展示事实时间序列，不计算“是否健康”“是否理想”或调整建议。

## 7. Deterministic Core

### Program Validator

在任何 ProgramSpec 驱动用户视图前验证 schema、引用、符号绑定和 session 完整性。无效或 unresolved 关系 fail closed。

### Program Engine

输入 ProgramSpec、Program State 和目标日期，输出 Planned Session。它只解释来源计划，不评价计划。

### Record Rebuilder

从 Observation Records、纠错关系与 Program State 重建：

- 当前周期与 planned session；
- 每个训练日记录了哪些 actual；
- missing / uncertain / corrected 字段；
- strength-test result 到符号重量的确定性绑定；
- 去重后的事实时间线。

不得派生训练表现评分、趋势诊断、原因假设或健康风险。

## 8. 持久化边界

### Personal Data Directory

canonical：

```text
raw artifacts
observation records
correction records
program state
processing records
rebuildable record snapshots
```

### Runtime Directory

仅保存：

```text
locks / cursors / temporary sanitized media / rebuildable indexes / task state
```

Runtime Directory 不得成为个人数据 fallback，也不得恢复用户已删除的 canonical 文件。

### Body-weight Observation 文件

体重事实逐条保存在 `observations/body-weight/<observation-id>.json`。文件名必须与记录内的 UUID `id` 一致；schema version 是 `stella-fitness/observation/body-weight/v0.1`。记录包含原始 `value`/`unit`、RFC 3339 `occurredAt`、用户文字 `source` 和写入 `provenance`。相同 `source.messageId`（同 channel）或 OpenClaw `source.runId` 的重试返回已有记录；同一 source identity 不得指向不同事实。

纠错也创建新的同版本 Observation；`provenance.kind` 为 `body-weight-correction`，并由 `replacesObservationId` 指向被替代记录。旧文件不覆盖。重建时，缺失引用、循环引用、非法 UUID、非 canonical 时间、非正数值或字段类型错误都会作为相对文件路径错误报告，并从事实时间序列排除。

## 9. Provider 与模型权限

OpenClaw 管理 Provider、凭据、endpoint、模型 allowlist 和实际外发。Plugin 只引用 operator 已授权的 extraction model，并记录 runtime 实际返回的可用执行元数据。

v1 不需要 Blind Diagnostician、Belief Extractor、Auditor、Reporter 或多模型监督角色。

## 10. 失败语义

| 失败 | 行为 |
|---|---|
| Personal Data Directory 无效 | 拒绝接收个人输入 |
| ProgramSpec 无效或 unresolved | 不解析对应 session |
| 图片不可读 | 请求重新拍摄或最小补充 |
| 关键字段低置信 | 请求字段确认，不写成确定事实 |
| 模型失败/超时 | 清理临时文件，记录失败类别，不写 Observation |
| 重复上传 | 返回已有记录引用，不重复计入 |
| schema-invalid 手工编辑 | 隔离并报告，不污染重建结果 |
| 原始文件被用户删除 | 尊重删除并重建，不从 runtime 恢复 |

## 11. 测试边界

最高价值 seam 是 scenario-level Plugin harness：给定 ProgramSpec、隔离的 Personal/Runtime 目录、输入 artifact 和受控 extraction result，观察确认请求、canonical records、重建视图和精确 payload。

必须覆盖：

- clean install / enable / load / deterministic status；
- ProgramSpec 全 12 周、阶段转换、recovery 和 strength-test bindings；
- 固定 XLSX 三阶段布局、裁剪/模糊、空白保留、load 多态、reps/duration；
- correction、dedupe、restart、external deletion 和 invalid edit；
- 原件字节保真、orientation、metadata strip 和全部退出路径清理；
- payload 最小化与 operator model permission；
- 发行包排除原始 DOCX、任意非白名单 Office 文件、用户数据和未授权内容；唯一允许的原始 Office 制品是固定路径与 digest 的内置训练日志 XLSX。

不建立 diagnosis、nutrition、safety、framing invariance、Policy Gate 或 periodic supervision 测试分支。

## 12. 目标代码结构

```text
src/
├── plugin.ts
├── config/
├── domain/
│   ├── program.ts
│   ├── observation.ts
│   ├── correction.ts
│   └── processing.ts
├── program/
│   ├── validator.ts
│   ├── engine.ts
│   └── state.ts
├── extraction/
│   ├── workout-log.ts
│   └── body-weight.ts
├── media/
│   └── sanitizer.ts
├── storage/
│   ├── personal-data.ts
│   ├── runtime-state.ts
│   └── rebuild.ts
└── reporting/
    └── recording-reply.ts
```
