# Stella Fitness — Frozen Requirements

> 本文是实现阶段的需求基线。与本文冲突的实现，应先修改需求并记录原因。

## 1. 项目定位

Stella Fitness 是一个以 **OpenClaw Native Plugin** 为主体的训练计划执行与记录工具。

```text
Program Source → deterministic Program State
Paper records → confirmed Observation Records
```

它不是 AI 私教、训练监督系统、营养顾问或健康风险系统。

## 2. 产品目标

- 让用户训练时继续使用纸质训练日志；
- 将固定模板的训练日志照片转换为可确认、可纠错的结构化记录；
- 确定性解释来源计划、当前周期和目标训练日；
- 记录体重等明确事实；
- 保证来源、空白、不确定性和纠错历史可追溯；
- 让用户数据可检查、迁移、备份和删除。

成功标准是记录准确、输入低摩擦、事实可追溯，而不是产生建议。

## 3. 明确非目标

v1 不提供：

- 训练表现评价、趋势诊断或停滞归因；
- Blind Diagnosis、User Belief Extraction、Adversarial Audit 或 Policy Gate；
- 训练、负重、训练量、恢复或课程调整建议；
- 饮食照片分析、营养估算、餐量判断或营养建议；
- 医疗、伤病、症状或健康风险识别、分级、升级和处置；
- 特殊人群适用性判断；
- 周期主动监督、异常通知或自动干预；
- 实时动作纠正或训练中持续交互；
- 通用任意训练表识别或每日 LLM 生成训练计划。

用户独立选择训练计划并作出训练与健康决策；Stella Fitness 不对输入进行安全筛查，也不以免责声明替代不存在的专业能力。

## 4. 核心用户流程

```text
安装 → 自动载入卓叔 12 周 Built-in Program
→ 技术 preflight → 器材/打印材料/训练记录协议逐项确认 → baseline 体重
→ 三主项独立初始 12RM → 星期一激活 → Planned Session / 可打印日志
→ 纸笔填写 Actual → 训练后拍照
→ 图像结构化 → 必要字段确认 → Observation Record
→ 可重建 Training Record View
```

训练过程中不得要求逐组操作手机。

## 5. ProgramSpec 与 Program State

ProgramSpec 是来源训练计划的 canonical machine-readable 表示。Program Engine 负责确定性解析：

- 当前周期、阶段、周次和训练日；
- session type；
- 计划动作与目标组次/总次数/持续时间；
- 相对重量节点；
- 休息时间、恢复训练和测试语义；
- 12RM、max-reps 与未来符号重量的绑定关系。

Program Engine 不评价处方质量。遇到 `status: unresolved` 或无效关系必须 fail closed。

`A`、`A+1`、`N` 等是每个动作各自的符号节点，不得被模型解释成固定公斤增量。

首版只有一个默认 Built-in Program，不提供计划选择器，也不要求用户输入 ProgramSpec 路径。持久化 Program Journey 必须依次暴露 `PREREQUISITES_REQUIRED`、`BASELINE_WEIGHT_REQUIRED`、`INITIAL_12RM_REQUIRED`、`READY_TO_ACTIVATE`、`ACTIVE` 或 `PHASE_CHECKPOINT_REQUIRED` 中唯一明确的下一步。Active Program State 只能在 prerequisites、baseline 和三个动作各自的 `A` 完整后，以星期一 cycle start 创建。

Current Fitness State 把 `program/state.json` 视为现有单一 Active Program Context。迁移或外部 Provider 如需提供额外候选，只能放在 `program/active-contexts/<context-id>/`，并同时提供严格匹配目录名的 `active.json`（`stella-fitness/active-program-context/v0.1`、`active: true`）、`state.json` 和 `spec.json`；目录存在本身不表示 active。查询发现两个或更多显式 active context 时必须报告冲突，不按修改时间选择。

## 6. 训练日志抽取

v1 只优先支持用户提供的原课程三阶段 XLSX 固定布局。

必须：

- 固定识别 stage、week、weekday、session type 和 exercise；
- 识别实际重量、各组完成值、动作质量和问题备注的原始内容；
- 把动作质量和备注保存为用户记录，不推导表现或健康含义；
- 支持 kg、bodyweight、assisted、exercise variant 和 none 等 load 语义；
- 根据动作区分 repetitions 与 duration；
- 单独处理第 4 周周五 strength test；
- 保留 recovery session 的计划身份；
- 对低置信、冲突或关键数字请求最小确认；
- 永远不使用计划目标补齐空白 actual；
- 保持 Raw Artifact、字段结果和用户确认之间的 provenance。

