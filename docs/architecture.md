# Stella Fitness 技术架构

> 本文描述记录型 v1 的目标架构。OpenClaw 接口以本机 stable 基线实机核验，并通过最低版本声明与能力预检保持向后续 stable 版本兼容，不使用精确版本白名单。

## 1. 总体结构

```text
OpenClaw channel / dedicated Agent
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
- 写入用户显式配置的 Personal Data Directory；
- 运行确定性 Program Engine；
- 返回 synthetic status、confirmation 和 recording reply。

这些是 Plugin 集成与数据边界需求，不是训练诊断或风险控制需求。Skill 可以辅助说明，但不能替代持久化和媒体处理边界。

## 3. 输入路由

对于 Stella Fitness 明确认领的记录型输入：

```text
inbound message
  → before_agent_reply
  → Plugin claims recording workflow
  → extract / confirm / persist / rebuild
  → synthetic reply
```

`before_agent_run` 作为路由保险，防止已认领输入重复进入普通 Agent。Plugin 不接管普通健身聊天，也不把普通聊天内容保存为训练事实。

non-bundled Plugin 所需 conversation-access 权限必须由 operator 显式启用，不得绕过。

## 4. 媒体处理

原始上传先按字节写入 Personal Data Directory。模型调用使用 Runtime Directory 中的 `Sanitized Media Copy`：

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

- 空白 actual 保持空白；
- 关键数字低置信时必须确认；
- `重量` 不强制为 number；
- 第 4 周力量测试使用独立 schema；
- recovery session 不因普通布局标题丢失计划身份；
- 备注按原始用户记录保存，不作表现、心理或健康解释。

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
