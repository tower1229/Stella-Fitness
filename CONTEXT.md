# Stella Fitness

Stella Fitness 是把来源训练计划转成确定性执行视图，并把纸质训练记录低摩擦数字化的 OpenClaw Plugin。它记录计划和用户事实，不评价训练表现，不提供训练、营养、医疗或健康风险判断。

## Language

**Stella Fitness Agent**:
技术上独立、长期存在的 Stella 健身领域 Agent，拥有自己的会话和记忆边界，但通过筛选投影延续 Stella 的基础人格与用户背景。它不与主 Stella 自动委派或移交会话。
_Avoid_: 独立人格、临时 Subagent、空白 Agent

**Fitness Principal**:
唯一使用某个 Stella Fitness Agent 与其 Personal Data Repository 的用户主体；Stella Fitness 是只对该用户开放的私人部署，不设计多用户或群组数据隔离。
_Avoid_: 多用户 Agent、群组 Agent、共享账户

**Explicit Fitness Entry**:
用户通过选择 Stella Fitness Agent、固定 Channel binding 或明确的 Agent 切换命令进入健身领域；仅在普通消息中提及健身不构成进入。
_Avoid_: 关键词路由、隐式委派

**Canonical Fitness Fact**:
经确定性解析和必要确认后进入 Personal Data Repository 的权威健身事实；它可以生成记忆投影，但不从自由对话记忆反向推定。
_Avoid_: 对话印象、模型推断、未确认训练记录

**Conversational Fitness Memory**:
Stella Fitness Agent 范围内可跨其 WebChat、Telegram 等 sessions 检索的非权威对话和摘要；OpenClaw 负责让当前用户输入优先于历史记忆，Plugin 不另建通用记忆排序。对话内容不自动同步到 Personal Data Repository，其中的训练信息只有转化为 Canonical Fitness Fact 后才可作为正式记录。
_Avoid_: Observation Record、权威训练档案

**Base Stella Context Projection**:
通过与 Stella 约定的内容读取协议，从指定个人数据层级生成的最小只读投影，只包含基础人格、稳定用户偏好和健身相关背景，并保留可追溯来源。其内容由主 Stella 修正，Stella Fitness Agent 只消费同步结果。
_Avoid_: 完整个人数据副本、原始聊天全文、模型用户画像

**Fitness Context Projection**:
从 Canonical Fitness Facts 重建的 Agent 可检索表示，用于召回和自然语言表达，但不能作为精确健身事实的回答权威。
_Avoid_: Personal Data Repository、Fitness 数据库、权威进度缓存

**Projection Builder**:
受信任的本地边界，通过 Fitness Context Read Contract 读取指定个人数据层级，并按 allowlist 生成带来源引用的 Base Stella Context Projection 和 Fitness Context Projection；它不扫描整个仓库，Stella Fitness Agent 也不能越过它读取其他层级。
_Avoid_: 全库扫描、Agent 数仓访问、无来源人格生成器

**Projection Publisher**:
只在 Stella Fitness 内串行运行的发布边界，从完整候选原子替换 managed projections；它不降低其他 OpenClaw Agent 的并发，也不允许半迁移状态可见。
_Avoid_: Gateway 全局串行、并发文件改写

**Fitness Context Read Contract**:
由 Stella Runtime 拥有、Stella Fitness 消费的版本化只读内容协议，限定 Fitness 可访问的个人数据层级、内容类别、来源标识和变更语义；当前 experimental adapter 和未来正式 Provider 必须保持相同消费语义。
_Avoid_: 仓库遍历、路径猜测、共享全部记忆

**Fitness Data Ownership**:
Stella Fitness 对 Program State、Fitness Observation 及其确认和纠错关系拥有写权限；基础人格、通用用户背景、长期偏好和其他领域数据由主 Stella 管理，Fitness 只读。
_Avoid_: 健身关键词所有权、Fitness 用户画像

**Agent Identity Projection**:
Stella Fitness Agent 的小型稳定身份上下文，从主 Stella 的 IDENTITY、SOUL 和允许的 USER 内容筛选生成，包含 Stella 基础身份、交流方式和 Fitness 领域边界；可变用户背景和训练事实不进入该投影。
_Avoid_: 完整用户画像、Current Fitness State、无限 system prompt

**Managed Agent Artifact**:
由 Stella Fitness 通过 ownership metadata 和 managed section 幂等维护的 Agent 文件或配置；普通 Agent 文件操作不能修改 managed sections，用户内容位于独立区域，冲突时停止覆盖。卸载保留全部制品，但把实时 Plugin 能力转换为明确的 standalone degraded 状态。
_Avoid_: 可随意删除的缓存、整个 Agent workspace

**Projection Freshness**:
Context Projection 相对于来源数据的同步状态；过期投影可以继续提供非权威背景，但不得回答精确健身事实。
_Avoid_: Canonical 数据状态、训练完成度

