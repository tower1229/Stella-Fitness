# ADR-026：个人上下文建模需要独立外发授权

OpenClaw extraction model 的既有权限不代表 Stella Fitness 可以把 Personal Data Repository 内容发送给同一 Provider。Projection Builder 默认使用确定性本地投影；非结构化个人资料需要远程模型概括时，必须先展示拟发送的数据范围、Provider、用途和保留边界并取得明确授权，并在首次 Initialization Disclosure 中报告。授权绑定 Provider、用途和数据类别，同一范围内持续同步无需重复确认，Provider、用途或数据范围扩大时必须重新授权；撤销只阻止未来外发，不能虚假承诺删除 Provider 已处理的数据。输出只能形成带来源的非权威 Context Projection，不能成为 Canonical Fitness Fact 或隐藏用户画像。

模型生成的投影必须记录 Projection Provenance：来源引用与 checksum、Provider/model、schema/prompt 版本、生成时间、输入类别和输出 checksum，不保存隐藏推理；来源、模型和版本均未变化时不无条件重新生成。
