# Source Material Handling

本目录用于记录 Stella Fitness 训练计划的来源治理，不默认存放第三方原始内容。

## 当前教程来源

开发期使用的首个训练计划来源为：

```text
《卓叔增重 · 结构化增肌增重教程》
```

该材料由项目发起者提供给开发流程，用于需求分析、结构化和 ProgramSpec 设计。

## 为什么仓库中不提交原始 DOCX

当前尚未确认该教程的版权归属与公开再发布许可。

因此在许可明确前：

- 不把原始 DOCX 提交到公开仓库；
- 不把原始 DOCX 打入 npm / ClawHub 包；
- `package.json#files` 也暂不包含 `knowledge/`；
- `knowledge/` 中的开发期结构化资料不得被解释为已经完成公开再发布授权。

相关阻塞项见：

- [docs/known-gaps.md](../docs/known-gaps.md)
- [knowledge/programs/zhuoshu-12-week/source-audit.md](../knowledge/programs/zhuoshu-12-week/source-audit.md)

## 后续可能的发布策略

### 策略 A：获得再发布许可

确认可以公开分发后：

- 补充来源、署名和许可证信息；
- 完成人工内容审核；
- 决定是否把 canonical ProgramSpec / Markdown 计划作为内置资源随 Plugin 发布。

### 策略 B：Program 与 Plugin 解耦

如果教程不能公开再发布：

```text
Stella Fitness Plugin
        +
user-local program package
```

Plugin 只提供通用监督引擎与 ProgramSpec 协议，训练计划由用户本地导入或使用另外获得许可的 program package。

这也是项目架构不与某一份教程强耦合的原因之一。