## 7. 体重记录

用户可以记录带发生时间的体重 Observation。baseline 是激活门禁，第 4、8、12 周 checkpoint 是进入下一阶段或完成周期的交互门禁。系统可以确定性展示相对 baseline 和上一 checkpoint 的 kg、百分比变化及 `toward-goal`、`away-from-goal`、`unchanged`、`insufficient-data` 数学方向，但不得评价健康或理想程度、推断原因、后台监督或触发饮食/训练调整。

## 8. 数据模型

至少区分：

- `Raw Artifact`：原始训练表图片等用户输入；
- `Observation Record`：训练 actual、体重、用户原始备注等事实；
- `Program State`：确定性的周期和符号重量绑定；
- `Program Setup`：激活前 prerequisites、baseline 与 course-start 12RM 的稳定引用；
- `Training Record View`：由 Program State 与 Observation Records 重建的事实视图；
- `Processing Record`：抽取、确认、失败及 OpenClaw 执行元数据。

不得持久化训练诊断、营养判断、健康风险判断或隐藏推理。

## 9. 数据完整性

- Observation Record 具有稳定 ID、发生时间、schema version 和 provenance；
- 用户纠错创建显式替代关系，不静默覆盖原记录；
- 事实视图和索引可从 canonical records 重建；
- 原始文件通过相对路径和 hash 与 Observation 关联；
- unknown、conflict 和 low-confidence 必须结构化保留；
- 重复上传必须可检测；
- 文件系统删除必须有效，Runtime Directory 不得恢复已删除个人数据；
- schema-invalid 手工编辑必须隔离并报告，不能污染派生状态。

## 10. 隐私与数据所有权

本节已由 Product Owner 于 2026-08-10 审核通过。

- Built-in Program 内容适用独立发行授权；
- 用户输入及 Plugin 产生的用户记录均由用户控制；
- operator 必须通过 Runtime-owned locator 配置唯一绝对路径 Personal Data Repository；Fitness 固定使用 `<repository>/stella/fitness`，不得复制第二份路径配置；
- 未配置、不可读写或与 Runtime Directory 重叠时必须 fail closed；
- canonical 用户数据不得回退到 Runtime Directory；
- 原始上传在 Personal Data Directory 中保持字节不变；
- 提交 OpenClaw media runtime 前生成已应用方向、移除 EXIF/GPS/设备信息的临时副本；
- 临时副本覆盖成功、失败、超时和取消的清理路径；
- 模型只接收完成抽取所需的最小 payload；
- Processing Record 只保存 Plugin 可观察的 payload 类别和 runtime 实际返回的执行元数据；
- Plugin 不提供遥测、自动数据贡献或隐式 Benchmark 复用；
- 用户通过文件系统或 Personal Data Repository 管理、复制、备份和删除数据。

## 11. OpenClaw 要求

主体必须是可独立安装的 Native Plugin。Plugin 负责：

- 领域输入路由；
- 媒体净化与结构化抽取；
- 字段确认与纠错；
- ProgramSpec validation 与 Program Engine；
- Personal Data Directory 写入和确定性重建；
- synthetic status/confirmation/recording replies。
- Program Journey、Program Facts 和 Printable Log 的统一 Interface；
- 绑定 conversation 中的范围拒绝，禁止把诊断、饮食、健康风险或计划调整问题转交通用 Agent。

OpenClaw 负责 Provider、凭据、endpoint、授权和实际模型执行。Plugin 只能使用 operator 明确允许的模型，不另建 Provider 配置体系。

## 12. 初始 Program Source

卓叔 12 周课程与原课程配套 XLSX 构成首个 Program Source。当前 source reconciliation 已完成，`program-spec.v0.2.yaml` 是实现与验收 fixture。

来源忠实性不等于专业背书。Stella Fitness 不评价该计划是否适合某个用户，也不根据训练结果调整计划。

## 13. 发布边界

- Plugin 代码、通用 schema 与原创材料采用 Apache-2.0；
- 原始 DOCX 只作源码审计材料；训练日志原始 XLSX 以固定 digest 作为内置打印模板进入安装包；
- 课程派生运行时制品只有在取得覆盖实际制品与渠道的授权后才能公开发行；
- 发布制品不得包含用户数据、研发 pilot 或未授权来源内容；
- clean install 与真实 OpenClaw load 是发行验收的一部分。
- 安装包必须包含默认 Built-in Program 与完整 12 周内置 XLSX；Plugin 直接发送该静态工作簿，不在运行时生成 PDF。公开发行仍须通过精确制品授权 gate。
