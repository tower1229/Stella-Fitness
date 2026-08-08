# V1 Applicability Boundary

**状态：Phase 0 product scope**

Stella Fitness 首版不尝试服务“所有想健身的人”。为了让监督策略可验证，v1 默认适用范围应明确收窄。

## 1. Default target population

v1 默认面向：

> **18 岁及以上、没有已知需要医疗个体化运动限制的成年人，正在执行已支持的增肌/抗阻训练计划，并希望获得长期执行监督。**

这与 2026 ACSM resistance-training Position Stand 的主要证据对象（healthy adults ≥18）更一致。

## 2. Supported intent

v1 主要目标：

- 增肌 / hypertrophy；
- 训练计划执行监督；
- 体重与力量趋势观察；
- 非临床级饮食证据辅助；
- 数据不足时提醒；
- 明显异常时停止普通优化并升级。

## 3. Not default-supported in v1

以下情况不能默认套用同一 Policy：

- <18 岁；
- pregnancy / postpartum 特殊训练阶段；
- known cardiovascular disease requiring clinician guidance；
- significant kidney disease；
- active eating disorder or medically supervised weight restoration；
- post-operative rehabilitation；
- acute injury rehabilitation；
- clinician-prescribed exercise restrictions；
- 任何用户已经被医生要求限制负荷/动作/心率的情况。

这不表示这些人不能做抗阻训练，而是表示 **Stella Fitness 当前普通监督 Policy 没有资格替代个体医疗/康复方案**。

## 4. Source program applicability

首个教程的饮食示例明确以 65kg / 70kg 男生为例。

因此：

- 不得把 65/70kg 模板自动外推为女性/任意体重的医学营养处方；
- “不同体重按比例调整”在没有严格公式时不能由代码擅自线性外推；
- ProgramSpec 可以保留原教程饮食 reference，但 nutrition supervision 应使用独立 evidence/policy 层。

## 5. Onboarding requirement

未来首次启用监督时，只需要收集会改变安全/解释边界的最低信息，而不是建立复杂健康问诊。

建议至少确认：

```text
age >= 18?
using supported program?
known clinician exercise restriction?
currently in rehabilitation / acute injury?
```

如果用户主动披露会显著改变安全边界的健康情况，应进入更保守 scope，而不是让聊天模型自己决定“应该没问题”。

## 6. No hidden demographic assumptions

系统不能仅因为：

- 用户名字；
- 照片外观；
- 训练重量；
- 教程示例；

推断 sex、疾病状态或其他敏感健康属性。

如果某个 policy 确实需要该信息，应显式询问，并解释用途。

## 7. Expansion policy

未来若支持特殊人群，应使用独立 policy/version，例如：

```text
healthy-adult-hypertrophy/v1
pregnancy-rt/...           // only after dedicated evidence/review
rehab/...                  // not generic hypertrophy policy
```

不能通过在 Prompt 中加一句“对孕妇谨慎一些”就声称扩展适用范围。

## 8. Research basis

- ACSM 2026 Position Stand 的纳入标准以健康成年人（≥18 岁）抗阻训练研究为主：
  https://pubmed.ncbi.nlm.nih.gov/41843416/
- ACSM / multi-organization PPE resources强调运动参与的健康与医学资格需要在特定情况下单独评估：
  https://acsm.org/education-resources/books/preparticipation-physical-evaluation-monograph/

## 9. Phase 0 decision

v1 默认 scope 冻结为：

```text
healthy adults, age >= 18,
general hypertrophy supervision,
not medical / rehabilitation care
```

特殊人群支持属于未来显式扩展，不属于 v1 默认能力。
