# Stella Fitness

> Source-faithful workout recording for OpenClaw.
>
> **正常训练，纸笔记录；训练后拍照，形成可追溯数字记录。**

Stella Fitness 是一个 **OpenClaw Native Plugin** 训练计划执行与记录工具。它把来源训练计划转换为确定性的 `ProgramSpec`，解析用户当前训练日，并把纸质训练日志与体重记录低摩擦地转换为可纠错、可重建的结构化事实。

当前仓库已有可构建、可测试并可在 clean OpenClaw 环境安装检查的 Plugin 实现；课程派生制品授权和最终发布闸门通过前，不公开发行。

```text
Program Source → ProgramSpec → Planned Session
                                  +
Paper Log Photo → Confirmed Observation → Training Record View
```

## 产品边界

v1 的核心体验：

```text
原课程三阶段 XLSX
      ↓
打印对应阶段训练日志
      ↓
正常训练 + 纸笔记录 Actual
      ↓
训练后拍照上传
      ↓
结构化、确认、纠错与长期保存
```

Stella Fitness 只回答事实问题：

1. 来源计划要求什么？
2. 当前周期对应哪个训练日？
3. 用户记录了哪些实际结果？
4. 哪些字段仍为空白、不确定或已被纠正？

它明确不负责：

- 评价训练表现好坏；
- 推断停滞、疲劳或进步原因；
- 调整训练计划、训练量、负重或恢复；
- 饮食照片、营养估算或饮食建议；
- 医疗、伤病或健康风险识别与升级；
- 根据用户观点生成诊断或建议；
- 周期性主动监督和异常通知。

用户独立选择并执行训练计划，训练和健康相关决策由用户自行负责；需要时应咨询合格专业人员。Stella Fitness 不把这一边界包装成自动安全判断。

## 数据完整性

- `ProgramSpec` 只表达来源计划，不把模型建议写回原计划；
- 空白 Actual 永远保持空白，不能根据计划目标自动补齐；
- `重量` 保留 kg、bodyweight、assisted、动作变式或 none 等真实语义；
- reps 与 duration 分开表达；
- 第 4 周力量测试和 recovery session 保留其计划语义；
- Observation Records 是 canonical，事实视图可从记录重建；
- 用户纠错保留 provenance，不静默改写历史。

## 隐私与数据所有权

隐私与数据生命周期设计已由 Product Owner 于 2026-08-10 审核通过：

- 用户必须显式配置 Personal Data Directory；
- canonical 用户数据不得静默写入 Runtime Directory；
- 原始上传文件保持字节不变；
- 提交给 OpenClaw media runtime 前生成应用方向且去除 EXIF/GPS 的临时 `Sanitized Media Copy`；
- 临时副本在成功、失败、超时和取消路径均清理；
- Plugin 无遥测、自动数据贡献或隐式 Benchmark 复用；
- 用户通过文件系统或自己的 Personal Data Repository 管理、备份和删除数据。

## 首个训练计划

首个 program source 来自：

1. 《卓叔增重 · 结构化增肌增重教程》；
2. 原课程三阶段训练情况记录 XLSX。

来源语义已完成最终交叉核对：

- `A` 是三个主项各自的初始 12RM；
- 第 4 周周五重新测试三个主项 12RM，并分别绑定第二阶段的 `N`；
- 同日引体向上第一组最大次数用于第二阶段辅助方式选择；
- “哑铃推举”和“哑铃推肩”统一为哑铃推肩，哑铃弯举保持独立；
- 第一阶段采用详细逐周处方 `A → A+1 → A+2 → A+2 + retest`。

当前 [ProgramSpec v0.2](knowledge/programs/zhuoshu-12-week/program-spec.v0.2.yaml) 是 source-reconciled draft。它的启用条件是 schema/fixture 验证与来源忠实性；Stella Fitness 不对计划作专业评价或背书。

## 当前门禁

Privacy Review 已批准。训练/营养监督和 Safety Review 因对应能力已移出范围，不再是实施门禁。

实施 kickoff 仍须完成：

- 锁定并核验当前 OpenClaw Plugin SDK、hooks、structured media 与模型权限契约；
- 实现并验证 ProgramSpec schema/fixture；
- 保持内部实现、Built-in Program 启用与公开发行三类门禁分离。

公开发行仍受以下条件约束：

- 覆盖实际课程派生制品和发行渠道的可核验授权；
- ClawHub/npm 制品检查与实时发布权限验证；
- 与待发布 package name、version、artifact SHA-256 绑定的一次真实 Telegram Adapter smoke；
- #3 所需的真实填写训练日志照片、人工 ground truth 与 live provider benchmark；当前 deterministic fixture 不代表该 gate 已完成；
- 原始 DOCX 不进入发行包；仅允许固定 digest 的内置训练日志 XLSX 随包分发。

## 仓库结构

```text
.
├── docs/                 # 冻结需求、架构、质量与实施准备
├── knowledge/            # 来源忠实的训练计划知识层
└── sources/              # 外部资料登记、来源治理与引用索引
```

从 [docs/README.md](docs/README.md) 开始阅读。

## 许可证与内容权利

Plugin 代码、通用 schema 及非课程派生的项目原创材料采用 [Apache License 2.0](LICENSE)。该许可不覆盖 `sources/originals/` 中的原始 DOCX/XLSX、课程派生内容或用户 Personal Data Directory 中的数据，详见 [NOTICE](NOTICE) 与 [ADR-018](docs/decisions/ADR-018-apache-2-code-separate-content-rights.md)。

## 验证证据边界

Tests demonstrate implementation fidelity only; they are not professional endorsement.

测试结果只证明制品安装、数据流和记录行为符合实现规格，不证明训练计划具有专业背书，也不扩展 Stella Fitness 的 recording-only 能力边界。

## 状态

**Stella Fitness 当前可供内部实现验证，但不可公开发行。** Plugin 已可构建、安装和执行；公开发行继续由精确课程派生授权、制品检查和 ClawHub live gate 共同阻止，任一证据缺失都必须失败关闭。
