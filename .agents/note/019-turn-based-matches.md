# 需求：房间制回合游戏框架

Status: in_progress

## 需求

在第二层增加房间制回合游戏类型，支持座位、满员开局、阶段推进与独立AI视角。首个接入为[狼人杀001](../../mods/werewolf/.agents/note/001-ai-spectator-mvp.md)。

## 范围

2026-09-20架构方向已确认：编写独立房间制回合游戏框架，不强制整合MUD，最底层统一。两个第二层框架并列，具体狼人杀规则留在MOD。用户进一步明确背包、道具等跨框架系统未来出现实际共用需求后再抽象，本轮不预先迁移。通用v1已授权并实现；阶段抢占v2增量待确认。见[大纲](../../docs/specs/turn-based-matches.md)。

## 验收

- [x] TB-01～TB-08通用框架契约已实现并有可执行测试。正文见[框架测试契约](../../docs/testing/turn-based-matches.md)，实现契约见[设计](../../docs/specs/turn-based-matches.md)。
- [ ] 狼人杀接入与只读旁观UI不在本轮范围，随[狼人杀001](../../mods/werewolf/.agents/note/001-ai-spectator-mvp.md)另行确认。

## 当前进展

2026-09-21续做：狼人杀规则v2已确认。现有单pending无法满足随时插队；已补[抢占设计v2](../../docs/specs/turn-based-interrupts.md)及TB-09～14验收说明，待确认新增接口、双执行scope、epoch、数据和恢复范围后实施。框架代码未改。

2026-09-21：通用框架已按已授权边界实现，狼人杀细则仍待用户提供，本轮未实现MOD、HTTP路由或UI。

- 实现：`packages/turn-based/src`（types/engine/runtime/schema）。独立入口`@game-ai/turn-based`，只依赖`@game-ai/core`公共入口与ajv；新表仅`tb_rooms`、`tb_seats`。MUD包与底层包均未反向引用，由`npm run check:repo`强制。
- 测试证据（本次实际运行）：
  - `packages/turn-based/tests/engine.test.ts`：6/6通过（纯引擎：满员开局、顺序/封闭收集、信息隔离、预算中止不揭密）。
  - `tests/integration/turn-based.test.ts`：15/15通过，真实PostgreSQL 18容器，覆盖TB-01～TB-08，含并发tick共享请求、过期响应拒绝、结算回滚、阶段变更拒绝陈旧输出、大关停时序、12席独立scope。
  - 全量回归：93/93通过（core、model、game-systems、turn-based、tests/integration、mods/qingxi）。
  - `npm run check`（tsc --noEmit）与`npm run check:repo`通过（205文件，26需求）。
- 未运行：Docker镜像构建（`docker compose --profile test run --build --rm tests`）与真实LLM对局。本轮以ScriptedModel验证框架契约，真实模型证据留待狼人杀接入后按MOD验收记录。未使用Mock冒充真实PostgreSQL或真实模型。

## 待完善

狼人杀规则已确认；下一步确认通用抢占v2增量。既有架构方向不重复索取确认。正常结束后揭密，进行中旁观者仅见公共信息。

