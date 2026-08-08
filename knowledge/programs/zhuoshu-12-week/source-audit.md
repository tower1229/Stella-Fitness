# 源资料审计

本文件记录《卓叔增重 · 结构化增肌增重教程》及其原课程配套训练记录表在进入 Stella Fitness canonical program 前的资料完整性与发布风险。

## 1. 当前审计状态

```text
source_document: 卓叔增重 · 结构化增肌增重教程
companion_source: 原课程三阶段训练情况记录 XLSX
program_length: 12 weeks
source_coverage: COMPLETE_FOR_CURRENT_PRESCRIPTION
source_interpretation: RESOLVED_Q1_Q6
program_spec_draft: v0.2
raw_source_archive: COMMITTED_TO_PUBLIC_GITHUB_REPOSITORY
final_source_cross_check: COMPLETE
canonical_ready: false
```

`canonical_ready: false` 现在不是因为训练计划内容仍有缺口，也不是因为原始 Office 文件未归档。

当前训练处方来源层已经收敛；剩余阻塞主要属于：

- ClawHub/npm 等发行包是否捆绑原始 Office 文件的独立发布决策；
- 是否/如何做默认 program 的独立领域审核；
- ProgramSpec schema/fixture 等未来实施验证。

## 2. 原始来源归档

用户已于 2026-08-08 明确确认允许将两份原始 Office 资料提交到公开 `tower1229/Stella-Fitness` GitHub 仓库。

当前原件路径：

```text
sources/originals/zhuoshu-hypertrophy-course.docx
sources/originals/zhuoshu-workout-log.xlsx
```

本轮核验的文件身份：

```text
zhuoshu-hypertrophy-course.docx
sha256: B1E8E156C4C27AF3B130BEE44D9989C27B1926FCE9AB2D0FE111EC400883723F

zhuoshu-workout-log.xlsx
sha256: A113A16F9844CEB518307369BD45979AF3AA703E67DA8EB3BBB6B5E991AEBCCA
```

治理关系：

```text
raw Office sources
    ↓
knowledge Markdown / ProgramSpec
    ↓
product / architecture / quality docs
```

原件是回溯来源事实的基准，不通过派生文档反向静默修改。

## 3. 已确认覆盖范围

同源资料组合已覆盖：

- 器械准备；
- 65 kg / 70 kg 饮食模板；
- `A / A+1 / A+2 / N / N+1...` 重量语义；
- 第 1~12 周训练安排；
- 第 4 周周五阶段末力量测试；
- `A` 与初始 12RM 的关系；
- 第 4 周 12RM 与第二阶段 `N` 的关系；
- 引体向上测试与第二阶段辅助带选择；
- 第 4 周和周期末 12RM 测试协议的一致性；
- “哑铃推举 / 哑铃推肩”动作别名；
- 第一阶段特殊加重节奏与长期“两周一次”概括的优先关系；
- 热身与放松；
- 力竭、辅助动作加重和恢复规则；
- 第 12 周结束后的 12RM 重测与循环逻辑；
- 三阶段纸质训练记录布局。

## 4. 第 4 周周五正式内容

正式处方：

```text
第4周，周五，力量测试

高脚杯深蹲：12RM 测试重量（kg）
哑铃卧推：12RM 测试重量（kg）
哑铃硬拉：12RM 测试重量（kg）
引体向上：第一组最大完成次数
```

三个主项的测试结果分别成为第二阶段对应动作的 `N`。

## 5. 已确认的课程关系语义

### Q1：第一轮 `A`

`A` = 三个主项各自第一次测试得到的初始 12RM。

### Q2：第 4 周 12RM → `N`

三个主项第 4 周周五重新测试得到的 12RM，分别直接成为第二阶段对应动作的 `N`。

### Q3：引体向上测试

第一组最大完成次数会影响第二阶段辅助带选择。

原则：选择徒手或弹力带辅助，使训练时尽量每组能完成 8 次以上，同时保持课程规定的累计总次数目标。

### Q4：12RM 测试方法

第 4 周周五采用与课程完整周期结束时相同的 12RM 测试方法。

### Q5：哑铃推举 / 哑铃推肩

两者是同一动作，统一标准名称为“哑铃推肩 / dumbbell-overhead-press”。

第三个月新增的“哑铃弯举 / dumbbell-curl”是另一个独立动作。

### Q6：第一阶段加重频率

详细逐周计划优先：

```text
A → A+1 → A+2 → A+2 + 12RM retest
```

“两周加重一次”作为长期一般节奏理解；第一个月属于特殊阶段，不覆盖详细处方。

完整确认记录见 `open-questions.md`（文件保留作审计记录）。

## 6. ProgramSpec 状态

- `program-spec.v0.1.yaml`：历史草案；
- `program-spec.v0.2.yaml`：当前来源关系已收敛的草案。

v0.2 在训练处方来源层面：

```text
known_gaps: []
```

这不等于已经 production-ready。它仍需未来实施阶段的 Schema validation、fixtures 和 Program Engine 验证。

## 7. 源资料自身的不确定性声明

结构化教程末尾注明：

> 部分内容可能由 AI 生成。

因此本仓库完成的是来源忠实结构化，不是训练科学或医疗层面的专业背书。

配套 XLSX 和用户课程背景确认解决了课程内部完整性/语义问题，但不替代独立领域审核。

## 8. GitHub 收录与发行包分发

已确认：

- 原始 DOCX 可以收录到本公开 GitHub 仓库；
- 原始 XLSX 可以收录到本公开 GitHub 仓库。

仍作为未来 release decision 单独处理：

1. ClawHub/npm 等发行包是否直接携带原始 Office 文件；
2. 是否只在源码仓库保留原件、发行包只包含派生 ProgramSpec/文档；
3. 是否需要额外署名或许可声明。

因此“GitHub 仓库归档权限”和“发行包再分发策略”不再混为同一个问题。

## 9. 审定规则

未来 `program-spec.v1` 标记为 canonical 前至少需要：

- [x] 第 4 周周五来源缺口已解决；
- [x] Q1–Q6 训练计划语义已确认；
- [x] `A / N` 的 12RM 绑定关系已明确；
- [x] 哑铃推肩/哑铃弯举命名边界已明确；
- [x] 第一阶段详细周计划优先级已明确；
- [x] 原始 DOCX/XLSX 已归档到公开 GitHub 仓库；
- [x] 所有训练日与同源资料完成最终逐项审阅；
- [ ] 默认公开 program 所需的领域审核范围已完成；
- [ ] ProgramSpec Schema 校验通过；
- [ ] Program Engine 单元测试覆盖全部 12 周；
- [ ] 正式发行前明确原始 Office 文件是否进入 distributable package。
