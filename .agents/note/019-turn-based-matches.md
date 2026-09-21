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


## 下一步开发方案 v2（2026-09-21，待确认）

目标：普通模型等待期间独立受理合法抢占，同时保持授权隔离、原子提交、幂等及可恢复。具体协议唯一正文为[抢占v2](../../docs/specs/turn-based-interrupts.md)，验收为[TB-09～14](../../docs/testing/turn-based-matches.md)。v1既有确认不变，本节仅申请v2增量。

本次范围：packages/turn-based的types、engine、runtime、schema与公共导出；Phase.interrupt、两个纯回调、tickInterrupt；pendingJobs、decisionEpoch及每席interruptScopeId；框架可由受信任宿主调用的调度生命周期（阶段/事件触发、pass间隔、预算与关闭）。同步更新仓库内受影响调用方和测试。core保持同scope串行及原子记忆契约，不增加游戏规则。

权限、事务与恢复：沿用room→scope→request短事务锁序；模型等待不持锁；提交重验阶段、epoch与资格；过期成功/失败不污染新状态；有效执行租约不被复用。具体算法与数据约束见协议。公开DTO不增加私有抢占资格。当前版本正常重启保留数据，不提供旧pending兼容入口。

不包含：具体MOD规则、HTTP/UI、应用自动开局、生产部署及真实模型付费运行。本次通过隔离测试schema验证新结构，不执行现有开发库清理；如实际接入需重建开发数据，先核实目标并记录备份/恢复方案后单独执行，不由启动或测试隐式清理。

实施顺序：明确确认本版本与范围 → 核对差异并建立本地Git检查点 → 编写TB-09～14可失败行为测试并记录失败 → 实现引擎与运行时/数据结构 → 验证中性游戏的真实PostgreSQL竞态及恢复 → 运行既有回归并回填证据。具体MOD在所属note管理接入与验收，框架文档及测试只使用中性场景。

完成标准：TB-01～14通过，类型与仓库检查通过，真实数据库证明抢占后无旧动作/有效记忆提交、重复请求不重复执行、事务回滚无部分结果、重启无重复行动。未取得的环境或模型证据明确标为未运行，不将单元测试代作数据库验收。

确认记录：2026-09-21用户在019 v2及001 v3具体范围提交审阅后明确回复“确认执行”，批准该范围实施。历史v1数据库与93项回归证据属于原实施记录，本次文档整理未重跑。没有新增待裁定的业务规则；本次待确认内容为接口、持久数据、调度及验收方案。
