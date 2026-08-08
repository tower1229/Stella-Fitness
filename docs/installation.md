# 安装与配置

> Stella Fitness 当前尚未发布稳定版本。本文件先冻结目标安装体验与所需权限，实际 ClawHub 包发布后再补充最终命令与版本号。

## 1. 目标安装方式

ClawHub 包名暂定：

```text
@tower1229/stella-fitness
```

首次公开发布前必须确认 ClawHub owner / package scope。

目标安装命令：

```bash
openclaw plugins install clawhub:@tower1229/stella-fitness
```

开发期本地包测试应先：

```bash
npm run build
npm pack
```

再使用 OpenClaw 对生成的 npm pack 进行安装测试。

## 2. 为什么需要 conversation access

Stella Fitness 的核心能力要求 Plugin 在普通 Agent 读取完整用户输入前接管监督类 turn，并建立独立的信息披露边界。

因此 non-bundled Plugin 需要用户显式允许 conversation hooks：

```json
{
  "plugins": {
    "entries": {
      "stella-fitness": {
        "hooks": {
          "allowConversationAccess": true
        }
      }
    }
  }
}
```

这项权限是产品能力的一部分，不能通过隐藏实现绕过。

## 3. 推荐专用 Agent

Stella Fitness Plugin 设计为可独立安装，不依赖用户拥有名为 Stella 的私人 Agent。

推荐用户为健身监督建立一个独立 OpenClaw Agent，例如：

```text
fitness
```

然后通过 Plugin 的 `agentIds` 配置限制作用范围：

```json
{
  "plugins": {
    "entries": {
      "stella-fitness": {
        "config": {
          "agentIds": ["fitness"]
        }
      }
    }
  }
}
```

具体 OpenClaw 配置字段会在实际加载测试后按官方 Schema 再核对一次。

## 4. 模型配置

当前质量优先推荐组合见 [model-strategy.md](./model-strategy.md)：

```text
Training log extractor → Gemini 3.6 Flash
Diet extractor         → Gemini 3.6 Flash
Belief extractor       → Gemini 3.5 Flash-Lite
Blind diagnostician    → GPT-5.6 Sol
Adversarial auditor    → Claude Sonnet 5
Reporter               → Template first
```

Plugin manifest 允许分别配置这些角色。

示意：

```json
{
  "plugins": {
    "entries": {
      "stella-fitness": {
        "config": {
          "models": {
            "trainingLogExtractor": "google/gemini-3.6-flash",
            "dietExtractor": "google/gemini-3.6-flash",
            "beliefExtractor": "google/gemini-3.5-flash-lite",
            "diagnostician": "openai/gpt-5.6-sol",
            "auditor": "anthropic/claude-sonnet-5"
          }
        }
      }
    }
  }
}
```

> 上述配置格式在 Plugin runtime 真正接线时还需要以锁定 OpenClaw 版本做加载测试；当前用途是冻结产品需要哪些角色配置。

## 5. 模型 override 权限

Stella Fitness 内部需要为不同角色选择不同模型。OpenClaw 要求 operator 对 Plugin model override 显式授权。

部署时需要同步配置并核对：

```text
plugins.entries.stella-fitness.llm.allowModelOverride
plugins.entries.stella-fitness.llm.allowedModels
plugins.entries.stella-fitness.llm.allowedCompletionModels
```

如果 Plugin 配置指定了某模型但 host 没有授权，Stella Fitness 应报出配置错误并停止对应监督步骤，不得偷偷退回普通聊天 Agent 的当前模型。

## 6. Provider 凭据

用户只需要配置自己实际启用的 provider。

质量优先三供应商组合需要：

- Google provider；
- OpenAI provider；
- Anthropic provider。

如果用户希望减少外部供应商，可切换为经过 Eval 的简化组合，但仍必须保持每个步骤的上下文隔离。

## 7. 数据目录

Plugin 支持可选：

```text
dataDir
```

用于存放 Stella Fitness 自主管理的：

- SQLite 数据库；
- 原始训练日志图片；
- 饮食图片；
- 其他必要 artifact。

若用户没有指定，最终版本会使用 OpenClaw-scoped 的默认 Plugin 数据目录。

### 备份原则

备份至少需要覆盖：

```text
SQLite database
raw artifacts
plugin config（不包含需要单独保护的 provider secrets）
```

最终 release 前会补充确定的数据目录和恢复流程。

## 8. 训练计划

当前仓库开发使用《卓叔增重 · 结构化增肌增重教程》的结构化 ProgramSpec 草案。

由于：

1. 第 4 周周五源资料缺失；
2. 教程公开再分发许可尚未确认；

当前 npm / ClawHub package **不会自动包含 `knowledge/` 目录**。

最终发布策略可能是：

- 获得许可后随 Plugin 分发内置 plan；或
- Plugin 与 program package 分离，用户本地导入计划。

## 9. 当前不可用能力

在 v0.0.0-development 阶段：

- hooks 仍为 pass-through；
- 不会实际接管监督对话；
- 不会调用诊断模型；
- ProgramSpec 尚未标记 canonical；
- 不应作为真实训练调整工具使用。

本阶段仓库的目的，是先把需求、数据边界和可验证架构冻结正确。
