# 统一执行事件日志 v1.1（待确认）

## 目的与已有边界

这是底层**执行审计**，用于回答一次动作由哪个用户发起、属于哪个 MOD 的哪个实例、何时进入哪个阶段、实际给模型什么、模型返回什么、裁判最终怎样处理。它与 `platform_events`（可投递的权威游戏事实）、`Room.events`（按受众投影的游戏记录）、`fw_memory`（模型记忆）和 `fw_model_calls`（用量摘要）职责不同。执行日志不驱动游戏规则，也不把内部模型内容投影给玩家。现有几套记录可用 `requestId`、`roomId`、事件序号关联，不做自动双向复制。

采用 PostgreSQL 追加表：常查字段独立列，变化较快的细节存 `jsonb`；优先建按对局/请求与时间排序的 B-tree 索引，不预先给整个详情加 GIN。此设计参考 [PostgreSQL JSONB 与索引文档](https://www.postgresql.org/docs/current/datatype-json.html) 和 [OpenTelemetry 事件及日志记录标识约定](https://opentelemetry.io/docs/specs/semconv/general/events/)。这里只借用结构化事件与唯一标识原则，不宣称当前实现兼容 OpenTelemetry 导出协议。

## 物理模型与信封

新增 `fw_execution_events`，由公共存储迁移创建，不依赖 MUD 或回合包。拟定列：

| 列 | 类型/约束 | 含义 |
|---|---|---|
| `sequence` | `bigint generated always as identity primary key` | 稳定分页游标；不承诺连续无缺口 |
| `event_id` | `uuid unique not null` | 单条记录的全局唯一身份；与事件类型分开 |
| `event_type` | `text not null` | 稳定低基数名称，如 `decision.requested.v1` |
| `occurred_at` | `timestamptz not null` | 服务端发生时间，UTC；同时间靠 sequence 排序 |
| `user_id` | `uuid null` | 发起用户的通用 ID；真人和 Robot 都填其 userId。非用户触发为空，不借用座位或 scope ID |
| `initiator_type` | `text not null` | `user/npc/system`；说明 `user_id` 为空时的来源，Robot 与真人都属于 user |
| `mod_id` | `text null` | 注册的 MOD 标识，如 `werewolf`、`qingxi`；纯底层、未绑定游戏的调用可为空 |
| `room_id` | `text null` | 该 MOD 的游戏实例标识：狼人杀填对局房间 ID，武侠填 realm ID；采用 text 兼容两类现有 ID |
| `request_id` | `text null` | 跨调用关联与幂等请求标识；适配不同入口的现有请求 ID |
| `result` | `text not null` | `started/succeeded/rejected/failed/expired/superseded` |
| `reason_code` | `text null` | 机器可分析的结果原因；不存异常堆栈 |
| `visibility` | `text not null` | `internal/seat/public`；模型原文固定 internal |
| `details` | `jsonb not null` | 版本化扩展状态，不参与权威结算 |

公共列只保留跨游戏和跨入口稳定复用的维度。`seatId`、`scopeId`、`phaseInstance`、局内目标和模型专属字段属于 `details`，不在公共表新增一列。`room_id` 在这里指**实例**，不指武侠地图中的小房间；武侠地图位置仍在详情里。`user_id` 不能直接对现有 `fw_users` 建外键，因为 Robot userId 目前由目录配置、尚未落入该表；写入时由受信任宿主取已绑定席位/会话的 ID，不能由浏览器任意提供。MUD 角色动作须在登记时由角色 scope 解析出对应账号 userId；NPC 没有账号，`user_id=null`、`initiator_type=npc`，其 `npcId` 留在详情。调度与到期裁判记 `initiator_type=system`，`user_id=null`，受影响的用户可另放详情，不冒充动作发起人。

索引建议 `(mod_id, room_id, sequence)`、`(user_id, sequence)`、`(request_id, sequence)`、`(event_type, occurred_at)`；同一调用尝试的逻辑去重使用稳定 `event_id` 或 `(request_id, event_type, attempt)` 唯一键。写入接口 `append(tx, event)` 只接受受信任服务器调用，校验类型、userId/initiatorType 组合、时间、结果、visibility 与有界 JSON；重复同 ID 同内容返回原记录，不同内容报幂等冲突。不得在日志接口中静默截断上下文；超限应拒绝本次模型尝试并留下安全的 `context.too_large.v1` 摘要记录。单条上限与总保留期在实施中固定并写配置说明，不能默认无限增长。

读取接口 `list({modId?, roomId?, userId?, requestId?, afterSequence, limit, eventTypes?}, authorization)`：至少提供 `(modId,roomId)`、`userId` 或 `requestId` 之一；游标升序、分页上限 100、稳定排序，返回 `nextCursor`。普通旁观不调用它。本地审计 Demo 可通过独立只读端点按 `modId=werewolf,roomId=<对局 ID>` 取内部记录，服务端必须验证房间属于审计 Demo 且请求来自本机；正式远程管理查询需另做管理员身份与审计自身访问记录，不能靠座位视角授权读取模型原文。

## 事件与状态流转

| 类别 | 典型 eventType | 记录点与 result |
|---|---|---|
| 平台事实 | `platform.fact_appended.v1` | 与权威事实事件在同一事务写入，`mod_id` 由宿主提供，`room_id` 为 realm ID，用户身份由宿主解析；不重新投递 |
| 房间/阶段 | `room.started.v1`、`phase.opened.v1`、`phase.closed.v1` | 状态同事务提交成功后为 succeeded |
| 行动 | `decision.requested.v1`、`decision.committed.v1`、`decision.defaulted.v1`、`decision.rejected.v1` | 登记、合法提交、到期默认、拒绝；记录席位/phaseInstance/窗口及选项摘要 |
| 模型 | `model.context_built.v1`、`model.attempt_started.v1`、`model.attempt_finished.v1`、`model.output_rejected.v1` | 实际最终请求、每次调用/纠正、原始输出与用量、解析或规则拒绝；标记 `simulated` 或 `provider` |
| 恢复/抢占 | `request.expired.v1`、`decision.superseded.v1`、`room.resumed.v1` | 旧请求失效与恢复；不记录重复有效动作 |

`details` 必须带 `schemaVersion: 1`。模型类事件的内部详情含 `modelProfile`（非密钥）、`attempt`、`phaseInstance`、`deadlineAt`、`promptVersion`、`messages`、`outputSchema`、`maxOutputTokens`、`rawText`（若已返回）、解析结果、token 用量和时长；`requestId` 使用公共列，无须在详情重复。`model.context_built` 保存**预算与筛选后传给适配器的最终 messages**；纠正重试须分别记录其追加的 system message。`model.attempt_finished` 的 rawText 保留无效 JSON，便于解释拒绝；候选概率只在内部详情。`DecisionInput` 六区可同时保存为装配来源快照或摘要，但不以它代替最终 messages。网络适配器的 API Key、Authorization 请求头和完整含密钥配置对象不进入事件对象、异常文本或数据库。

登记、提交、默认及房间状态改变与日志写入同一数据库事务；事务回滚不得留下“已提交”事件。网络调用不能包在数据库事务里：调用前已登记的 started 与调用后 finished/failed 是独立事件，允许调用后进程崩溃只留下 started；恢复时记录 expired，并由 `requestId/attempt` 对账。模型迟到可以留 `superseded` 审计，但不得把结果提交成有效行动。审计写失败时，对要求原子性的权威提交整体失败，不允许已生效游戏动作缺少对应记录；模型尝试阶段的审计写失败不得继续发起未留痕的外部调用。`fw_model_calls` 用量摘要保持原职责，由同一 requestId/attempt 对照。

## 无真实模型审计 Demo

现有内存 `DemoRooms` 使用脚本采样并直接调用纯引擎，**不经过 Harness 的最终 messages 装配**，不能凭它的游戏事件伪造“模型输入日志”。新增独立审计 Demo：沿用持久 `RoomRuntime`、狼人杀定义、Robot 席位、Harness 和同一 `ModelRequest`，仅将模型席的网络 `ModelAdapter` 换成确定性本地适配器。该适配器接收真实装配的 messages/Schema，根据合法选项返回可控 SPEAK/SELECT 文本；不得调用外网，也不消耗模型预算。脚本席仍走统一裁判路径。每条模型事件标记 `simulated: true`，实际供应商调用才标 `simulated: false`，两者不得合并成“真实模型效果”。

审计入口可启动一个固定种子、1 模拟模型 + 11 脚本席的本地对局，返回 roomId；浏览器沿用只读游戏快照。受信任本机端点或导出命令按分页输出该 roomId 的 JSONL 事件，便于检查 `phase.opened → decision.requested → model.context_built → attempt → 决策/默认 → phase.closed`。虚拟时钟仅用于自动化整局验证；正常浏览器演示仍按已确认的阶段时限推进，不增加暂停/倍速。核查包括夜间公开水位、各身份授权信息、合法选项、发言顺序、到期默认和有无不该触发的模型请求。

## 不包含与待审阅点

本版不补写旧局事件，不将审计事件直接塞进 `Room.events`，不做前端审计面板、跨服务日志收集或事件驱动投递。公共平台现有事实事件继续工作；首轮在共用 Harness、平台事实写入与回合运行时接点覆盖两种框架。未经过这些入口的既有 MUD 控制命令不在本轮逐一插桩，避免声称全量历史动作已被记录。执行日志若需长期存储完整私密 prompt，必须有仅内部访问和保留期；默认建议本地开发库保留 30 天、生产保留期部署前另定，不由应用启动自动删除。
