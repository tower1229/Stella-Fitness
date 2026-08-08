# Stella Fitness Knowledge

`knowledge/` 保存可版本化、可迁移、与用户运行时数据分离的领域知识。

## Programs

### 卓叔 12 周结构化增肌增重计划

路径：[`programs/zhuoshu-12-week/`](./programs/zhuoshu-12-week/)

状态：`draft / source-reconciled`

- 12 周、3 个阶段；
- 已完成 Markdown 结构化迁移；
- 已建立当前 `ProgramSpec v0.2` 草案；
- 第 4 周周五已由原课程配套 XLSX 补齐；
- Q1–Q6 已确认，训练处方来源层没有已知缺口；
- 仍需 Schema validator、fixtures、Program Engine 测试和领域审核后才能进入 production canonical 状态。

## 原则

1. Knowledge 不保存用户个人训练数据；
2. 不用 LLM 自动补齐来源缺口；
3. Markdown 用于人工核对，ProgramSpec 用于确定性执行；
4. 每个 program 独立版本化；
5. Plugin 核心逻辑不与单一训练计划绑定。
