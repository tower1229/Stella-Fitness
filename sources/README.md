# Sources

本目录登记 Stella Fitness 的原始 Program Source、外部研究依据与来源治理信息。

## 1. Original Program Sources

用户已于 2026-08-08 明确确认允许将首个训练计划的两份原始 Office 文件收录到本公开 GitHub 仓库。

原件保存在：

- `originals/zhuoshu-hypertrophy-course.docx` — 《卓叔增重 · 结构化增肌增重教程》原始 DOCX；
- `originals/zhuoshu-workout-log.xlsx` — 原课程三阶段训练情况记录表原始 XLSX。

目录职责：

```text
sources/originals/   原始、不可静默改写的来源文件
        ↓
knowledge/           来源忠实的 Markdown / ProgramSpec 派生层
        ↓
docs/                产品需求、架构、研究、质量与治理
```

完整性与来源审计见：

- `knowledge/programs/zhuoshu-12-week/source-audit.md`
- `sources/training-log-template-audit.md`
- `docs/known-gaps.md`

> 本公开 GitHub 仓库收录已获用户明确确认；卓叔计划将作为 v1 `Built-in Program`。正式发行包包含运行时派生制品，不包含原始 Office 文件，并须取得覆盖派生、修改、署名及实际分发渠道的可核验授权。

本目录中的课程原件及课程派生内容不因仓库根目录采用 Apache-2.0 而获得该许可。公开仓库收录确认不等于派生、修改或安装包再分发授权；适用范围见根目录 `NOTICE` 与 ADR-018。

## 2. Research Sources

OpenClaw、训练日志 extraction model、隐私与发布研究登记在 [source-register.md](./source-register.md)。

## 来源治理规则

1. 原始 Program Source 不静默修改；
2. `knowledge/` 的结构化内容必须可追溯到原件；
3. 发现原件与派生文档冲突时，记录 reconciliation，不以模型推断覆盖原件；
4. 平台/价格/模型属于易变事实，记录检查日期；
5. 实施开始和正式发布前重新核验易变依赖；
6. 技术平台优先官方文档；
7. `knowledge/` 不通过 research source 静默改写；
8. 不确定或冲突的资料进入 `known-gaps.md`。
