# 需求追踪矩阵

| Requirement | 设计落点 | 未来验收 |
|---|---|---|
| 训练中零手机依赖 | `product/user-flows.md` | 不要求 set-by-set 手机输入 |
| 复用现成三阶段 XLSX | `product/training-log-template.md`, ADR-005 | supplied-template benchmark |
| 训练后照片录入 | extraction contract | scenario harness |
| 空白 actual 不补齐 | extraction schema | blank-preservation case |
| load 多态语义 | template + observation schema | semantic classification cases |
| reps/duration 分离 | ProgramSpec + extraction schema | plank regression case |
| strength test 独立处理 | ProgramSpec + extraction schema | Week 4 binding fixture |
| 原始备注不作解释 | Observation schema, ADR-024 | G-LOG-006 |
| 低置信最小确认 | confirmation flow | ambiguous/cropped cases |
| 用户纠错可追溯 | correction records | rebuild case |
| 重复上传不重复计入 | artifact hash/idempotency | duplicate case |
| 体重只作事实记录 | Observation schema, ADR-024 | no-evaluation case |
| Program Engine 确定性 | ProgramSpec | full 12-week fixtures |
| `A/N` 每个动作独立 | Program State | binding fixtures |
| recovery 保持计划身份 | ProgramSpec | recovery fixture |
| unresolved fail closed | validator | invalid fixture |
| Observation canonical | ADR-014 | restart/rebuild tests |
| Personal Data Directory 显式配置 | ADR-012 | missing-config fail closed |
| Runtime 不保存 canonical 用户数据 | ADR-012/020 | path-boundary tests |
| 原件保真、payload 去 metadata | ADR-022 | byte/orientation/metadata tests |
| 用户删除有效 | ADR-020 | external deletion test |
| 无遥测与隐式数据复用 | ADR-023 | package/config inspection |
| 不评价训练表现 | ADR-024 | G-SCOPE-001 |
| 不处理饮食营养 | ADR-024 | G-SCOPE-003 |
| 不处理健康风险 | ADR-024 | G-SCOPE-002 |
| 不保留隐藏监督分支 | ADR-024 | G-SCOPE-004 + code search |
| 软件与内容权利分离 | ADR-018 | package inspection |
| raw Office 文件不入包 | ADR-010/011 | artifact exclusion test |

冻结需求变更时必须同步本矩阵、Golden Cases 和适用 ADR。
