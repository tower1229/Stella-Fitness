# 已知缺口与阻塞项

本文是 Stella Fitness 的未知项登记册。任何 `BLOCKING` / `RELEASE-BLOCKING` 项都不能由 LLM、开发者默认值或“看起来合理”的经验推断悄悄关闭。

## GAP-001：第 4 周周五训练内容

**状态：CLOSED / SOURCE RECONCILED**

原课程配套三阶段 XLSX 与用户课程背景确认已经补齐正式内容：

```text
第4周，周五，力量测试
高脚杯深蹲：12RM 测试重量
哑铃卧推：12RM 测试重量
哑铃硬拉：12RM 测试重量
引体向上：第一组最大完成次数
```

已进入 source Markdown 和 `program-spec.v0.2.yaml`。

## GAP-002：教程版权与再发布许可未知

**状态：OPEN / RELEASE-BLOCKING**

已确认资料可用于本项目需求和来源整理，但尚未确认教程全文/等价 Markdown 可公开再分发。

关闭条件：明确权利来源、署名和许可范围；否则采用本地导入或不捆绑受限内容的发布方式。

## GAP-003：教程本身存在来源不确定性

**状态：OPEN / CONTENT-REVIEW REQUIRED**

教程末尾注明“部分内容可能由 AI 生成”。`knowledge/` 表示来源忠实，不等于专业背书。

## GAP-004：饮食目标没有连续计算公式

**状态：PARTIALLY RESOLVED / SOURCE-FIDELITY LIMITATION**

保留 65/70 kg 示例，不自行发明线性公式，也不默认推广到所有人群。

## GAP-005：生产干预数值阈值尚未审定

**状态：PARTIALLY RESOLVED / BLOCKING FOR PRODUCTION SUPERVISION**

已有领域原则研究基线，但 plateau 窗口、体重采样频率、diet coverage、具体加热量/训练量幅度等仍需专业审核和版本化 Policy。

## GAP-006：健康安全与适用人群边界

**状态：PARTIALLY RESOLVED**

v1 默认仅面向健康成年人 18+ 的一般增肌监督；危险症状优先 `ESCALATE`。特殊疾病、孕期、未成年人、康复等不进入默认普通 Policy。

## GAP-007：食物照片无法提供可靠精确宏量营养素

**状态：KNOWN LIMITATION / DESIGN CONSTRAINT**

photo-only 只形成估算区间与低/中置信证据，不能单独触发高置信饮食调整。

## GAP-008：中国本地营养数据库的数字访问与许可

**状态：OPEN / QUALITY-BLOCKING FOR STRONG CHINESE-FOOD SUPPORT**

《中国食物成分表》是优先候选，但数字访问/API/再分发许可尚未确认。USDA FoodData Central 作为开放 fallback。

## GAP-009：最终模型组合未确定

**状态：OPEN / IMPLEMENTATION-TIME BENCHMARK**

只冻结模型角色契约，不冻结厂商。默认模型必须通过 Stella Fitness 自有 Benchmark/Eval。

## GAP-010：Provider 数据保留策略需部署时确认

**状态：OPEN / PRIVACY REVIEW**

生产前按最终 Provider/endpoint 重新核验数据用途、保留、ZDR、region 和图片传输策略。

## GAP-011：ClawHub owner / package scope 未确认

**状态：OPEN / RELEASE-BLOCKING**

首次发布前再冻结实际 owner/scope。

## GAP-012：软件许可证未选择

**状态：OPEN / RELEASE-BLOCKING**

代码许可证与教程内容许可是独立问题。

## GAP-013：Golden Cases 已起草但尚未 reviewer approval

**状态：OPEN / BLOCKING FOR IMPLEMENTATION**

关闭条件：Product / Domain / Safety reviewer 审核并标记 `FROZEN v0.1`。

## GAP-014：真实训练日志与饮食图片 Benchmark 尚未准备

**状态：PARTIALLY RESOLVED / BLOCKING BEFORE MODEL SELECTION**

训练日志固定模板已确定，专项 Benchmark 规范已建立；仍缺真实手写照片、噪声场景和人工 ground truth。饮食 benchmark 同样尚缺真实 artifacts。

## GAP-015：原始图片默认保留策略未冻结

**状态：OPEN / PRIVACY DECISION**

需要确定默认保留到何时、可配置期限和 opt-in 永久保存规则。

## GAP-016：外部专业审核机制尚未完成

**状态：PARTIALLY RESOLVED / BLOCKING FOR CLAIMING PROFESSIONAL SUPERVISION**

Product / Domain / Safety / Privacy / Platform / Rights reviewer 的职责和签署机制已经定义，但默认 Program、nutrition policy、safety policy 的实际专业审核者和首次签署仍未完成。

## GAP-017：训练日志 XLSX 公开再发布权限

**状态：PARTIALLY RESOLVED / RELEASE-BLOCKING FOR BUNDLING TEMPLATE**

已确认：

- XLSX 为原课程可靠同源配套资料；
- 可作为 Stella Fitness v1 的训练日志模板；
- 可作为第 4 周周五处方来源。

仍未确认：原始 XLSX 二进制是否允许随 public GitHub / ClawHub artifact 再分发。

在确认前，不提交 raw XLSX 到公开仓库。

## GAP-018：训练计划关系语义

**状态：CLOSED / USER-CONFIRMED SOURCE INTERPRETATION**

Q1–Q6 已由用户基于原课程背景一次性确认：

1. `A` 是三个主项各自的初始 12RM；
2. 第 4 周周五三个主项新 12RM 分别直接成为第二阶段对应动作的 `N`；
3. 引体向上第一组最大次数用于辅助带选择，尽量让每组能完成 8 次以上，同时保持计划总次数；
4. 第 4 周使用与完整周期结束相同的 12RM 测试协议；
5. “哑铃推举”和“哑铃推肩”是同一动作，统一为哑铃推肩；第三个月新增“哑铃弯举”，不得混淆；
6. 第一阶段以详细逐周处方为准；“两周加重一次”只作为长期一般节奏概括，第一个月属于特殊阶段。

已同步到：

- `knowledge/programs/zhuoshu-12-week/rules.md`；
- `cycle.md`；
- Phase 2 / Phase 3 Markdown；
- `open-questions.md`（现作为确认记录）；
- `program-spec.v0.2.yaml`；
- `docs/program-spec.md`。

目前**没有新的已知训练计划语义问题需要用户确认**。后续发现新冲突时继续采用“集中提问、不自行猜测”原则。

## 已关闭的 Phase 0 设计问题

- 默认适用范围：健康成年人 18+、一般增肌监督、非医疗/康复；
- Offline-first：使用原课程配套三阶段 XLSX → 打印 → 纸笔 actuals → 训练后拍照；
- 第 4 周周五：力量测试；
- `A / N / 12RM` 的关键绑定关系；
- 哑铃推肩/哑铃弯举命名边界；
- 第一阶段详细逐周计划的优先级；
- Safety：必须存在结构化 red flags 和 `ESCALATE` 优先路径。

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
