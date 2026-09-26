# 模型测试与调用日志 v2（已实施，待网页实局复核）

本页保留 v2 最初的测试口令协议记录。本机狼人杀测试台现行授权按[MOD v1.1](web-model-test-v1-1.md)执行：回环端口、本机模式、无需浏览器口令；日志数据与投影契约不变。

关联[框架需求 021](../../../.agents/note/021-event-log.md)、[狼人杀网页方案](web-model-test-v1.md)及[验收说明](model-test-observability-testing-v2.md)。用户于 2026-09-25 确认实施；v2 代码与网页已部署到本地测试服务，真实模型整局仍待网页复核。

## 目标与边界

用户在网页选定已配置的 Robot、模型 profile 与种子，启动一局持久模型房间；同时看阶段进度、已公开流程、终局回放、逐次模型 API 调用的成功/失败与缓存用量。房间及诊断日志在服务重启和浏览器刷新后仍可按房间 ID 查回。测试房间不使用自动删除的临时 schema；清理需单独显式操作。Robot profile 的 URL、模型名和密钥仍由服务端配置；网页只选已登记且可用的 profile ID，绝不接收或回显 Key。

现有接口以 `request.ip` 等于回环地址作为本机判定；经 Docker 发布端口从宿主访问已实测返回 403。新增测试台改用服务端环境配置的独立 `MODEL_TEST_TOKEN` 保护开局、profile 列表、私有视角和所有原始诊断接口。浏览器由操作者输入一次，仅当前标签页内存持有，以请求头传输；服务端使用常量时间比较，禁止把口令写进 URL、日志、房间或模型上下文。未配置口令时诊断功能关闭并明确提示，不因容器桥接地址放宽 `request.ip`。普通公开旁观接口不需要该口令。此口令仅供当前开发测试台，正式远程管理员体系以后设计。

模型 profile 列表、开局字段与冻结绑定由[狼人杀网页方案](web-model-test-v1.md)定义；公共日志层只消费服务端已绑定的 profile，不让浏览器直接指定供应商 URL 或调用参数。

现有 `fw_event_log` 是模型调用权威源，复用 `started/finished/failed/orphaned/judged/context_rejected`，不另建一份成功日志。`finished` 只表示供应商返回，Schema 有效与裁判提交另列状态；`failed` 代表确实发起的调用失败。没有进入适配器的预算或上下文拒绝须作为“未发出”原因显示，不算失败 API 请求。错误后默认行动若被提交，必须与失败调用分开显示。

有界网络重试启用后，原始私有事件流还包含 `model.retry.scheduled.v1`、`model.retry.skipped.v1` 和 `model.call.skipped.v1`。前者给出下一次 attempt 与等待时间，后两者解释为何未再发 HTTP 请求。网页“模型调用”列表只统计真实 started attempt；检查熔断和未发出的重试时使用同房间的原始事件接口。失败且无供应商 usage 的尝试保持未知，不把它们记为 0 token，也不能据此推断供应商不会计费。

## 接口与持久数据

- `GET /api/werewolf/model/:id/model-events?after&limit` 保留受测试口令保护的诊断入口和 cursor 分页，用于完整原文检查；前端日常列表新增分页摘要投影 `GET /api/werewolf/model/:id/model-calls?after&limit&seat&result`，按 `requestId + attempt` 关联事件，返回 `sequence/occurredAt/userId/seatNo/role/phase/micNo/profile/attempt/status/latencyMs/errorCode/httpStatus/inputTokens/outputTokens/cacheHitTokens/cacheMissTokens/schemaValid/gameCommitted`，未知量为 `null`，不把完整 messages 和 rawText 放进列表。
- `GET /api/werewolf/model/:id/model-calls/:requestId/:attempt` 受测试口令保护，返回该尝试的开始、完成/失败、裁判事件及原始请求/响应。详情必须保留 `modelRequest.messages` 的实际顺序、Schema、token 上限和模型原文截断状态；密钥、Authorization、连接串和原始异常消息禁止入库或出接口。
- `GET /api/werewolf/model/:id/usage` 扩充现有实际用量汇总，加入 reported cache hit/miss tokens、可计算的调用数、未报告缓存用量调用数、各结果计数。统计每次供应商返回的实际 usage；纠正重试单独计算。`cacheRate = sum(hit) / sum(hit+miss)`，仅对 hit/miss 完整且分母大于 0 的调用计算；缺失不是零。input/output 仍按真实供应商报告计账，不计算人民币。
- 适配器在现有受控 `MODEL_UNAVAILABLE` 等错误码外，增加脱敏诊断元数据：HTTP 非 2xx 时保存安全的状态码和 provider request id（如有，长度限制且不直接信任）、网络异常类别、超时/取消类别；不保存错误响应原文。成功但 JSON 或输出 Schema 不合法由 `finished.schemaValid=false` 和后续纠正/裁判事件说明，不能记作 HTTP 失败。若供应商返回 usage 缺失或调用在响应前失败，token 字段为 null。
- 保留 started 先持久化、网络调用不持有数据库事务、终态幂等及崩溃孤儿标记。模型调用日志与房间记录共用持久库；重启后可按房间查回，禁止后台测试清理抹除尚需复盘的日志。旧日志缺少新增诊断字段时显示“未记录”，不伪造状态。

