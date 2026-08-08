# ClawHub 发布调研

**状态：RESEARCH_BASELINE**  
**checked_at：2026-08-08**

## 1. 目标分发形态

Stella Fitness 未来定位为 **code plugin package**，不是只发布 Skill 文件夹。

OpenClaw 官方 ClawHub 文档当前要求 code plugin package 包含相应 OpenClaw compatibility metadata；Native Plugin 还需要 `openclaw.plugin.json`。

## 2. 当前官方发布检查

发布前应至少：

```text
clawhub package validate <source>
clawhub package publish <source> --family code-plugin --dry-run
```

正式发布还需选择 ClawHub owner。scoped package 的 scope 必须与选择的 owner 匹配，否则发布会被拒绝。

因此当前**不冻结** `@tower1229/stella-fitness` 为正式包名；它只能作为候选，直到实际 ClawHub owner 被确认。

## 3. 未来 package contract

实施/发布阶段需要重新核验并提供：

- package scope/name；
- OpenClaw `pluginApi` compatibility；
- build OpenClaw version；
- Native Plugin manifest；
- source repository / commit provenance；
- README / config / permissions / privacy；
- clean install + upgrade + uninstall 验证；
- dry-run artifact inspection。

## 4. 内容许可与 package 分离

Plugin 代码许可证与训练教程再分发许可是独立问题。

若教程许可无法确认：

- 公开 package 不包含可还原教程全文的知识包；
- 用户本地导入 program；或
- 使用项目有权分发的独立 program。

不得因为教程已经被结构化成 YAML/Markdown 就假定获得再发布权。

## 5. 发布策略

建议首次发布后再考虑 trusted publishing/OIDC；Phase 0 不生成 CI 发布 workflow，也不保存 ClawHub token。

## Sources

- https://docs.openclaw.ai/clawhub/publishing
- https://docs.openclaw.ai/clawhub/quickstart
- https://docs.openclaw.ai/clawhub/cli
- https://docs.openclaw.ai/plugins/manifest