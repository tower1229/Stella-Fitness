# Sources

本目录登记 Stella Fitness 的外部依赖资料、研究依据与来源治理信息。

## 两类 source

### 1. Program source

用户提供的训练教程属于产品知识来源。它决定 `knowledge/` 中“原计划写了什么”，但不自动成为科学/医学权威。

目前 program source：

- 《卓叔增重 · 结构化增肌增重教程》

完整性与许可问题见：

- `knowledge/programs/zhuoshu-12-week/source-audit.md`
- `docs/known-gaps.md`

原始 DOCX 不应仅因为开发方便就公开提交；是否可以再分发取决于许可确认。

### 2. Research source

OpenClaw、模型 Provider、运动科学、营养识别、隐私与安全研究登记在 [source-register.md](./source-register.md)。

## 来源治理规则

1. 平台/价格/模型属于易变事实，记录检查日期；
2. 实施开始和正式发布前重新核验；
3. 技术平台优先官方文档；
4. 模型信息优先厂商官方文档；
5. 运动/营养结论优先 position stand、系统综述、meta-analysis、同行评议论文；
6. `knowledge/` 不通过 research source 静默改写；
7. 不确定或冲突的资料进入 `known-gaps.md`。