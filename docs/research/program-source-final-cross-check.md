# 教程 / XLSX / Knowledge / ProgramSpec v0.2 最终 Source Cross-check

**检查日期：** 2026-08-08  
**状态：** `COMPLETE_WITH_RECONCILIATIONS`  
**范围：** 原始教程 DOCX、原课程配套 XLSX、`knowledge/programs/zhuoshu-12-week/`、`docs/program-spec.md` 与 `program-spec.v0.2.yaml`。  
**原则：** 原件事实、用户确认的 source interpretation、派生 Markdown 与机器规范分层记录；不以外部训练学资料改写课程。

## 原件身份

| Artifact | Repository path | Size | SHA-256 |
|---|---|---:|---|
| 教程 DOCX | `sources/originals/zhuoshu-hypertrophy-course.docx` | 30,638 bytes | `B1E8E156C4C27AF3B130BEE44D9989C27B1926FCE9AB2D0FE111EC400883723F` |
| 训练记录 XLSX | `sources/originals/zhuoshu-workout-log.xlsx` | 20,964 bytes | `A113A16F9844CEB518307369BD45979AF3AA703E67DA8EB3BBB6B5E991AEBCCA` |

XLSX 实际包含：

- `第一阶段!A1:J85`：第 1–4 周，含 `A81:J85` 第 4 周周五力量测试；
- `第二阶段!A1:J114`：第 5–8 周；
- `第三阶段!A1:J132`：第 9–12 周。

## 最终结论

原件、Knowledge 与 ProgramSpec 的 12 周训练结构已经完成逐项 cross-check：

- DOCX 提供 Week 1–12 的详细训练处方，但其第 4 周周五表格仍标记“待补充”；
- 同源配套 XLSX 的 `第一阶段!A81:J85` 补齐该日正式力量测试；
- 用户确认的 Q1–Q6 解决两份同源资料之间的关系语义；
- ProgramSpec v0.2 保留 12 weeks、44 sessions、44 resolved sessions、4 个 Week 4 tests，所有 9 个 session template 引用均有定义；
- 当前训练处方来源层没有未知训练日，不应再写成 `PARTIALLY RESOLVED` 或 Week 4 Friday missing。

这不等于 production-ready。Schema validator、fixtures、Program Engine 行为测试、领域审核以及 Built-in Program 的可核验发行授权仍是独立 gate；当前发行边界只允许固定 digest 的训练日志 XLSX 进入安装包，原始 DOCX 与任意其他 Office 文件仍排除。

## 已解决的文档状态冲突

以下陈旧状态已统一回写：

- `knowledge/README.md`：从 v0.1 / partially resolved 更新为 v0.2 / source-reconciled；
- `knowledge/programs/zhuoshu-12-week/overview.md`：Week 4 Friday 改为由 XLSX 补齐；
- `knowledge/programs/zhuoshu-12-week/phase-1-weeks-01-04.md`：Q2–Q4 从待确认改为已确认；
- `docs/product/training-log-template.md`：12RM → `N` 与引体测试用途改为已确认；
- `sources/source-register.md`：XLSX 从 candidate 改为 adopted template / accepted prescription evidence；
- `source-audit.md`：最终逐项 source review 标记完成。

Q1–Q6 不重新打开，除非未来出现不同版本原件的直接反证。

## 最终 reconciliation

### 1. 普通引体向上：只约束累计总数

DOCX 的训练表在引体向上行复用了阶段间歇值，但用户确认课程实际语义为：

```text
total reps = prescribed
sets = self-selected
rest = self-selected
```

因此 Markdown 与 ProgramSpec 不再把 `60–90s`、`90–120s` 或 `120–180s` 作为普通引体向上的强制休息处方；各周 `main_rest` 只约束负重主项。

### 2. 蛋白目标：65 kg = 133 g；70 kg = 146 g

DOCX 标题和用户确认均支持：

- 65 kg：每日蛋白目标 `133 g`；
- 70 kg：每日蛋白目标 `146 g`。

DOCX 的 65 kg 明细表同时把午餐、晚餐都写成 `1.5 拳`，但分别标注 `39 g`、`52 g`；逐行相加为 `146 g`。这是原件内部明细矛盾，不改变已确认的 65 kg 总目标，也不得由系统把行项机械求和后覆盖目标。原文差异继续保留在 `nutrition.md` 的来源注记中。

### 3. 热身与弹力带：可选、用户自由裁量

弹力带保持 optional 没有冲突。热身整体不是必选项，列出的动作是共享 options，不是必须完整执行的 sequence。ProgramSpec 已显式编码：

```yaml
warmup:
  required: false
  selection: user_discretion
  options: [...]
```

### 4. 俯卧撑变式

跪姿、标准、弹力带或背包负重属于用户按能力选择的执行变式，并由 Training Observation 保存实际 variant/load；v0.2 不需要把它们改写为自动 substitution。该项不再列为 source omission。

## 验证结果

- DOCX：使用 bundled `python-docx` 完整提取段落与 39 个表格，核对课程结构、营养目标、Week 1–12 处方、热身/放松与周期规则；本机缺少 LibreOffice，未生成 DOCX 页面 PNG，不影响文本/表格结构核验，但未完成视觉页码定位。
- XLSX：使用 `@oai/artifact-tool` 导入、检查并渲染全部 3 个 sheet；确认 44 个训练/测试块、通用字段结构与 `第一阶段!A81:J85` 力量测试。
- Markdown / YAML：逐周核对 load、sets、reps/duration、effort、recovery、test binding 与 template 引用；确认普通引体休息、热身自由裁量及用户确认项已显式表达。
- 原始 DOCX/XLSX 未被本轮修改。
