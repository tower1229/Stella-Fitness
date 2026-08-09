# Data Lifecycle Requirements

**状态：Phase 0 privacy requirement**

Stella Fitness 处理训练日志图片、饮食照片、体重、用户主观描述、结构化 observations、派生 metrics 与模型分析记录。数据生命周期必须在实施前定义，不能默认“所有东西永久保存”。

## 0. Storage boundary

### Rights and control model

整个产品只使用三类内容权利模型：

1. Built-in Program 内容：发布方负责取得授权；
2. User Input Data：用户输入的原件与事实，由用户控制，Plugin 不取得二次使用权；
3. User Derived Data：关于用户的 observations、分析、进度、决策和 provenance，由用户控制，Plugin 不取得二次使用权。

“用户控制”不是对输入内容底层版权的保证。用户上传第三方材料时仍需自行遵守原始权利；Plugin 不把处理行为解释为授权。

### Technical storage boundary

所有持久文件再按技术用途分流：

- `Runtime Directory`：Plugin 自行扩展，只保存可重建运行状态、锁、缓存、任务状态和可重建索引；
- `Personal Data Directory`：用户显式配置，保存所有关于用户的个人数据，包括上传原件和结构化产出。

用户未配置 Personal Data Directory 时，Plugin 不得静默把个人数据写入 Runtime Directory。Personal Data Directory 应适合由用户自己的 Personal Data Repository 管理、备份和版本化，但 v1 不强制绑定具体仓库工具。

## 1. Data classes

### A. Raw artifacts

- 训练日志原图；
- 饮食照片；
- 未来其他原始附件。

这些原件属于个人数据，进入 Personal Data Directory，而不是 Runtime Directory。

价值：纠错、重新抽取、审计。

风险：隐私最高、体积最大、可能包含无关环境信息。

### B. Verified observations

- 日期；
- exercise / load / reps；
- body weight；
- 用户确认的 meal / nutrition values；
- source/provenance。

这是长期监督的主要事实层。

每条 Observation Record 至少包含稳定 ID、发生时间、schema version 与 provenance。原始文件通过相对路径和 hash 关联；纠错显式指向被修正记录。

### C. Subjective claims

例如：

- “今天很累”；
- “我感觉吃少了”；
- “胸口不舒服”。

必须和客观 observation 分层，且可被用户查看/删除。

### D. Derived metrics

- weight trend；
- adherence；
- training trend；
- evidence coverage。

应能根据修正后的 facts 重新计算。

当前 `Training Progress`、趋势、完成率及便于阅读的 snapshot 都属于可重建派生视图，不得成为覆盖 Observation Records 的第二事实源。

### E. Model run records

- role；
- model/provider id；
- EvidencePacket reference / hash；
- structured diagnosis / audit / decision；
- ProgramSpec / Policy version；
- operation / payload category / runtime-reported execution metadata；
- timestamps；
- errors。

失败调用只保存角色、时间和错误类别。不得为了可审计性而默认复制完整敏感 prompt、Provider 原始自由文本 response、隐藏推理、schema-invalid 原始输出或 Provider 日志副本到长期记录。显式诊断模式产生的原始交互进入受控临时位置，而不是默认个人历史。

所有 B–E 类关于用户的持久数据同样进入 Personal Data Directory。Runtime Directory 中的派生缓存或索引不得成为第二个 canonical fact store。

## 2. Default retention principle

默认：

> **Personal Data Directory 长期保留原始上传文件及结构化个人产出，由用户控制删除。**

Plugin 不对用户目录执行静默的按时限自动删除。v1 不提供 Plugin 删除或 retention-policy 功能；用户通过文件系统或 Personal Data Repository 工具删除内容。Runtime Directory 中的临时副本在处理完成后清理。

### Why

原图与结构化产出共同构成用户控制的个人记录，可用于纠错、重新抽取和审计。隐私风险通过用户选择保存位置，以及使用自己的文件系统或 Personal Data Repository 工具管理，而不是由 Plugin 静默删改用户仓库。

## 3. Raw artifact states

原始文件在结构化记录中至少具有以下引用状态：

```text
AVAILABLE
source_missing
```

Plugin 不自动调度用户目录中的删除。用户移除原件后，仍存在的 Observation 保留结构化事实并标记 `source_missing`；Plugin 不得从 Runtime Directory 恢复原件。

