# Stella Fitness Knowledge

`knowledge/` 保存可版本化、可迁移、与用户运行时数据分离的领域知识。

## Programs

### 卓叔 12 周结构化增肌增重计划

路径：[`programs/zhuoshu-12-week/`](./programs/zhuoshu-12-week/)

状态：`draft / partially resolved`

- 12 周、3 个阶段；
- 已完成 Markdown 结构化迁移；
- 已建立 `ProgramSpec v0.1` 草案；
- 第 4 周周五仍为来源缺失，不能进入全自动执行状态。

## 原则

1. Knowledge 不保存用户个人训练数据；
2. 不用 LLM 自动补齐来源缺口；
3. Markdown 用于人工核对，ProgramSpec 用于确定性执行；
4. 每个 program 独立版本化；
5. Plugin 核心逻辑不与单一训练计划绑定。
