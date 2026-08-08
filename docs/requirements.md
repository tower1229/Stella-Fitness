# Stella Fitness — Frozen Requirements

> 本文是实现阶段的需求基线。与本文冲突的实现，应先修改需求并记录原因，而不是在代码中静默改变产品行为。

## 1. 项目定位

Stella Fitness 是一个 **OpenClaw Plugin 为主体的个人增肌监督智能体**。

它不是一个传统健身 App，也不是一个在训练过程中持续对话的 AI 私教。

核心范式：

```text
Human executes
Agent observes
Evidence decides
Agent intervenes only when necessary
```

用户继续按照成熟、稳定的训练计划自行训练；Stella Fitness 负责长期收集低摩擦证据、分析趋势、识别偏离，并在有足够证据时给出调整建议。

## 2. 产品目标

### 2.1 核心目标

- 降低长期记录训练数据的数字化成本；
- 将纸质训练日志自动转换为结构化数据；
- 用周期性体重数据与可选饮食数据补充训练证据；
- 对训练执行、力量变化、体重趋势等进行长期监督；
- 在出现停滞、异常或明显偏离时进行多因素归因；
- 抵抗模型对用户观点的迎合倾向；
- 在证据不足时明确保持观察，而不是强行提供建议。

### 2.2 成功标准

产品的价值不以“每天产生建议”衡量，而以以下能力衡量：

- 正常时不打扰；
- 异常时能发现；
- 证据不足时能克制；
- 用户强烈表达某种观点时仍保持诊断独立性；
- 长期数据可以追溯、修正和迁移。

## 3. 明确非目标

v1 不以以下能力为目标：

- 训练过程中要求用户持续操作手机；
- 逐组实时聊天式陪练；
- 实时摄像头动作纠正；
- 自动替代成熟训练计划生成每日训练；
- 在缺少可靠证据时生成精确营养摄入；
- 医疗诊断、伤病治疗或康复处方。

## 4. 使用场景与交互约束

### 4.1 训练过程必须 offline-first

训练时用户应可以只依赖：

- 打印训练计划；
- 纸笔训练日志；
- 原有健身习惯。

Stella Fitness 不能要求用户为了使用 Agent 而频繁中断训练。

### 4.2 训练日志输入

首选流程：

```text
纸质日志 → 训练后拍照 → 图像结构化 → 用户必要时纠错 → 入库
```

要求：

- 能识别日期、动作、重量、组数、每组次数等字段；
- 无法可靠识别的字段必须标记低置信或询问，不允许猜测后静默入库；
- 原始图片与结构化 observation 之间应保留可追溯关系。

### 4.3 体重输入

用户定期输入最新体重，系统关注趋势而非单次波动。

v1 不强制固定每日输入频率，但数据覆盖率必须进入诊断证据质量判断。

### 4.4 饮食输入

饮食记录是可选项。

支持：

- 食物照片；
- 自然语言描述；
- 用户常用食物/餐食的复用。

照片分析必须承认份量、配方、烹饪方式带来的不确定性。无法得到精确数据时使用范围与置信度，不制造小数点级伪精确值。

## 5. 初始训练计划

首个 canonical program 来源：

**《卓叔增重 · 结构化增肌增重教程》**

计划包含一个 12 周周期，分三阶段：

- 第 1–4 周：力量积累；
- 第 5–8 周：高效增肌；
- 第 9–12 周：全面显壮。

训练计划必须从自然语言资料转换为版本化 `ProgramSpec`，运行时不依赖 LLM 每次重新阅读教程。

### 已知阻塞项

原资料第 4 周周五明确标记“资料缺失，待补充”。在获得可靠来源前必须保持 `unresolved`，不得推测补齐。

## 6. Program Engine 要求

Program Engine 负责回答“按照原计划本来应该发生什么”。

确定性职责包括：

- 当前周期、阶段、周次和训练日；
- 计划动作；
- 目标组次/总次数/持续时间；
- 相对重量节点；
- 休息时间；
- 恢复训练标记；
- 来源中明确给出的辅助动作加重阈值。

`A`、`A+1`、`N`、`N+1` 等只能表示相对节点，不能自动解释成固定公斤数。

## 7. 数据模型要求

至少区分以下数据层：

### 7.1 Raw Artifact

原始训练表图片、饮食照片等。

### 7.2 Observation

从原始输入中抽取、可追溯的客观记录：

- body weight；
- exercise；
- load；
- reps；
- diet observation；
- timestamp；
- source；
- confidence。

### 7.3 Subjective Claim / User Belief

例如：

- “今天特别累”；
- “我觉得是碳水吃少了”；
- “我认为训练量不够”。

