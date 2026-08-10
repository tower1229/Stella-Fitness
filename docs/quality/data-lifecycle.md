# Data Lifecycle Requirements

**状态：APPROVED BY PRODUCT OWNER 2026-08-10**

## 1. Content classes

1. `Built-in Program Content`：发布方负责取得发行授权；
2. `User Input Data`：原始图片、体重与用户输入，由用户控制；
3. `User Derived Data`：Observation、correction、Program State、Processing Record 和事实视图，由用户控制。

Plugin 不因处理数据取得公开、Benchmark、训练或其他二次使用权。

## 2. Canonical personal data

Personal Data Directory 保存：

```text
raw artifacts
observation records
correction records
program state
processing records
optional rebuildable snapshots
```

每条 Observation 至少包含稳定 ID、发生时间、schema version 与 provenance。Raw Artifact 通过相对路径和 hash 关联。

Runtime Directory 只保存 locks、cursors、temporary sanitized media、task state 和 rebuildable indexes。

## 3. Retention

Personal Data Directory 中的原件和结构化记录默认由用户长期保留并通过文件系统管理。Plugin 不自动删除、备份或实现 retention policy；Runtime Directory 临时副本处理后清理。

## 4. Correction

```text
candidate extraction
→ user confirmation/correction
→ active Observation
→ deterministic rebuild
```

纠错显式指向被替代记录，旧值保留必要 provenance，但不继续作为 active fact。

## 5. Deletion and invalid edits

- 删除 raw artifact：Observation 可保留并标记 `source_missing`；
- 删除 Observation：下次扫描时从 active view 移除并重建；
- 删除整个 Personal Data Directory：Plugin fail closed；
- schema-invalid 文件：隔离并报告，不静默覆盖；
- Runtime Directory 不得恢复任何已删除 canonical 数据；
- Provider、Git、备份和远端副本删除不属于 Plugin 能力。

## 6. Processing provenance

至少保存：

```text
operation
run timestamp
payload category
artifact reference
runtime-reported provider/model if available
result reference or error category
```

不保存完整 prompt、自由文本 response、隐藏推理或 schema-invalid 原始模型输出。

## 7. Portability

复制 Personal Data Directory 必须足以解释 raw artifacts、observations、corrections、Program State 和 processing provenance，不依赖 Runtime Directory 或特定 Provider。

## 8. Benchmark separation

运行时数据不得自动进入研发数据集。Benchmark 样本需要独立授权、去身份、dataset version 和公开/私有范围说明。
