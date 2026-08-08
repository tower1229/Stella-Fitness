# Data Lifecycle Requirements

**状态：Phase 0 privacy requirement**

Stella Fitness 处理训练日志图片、饮食照片、体重、用户主观描述、结构化 observations、派生 metrics 与模型分析记录。数据生命周期必须在实施前定义，不能默认“所有东西永久保存”。

## 1. Data classes

### A. Raw artifacts

- 训练日志原图；
- 饮食照片；
- 未来其他原始附件。

价值：纠错、重新抽取、审计。

风险：隐私最高、体积最大、可能包含无关环境信息。

### B. Verified observations

- 日期；
- exercise / load / reps；
- body weight；
- 用户确认的 meal / nutrition values；
- source/provenance。

这是长期监督的主要事实层。

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

### E. Model run records

- role；
- model/provider id；
- input hash / evidence reference；
- structured output；
- timestamps；
- errors。

不应为了可审计性而默认复制完整敏感 prompt 到无限期日志。

## 2. Default retention principle

推荐默认：

> **长期保留已验证的结构化事实；原始图片只保留到验证完成后的有限、可配置窗口。**

Phase 0 暂不冻结具体天数，但明确反对默认永久保存全部 raw artifacts。

### Why

结构化事实足以支持大多数长期趋势；原图主要用于短期纠错、再抽取与争议审计。

## 3. Raw artifact states

未来至少支持：

```text
RECEIVED
EXTRACTED
NEEDS_CONFIRMATION
VERIFIED
SCHEDULED_FOR_DELETION
DELETED
PINNED_BY_USER
```

如果一个字段尚未确认，关联原图不能在纠错完成前自动删除。

## 4. Retention profiles

实施期可以实现配置：

### Minimal

验证后尽快删除原图，只保留结构化事实。

### Standard

验证后保留一个有限回溯期，再自动删除。

### Archive

用户显式选择长期保留原图。

默认 profile 应在 Phase 0 Exit Review 中确定。

## 5. User controls

用户至少需要：

- 查看已保存 structured data；
- 查看某条 fact 的来源；
- 删除单张原图；
- 删除单条 observation；
- 修改错误 observation；
- 导出所有结构化数据；
- 删除所有 Stella Fitness 数据；
- 查看哪些数据曾发送到哪些外部 provider。

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

## 7. Deletion semantics

“删除”不能只隐藏 UI。

未来产品必须明确：

- local DB record 删除；
- raw file 删除；
- derived metric 重算/删除；
- local cache 删除；
- provider 已发送数据无法由本地系统追溯删除时，需要在隐私说明中明确其 provider policy。

## 8. Export

导出格式应机器可读、与具体模型/provider 无关。

最低要求：

```text
profile metadata
program cycles
training observations
body weights
diet observations
subjective claims
corrections/provenance
decisions (optional but recommended)
```

原图应作为可选独立 archive，不与结构化 JSON/CSV 强绑定。

## 9. Provider disclosure ledger

由于 Stella Fitness 可能使用多个模型供应商，未来需要能回答：

> “这张训练表/这份 EvidencePacket 发给过谁？”

至少保存：

```text
provider
model
role
run timestamp
payload category
raw image sent? yes/no
retention/privacy profile reference
```

不需要把外部模型看到的所有 token 永久复制一份，但必须能审计数据流。

## 10. Benchmark data lifecycle

研发 benchmark 与用户运行时数据分开。

真实日志进入 benchmark 前需要：

- 明确授权；
- 去身份；
- 独立 dataset ID/version；
- 明确是否允许公开；
- 允许撤回时定义撤回影响。

不得因为用户上传过训练日志，就自动获得把图片放入公开 benchmark 的许可。

## 11. Security-oriented minimization

以下信息默认不需要进入训练监督数据库：

- GPS；
- 联系人；
- 相册其他图片；
- EXIF 中与任务无关的位置元数据；
- 完整 OpenClaw 对话历史；
- 其他 Agent 的私人记忆。

## 12. Phase 0 open decisions

仍需冻结：

1. Standard profile 的 raw image retention duration；
2. diagnosis/audit structured output 的默认保留期；
3. 是否允许完全关闭 raw artifact storage；
4. provider disclosure ledger 的用户 UI/导出形式；
5. benchmark consent template。

这些进入 `known-gaps.md`，但数据生命周期的核心原则已经可以进入实施约束。
