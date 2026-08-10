# Golden Cases

**状态：FROZEN v0.2 — RECORDING SCOPE / PRODUCT AND PRIVACY APPROVED**

## Program

### G-PROG-001 — Ordinary session

给定确定的 cycle start 与 ProgramSpec，返回唯一的 phase/week/day/session prescription，不调用 LLM 解释来源文本。

### G-PROG-002 — Per-exercise symbolic load

三个主项的 `A`、`N` 绑定彼此独立，一个动作的测试结果不能覆盖其他动作。

### G-PROG-003 — Week 4 strength test

第 4 周周五解析为 strength-test；三个主项的确认 12RM 分别绑定 `N`，引体结果绑定辅助基线。

### G-PROG-004 — Recovery session

保持 recovery identity 和原计划处方，不产生“退步”或其他表现判断。

### G-PROG-005 — Invalid/unresolved spec

Program Engine fail closed，不猜测缺失关系。

## Workout extraction

### G-LOG-001 — Clear ordinary sheet

正确识别 stage/week/day/exercise、load 和各组 actual，并关联 Raw Artifact。

### G-LOG-002 — Blank actual

空白保持 unknown；禁止使用 ProgramSpec 目标补齐。

### G-LOG-003 — Critical numeric ambiguity

只询问无法可靠识别的关键字段，确认前不写成确定 Observation。

### G-LOG-004 — Polymorphic load

kg、bodyweight、弹力带辅助、跪姿/标准/负重变式和 none 不被错误压成一个 number。

### G-LOG-005 — Reps versus duration

平板支撑按 duration，普通动作按 reps；不得仅凭单元格数字猜测语义。

### G-LOG-006 — Raw note preservation

动作质量和问题备注按原文保存，不推断训练表现、原因或健康风险。

## Record lifecycle

### G-DATA-001 — Duplicate upload

相同 artifact 不创建第二份有效训练记录。

### G-DATA-002 — Correction

纠错生成显式 provenance，旧记录可审计，事实视图使用当前有效值。

### G-DATA-003 — Restart rebuild

清空可重建 runtime state 后，Personal Data Directory 可恢复相同事实视图。

### G-DATA-004 — External deletion

用户删除 canonical 文件后，重建尊重删除；runtime 不复活数据。

### G-DATA-005 — Invalid manual edit

无效 schema 文件被隔离并报告，不污染其他有效记录。

## Privacy

### G-PRIV-001 — Missing personal directory

拒绝接收个人输入，不回退到 Runtime Directory。

### G-PRIV-002 — Original and sanitized copy

原件 byte-identical；模型副本应用方向且不含 EXIF/GPS/设备 metadata。

### G-PRIV-003 — Cleanup

成功、失败、超时和取消后均不存在遗留 sanitized copy。

### G-PRIV-004 — Minimal payload

训练日志 Extractor 只收到当前 artifact、layout context 与 extraction schema，不收到无关历史或个人资料。

## Scope regressions

### G-SCOPE-001 — Performance question

当用户要求评价训练表现或调整计划时，Plugin 不读取记录生成结论；明确说明该能力不在范围内。

### G-SCOPE-002 — Health-risk statement

Plugin 不提取、判断或升级健康风险，也不把原文保存为结构化健康结论；明确说明该能力不在范围内。

### G-SCOPE-003 — Diet input

Plugin 不分析食物照片、营养或餐量，不创建 Food Observation。

### G-SCOPE-004 — No hidden supervision

代码、schema、配置和 package 中不存在 Blind Diagnosis、Audit、Policy Gate、Safety 或 periodic supervision capability flag。
