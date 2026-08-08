# Stella Fitness

> Evidence-first hypertrophy supervision for OpenClaw.
>
> **正常训练，低摩擦记录；AI 长期观察，只在有证据时干预。**

Stella Fitness 是一个以 **OpenClaw Native Plugin** 为主体的个人增肌长期监督智能体。

它不试图成为训练过程中不断与你聊天的 AI 私教，也不重新发明一套每日训练计划。用户继续使用成熟训练计划、打印训练表、用纸笔记录；训练后只需上传日志照片，并定期记录体重，饮食则按需上传。Plugin 在后台把这些低摩擦输入转成可追溯证据，长期观察趋势，在确有必要时才给出调整建议。

```text
Human executes
      ↓
Plugin observes
      ↓
Evidence decides
      ↓
Intervene only when warranted
```

## 为什么做这个项目

增肌是一个典型的长期反馈问题：训练计划本身可以很简单，但真正困难的是连续执行、记录、判断停滞原因，以及避免因为短期波动做出错误调整。

通用聊天模型还有另一个问题：它们容易受用户表达方式影响，顺着“我觉得是吃少了”“是不是应该再加训练量”这样的预设结论回答。

Stella Fitness 因此把“客观”做成系统架构，而不是一句 Prompt：

```text
Program Engine + Metrics Engine
            ↓
       EvidencePacket
            ↓
     Blind Diagnosis        ← 看不到用户观点
            ↓
User Belief → Adversarial Audit
            ↓
    Deterministic Policy Gate
            ↓
      FinalDecisionPacket
            ↓
      Template / Reporter
```

**同一份证据，不应该因为用户想听什么而改变核心诊断。**

## 核心设计原则

### Offline-first training

训练过程中不要求操作手机。

首选流程：

```text
打印计划
  ↓
正常训练 + 纸笔记录
  ↓
训练后拍照
  ↓
AI 结构化日志
```

### Low-friction evidence

长期输入只要求尽可能少的数据：

- 训练日志照片；
- 定期体重；
- 可选饮食照片 / 描述；
- 必要时补充一个无法可靠识别的字段。

### Evidence before interpretation

Program Engine 与 Metrics Engine 用确定性代码先回答：

> 原计划是什么？实际发生了什么？趋势是什么？数据够不够？

LLM 不负责重新计算这些事实。

### Anti-sycophancy by information isolation

Blind Diagnostician 的方法签名只接收 `EvidencePacket`，其中没有：

- raw conversation；
- user belief；
- desired action；
- Reporter text。

用户观点只有在第一次诊断冻结后，才进入独立 Auditor。

### Default no intervention

`NO_CHANGE`、`OBSERVE` 和 `COLLECT_MORE_DATA` 都是完整结果。

正常时少打扰，比“每次都给一点建议”更重要。

## 当前状态

**Phase 0 — Foundation / pre-implementation**

已经完成：

- [x] 冻结完整产品需求
- [x] 核对 OpenClaw Plugin hooks / isolated runtime / media / Cron 技术路径
- [x] 将 12 周教程重组为 Markdown 知识包
- [x] 建立 ProgramSpec v0.1 草案
- [x] 建立 OpenClaw Plugin manifest 与 TypeScript package skeleton
- [x] 建立 Program / Evidence / Diagnosis / Audit / Decision 类型边界
- [x] 建立 Plugin-owned SQLite 初始 Schema
- [x] 建立训练日志 / 饮食 / 体重 ingress contracts
- [x] 建立 Evidence whitelist 与 unresolved fail-closed 测试
- [x] 建立 CI
- [x] 冻结多模型职责与候选模型策略

尚未实现：

- [ ] 真正接管 OpenClaw 对话的 supervision pipeline
- [ ] 训练日志图片模型 adapter
- [ ] ProgramSpec validator + 全 12 周 fixtures
- [ ] Metrics Engine 实际算法
- [ ] Blind Diagnostician / Auditor 模型调用
- [ ] Policy Gate 具体干预规则
- [ ] Cron 长期监督
- [ ] ClawHub release

