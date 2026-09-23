# 模型调用事件日志 v1.3：验收用例（待确认）

本文件仅列行为与边界用例；确认方案前不写可执行测试。中性测试归 core/storage，狼人杀身份与麦序断言归 MOD。

| ID | 场景 | 通过标准 |
|---|---|---|
| EL-M01 | 通用信封 | 每条记录可按 eventId、eventType、时间、userId、modId、roomId、requestId、result 查询；不要求 seat/scope/role 公共列 |
| EL-M02 | 每次真实尝试 | 适配器 `generate` 被调用一次，恰有同 requestId/attempt 的 started 与 finished/failed；纠正重试分别记 attempt 1/2 |
| EL-M03 | 最终输入一致 | 抓取适配器收到的 `ModelRequest`，与该 attempt 日志中的 messages、Schema、maxOutputTokens 逐字段相同；纠正消息只出现在 attempt 2 |
| EL-M04 | 输出与用量 | 原始有效/无效 JSON、实际 model、供应商返回的 input/output token、耗时和受控错误码如实保存；未知 usage 为 null |
| EL-M05 | 玩家元数据 | 狼人杀用户 ID、座位、真实身份和 phaseInstance 对应调用时冻结状态；发言麦序为顺序号而非座位号，非发言阶段为 null |
| EL-M06 | 私密与密钥 | Key、Authorization、连接串不入日志/导出；公共旁观和对手 context 不可读取他席调用；仅本机诊断可取原始消息 |
| EL-M07 | 原子和幂等 | started 入库失败不发调用；同一请求/尝试重放不复制事件；已完成请求重取不重调模型 |
| EL-M08 | 失败与恢复 | 网络失败/超时/取消有失败事件；进程崩溃只留 started 时恢复补 orphaned，不伪造成功或游戏动作 |
| EL-M09 | 调用与判定分离 | 模型返回合法 JSON 但旧阶段/业务拒绝时，调用结果仍如实记录，游戏提交状态标为未生效；无实际适配器调用时不造模型事件 |
| EL-M10 | 无网络整局检查 | 一名本地可控 ModelAdapter 与脚本席同局，按日志核对夜间查验、白天 SPEAK/SELECT 的调用时机、身份、麦序、授权水位；网络请求与费用为零，simulated 标志准确 |

验证须区分单元测试、真实 PostgreSQL、无网络模拟整局和真实供应商；本期不调用真实供应商，最后一项明确记录未运行。游戏回放、业务打点和 NPC/通用定时任务不作为本版验收。