用户观点是有价值的数据，但不能在 Blind Diagnosis 前混入客观 EvidencePacket。

### 7.4 Derived Metric

由代码计算：

- 训练完成率；
- 重量与容量趋势；
- 体重趋势；
- 数据覆盖率；
- 与 ProgramSpec 的偏差。

## 8. 反迎合与客观性要求

这是 Stella Fitness 的核心可靠性要求。

### 8.1 Blind Diagnosis

诊断模型只能看到经过白名单构造的 EvidencePacket。

禁止输入：

- 用户希望得到的结论；
- 用户对原因的猜测；
- 无关的聊天历史；
- 为迎合用户而提供的预设答案。

### 8.2 Belief Extraction

用户观点单独抽取，且不能参与第一次诊断。

### 8.3 Adversarial Audit

Blind Diagnosis 冻结后，独立 Auditor 才获得：

- EvidencePacket；
- Blind Diagnosis；
- User Belief。

Auditor 的职责是寻找证据不足、推理漏洞、与用户观点异常一致的风险，而不是单纯赞同第一次诊断。

### 8.4 Policy Gate

最终行动必须由确定性代码门控。

至少支持：

```text
NO_CHANGE
OBSERVE
COLLECT_MORE_DATA
ADJUST_DIET
ADJUST_TRAINING
RECOVERY
ESCALATE
```

模型不能绕过 Policy Gate 直接产生正式干预结论。

### 8.5 默认沉默

没有异常或没有足够证据时，`NO_CHANGE` / `OBSERVE` 是完整、正确的产品结果。

系统不能为了显得“有用”而强制产生修改建议。

## 9. 数据完整性要求

- 所有结构化 observation 应保留来源；
- OCR/视觉低置信字段不得静默写成确定事实；
- 用户纠错必须可覆盖派生结果，并保留必要的变更轨迹；
- 未知值必须作为未知保存；
- ProgramSpec 中 unresolved 内容必须 fail closed。

## 10. 数据所有权与隐私

Stella Fitness 的长期训练与身体数据应存储在用户控制的 OpenClaw / Plugin 环境中。

外部模型只接收完成当前任务所必需的最小数据。

不同模型角色采用最小披露：

- Extractor 只获得需要结构化的输入；
- Diagnostician 获得 EvidencePacket；
- Auditor 获得审核所需内容；
- Reporter 只获得最终允许公开给用户的 DecisionPacket。

## 11. 安全边界

Stella Fitness 是训练监督工具，不替代医疗服务。

遇到明显超出训练监督范围的症状、疼痛、疾病或潜在伤害信息时，系统应进入 `ESCALATE`，停止把问题继续解释为普通增肌计划调整。

具体安全规则在实现前需要单独制定并测试。

## 12. OpenClaw 实现要求

主体必须是可独立安装的 OpenClaw Plugin，而不是依赖某个私人 Agent 的专属 Skill。

Plugin 负责：

- 输入路由；
- 结构化抽取；
- 数据持久化；
- Program / Metrics Engine；
- 隔离模型调用编排；
- Policy Gate；
- 定期监督任务；
- 最终回复控制。

Plugin 应可以被其他 OpenClaw 用户安装，不依赖用户拥有 Stella 主 Agent。

## 13. 发布要求

目标发布渠道：ClawHub。

正式发布前必须具备：

- 清晰 README；
- 安装指南；
- OpenClaw 配置示例；
- 模型/provider 配置说明；
- 数据目录与备份说明；
- 隐私说明；
- 已知限制；
- canonical program 来源和许可状态说明；
- Eval 结果；
- 版本与 changelog。

## 14. Eval / 验收要求

必须至少覆盖：

### Information Flow

Blind Diagnostician payload 中不得出现 user belief、desired action 或完整聊天历史。

### Framing Invariance

同一 EvidencePacket，在用户分别声称“吃少了”“练少了”“恢复不好”等不同 framing 下，Blind Diagnosis 的核心结论应保持稳定。

### Abstention

证据不足时应选择 `COLLECT_MORE_DATA` / `OBSERVE`，而不是强行归因。

### No-change

正常进步时必须能够选择不干预。

### Source Fidelity

第 4 周周五等 unresolved 内容不得被自动补全。

### Extraction Quality

真实纸质训练日志上的关键字段识别必须有专门评测集，低置信识别需要正确进入纠错流程。

## 15. 实现前仍需解决

详见 [known-gaps.md](./known-gaps.md)。

在当前阶段，最重要的阻塞项是：

1. 第 4 周周五原始训练内容缺失；
2. 正式公开发布教程内容前的再发布许可确认；
3. 训练日志图像结构化模型的真实样本评测尚未建立。
