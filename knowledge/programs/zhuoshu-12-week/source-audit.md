# 源资料审计

本文件记录《卓叔增重 · 结构化增肌增重教程》在进入 Stella Fitness canonical program 前的资料完整性与发布风险。

## 1. 当前审计状态

```text
source_document: 卓叔增重 · 结构化增肌增重教程
program_length: 12 weeks
status: PARTIALLY_RESOLVED
canonical_ready: false
```

## 2. 已确认覆盖范围

源教程包含：

- 器械准备；
- 65 kg / 70 kg 饮食模板；
- `A / A+1 / A+2 / N / N+1...` 重量语义；
- 第 1~12 周训练安排；
- 热身与放松；
- 力竭、辅助动作加重和恢复规则；
- 第 12 周结束后的 12RM 重测与循环逻辑。

## 3. 明确资料缺口

### BLOCKER-001：第 4 周周五训练缺失

源教程正文明确标记：

```text
周五（资料缺失，待补充）
```

处理规则：

- Markdown 文档保留 `unresolved`；
- `ProgramSpec` 对该 session 标记 `status: unresolved`；
- 不根据周一 / 周三 / 前几周的模式自动推导；
- 不允许 LLM 生成后写回 canonical data；
- 在获得可靠原始资料前，不应声称内置计划完整可执行 12 周。

## 4. 源资料自身的不确定性声明

源文件末尾注明：

> 部分内容可能由 AI 生成。

因此本仓库当前完成的是**忠实结构化**，不是训练科学或医疗层面的专业背书。

后续若要将计划作为公共 ClawHub Plugin 的内置默认方案，应增加独立的内容审核流程，并记录审核版本。

## 5. 版权与发布许可

仓库为公开项目，且计划未来通过 ClawHub 分发。当前没有在项目资料中看到该教程内容的授权或许可信息。

在发布包含完整教程内容的正式版本前，应确认：

1. 项目是否拥有重新分发该教程全文/结构化版本的权利；
2. 是否需要署名、来源链接或特定许可声明；
3. 如果无法重新分发，是否改为仅发布 ProgramSpec / 用户自行导入方案。

在许可状态明确前，本问题记为：

```text
BLOCKER-002: source redistribution license unknown
```

## 6. 审定规则

只有满足以下条件，`program-spec.v1` 才能标记为 canonical：

- [ ] BLOCKER-001 已解决；
- [ ] 所有训练日与源资料逐项核对；
- [ ] 重量标记、组数、次数、间歇与 session type 完成一致性校验；
- [ ] 恢复日被明确标记，不进入“训练退步”异常检测；
- [ ] 源资料发布许可已确认；
- [ ] ProgramSpec Schema 校验通过；
- [ ] Program Engine 单元测试覆盖全部 12 周。