## 4. Retention policy

默认是用户目录持久保留，不自动删除。需要定时清理、版本历史或安全擦除时，用户使用自己的文件系统或 Personal Data Repository 工具；Plugin 不声称管理备份、Git 历史、远端副本或 Provider 已接收的数据。

## 5. User controls

v1 通过开放文件格式和目录契约提供：

- 查看已保存 structured data；
- 查看某条 fact 的来源；
- 用普通文件操作复制、移动或删除原件与结构化记录；
- 通过核心 extraction 纠错流程修正 observation；
- 对手工修改的结构化文件执行 schema 校验；
- 在文件缺失后重建 Training Progress 和 runtime index；
- 查看 Plugin 曾把哪些 payload category 提交给 OpenClaw runtime，以及 runtime 返回的可用执行元数据。

这些是存储契约，不要求 Plugin 提供通用数据管理 UI、删除命令、导出命令、备份或回收站。

## 6. Correction semantics

用户纠错后：

```text
raw extraction
   ↓
user correction
   ↓
verified observation
   ↓
recompute derived metrics
```

历史错误不能继续污染新趋势。

审计只需保留“发生过修正”的必要 provenance，不需要把错误数据继续当活跃事实。

## 7. Filesystem deletion semantics

- 只删除 raw artifact：对应 Observation 可继续存在，但其 provenance 标记 `source_missing`；
- 删除 Observation 文件：该记录不再是 active fact，依赖它的 Training Progress、Analysis Records 和 runtime index 在下次扫描时重建或失效；
- 删除全部 Personal Data Directory：Plugin fail closed，不回退到 Runtime Directory，也不从缓存恢复；
- schema-invalid 手工修改：报告具体文件和校验错误，从 active computation 排除，不静默修复或覆盖；
- Provider、Git、备份或远端副本：不属于 Plugin 的删除能力，必须在文档中明确。

## 8. Portability instead of an export feature

Personal Data Directory 本身就是 v1 的完整导出制品。复制该目录必须带走 profile、program cycles、observations、原件、corrections/provenance 与 Analysis Records，且不依赖特定模型/provider 或 Runtime Directory 才能解释。v1 不另做 export command。

## 9. Processing provenance

Plugin 需要能回答：

> “这张训练表/这份结构化数据是否被 Plugin 提交给 OpenClaw runtime 做过处理？”

至少保存：

```text
operation
run timestamp
payload category
raw image submitted to OpenClaw runtime? yes/no
runtime-reported provider/model (if available)
```

Plugin 不复制完整 prompt/token，也不推断 OpenClaw 没有返回的网络层信息。Provider 选择、endpoint、fallback 和实际外发审计属于 OpenClaw。

## 10. Benchmark data lifecycle

研发 benchmark 与用户运行时数据分开。

真实日志进入 benchmark 前需要：

- 明确授权；
- 去身份；
- 独立 dataset ID/version；
- 明确是否允许公开；
- 允许撤回时定义撤回影响。

不得因为用户上传过训练日志，就自动获得把图片放入公开 benchmark 的许可。

Benchmark 是 User Input Data/User Derived Data 的独立二次用途，不是新的所有权类别。Plugin 不提供遥测、自动贡献数据或 Benchmark 上传能力；任何研发副本都通过 Plugin 之外的独立人工授权流程取得。

## 11. Security-oriented minimization

以下信息默认不需要进入训练监督数据库：

- GPS；
- 联系人；
- 相册其他图片；
- EXIF 中与任务无关的位置元数据；
- 完整 OpenClaw 对话历史；
- 其他 Agent 的私人记忆。

Personal Data Directory 中按原字节保存的 raw artifact 是上述规则的存储例外：文件自身可能带有 EXIF/GPS，但 Plugin 不解析为个人事实，也不直接提交该原件。模型处理只使用已校正方向并移除 metadata 的 `Sanitized Media Copy`；该副本位于 Runtime Directory，处理后清理。

## 12. Remaining implementation/review artifacts

- processing provenance 的落盘形式及 OpenClaw metadata 可用边界；
- 独立 benchmark authorization template；
- public privacy notice 最终措辞。

这些是实施或 review artifact，不再是数据所有权的产品歧义。
