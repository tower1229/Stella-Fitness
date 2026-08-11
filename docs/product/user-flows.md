# 用户流程

## 1. 首次设置

```text
安装并启用 Plugin
→ 配置 Personal Data Directory
→ 检查目录与 OpenClaw media/model 权限
→ 自动载入卓叔 12 周 Built-in Program 并绑定当前 conversation
→ 逐项确认可拆卸哑铃、引体向上杆和打印材料
→ 记录 baseline 体重
→ 分别确认高脚杯深蹲、哑铃卧推、哑铃硬拉初始 12RM
→ 确认星期一 cycle start 并建立 Program State
→ ACTIVE
```

配置不完整时不得接收或保存个人输入，也不得回退到 Runtime Directory。

## 2. 训练日

```text
查看当前 Planned Session
→ 打印/使用原课程训练日志
→ 正常训练 + 纸笔填写 Actual
→ 训练后拍照
→ 结构化候选字段
→ 仅确认关键歧义
→ 保存 Observation Record
→ 更新 Training Record View
```

训练过程中不要求逐组手机输入。

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

绑定 conversation 支持 today/next Planned Session 事实问答，以及 today/week/phase A4 PDF。普通训练 PDF 预填计划处方并保留 Actual、动作质量和问题备注空白；第 4 周力量测试使用独立布局。无法识别或超出 Program Facts 范围的问题由 Plugin 明确拒绝，不传给通用 Agent 诊断或调整计划。

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
