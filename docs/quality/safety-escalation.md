# Safety Escalation Baseline

**research snapshot：2026-08-08**

Stella Fitness 是训练监督系统，不是医疗诊断系统。安全策略的职责不是判断用户“得了什么病”，而是识别**不应该继续由增肌监督逻辑处理**的输入，并停止训练/饮食优化建议。

## 1. Product behavior

一旦命中明确 safety red flag：

```text
normal hypertrophy reasoning
        ↓ STOP
ESCALATE
        ↓
plain-language safety message
```

必须禁止继续：

- 加重量；
- 加组数；
- 继续力竭；
- “忍一下完成今天计划”；
- 用补充碳水/水分等普通训练建议解释危险症状。

`ESCALATE` 不等于诊断某种疾病。

## 2. Immediate high-priority red flags

### Cardiovascular / exertional

可靠公共健康来源建议，运动中出现以下情况应停止活动并获得医疗评估：

- chest pain / pressure / squeezing / unusual chest discomfort；
- fainting / loss of consciousness；
- near-syncope、明显 lightheadedness/dizziness；
- unusual or extreme shortness of breath；
- fast/irregular heartbeat **伴随**胸痛、呼吸困难、头晕或接近晕厥等异常症状。

Stella Fitness 不需要判断具体心血管原因；命中即停止普通监督路径。

### Severe acute injury

以下情况应退出增肌优化：

- severe pain；
- suspected fracture；
- joint appears out of position；
- 明显严重出血；
- popping sound 后立即失去关节/肢体正常使用能力；
- sudden numbness/tingling with functional loss；
- injury 后无法正常移动相关肢体。

### Possible rhabdomyolysis pattern

CDC/NIOSH 提醒的典型警示包括：

- muscle pain/cramps 明显超过预期；
- dark tea/cola-colored urine；
- marked weakness/tiredness or exercise intolerance。

这些症状不能被 Stella Fitness 归类成普通训练酸痛。命中明显 pattern 时应 `ESCALATE`。

## 3. Emergency vs prompt medical review

产品文案可以区分严重程度，但 Stella Fitness 不应建立复杂远程 triage。

### Emergency-style wording

适用于明显严重、急性的情况，例如：

- 持续/明显胸痛或胸部压迫，尤其伴呼吸困难、冷汗、恶心、晕厥等；
- loss of consciousness；
- 严重呼吸困难；
- 明显严重创伤或大出血；
- acute neurologic loss of function。

输出应建议立即寻求当地紧急医疗帮助。

### Prompt medical evaluation wording

适用于：

- 新出现或反复的异常运动相关胸部不适；
- 运动相关头晕/接近晕厥；
- 异常心悸伴其他症状；
- severe-than-expected muscle pain / dark urine / marked weakness；
- 急性伤痛、肿胀、麻木等不适但未表现为立即危及生命。

## 4. Ordinary training discomfort is not automatically emergency

为了防止过度医疗化，也需要 negative cases。

以下单独出现时不能自动判断为紧急情况：

- 常见延迟性肌肉酸痛；
- 正常训练后的局部疲劳；
- 在计划内高强度训练后的短暂气喘，随后按预期恢复；
- 单次普通 soreness 且无 severe pain / dark urine / neurologic/cardiovascular red flags。

系统可以降低训练建议强度或继续观察，但不能假装做医学诊断。

## 5. Conversation policy

### 用户说“胸口疼，但我今天还差两组”

禁止：

> 降低重量把两组做完。

必须：

> 停止训练监督路径，给出安全升级信息。

### 用户说“腿今天有点酸”

不能仅凭一个模糊描述直接诊断损伤。

可以询问最少必要信息，例如：

- 是普通酸胀还是 sharp/severe pain？
- 是否突然发生？
- 是否影响正常活动？
- 是否有明显肿胀、麻木、异常尿色等？

但如果已经存在明确 red flag，不应通过长问诊延迟升级。

## 6. Safety data separation

Safety flags 可以进入 EvidencePacket，但只应包含最小结构化事实，例如：

```text
flag_type: exertional_chest_discomfort
source: user_statement
timestamp
severity_known: false
```

Blind Diagnostician 不需要看到用户完整医疗聊天史来决定“停止普通增肌优化”。

## 7. Policy Gate requirement

未来 deterministic gate 必须满足：

```text
if criticalSafetyFlag:
    action = ESCALATE
    prohibit ADJUST_TRAINING
    prohibit ADJUST_DIET as primary response
```

Safety precedence 必须高于：

- Program adherence；
- hypertrophy progression；
- 用户希望继续练；
- 用户要求“不要叫我去医院”。

## 8. V1 scope exclusions

依据 [V1 Applicability Boundary](../product/applicability.md) 与 ADR-006，Stella Fitness v1 不对以下用户启用默认 healthy-adult Policy：

- diagnosed cardiovascular disease；
- significant kidney disease；
- pregnancy；
- adolescents；
- active eating disorders；
- post-operative / rehabilitation users；
- users following clinician-directed exercise restrictions。

这些人群需要医疗或专业个体化指导，不适合默认自动监督策略。未来只有在建立独立 evidence、Policy、Golden Cases 与专业审核后，才能作为显式扩展范围支持。

## 9. Eval requirements

Safety Golden Cases 至少同时包含：

- true red flags → `ESCALATE`；
- benign ordinary soreness → 不误报 emergency；
- user pressure to continue → 仍 `ESCALATE`；
- red flag buried inside long fitness message → 能发现；
- red flag with user self-diagnosis (“只是低血糖”) → 不因自我解释降低优先级。

## 10. Current status

Phase 0 已能冻结**安全升级类别和行为优先级**。

不属于 v1、未来扩展时才需冻结：

- 面向所有特殊人群的完整 medical eligibility policy；
- 每一种症状的远程医学分级；
- 国家/地区特定的医疗入口文案。

这些不应阻塞健康成人普通增肌监督的需求设计，但会阻塞声称适用于特殊医疗人群。

## Sources

- American Heart Association, physical activity warning signs: https://www.heart.org/en/health-topics/cardiac-rehab/getting-physically-active/develop-a-physical-activity-plan-for-you
- American Heart Association, heart attack warning signs: https://www.heart.org/en/health-topics/heart-attack/warning-signs-of-a-heart-attack
- AHA exercise-related cardiovascular events summary: https://professional.heart.org/en/science-news/exercise-related-acute-cardiovascular-events-and-potential-deleterious-adaptations/top-things-to-know
- CDC/NIOSH rhabdomyolysis signs: https://www.cdc.gov/niosh/rhabdo/signs-symptoms/index.html
- MedlinePlus exercise injury guidance: https://medlineplus.gov/ency/patientinstructions/000859.htm
