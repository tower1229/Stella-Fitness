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

scoped package 的 scope 必须与选择的 owner 匹配，否则发布会被拒绝。

项目已冻结 canonical identity：

```text
owner: tower1229
package: @tower1229/stella-fitness
source: tower1229/Stella-Fitness
```

这是产品与发布治理决策，不替代实时权限验证。首次发布前仍需以 `clawhub whoami`、package validate 和 publish dry-run 证明当前账号能够以该 owner 发布；失败时不得静默换名。

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

软件层已选择 Apache-2.0，覆盖 Plugin 代码、通用 schema 与非课程派生的项目原创材料。根目录 `NOTICE` 明确排除课程原件、卓叔派生 Built-in Program 和用户 Personal Data Directory；Apache-2.0 的采用不构成这些内容的授权。

v1 已决定采用保守发行边界：

- 卓叔计划将作为 v1 `Built-in Program` 直接随包提供；
- package 包含运行时 ProgramSpec、必要结构化知识、固定 digest 的原始训练日志 XLSX 及权利声明；
- 原始 DOCX 不进入安装包；训练日志 XLSX 仅允许从白名单路径按原始字节复制；
- 发布前必须取得覆盖实际制品、版本、渠道、修改和署名要求的可核验授权；
- 专业签署和 Rights Review 都是发布 gate。
- package 必须携带标准 `LICENSE`、`NOTICE` 及 Built-in Program 的独立 rights notice。

不得因为教程已经被结构化成 YAML/Markdown 就假定获得再发布权。自动化 package inspection 必须拒绝未授权来源内容，并验证允许分发的内置 XLSX 路径与 digest。

## 5. 发布策略

首次发布采用手工/token-authenticated 流程；成功建立 package 后再考虑 trusted publishing/OIDC。Phase 0 不生成 CI 发布 workflow，也不保存 ClawHub token。

## Sources

- https://docs.openclaw.ai/clawhub/publishing
- https://docs.openclaw.ai/clawhub/quickstart
- https://docs.openclaw.ai/clawhub/cli
- https://docs.openclaw.ai/plugins/manifest
