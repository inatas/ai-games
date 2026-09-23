# 模型调用事件日志 v1.3（待确认）

## 目标与范围

第一期只记录 Game AI Harness **每次实际调用 `ModelAdapter.generate` 的尝试**，使开发者按对局和玩家核查调用时机、授权 context、原始 result、token 与错误。脚本 Robot 本地 `DecisionAdapter.decide` 不属于模型调用，不能伪造一条模型事件；可控的本地 `ModelAdapter` 走同一 Harness 路径时必须标记 `simulated=true`。本期没有用户侧业务打点、游戏回放日志、NPC/通用定时任务审计、支付事件或公共日志页面。

已有 `fw_model_calls` 只保存 `scope_id/request_id/attempt/model/usage/latency/context_ids/error_code`，没有请求 messages、原始返回或狼人杀玩家元数据。本期将其职责合并入一个新的通用事件日志表 `fw_event_log`；旧摘要表不作为第二个权威来源。当前未发布阶段的表结构替换及受影响查询/测试同批更新，既有开发数据处理须按项目数据库规则明确核实与备份，不在应用启动时自动删除。

## 通用信封与模型详情

`fw_event_log` 为 PostgreSQL 追加表。公共列限于跨游戏可复用信息：`sequence bigint identity`（分页）、`event_id uuid unique`、`event_type text`、`occurred_at timestamptz`、`user_id uuid null`、`mod_id text null`、`room_id text null`、`request_id text`、`result text`、`details jsonb`。`room_id` 表示游戏实例：狼人杀为房间 ID，武侠为 realm ID。Robot 与真人共用真实 `user_id`；纯底层调用尚无用户绑定时允许空值，不能把 `scope_id` 或座位号冒充用户 ID。Robot 当前目录用户不在 `fw_users` 表，故 `user_id` 不建该表外键。模型调用 `scope_id`、`attempt`、`seat_no`、`mic_no`、角色、模型 profile 等只放 `details`。索引以 `(mod_id,room_id,sequence)`、`(user_id,sequence)`、`(request_id,sequence)` 为主；不预建整份 JSONB 的 GIN 索引。扩展字段今后用于周边业务时另评估，不能因预留通用表而在本期生成业务打点。

每个实际适配器调用 attempt 至少两条不可变事件，共用 `request_id` 与 `details.attempt`：

1. `model.call.started.v1`：在调用前持久写入，`result=started`；`details` 保存 `schemaVersion`、`simulated`、模型 profile、绑定版本、`scopeId`、`attempt`、绝对截止时间、最终 `ModelRequest`（实际 messages、outputSchema、maxOutputTokens）及其内容摘要。上下文预算失败且尚未进入适配器时只记 `model.context_rejected.v1`，**不算一次模型调用**。
2. `model.call.finished.v1`：收到适配器结果后写入，`result=succeeded` 表示**适配器已返回**；保存 `rawText`、实际返回的 model、input/output token、耗时、解析/Schema 判定。无效 JSON 仍保留原文，后续纠正若真的再次进入适配器另记 attempt 2。
3. `model.call.failed.v1`：网络失败、取消或超时等，`result=failed/expired`；保存稳定错误码及耗时。进程崩溃可能只留 started，恢复时根据请求租约补记 `model.call.orphaned.v1`；绝不把未知供应商结果填成成功。模型已返回但裁判因旧阶段/非法选择未提交时，模型调用仍如实记录 finished；“模型成功返回”不等于“游戏动作生效”。

裁判后续结果使用独立的 `model.call.judged.v1`，与同一 `request_id/attempt` 关联，标明接受、拒绝或因阶段失效而未生效；不可修改已追加的 finished 事件。若模型返回后进程崩溃，没有 judged 就表示裁判结果待查，不能推断为动作成功。

一次重试的最终 messages 可能追加格式纠正指令，因此按 attempt **逐次**记录实际传给适配器的完整请求，不能只记六区草稿或第一次 context。密钥、HTTP Authorization 头、数据库连接串与完整服务配置对象不得进入日志；异常只记受控错误码，不能将原始异常文本直接写入。模型原始输出可能含角色私密信息，原始日志仅服务端受信任本机诊断接口/导出命令可读，不进入普通旁观、历史发言或对手 context。限制单条消息与 rawText 大小；超限不得静默截断并谎称完整。日志写入失败时不得继续发起未留痕的外部调用。

## 游戏元数据：谁、哪一麦、什么身份

底层 Harness 只认识通用请求，不推测游戏身份。发起调用的受信任宿主在登记时传入只读诊断元数据：`modId`、`roomId`、`userId`、游戏阶段、座位号、麦序、本人真实身份和本席公开事件水位。狼人杀从席位绑定取得 Robot `userId`，从冻结的阶段/行动取得座位和身份；`seat_no` 表示玩家座位，`mic_no` 表示**本轮发言顺序中的第几麦**，不是座位号。SPEAK 阶段须有可验证麦序；夜间查验/刀人及投票等非发言阶段 `mic_no=null`，不可硬填座位号。元数据与本次冻结 context 对应同一 phaseInstance/epoch，迟到调用仍保留原时点身份与水位。跨 MOD 不适用的字段为空，不扩成公共列。

若当前阶段没有可确定的发言顺序，先记录 `mic_no=null` 和原因，不能猜测；此场景的麦序来源应在狼人杀接入测试中明确后才算验收。业务规则仍由 MOD 决定；日志字段不授予新信息，也不改变游戏行动。

## 接口、事务、读取与恢复

公共写入接口只接受服务器构造的事件，按 `event_id` 或 `(request_id,attempt,event_type)` 幂等；同一键不同内容为冲突，不复制日志。开始与结束分别短事务写入，模型网络等待不持数据库事务。按 `sequence` 分页查询，至少按 `request_id` 或 `mod_id+room_id` 限定，单页最多 100 条；只读诊断入口本期限制本机并验证目标房间，不提供公共原始日志 API。已结束/失败请求重取不再调用模型，也不产生第二组 started/finished；孤儿 started 在恢复时标明未确认状态，不删除原记录。

`result` 表示**该事件的执行结果**，游戏裁判是否接受模型输出需有独立受控状态字段；token 为供应商返回时的值，失败且无供应商 usage 时为 null，不能用估算数冒充真实用量。实际 context 与输出按尝试持久保存，后续才能检查狼人杀的调用时机和授权边界。该技术日志不保证还原整局游戏画面；游戏回放与用户业务分析延后单独设计。
