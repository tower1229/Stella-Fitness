# Stella Fitness

Stella Fitness 是把来源训练计划转成确定性执行视图，并把纸质训练记录低摩擦数字化的 OpenClaw Plugin。它记录计划和用户事实，不评价训练表现，不提供训练、营养、医疗或健康风险判断。

## Language

**Program Source**:
训练计划的原始资料及经明确确认的来源解释，只证明计划“原本怎么写”，不构成专业背书。
_Avoid_: 专业计划、权威计划

**ProgramSpec**:
Program Source 的确定性、机器可读表示，保留计划处方、来源解释与未知状态。
_Avoid_: 训练建议、表现评估、风险判断

**Built-in Program**:
随正式发行包分发、安装后无需用户导入即可使用的 ProgramSpec。它必须通过来源忠实性与发行权利门禁，但不代表 Stella Fitness 对计划作专业背书。
_Avoid_: 专业审核计划、监督策略

**Program State**:
用户当前周期、阶段、周次、训练日及每个动作的符号重量绑定等确定性状态。
_Avoid_: Training Progress、训练表现诊断

**Technical Readiness**:
Plugin 对 Personal Data Directory、conversation access、structured media 和 extraction model permission 的独立技术检查结果。它不包含用户的训练前准备进度。
_Avoid_: Program Journey Status、训练适用性检查

**Program Journey Status**:
由 Personal Data Directory 中的 Program Setup、Observation Records 和 Program State 重建的当前开课/阶段状态，只返回一个明确下一步。它与 Technical Readiness 独立。
_Avoid_: Technical Readiness、后台监督状态

**Prerequisite Acknowledgement**:
用户对来源计划所需器材、打印材料或训练记录协议的逐项确认，包含时间、provenance 和稳定幂等键，保存在 Personal Data Directory。它不是健康筛查或训练适用性判断。
_Avoid_: 安全批准、健康档案

**Runtime Directory**:
由 Plugin 自行创建和演进的运行目录，可保存可重建的游标、锁、缓存、任务状态和索引，但不是用户记录的 canonical store。
_Avoid_: Personal Data Directory、训练档案

**Personal Data Directory**:
由用户显式配置的目录，保存用户控制的 canonical 记录，包括原始上传文件、Program State、Observation Records 和处理记录。
_Avoid_: Plugin storage、Runtime Directory

**Personal Data Repository**:
用户用于管理、备份和版本化 Personal Data Directory 的个人仓库形态；Stella Fitness 推荐但不强制绑定某一种仓库工具。
_Avoid_: Plugin database、研发 benchmark

**Observation Record**:
带稳定 ID、发生时间、schema version 和 provenance 的用户事实记录，例如训练 actual 或体重；纠错通过显式关系指向原记录。
_Avoid_: 训练评价、模型诊断、健康判断

**Training Record View**:
由 Observation Records 和 Program State 计算出的可重建事实视图，呈现计划与实际记录但不判断好坏、原因或风险。
_Avoid_: Training Progress、监督结论、表现评分

**Processing Record**:
保存输入处理、字段确认、模型执行元数据与结构化结果引用的记录，不包含训练诊断、健康判断、完整 prompt、自由文本 response 或隐藏推理。
_Avoid_: Analysis Record、健康档案

**Sanitized Media Copy**:
提交给 OpenClaw media runtime 前生成的临时媒体副本；先把方向应用到像素，再移除 EXIF、GPS、设备和软件等无关 metadata。
_Avoid_: raw artifact、长期个人数据
