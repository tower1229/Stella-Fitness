# 用户流程

## 1. 首次设置

```text
安装并启用 Plugin
→ 通过 Runtime-owned locator 配置唯一 Personal Data Repository
→ 独立检查 Personal Data Directory、conversation、media 与 model 权限
→ 自动载入卓叔 12 周 Built-in Program 并绑定当前 conversation
→ 逐项确认可拆卸哑铃、引体向上杆、打印材料和训练记录协议
→ 记录 baseline 体重
→ 分别确认高脚杯深蹲、哑铃卧推、哑铃硬拉初始 12RM
→ Plugin 询问从本周一还是下周一开始
→ 用户用“本周开始”“下周开始”或明确的星期一日期确认并建立 Program State
→ ACTIVE
```

配置不完整时不得接收或保存个人输入，也不得回退到 Runtime Directory。
Technical Readiness 与 Program Journey Status 分开报告；每次 prerequisite acknowledgement 都在 Personal Data Directory 保存确认时间、provenance 和稳定幂等键。

## 2. 训练日

```text
查看当前 Planned Session
→ 打印/使用原课程训练日志
→ 正常训练 + 纸笔填写 Actual
→ 训练后直接拍照发送（无需附加“记录训练”）
→ 按用户时区锁定本周最近到期且未记录的 Planned Session
→ 只抽取照片中该 session 的结构化候选字段
→ 仅确认关键歧义
→ 保存 Observation Record
→ 更新 Training Record View
→ 返回本周派生完成数和下一 Planned Session
```

训练过程中不要求逐组手机输入。

照片不是固定训练日志时继续普通图片回复且不保存 Stella 数据；目标区块不可见、空白或不清晰时要求只补拍该区块。照片只填写了其他训练日或动作集合与当前 ProgramSpec 不一致时，系统不会改选可见区块，也不会推进进度。

## 3. 特殊训练日志

第 4 周周五力量测试按独立 layout 记录三主项 12RM 和引体第一组最大次数。确认后的测试事实可由 Program Engine 确定性更新后续符号重量绑定。

Recovery session 保持来源计划中的 session identity，但系统不评价该次训练表现。

## 4. 体重记录

```text
“今天 68.4 kg”
→ 解析测量值与发生时间
→ 歧义时确认
→ 保存 Observation Record
→ 展示事实时间序列
```

系统不评价体重变化是否理想，也不据此调整训练或饮食。

第 4、8、12 周结束时记录体重 checkpoint。交互查看下一阶段时缺少 checkpoint，Program Journey 返回 `PHASE_CHECKPOINT_REQUIRED`。Weight Facts View 只重建 kg、百分比和增重目标数学方向，不作原因、健康或表现判断。

## 5. 事实问答与打印

绑定 conversation 支持用自然语言查询今天、下次和本周的 Planned Session；本周以查询日期所在的周一至周日为边界，逐日返回 ProgramSpec 中的课程，无课程日明确显示“休息”。普通回复只展示简明中文，不暴露 Journey 状态码、Observation ID、schema 或内部确认命令；`/stella-status` 是保留技术细节的诊断例外。系统也支持直接获取固定 digest 的完整 12 周 XLSX。`/stella-print` 不要求 Program 已激活，不接受 today/week/phase 范围，也不在运行时生成 PDF；用户在工作簿中自行选择需要打印的页面。无法识别或超出 Program Facts 范围的问题由 Plugin 明确拒绝，不传给通用 Agent 诊断或调整计划。

## 6. 纠错与删除

- 用户纠正字段时创建新的 correction provenance，并重建事实视图；
- 重复上传返回已有记录，不重复计入；
- 用户从 Personal Data Directory 删除文件后，系统尊重删除并重建；
- Runtime Directory 不得恢复已删除数据；
- schema-invalid 手工编辑被隔离并给出可操作错误。

## 7. 明确不存在的流程

- 训练表现诊断或评分；
- 停滞、疲劳、饮食或恢复归因；
- 食物照片与营养建议；
- 健康风险筛查或安全升级；
- User Belief、Blind Diagnosis、Audit 或 Policy Gate；
- 周期主动监督和异常通知。