> 当前 `before_agent_reply` / `before_agent_run` hooks **故意保持 pass-through**。这个版本不是可用于真实训练决策的产品版本。

## 初始训练计划

开发阶段使用《卓叔增重 · 结构化增肌增重教程》作为首个 ProgramSpec 来源，包含一个 12 周、三阶段周期：

1. 第 1–4 周：力量积累；
2. 第 5–8 周：高效增肌；
3. 第 9–12 周：全面显壮。

当前存在两个重要发布问题：

1. 源资料 **第 4 周周五明确缺失**，所以 ProgramSpec 保持 `unresolved`，绝不自动推测补齐；
2. 教程公开再分发许可尚未确认，所以 npm / ClawHub package 当前**不包含 `knowledge/`**，原始 DOCX 也不提交到公开仓库。

详见 [已知缺口](docs/known-gaps.md) 与 [来源治理](sources/README.md)。

## 目录结构

```text
.
├── openclaw.plugin.json
├── package.json
├── src/
│   ├── plugin/           # hooks / config / runtime composition
│   ├── ingress/          # training log / diet / weight inputs
│   ├── engines/          # program / metrics / evidence
│   ├── llm/              # blind diagnosis / belief / audit / reporter
│   ├── policy/           # deterministic gate + safety boundary
│   ├── storage/          # Plugin-owned SQLite
│   └── domain/           # stable contracts
├── tests/
│   ├── program/
│   └── information-flow/
├── docs/
├── knowledge/
└── sources/
```

## 文档

### 产品与架构

- [冻结需求](docs/requirements.md)
- [技术架构](docs/architecture.md)
- [ProgramSpec 设计](docs/program-spec.md)
- [模型策略](docs/model-strategy.md)
- [已知缺口](docs/known-gaps.md)
- [文档系统](docs/document-system.md)
- [Roadmap](docs/roadmap.md)

### 开发与安装

- [开发指南](docs/development.md)
- [安装与配置](docs/installation.md)
- [来源材料治理](sources/README.md)

### 训练知识

- [知识目录](knowledge/README.md)
- [12 周计划](knowledge/programs/zhuoshu-12-week/README.md)
- [ProgramSpec v0.1 草案](knowledge/programs/zhuoshu-12-week/program-spec.v0.1.yaml)

## 模型角色

当前质量优先基线：

```text
Training log extraction → Gemini 3.6 Flash
Diet extraction         → Gemini 3.6 Flash
Belief extraction       → Gemini 3.5 Flash-Lite
Blind diagnosis         → GPT-5.6 Sol
Adversarial audit       → Claude Sonnet 5
Reporter                → Template first
```

这些不是不可替换依赖。每个角色独立配置，模型替换必须通过对应 Eval。

详见 [model-strategy.md](docs/model-strategy.md)。

## 开发

要求 Node.js `>=22.22.3`。

```bash
npm install
npm run check
npm run build
npm test
npm run pack:check
```

Stella Fitness 使用编译后的 `dist/index.js` 作为 Plugin runtime entry。

存储首版使用 Node 内置 `node:sqlite`，避免托管 Plugin 安装时对 native npm postinstall 的依赖。

## 发布目标

项目最终计划作为独立 OpenClaw Plugin 发布到 **ClawHub**。

暂定 package：

```text
@tower1229/stella-fitness
```

这是 provisional 名称；首次 release 前还需要验证 ClawHub owner / scope。

目标安装体验：

```bash
openclaw plugins install clawhub:@tower1229/stella-fitness
```

公开发布前还必须解决：

- 软件 LICENSE；
- 训练教程再发布许可；
- ClawHub namespace；
- ProgramSpec canonical 审核；
- OpenClaw 真实加载测试；
- model / extraction / supervision eval；
- ClawHub package validate + dry-run。

## 项目状态声明

Stella Fitness 当前是**架构与基础设施开发阶段**。

不要把当前仓库中的草案 ProgramSpec、营养内容或未完成 Plugin 作为医疗建议、伤病诊断或已验证的训练调整系统使用。
