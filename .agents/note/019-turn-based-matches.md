# 需求：房间制回合游戏框架

Status: implemented

## 需求

在第二层增加房间制回合游戏类型，支持座位、满员开局、阶段推进与独立AI视角。首个接入为[狼人杀001](../../mods/werewolf/.agents/note/001-ai-spectator-mvp.md)。

## 范围

2026-09-20架构方向已确认：编写独立房间制回合游戏框架，不强制整合MUD，最底层统一。两个第二层框架并列，具体狼人杀规则留在MOD。用户进一步明确背包、道具等跨框架系统未来出现实际共用需求后再抽象，本轮不预先迁移。通用v1已授权并实现；阶段抢占v2增量已于2026-09-21明确确认并实现。见[大纲](../../docs/specs/turn-based-matches.md)。

## 验收

- [x] TB-01～TB-08通用框架契约已实现并有可执行测试。正文见[框架测试契约](../../docs/testing/turn-based-matches.md)，实现契约见[设计](../../docs/specs/turn-based-matches.md)。
- [x] TB-09～14抢占契约实现并通过真实PostgreSQL验收。
- MOD接入与只读旁观UI归[狼人杀001](../../mods/werewolf/.agents/note/001-ai-spectator-mvp.md)另行确认。

## 当前进展

2026-09-21当前：用户在019 v2与001 v3范围提交审阅后回复“确认执行”。独立抢占通道、双scope、pendingJobs、epoch与受信任宿主调度已实现，具体证据见下文。

历史v1实施记录：通用框架按当时已授权边界实现，该阶段未实现MOD、HTTP路由或UI。

- 实现：`packages/turn-based/src`（types/engine/runtime/schema）。独立入口`@game-ai/turn-based`，只依赖`@game-ai/core`公共入口与ajv；新表仅`tb_rooms`、`tb_seats`。MUD包与底层包均未反向引用，由`npm run check:repo`强制。
- 历史v1测试证据（原实施阶段实际运行）：
  - `packages/turn-based/tests/engine.test.ts`：6/6通过（纯引擎：满员开局、顺序/封闭收集、信息隔离、预算中止不揭密）。
  - `tests/integration/turn-based.test.ts`：15/15通过，真实PostgreSQL 18容器，覆盖TB-01～TB-08，含并发tick共享请求、过期响应拒绝、结算回滚、阶段变更拒绝陈旧输出、大关停时序、12席独立scope。
  - 全量回归：93/93通过（core、model、game-systems、turn-based、tests/integration、mods/qingxi）。
  - `npm run check`（tsc --noEmit）与`npm run check:repo`通过（205文件，26需求）。
- 未运行：Docker镜像构建（`docker compose --profile test run --build --rm tests`）与真实LLM对局。本轮以ScriptedModel验证框架契约，真实模型证据留待狼人杀接入后按MOD验收记录。未使用Mock冒充真实PostgreSQL或真实模型。

## 待完善

v2已实现并通过真实数据库验收。应用侧自动开局与HTTP/UI不在本次范围；当前开发库未执行迁移或清理。正常结束后揭密，进行中旁观者仅见公共信息。


## 开发方案 v2（2026-09-21，已确认执行）

目标：普通模型等待期间独立受理合法抢占，同时保持授权隔离、原子提交、幂等及可恢复。具体协议唯一正文为[抢占v2](../../docs/specs/turn-based-interrupts.md)，验收为[TB-09～14](../../docs/testing/turn-based-matches.md)。v1既有确认不变，本节记录已批准的v2增量。

本次范围：packages/turn-based的types、engine、runtime、schema与公共导出；Phase.interrupt、两个纯回调、tickInterrupt；pendingJobs、decisionEpoch及每席interruptScopeId；框架可由受信任宿主调用的调度生命周期（阶段/事件触发、pass间隔、预算与关闭）。同步更新仓库内受影响调用方和测试。core保持同scope串行及原子记忆契约，不增加游戏规则。