## 权限与状态

公开旁观快照与游戏发言、投票回放只含按阶段授权的游戏事实。完整模型上下文、私有角色、原始响应和调用错误仅测试口令授权的诊断页面可见；在终局前也不能通过普通旁观接口间接读取。现有 `seat` 查询的私有视角同样纳入测试口令保护，避免绕过日志权限。逐次状态为 `started → finished|failed|orphaned`，`finished → judged` 独立；若短暂没有终态，网页显示“进行中”，超过恢复边界显示“结果未知/已孤儿化”，不写“成功”。

本版不做日志驱动的游戏画面回放、旧测试库恢复、脚本 Robot 伪造 API 日志、供应商原文错误体存储、远程权限系统或 API 价格控制。实现顺序：先写持久化/失败分类/权限/分页/汇总的行为测试，再适配器诊断与服务端投影，最后网页接入并用真实模型整局验证。

## JEV SELECT 旁路日志（v1 历史实现；本机当前暂停）

关联[需求 009](../.agents/note/009-jev-select-shadow-comparison.md)与[模型接入设计](model-integration-v1.md)。比较器在已有私有 `fw_event_log` 追加 `model.shadow.jev.started.v1`、`model.shadow.jev.finished.v1`、`model.shadow.jev.failed.v1`、`model.shadow.jev.unknown.v1` 事件；原 `request_id`、房间、座位、阶段、角色和源事件 sequence 用于关联。`started` 先于网络调用持久化，内容包括实际送给 JEV 的 `state`、`questions`、目标模型及上下文摘要；`finished` 保存实际模型版本、选中 ID、概率分布、置信度、响应 token 用量及延迟；`failed` 只存脱敏状态码/错误类别/延迟，绝不保存 Authorization 或原始错误体。已领取但崩溃未得终态的请求记 `unknown`，不能伪称失败或成功。无法转换为 JEV 合法请求时记 `skipped` 及原因，没有 `started`，也不调用 API。

按 `request_id` 查询现有原模型事件与 JEV 旁路事件，即可人工核对两个 `selected`、实际裁判状态、发起时的上下文、用量和耗时。JEV 的成功是供应商成功响应，不意味着其选择有效或游戏执行；JEV 没有 `judged` 事件。原用量统计仅计算 `model.call.finished.v1`，旁路 token 在私有调用详情中单列，不与原模型账本相加。上述完整上下文与概率仅在本机私有诊断接口可读，不进入公共旁观、游戏历史、其他 Robot 的上下文或普通房间回放。

本机网页开新局后，在“模型调用”列表选一条 SELECT，点开“私密调用详情”：`model.call.finished.v1.details.rawText` 是原模型输出，`model.call.judged.v1` 是实际动作是否提交；同一详情中的 `model.shadow.jev.finished.v1.details.choice` 是 JEV 建议，`probabilities`、`confidence`、`usage` 和 `latencyMs` 可用于比较。JEV 报错则查 `model.shadow.jev.failed.v1.details.errorCode`；正在进行时可能只有 started，进程失联后标记 unknown。规则强制选项、SPEECH 和脚本动作没有这组旁路事件。网页刷新后按同一房间 ID 可继续查询这些私有日志。

2026-09-26 本机 JEV 旁路已关闭。上述查询仍适用于停用前的历史事件；新模型决策只生成原模型的调用日志，不再生成 JEV 旁路事件。旧记录未清理。
