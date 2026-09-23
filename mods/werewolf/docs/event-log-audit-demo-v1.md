# 狼人杀模型调用日志演示 v1.3（已实现）

本期只验证模型调用技术日志，不做游戏业务打点或事件日志回放。公共字段与 Harness 行为见[模型调用事件日志 v1.3](../../../docs/specs/execution-event-log-v1.md)。

使用持久房间运行路径：一名配置为本地可控 `ModelAdapter` 的 Robot、十一名脚本 Robot，共用正常座位、身份、阶段截止和 Harness 上下文组装。可控适配器只返回合法 SPEAK/SELECT 文本，不访问 DeepSeek 或其他正规模型，不预留真实模型费用。日志中的 `simulated=true` 必须明确；本地模拟仅证明调用点和上下文，不证明真实模型质量。

每次调用从冻结的 `DecisionInput`/房间取 `user_id`、`seat_no`、本席真实身份、scene、phaseInstance、公开事件水位；发言阶段还取当前发言顺序 `mic_no`。麦序不能等同座位号：例如 5 号玩家第一位发言时应记 `seat_no=5, mic_no=1`。查验、狼人刀人、女巫用药、投票等非发言场景的 `mic_no=null`。所有原始 messages、outputSchema 与返回 rawText 仅内部可读，不进入公共旁观或对手视角。

多个固定种子至少覆盖一回夜间 SELECT、上警/普通发言 SPEAK、白天投票 SELECT、一次失败或超时与一次格式纠正；逐 attempt 比对适配器实收请求与日志，并核验身份、合法选项、未公布死讯水位及麦序。正常页面继续实时旁观且计时不暂停；本机诊断接口或 JSONL 导出供开发者检视模型日志。本期不要求仅凭日志生成整局游戏画面回放。

当前本机诊断入口：`GET /api/werewolf/model/:id/model-events?after=0&limit=50`。仅本机地址可访问，查询前核验目标是持久模型房间；按 `sequence` 升序分页，最多100条。返回完整模型输入与输出，请勿转发给普通旁观者。
