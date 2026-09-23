# 狼人杀简明规则集接入 v2（已确认实施）

通用配置与运行约束见[框架方案](../../../docs/specs/decision-rule-config-v2.md)。本 MOD 的作者文件为 `mods/werewolf/rules/ruleset.json`，首条规则按示例配置 `seer-first-day-run`，80% 强制上警。作者只需修改 `priority / instruction / enforcement / probability` 等可读字段，不直接编辑 TS 谓词。

内部处理器拟放 `src/decision-rules/handlers.ts`，`id='seer-first-day-run'` 对应当前已实现的触发条件：当前座位真实身份为预言家、场景为首日 `nominations`、本人可报名。选项映射只从当次合法选项中选择 `nominate/run=true`。`src/decision-rules/index.ts` 静态导入 JSON、调用通用装配函数，并由 `definition.ts` 注册。原 `seer-first-day.ts` 中的作者配置移至 JSON，条件与选项代码留在内部处理器。

若未来要让模型在上警发言场景看到一条说明，应新增独立的 `guidance` 规则 ID 和对应场景处理器；本次第一条规则的说明仅在首日报名决策时适用。其他席位不得看到预言家专属说明。女巫平安夜公开刀口继续待单独定义，不借此配置自动启用。

验收：JSON 可由人读懂；修改 `instruction` 且未提升版本应触发摘要不匹配；已匹配规则进入本人模型请求，其他席位和公共旁观没有该文本；概率命中时程序强制合法上警，未命中时模型可自由选择；`guidance` 规则只影响模型上下文、不改变候选动作。上述核心行为已由定向与隔离 PostgreSQL 用例覆盖，证据见[MOD note 002](../.agents/note/002-decision-rules.md)。