权限、事务与恢复：沿用room→scope→request短事务锁序；模型等待不持锁；提交重验阶段、epoch与资格；过期成功/失败不污染新状态；有效执行租约不被复用。具体算法与数据约束见协议。公开DTO不增加私有抢占资格。当前版本正常重启保留数据，不提供旧pending兼容入口。

不包含：具体MOD规则、HTTP/UI、应用自动开局、生产部署及真实模型付费运行。本次通过隔离测试schema验证新结构，不执行现有开发库清理；如实际接入需重建开发数据，先核实目标并记录备份/恢复方案后单独执行，不由启动或测试隐式清理。

实施顺序：明确确认本版本与范围 → 核对差异并建立本地Git检查点 → 编写TB-09～14可失败行为测试并记录失败 → 实现引擎与运行时/数据结构 → 验证中性游戏的真实PostgreSQL竞态及恢复 → 运行既有回归并回填证据。具体MOD在所属note管理接入与验收，框架文档及测试只使用中性场景。

完成标准：TB-01～14通过，类型与仓库检查通过，真实数据库证明抢占后无旧动作/有效记忆提交、重复请求不重复执行、事务回滚无部分结果、重启无重复行动。未取得的环境或模型证据明确标为未运行，不将单元测试代作数据库验收。

确认记录：2026-09-21用户在019 v2及001 v3具体范围提交审阅后明确回复“确认执行”，批准该范围实施。历史v1数据库与93项回归证据保留为原实施记录；本次新增接口、持久数据、调度及验收范围已经获批，完整回归证据见下文。

实施记录（2026-09-21）：用户“确认执行”后建立main/92beb7a检查点，保留全部待验收代码及规则文档。基线文档检查224文件/26需求通过，历史单元56项；基线数据库和真实模型本机未验证，不称稳定版本。

## v2实施与验证证据（2026-09-21）

- 实现：Phase.interrupt、validateInterrupt/resolveInterrupt、acceptInterrupt、tickInterrupt与run；Seat双scope、Room.pendingJobs/decisionEpoch及tb_seats.interrupt_scope_id。所有调用方和原持久化测试已更新，无旧pending兼容分支。
- 一致性：登记提交Harness前及最终提交均重验job/phase/epoch；失效job不污染新阶段，活跃scope租约不被复用。普通提交、成功抢占递增epoch；pass只产生本通道内部记录，不产生公共事件或游戏状态变化。
- 测试先行证据：新纯引擎测试首先因acceptInterrupt未导出失败；新集成测试类型检查因tickInterrupt、pendingJobs等缺失失败。额外登记竞态测试实际暴露SCOPE_BUSY：旧登记在新请求开始后仍尝试claim；增加提交前room锁重验后通过。
- 真实PostgreSQL：专用临时postgres:18-bookworm容器，127.0.0.1随机端口；显式TEST_DATABASE_URL，各测试使用随机schema。通用框架8组单元、25组数据库测试通过，其中v2新增2组单元和10组数据库测试，覆盖TB-09～14及原TB-01～08。
- 全量npm test：150/150通过，包含core、MUD、框架和MOD回归；无跳过。npm run check、npm run check:repo（229文件/26需求）与git diff --check通过。
- 未执行现有开发库重建、备份恢复或应用镜像构建；未运行真实LLM。本次Runtime重建、持久登记恢复与过期租约测试不冒充现有开发库备份恢复验收。临时库没有需保留的开发数据。

## v3模型运行时提案（待确认）

为后续模型局提出通用扩展：按席密封并行、绝对截止与默认原子提交、定义拥有的模型决策编解码、持久展示门控及重启恢复。当前normal单通道及每次普通提交提升decisionEpoch的实现不能直接支持并行收集；协议见[运行时v3](../../docs/specs/turn-based-model-runtime-v3.md)。仅文档提案，v2已实现范围保持；本次未写实现/测试、未执行迁移。具体游戏映射由对应MOD需求管理，不在框架文档写游戏范例。确认后先中性失败测试与数据库竞态测试，再实现。

