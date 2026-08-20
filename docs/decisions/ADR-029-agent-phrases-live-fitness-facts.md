# ADR-029：Fitness Agent 基于实时事实块组织自然回答

自然输入先经过确定性 parser，未命中时由无写权限的受约束 Fitness Query Intent classifier 选择封闭查询；精确训练问题实时读取 Current Fitness State，并把只读事实块交给同一次 Stella Fitness Agent 回答。Agent 可以结合身份与对话记忆生成 Fact-Preserving Reply，但默认只回答用户请求所需内容；确定性检查要求输出中的数字、日期、阶段、动作和完成状态均来自事实块，新增或冲突事实触发模板回退。

明确且完整的确定性记录输入可以直接保存；LLM 识别出的写入意图只能形成 Fitness Write Candidate，必须经过用户确认才能进入 Fact Promotion。分类低置信、超时、Provider 失败或输出非法时，精确事实请求先澄清，普通对话继续，分类器始终没有写权限。
