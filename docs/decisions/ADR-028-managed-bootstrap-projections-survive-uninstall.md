# ADR-028：受管 bootstrap 投影在 Plugin 卸载后继续存在

Stella Fitness 通过公开 Agent files 能力将主 Stella 的 `IDENTITY.md`、`SOUL.md` 和协议允许的 `USER.md` 内容筛选为 Fitness 自己的 bootstrap 文件。生成内容只占 ownership metadata 标识的 managed sections，用户区域保持可编辑；普通 Agent 文件操作不得修改 managed sections，managed section 被手工修改或 ownership 丢失时停止覆盖并要求用户选择。

卸载 Plugin 不删除 `SOUL.md` 等 Managed Agent Artifacts，以免破坏独立 Fitness Agent。卸载流程保留人格、用户内容和历史投影，只把实时记录与 Current Fitness State 能力转换为明确的 standalone degraded 状态，并保留最后验证的 `as-of` 信息。

已有 `fitness` workspace 缺少 Stella Fitness ownership manifest 时，初始化只生成 adoption plan，必须由用户明确选择合并 managed sections、改用其他 Agent ID 或跳过。升级先验证旧 ownership 与来源，构建完整迁移候选后原子切换，失败保留旧制品；disable 只暂停 Plugin 并在重新 enable 时检查 freshness，uninstall 才执行 standalone-degraded 转换。
