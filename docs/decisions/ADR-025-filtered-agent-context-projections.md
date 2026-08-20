# ADR-025：独立 Fitness Agent 使用筛选投影而不是共享完整记忆

Stella Fitness 运行在技术上独立、由用户显式进入的 OpenClaw Agent 中，但通过本地 Projection Builder 延续 Stella 的基础人格、必要用户背景和健身上下文。Projection Builder 不扫描整个 Personal Data Repository，而是通过与 Stella 约定的 Fitness Context Read Contract 读取指定数据层级，并只向 Agent 暴露带来源引用的 allowlisted Agent Identity Projection、Base Stella Context Projection 与 Fitness Context Projection；原始聊天、无关私人内容、凭据、无来源画像和隐藏推理不得进入投影。Base Stella Context 的修正仍由主 Stella 写入，Fitness 只消费同步结果。

Context Projection 是可重建、非权威且可能过期的派生物。训练记录、体重、计划状态和当前进度等精确事实必须通过受约束 Fitness Query Intent 实时读取 canonical view；投影同步失败不回滚 canonical 写入，但必须标记 stale，不能让旧记忆冒充当前事实。OpenClaw 原生对话记忆保留在 Fitness Agent 范围内，不自动回流主 Stella 或 Personal Data Repository；只有经过 Fact Promotion 的明确输入才能成为 Canonical Fitness Fact。

首次初始化自动启用投影，但必须展示摘要、来源和排除项并允许用户检查或重建。多个冲突来源分别保留，不由 Projection Builder 预先裁决；来源删除只撤销 managed projection，不删除既有 Fitness 会话历史。Plugin 自己的 canonical 写入后增量刷新，外部修改在 Runtime 事件可用前通过启动 freshness 检查和显式同步入口接入。

Fitness 只写 Program State、Fitness Observation 及其确认和纠错关系；基础人格、通用用户背景和长期偏好仍由主 Stella 管理。用户在 Fitness 中对 Base Context 作出的说明可以进入 Conversational Fitness Memory，但不改写 Base Projection 或 canonical 数据；永久纠正必须由主 Stella 写入后再同步。当前版本先实现带版本的窄 Fitness Context Read Contract 与适配器，未来 Stella Runtime 替换数据 Provider 而不改变 Fitness 消费语义；协议不兼容时使用最后一个已验证兼容来源并标记 `as-of`，没有兼容来源则进入明确的 degraded 模式。

Agent Identity Projection 保持小而稳定，通过受支持的 Agent files 能力从主 Stella 的 `IDENTITY.md`、`SOUL.md` 和协议允许的 `USER.md` 内容筛选生成；主 Agent 的工具、其他领域任务和无关用户内容不进入 Fitness。普通回答只在冲突、stale、用户追问或技术诊断时展示来源；degraded 状态只在首次进入、状态变化或回答确实依赖缺失上下文时提示。Plugin 通过 ownership manifest 和 managed sections 幂等维护自己的 Agent 文件与配置，保留 user-owned sections；卸载不删除任何 Managed Agent Artifact，而是保留人格和历史上下文并将实时能力转换为带最后 `as-of` 的 standalone degraded 状态。

Fitness 不读取主 Agent 的 SQLite/index，也不对主 Agent 执行跨 Agent memory search。主 Stella 的筛选 bootstrap 内容、协议允许的个人背景、Fitness 自己的 Context Projection 和该 Agent 的跨 session 对话记忆共同构成 Fitness 的上下文；OpenClaw 负责当前输入相对历史记忆的正常优先级，Plugin 只阻止历史记忆成为 canonical 写入或覆盖实时 Current Fitness State。

主 Stella bootstrap 文件始终只读，Fitness 只写自己的 workspace managed sections；永久 Base Context 修正必须回到主 Stella。有效 `IDENTITY.md` 与 `SOUL.md` 是创建 Fitness Agent 的身份门禁，缺失、空白或无法验证时停止创建；`USER.md` 缺失只进入明确的用户背景 degraded 状态。首次启用必须展示 Initialization Disclosure，让用户知道 Agent 引入和排除了什么、来源与同步时间、是否发生远程模型外发以及如何查看或重新同步。

Context Sync State 区分 uninitialized、ready、degraded、stale、conflicted 和 standalone-degraded，普通交互使用自然语言，技术状态码只在诊断入口展示。刷新只做有限且可取消的重试；失败后持久标记 stale，由启动 freshness 检查、后续相关 canonical 写入或显式 Context Resync 再次触发，不阻塞已经成功的 canonical 写入。命令和自然表达都可以触发 Resync。

生成后的 bootstrap 与 memory projections 保存在 Fitness Agent workspace 的 managed files/directories，随 workspace 保留但始终可从来源重建；Runtime Directory 只保存锁、任务状态和临时候选。用户拒绝远程摘要授权时继续使用确定性筛选的 bootstrap 内容和结构化 Fitness Projection，并在 Initialization Disclosure 中说明未引入的非结构化背景。

兼容性由 capability preflight 证明，不用版本号或内部路径猜测：缺少公开 Agent files 能力时不创建或更新 Agent Identity Projection；缺少 memory projection 能力时进入对应 degraded 状态，确定性 Fitness core 按自己的能力独立判断。主 Stella 的人格不能扩大 Fitness 的工具、数据或 recording-only 权限，Fitness 领域规则始终优先。

Projection Publisher 只在 Stella Fitness 内使用单实例串行锁，不修改 Gateway 全局 `maxConcurrent`；它从完整候选原子切换 managed projections。主 Stella 身份来源在 Agent 创建后失效时保留最后验证身份并标记 stale/degraded，不生成空白人格；普通来源变化自动同步，名称、核心人格或价值边界的实质变化形成 Pending Identity Update，用户确认前继续使用旧身份。

普通自然语言承担查询与 Context Resync；首次初始化通过 `/stella-start` 展示 Initialization Disclosure，`/stella-status` 汇总 Technical Readiness、Program Journey 和 Context Sync，详细来源与恢复信息进入独立 Context Diagnostics。普通回复不暴露 schema、Observation ID、内部路径或状态码。