2026-09-23增量待确认：新目标要求模型和脚本席位统一**决策**输入输出；底层通用契约是`DecisionInput/DecisionOutput`与裁判提交，不把脚本直接伪装成付费`ModelAdapter`。模型分支继续由Harness组装上下文并调用provider适配器，脚本分支在相同授权事实和合法选项上本地生成提案。六区内容由MOD构造、core处理消息与预算。具体方案见[Robot模型运行时v2增量](../../docs/specs/robot-model-runtime-v1.md)。本条仅记录跨框架依赖，未确认实施、未改代码与数据库。

确认补记（2026-09-23）：用户随后答复“确认，继续推进”，批准与Robot同局目标直接相关的统一决策路径；密封并行、绝对截止、合法输出提交及恢复按现有v3提案落实。预言家无输入的具体默认仍归MOD游戏规则，未获答复前不能擅定。

实施进展补记（2026-09-23）：已先增加失败的中性测试，随后实现DecisionInput/DecisionOutput、按席密封任务通道、行动截止与阶段结束双时间点、固定窗口结算、过期任务失效、模型请求绝对notAfter及脚本/模型同一游戏裁判入口。用户追加要求所有阶段提前结果不缩短流程，已将fixedWindow扩至全部狼人杀阶段；女巫死亡的夜间保留第60～90秒暗场。类型/单元测试已通过；真实PostgreSQL并发、恢复与事务集成待本机测试库可用，不能标为通过。

本轮验证补记：新增单席顺序发言早到后仍保持原阶段的纯引擎测试，定向10/10通过。`npm run check`、`npm run check:repo`、`npm run build`和`git diff --check`通过；本机Docker daemon不可用且未设置`TEST_DATABASE_URL`，新增真实数据库集成测试尚未运行。无模型服务环境变量，未发起真实模型调用或产生费用。

### 已提交决策后的可选提前结束（v3.1已实现）

狼人杀MOD提出Robot合法发言提交后3秒结束当前发言窗口，具体场景和时限归[MOD note](../../mods/werewolf/.agents/note/001-ai-spectator-mvp.md#白天robot发言完成后3秒跳过-v12已实现)。框架只提供可选的、由游戏定义声明的`completionDelayMs(room)`与房间持久`phaseEarlyFinishAt`，不内置“发言”、3秒或Robot类别。提交事务内设置提前结束时刻，宿主到点按房间锁和原阶段实例确认完整决策后结算；未配置时继续使用原固定截止。恢复沿用保存的绝对时刻，不能重开时钟、重复结算或越过新阶段。中性接口与验收见[运行时v3.1](../../docs/specs/turn-based-model-runtime-v3.md#已提交决策后的可选提前结束v31已实现)。

确认补记：2026-09-23用户在v1.2范围审阅后明确回复“实现”，批准该MOD发言跳过及其所需的通用提前结束接口。跨模块修改前本地检查点为main/5d53f95；基线类型、仓库、构建检查和单元99/99通过，新增数据库集成与真实模型试跑尚未运行。以下开始先写可失败测试再实现。

接口细化：Seat可选持久`controllerKind: robot | human`，用于游戏定义区分同样具有`userId`的Robot和真人；不提供该字段的原有中性席位不获得Robot专属自动跳过。模型Robot开局由受信任宿主写`robot`，公开视图不暴露控制策略字段。

验证补记：通用Runtime在普通决策提交事务中记录提前结束绝对时间，到点以房间锁结算；若前一阶段在`tick`中截止，先返回该阶段的结算视图，不在同一次调用抢先提交下一阶段动作。修复密封普通决策后同席旧抢占错误仍将房间blocked的竞态，并更新旧测试对按席lane和固定窗口的预期。一次性真实PostgreSQL测试库中全量`npm test`192/192通过，包含新增双宿主同时到点和恢复扫描；测试库已停止。真实模型付费调用仍未运行。
