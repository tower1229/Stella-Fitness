# Phase 0 Review Governance

**状态：Phase 0 governance requirement**

Stella Fitness 的核心风险不是缺少更多文档，而是关键结论没有明确“谁有资格批准”。本文定义进入实施前的 reviewer 角色和签署范围。

## 1. Product Owner Review

负责批准：

- 产品定位；
- 非目标；
- 用户流程；
- offline-first 交互；
- 默认不干预；
- v1 scope；
- Golden Cases 中 Expected / Forbidden 的产品语义；
- 原图保留、数据导出/删除等产品选择。

Product Owner 不单独批准医学/运动科学阈值。

## 2. Domain Review

需要具备与抗阻训练/运动营养相关的专业知识，负责：

- 默认训练监督 policy；
- 哪些 trend 足以形成调整候选；
- 训练量、恢复、负荷、饮食解释是否存在明显专业错误；
- numeric intervention policy 的适用范围和保守程度；
- source program 是否适合作为公共默认方案。

### 不要求 reviewer 做什么

- 不要求背书 OpenClaw 架构；
- 不要求审核 TypeScript；
- 不要求为所有特殊疾病人群设计医疗方案。

## 3. Safety Review

负责：

- `ESCALATE` 类别；
- benign soreness negative cases；
- 不应继续普通 hypertrophy optimization 的红旗场景；
- 特殊人群默认排除边界；
- safety 文案不会错误鼓励继续训练。

对于医疗边界，运动训练专家不能自动替代具有相关临床资质的 reviewer。

## 4. Privacy Review

负责：

- raw image retention；
- provider payload；
- data export/delete；
- provider retention/ZDR profile；
- 日志是否泄露健康/身体数据；
- benchmark dataset 的去身份和使用许可。

## 5. Platform Review

Implementation kickoff 时由熟悉 OpenClaw 当前版本的开发者确认：

- hooks contract；
- conversation permission；
- isolated runtime；
- media structured extraction；
- Cron；
- ClawHub packaging/publish contract。

这是**时效性 review**，不能用 2026-08-08 的 Research Snapshot 永久替代。

## 6. Source / Rights Review

负责：

- 原教程是否有权公开再分发；
- attribution；
- knowledge / ProgramSpec 的可发布范围；
- 第三方营养数据库许可；
- benchmark 图片使用授权；
- 软件许可证。

## 7. Review artifact

每个需要批准的 Policy/Case/Source 应记录：

```text
artifact
version
reviewer_role
reviewer_identity/reference
review_date
scope
status: approved | changes_requested | rejected
notes
```

Phase 0 不规定未来存 YAML、JSON 还是 Git review metadata，但这些字段必须可追溯。

## 8. Approval matrix

| Artifact | Product | Domain | Safety | Privacy | Platform | Rights |
|---|---:|---:|---:|---:|---:|---:|
| `requirements.md` | required | advisory | advisory | advisory | advisory | advisory |
| `golden-cases.md` | required | required for domain cases | required for safety cases | - | - | - |
| numeric intervention policy | required | required | advisory | - | - | - |
| safety escalation policy | advisory | advisory | required | - | - | - |
| v1 applicability | required | required | required for exclusions | - | - | - |
| provider privacy profile | advisory | - | - | required | advisory | - |
| tutorial public distribution | required | advisory | - | - | - | required |
| nutrition DB integration | advisory | required for semantics | - | advisory | - | required |
| OpenClaw compatibility snapshot | - | - | - | advisory | required | - |

## 9. Review failure rule

如果 reviewer 无法确认一个数字或行为：

> 保留 Unknown / conservative fallback，而不是把模型意见当 reviewer approval。

LLM 可以帮助整理证据和生成反例，但不计作外部专业签署者。

## 10. Versioning rule

任何会改变以下行为的批准都必须产生新 policy/case version：

- 何时 ADJUST；
- 何时 ESCALATE；
- 哪类数据足以形成高置信证据；
- 默认适用人群；
- 公开 Program 内容。

## 11. Phase 0 Exit

实施前至少必须完成：

- Product Owner 批准 requirements + Golden Cases；
- Domain reviewer 批准 domain Golden Cases 和首版 numeric policy，或明确 v1 不自动给出该类数值调整；
- Safety reviewer 批准 safety cases；
- Rights decision 明确首个 Program 如何合法进入 public distribution；
- Privacy decision 明确 raw artifact 与 provider data flow。

如果无法获得某项专业审核，可以通过**缩小 v1 能力**关闭风险，而不是降低审核标准。
