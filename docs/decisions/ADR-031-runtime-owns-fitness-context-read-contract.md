# ADR-031：Stella Runtime 拥有 Fitness Context Read Contract

个人数据分层和跨功能读取协议由 Stella Runtime 拥有，Stella Fitness 只实现消费端、兼容矩阵和 conformance fixtures。Runtime 0.2 完成前，Fitness 可以提供明确标记 experimental 的 Provider adapter 来修复当前 Agent 上下文断层，但不得把临时路径或数据格式冒充正式 Runtime 协议；正式 Provider 替换 experimental adapter 时保持相同消费语义。

实施按 Agent Identity Bootstrap、Natural Fitness Query、Fitness Memory Projection、Runtime 0.2 Provider 四个可独立验收的切片推进，前两个切片优先修复空白人格和“目前训练进度”失败。