**Projection Provenance**:
投影的可复现来源信息，包括来源引用与 checksum、Provider/model、schema/prompt 版本、生成时间、输入类别和输出 checksum，不保存隐藏推理。
_Avoid_: 模型推理记录、无来源摘要

**Context Sync State**:
Context Projection 的用户可见生命周期状态，区分 uninitialized、ready、degraded、stale、conflicted 和 standalone-degraded；技术状态码只在诊断入口展示。
_Avoid_: Program Journey Status、Technical Readiness、单一就绪标志

**Pending Identity Update**:
主 Stella 的名称、核心人格或价值边界发生实质变化后，等待用户确认的新 Agent Identity Projection；确认前继续使用最后验证身份并明确存在待更新版本。
_Avoid_: 静默人格替换、普通措辞同步

**Degraded Fitness Context**:
基础用户上下文不可用但 Agent Identity Projection 与确定性 Fitness 能力仍可工作的状态；只在首次进入、状态变化或回答依赖缺失上下文时提示用户。
_Avoid_: 空白 Agent、完全不可用、静默失忆

**Fitness Identity Readiness**:
主 Stella 的有效 IDENTITY 和 SOUL 来源以及所需公开 Agent files/bootstrap 能力可用于生成 Agent Identity Projection 的状态；任一身份核心缺失、空白、无法验证或公开能力不可用时不得创建投影，USER 或可检索背景能力缺失只降低上下文完整性。
_Avoid_: Technical Readiness、用户背景完整度

**Projection Conflict**:
多个带来源的投影陈述对同一用户背景给出不一致内容的状态；冲突陈述保持可区分，不由 Projection Builder 合并成单一事实。
_Avoid_: 自动事实裁决、最新值覆盖

**Projection Retraction**:
来源从 Personal Data Repository 删除后，撤销对应 managed projection 和检索来源；它不删除已经形成的独立会话历史。
_Avoid_: 全局遗忘、会话销毁

**Current Fitness State**:
由唯一 Active Program Context 的 Program State、Program Journey Status 和 Training Record View 实时组成的当前健身事实，包括当前周期与阶段、按 Fitness Principal 时区截至当前应进行和已记录的训练、待确认内容、最近记录及下一步。
_Avoid_: 训练表现、效果评价、记忆摘要

**Active Program Context**:
唯一明确标记为 active 的 Program 及其周期身份；没有 active 时进入 Program Journey，多个 active 时视为数据冲突且不生成 Current Fitness State。
_Avoid_: 最近修改的计划、合并计划、模型选择

**Unrecorded Planned Session**:
截至当前日期尚未找到有效 Observation 的 Planned Session；它只表示没有记录，不证明用户没有训练。
_Avoid_: 未完成训练、训练失败、漏练结论

**Fitness Query Intent**:
把自然表达映射到封闭确定性查询的受约束意图；它只选择查询能力，不生成或修改健身事实。
_Avoid_: 关键词命中、自由回答、训练建议

**Fact-Preserving Reply**:
Stella Fitness Agent 基于只读事实块和自己的身份、当前会话及对话记忆生成的自然语言回答；默认只回答请求所需事实，不得增加事实块之外的训练数字、计划或完成状态，无法保持事实时回退到确定性表达。
_Avoid_: 自由改写、记忆补全

**Fact Promotion**:
把对话中用户明确表达的健身信息转化为 Canonical Fitness Fact 的过程；明确且完整的记录请求可直接保存，存在歧义时必须确认，随口提及不会自动晋升。
_Avoid_: 自动记忆同步、模型推断写入

**Fitness Write Candidate**:
由受约束模型从自然对话中识别出的潜在记录意图和字段；它没有写权限，必须经用户确认后才能进入 Fact Promotion。
_Avoid_: Canonical Fitness Fact、高置信自动写入

**Initialization Disclosure**:
Stella Fitness Agent 首次启用时展示的上下文来源摘要，包括引入与排除类别、同步时间、远程模型授权、readiness、freshness 和查看来源或重新同步的入口。
_Avoid_: 普通回复诊断信息、完整隐私内容展示

**Context Resync**:
通过明确命令或自然表达重新读取允许来源并重建 Context Projection 的用户操作；它返回简洁状态，详细来源保留在诊断入口。
_Avoid_: 每轮全量扫描、canonical 数据重写

**Context Diagnostics**:
用户主动查看的本地技术视图，展示来源、checksum、as-of、排除类别、Provider 授权、ownership 冲突和同步恢复入口；普通回答不暴露这些内部细节。
_Avoid_: 普通对话内容、远程遥测、完整个人数据日志

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
Plugin 对 Personal Data Directory、dedicated-agent conversation access、structured media 和 extraction model permission 的独立技术检查结果。它不包含用户的训练前准备进度。
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
