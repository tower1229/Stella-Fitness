# Stella Fitness

Stella Fitness 是面向健康成年人的增肌训练监督产品。它把来源计划、机器可执行计划与监督决策严格分层，避免把来源忠实误写成专业背书。

## Language

**Program Source**:
训练计划的原始资料及经明确确认的来源解释，只证明计划“原本怎么写”，不证明其专业正确性。
_Avoid_: 专业计划、权威计划

**ProgramSpec**:
Program Source 的确定性、机器可读表示，保留计划处方、来源解释与未知状态。
_Avoid_: Supervision Policy、模型建议

**Default Program**:
随 v1 内置并作为默认方案提供给用户的 ProgramSpec；必须通过规定范围的独立 Domain Review。
_Avoid_: 来源样例、未审核计划

**Default Program Candidate**:
以成为 Default Program 为目标、并作为开发与验收主测试计划的 ProgramSpec；尚未通过发布权利和专业审核 gate 时不得称为 Default Program。
_Avoid_: Default Program、普通测试样例

**Built-in Program**:
随正式发行包分发、安装后无需用户导入即可使用的 Program。卓叔 12 周计划是 v1 预定的 Built-in Program，但发布仍以专业签署和可核验分发授权为前提。
_Avoid_: 本地导入计划、源码归档

**Supervision Policy**:
根据用户证据决定 `NO_CHANGE`、`OBSERVE`、`COLLECT_MORE_DATA`、`ADJUST_*` 或 `ESCALATE` 的版本化规则，与 ProgramSpec 中的原计划处方分离。
_Avoid_: Program rule、模型临场建议

**Runtime Directory**:
由 Plugin 自行创建和演进的运行目录，可跨重启保存可重建的运行状态、游标、锁、缓存、任务状态和索引，但不是训练进度或其他个人数据的 canonical store。
_Avoid_: Personal Data Directory、健康档案

**Personal Data Directory**:
由用户显式配置的目录，保存关于用户的 canonical 记录，包括原始上传文件、训练进度、健康档案、observations、分析结果、决策和披露记录。
_Avoid_: Plugin storage、Runtime Directory

**Personal Data Repository**:
用户用于管理、备份和版本化 Personal Data Directory 的个人仓库形态；Stella Fitness 推荐但不强制绑定某一种仓库工具。
_Avoid_: Plugin database、研发 benchmark

**Observation Record**:
带稳定 ID、发生时间、schema version 和 provenance 的用户事实记录，例如训练 actual、体重、饮食或主观反馈；纠错通过显式关系指向原记录。
_Avoid_: Progress snapshot、派生指标

**Training Progress**:
由 Observation Records 和当前 Program state 计算出的可重建视图，可生成便于阅读的 snapshot，但不是独立事实源。
_Avoid_: 单一可变进度文件、canonical observation

**Analysis Record**:
保存在 Personal Data Directory 中的结构化模型分析与审计记录，包含 evidence 引用、结果、版本和 OpenClaw 实际返回的可用执行元数据，但默认不包含完整 prompt、自由文本 response 或隐藏推理。
_Avoid_: Provider 原始日志、Runtime debug dump

**Sanitized Media Copy**:
提交给 OpenClaw media runtime 前生成的临时媒体副本；先把方向应用到像素，再移除 EXIF、GPS、设备和软件等无关 metadata。它只存在于 Runtime Directory 的最小处理窗口，不替代 Personal Data Directory 中按原字节保存的上传原件。
_Avoid_: raw artifact、长期个人数据
