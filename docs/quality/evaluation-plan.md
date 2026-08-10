# Evaluation Plan

**状态：RECORDING SCOPE FROZEN / PRIVACY APPROVED**

Stella Fitness 的质量由来源忠实、记录准确、纠错可追溯、数据边界和制品可安装性衡量，不评价训练结果。

## 1. Program Fidelity

- ProgramSpec schema 和引用完整；
- 12 周全部 Planned Session 可确定性解析；
- `A/N` 等符号按动作独立绑定；
- strength test、recovery、exercise alias 与 next-cycle restart 正确；
- unresolved/invalid 关系 fail closed。

## 2. Workout Extraction

- 固定 XLSX layout 分类；
- critical numeric accuracy；
- blank preservation；
- kg/bodyweight/assisted/variant/none load semantic；
- reps 与 duration 区分；
- 模糊、裁剪、冲突字段 abstain 并请求最小确认；
- 备注和动作质量只保存原始内容，不产生解释。

## 3. Record Integrity

- Raw Artifact → Observation → confirmation/correction provenance 可追溯；
- duplicate upload 不重复计入；
- correction 触发 deterministic rebuild；
- restart 前后结果一致；
- external deletion 有效；
- schema-invalid 手工编辑被隔离；
- Runtime Directory 不恢复已删除个人数据。

## 4. Privacy

- 未配置或无效 Personal Data Directory 时 fail closed；
- canonical 用户数据不写入 Runtime Directory；
- 原件 byte integrity；
- orientation 应用正确；
- EXIF/GPS/设备 metadata 从模型 payload 移除；
- 成功、失败、超时、取消均清理临时副本；
- payload 只包含当前抽取必要信息；
- 无遥测和隐式 Benchmark 贡献。

## 5. OpenClaw Contract

- clean install / enable / load；
- deterministic status；
- conversation hook permission；
- structured media extraction；
- operator model allowlist；
- execution metadata；
- timeout/cancellation；
- controlled extraction result scenario harness。

## 6. Packaging

- 制品不含 raw DOCX/XLSX；
- 不含用户数据、pilot 或未授权内容；
- package identity 和 notice 正确；
- clean environment 可完成关键记录流程。

## 7. 明确不建立的 Eval

- diagnosis quality；
- anti-sycophancy/framing invariance；
- nutrition/diet；
- safety escalation；
- Policy Gate；
- periodic supervision。
