# 已知缺口与阻塞项

本文是 Stella Fitness 的未知项登记册。任何 `BLOCKING` / `RELEASE-BLOCKING` 项都不能由 LLM、开发者默认值或“看起来合理”的经验推断悄悄关闭。

## GAP-001：第 4 周周五训练内容缺失

**状态：OPEN / BLOCKING FOR CANONICAL PROGRAM**

源教程明确写为“周五（资料缺失，待补充）”。

当前处理：

- Markdown 保留缺失；
- ProgramSpec 保留 `status: unresolved`；
- 不根据前几周模式推导；
- 不允许模型生成后写回 canonical data。

关闭条件：获得可靠、可追溯的原始来源并完成逐项复核。

## GAP-002：教程版权与再发布许可未知

**状态：OPEN / RELEASE-BLOCKING**

当前仅确认用户提供了教程作为本项目需求/结构化工作的来源，没有证据证明可以将教程全文、等价 Markdown 或可还原结构随 GitHub/ClawHub 公开再分发。

关闭条件：明确权利来源、署名和许可范围；否则公开产品需改用用户本地导入或其他合法方案。

## GAP-003：教程本身存在来源不确定性

**状态：OPEN / CONTENT-REVIEW REQUIRED**

源文件末尾注明“部分内容可能由 AI 生成”。因此 `knowledge/` 代表**来源忠实**，不代表专业背书。

关闭条件：若要把该 program 作为默认公共训练方案，需要独立领域审核并留下审核版本。

## GAP-004：饮食目标没有连续计算公式

**状态：OPEN / NON-BLOCKING FOR SOURCE FIDELITY**

教程给出 65 kg / 70 kg 示例，并说不同体重按比例调整，但没有定义唯一连续算法。

当前处理：保留示例，不自行发明公式。

## GAP-005：干预阈值尚未审定

**状态：OPEN / BLOCKING FOR PRODUCTION SUPERVISION**

未冻结：

- 体重停滞窗口；
- 训练完成率/负荷趋势触发条件；
- 饮食证据覆盖度；
- 调整幅度；
- 疲劳/恢复判断边界。

研究表明增肌结果涉及多个变量，且能量盈余的精确“最佳值”证据不足，因此不应在需求阶段硬编码一个万能阈值。

## GAP-006：健康安全与适用人群边界待专业审定

**状态：OPEN / BLOCKING FOR PRODUCTION SUPERVISION**

当前只冻结原则：出现胸部不适、异常呼吸困难、明显头晕/晕厥等危险信号时，必须退出“增肌优化”路径并 `ESCALATE`，而不是继续提供训练强化建议。

仍需确定：

- 特殊疾病/用药/伤病人群排除条件；
- 地区化紧急指引；
- 非急性疼痛如何分流；
- 哪些健康信息允许 Plugin 主动询问。

## GAP-007：食物照片无法提供可靠精确宏量营养素

**状态：KNOWN LIMITATION / DESIGN CONSTRAINT**

现有研究显示，通用视觉模型在食物识别上可以较好，但份量和营养定量误差明显，蛋白质估计尤其可能较差。

因此：

- photo-only 只能形成估算区间与低/中置信证据；
- 不显示虚假小数精度；
- 包装标签、用户确认重量、固定食谱模板等应具有更高证据等级；
- photo-only 不能单独触发高置信饮食调整。

## GAP-008：中式饮食营养数据库与 benchmark 尚未确定

**状态：OPEN / RESEARCH**

USDA FoodData Central / FNDDS 是明确、开放且可通过 API 使用的候选 grounding 数据源，但其覆盖结构不等于中国本地饮食场景。

关闭条件：调研并对比适合常见中式菜品的权威数据源，建立真实 benchmark 后再决定。

## GAP-009：最终模型组合未确定

**状态：OPEN / IMPLEMENTATION-TIME BENCHMARK**

当前只冻结角色能力，不冻结厂商：

- structured vision extraction；
- blind high-quality reasoning；
- independent adversarial audit；
- low-cost belief extraction；
- template-first reporting。

任何候选模型都必须在 Stella Fitness 自己的 Eval 上通过后才能成为默认值。

## GAP-010：Provider 数据保留策略需部署时确认

**状态：OPEN / PRIVACY REVIEW**

模型供应商的数据政策、ZDR 可用性和功能限制可能变化。生产配置必须记录每个 Provider 的数据用途、默认保留、ZDR/企业选项和是否允许发送图片。

## GAP-011：ClawHub owner / package scope 未确认

**状态：OPEN / RELEASE-BLOCKING**

当前仓库 owner 不能自动等价为最终 ClawHub publish owner。包名和 scope 在首次发布前才冻结，并必须与 ClawHub 实际 owner 匹配。

## GAP-012：软件许可证未选择

**状态：OPEN / RELEASE-BLOCKING**

代码许可证与教程内容许可是两个独立问题。当前 Phase 0 没有 package，因此不设置虚假的 `UNLICENSED` package 状态。

## GAP-013：Phase 0 Golden Cases 尚未冻结

**状态：OPEN / BLOCKING FOR IMPLEMENTATION**

需要在代码开始前先准备代表性案例，包括：

- 正常进步 → NO_CHANGE；
- 数据不足 → COLLECT_MORE_DATA；
- 同数据不同用户 framing → 同诊断；
- 恢复周 → 不误判退步；
- 训练日志识别不确定 → 请求最小补充；
- 饮食照片与用户主观判断冲突；
- 安全危险信号 → ESCALATE。

## 维护模板

```text
GAP-XXX
status
source/evidence
effect
current handling
closure criteria
```

未知必须显式存在。