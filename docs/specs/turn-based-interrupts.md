# 房间阶段抢占 v2（已确认并实现）

归属：[需求019](../../.agents/note/019-turn-based-matches.md)。扩展[现有v1契约](turn-based-matches.md)，本增量于2026-09-21获用户“确认执行”。实现与实际验证证据见需求019。

## 目标与边界

允许MOD定义在某阶段内可随时提交的插队动作；普通模型请求等待期间不阻塞插队判断。框架负责资格校验、并发、原子提交和恢复；动作含义、可用阶段与业务结果由RoomDefinition定义。原v1单pending无法支持该要求，拆分单席阶段也不能替代独立抢占通道。

“随时”表示允许阶段内独立受理，不要求当前执行者或阶段全部actors完成。LLM有推理延迟，不承诺零延迟响应，本文仅定义服务端接口。已经提交的公开事实不回滚；先提交的抢占令尚未提交的旧动作失效。

## 服务端契约

- Phase新增可选interrupt字段，包含actors、schema和策略key；缺省禁止插队。公开Phase DTO不增加该字段，避免泄漏各座位的私有行动资格。
- RoomDefinition新增validateInterrupt(state, phase, seat, value)与resolveInterrupt(state, phase, seat, value)同步纯回调。结果为`{ pass: true }`或Transition；pass不改变游戏状态、不发布公共事件。框架重验Schema、阶段实例和资格后才调用。
- Runtime保留普通tick；新增tickInterrupt(roomId, seat)，只供受信任宿主调度。模型profile来自已入座白名单，外部不得提交任意scope或模型配置。
- 每座位增设interruptScopeId作为独立执行通道：普通行动与插队可并行，但同scope仍串行，不修改Harness的单scope保护。两条scope均绑定同一座位，模型事实只使用该席位的actorView与私有事件，不能读取其他座位历史。
- 插队上下文采用当前授权事实和事件，不跨scope复制Harness记忆；pass记录为该通道内部操作，不当作公开动作或已发生游戏事实。成功动作的游戏事件按MOD audience发布，后续普通上下文可见。

## 调度与预算

阶段进入、公开事件变化时为合资格席位安排独立插队判断；普通动作与这些判断并发。允许阶段持续期间，pass后可按服务端配置间隔再次判断，不限于普通动作开始前的固定窗口。默认间隔1000ms，单席最多一个未完成插队请求；每次判断计入房间maxRequests，超限aborted且不揭密。不自动重试网络失败。间隔与并发数只影响响应延迟，不改变可插队资格。

受信任宿主可调用`run(roomId, { interruptIntervalMs: 1000 })`同时调度普通动作与抢占；也可分别调用tick/tickInterrupt自行调度。run只对指定已就绪房间运行，返回非running快照后停止新登记；close停止全部登记并等待在途请求退出。同一Runtime重复run共享调度任务；数据库仍负责跨实例请求幂等。阶段/公共事件变化通过至多25ms的轮询发现；pass后的间隔从该lane调用完成时计算。

普通tick不会等待pass收齐。已有同lane请求时并发tick共享requestId，重启亦沿用；不重复创建模型请求。宿主只启动已配置游戏的调度器，关闭时停止新登记并等待/终止现有执行。

## 数据与版本

Room文档以pendingJobs替换原pending，按lane（normal、interrupt:seat）索引，记录requestId、scopeId、seat、profile、memoryVersion、phaseInstance和授权facts；新增decisionEpoch。普通已提交动作和成功抢占递增epoch；每个job固定登记时读取的epoch。pass不增加epoch，避免相互无意义失效。

tb_seats增加独立唯一interrupt_scope_id；两scope均由宿主创建fw_scope。仅tb层拥有lane，core不依赖回合框架。普通scope有效记忆仍由Harness维护；规则状态只由tb事务决定。

文档版本升级不保留旧pending兼容分支。若开发库已有旧版tb房间，实施前先核实本项目数据库及tb数据，备份并验证恢复；明确停止旧调度后显式重建该项目tb数据与关联执行scope，不能在应用启动时删除。不得清空其他游戏scope或其他项目库。若无需保留则也须记录核实结果，不能以Git提交替代数据库备份。

## 提交、竞态与恢复

1. 登记持短事务room→lane scope→Harness request锁，冻结该席位授权事实，释放锁后调用模型。
2. 登记后向Harness提交前也持room锁重验job身份、阶段与epoch，避免尚未提交的旧登记占用新请求scope。最终提交仍按同顺序，校验运行状态、job身份、阶段实例、epoch、当前资格与Schema。普通动作与抢占按取得room锁并成功提交的顺序线性化，不以供应商开始/完成时间裁定。
3. 成功抢占原子提交MOD Transition、可见事件、请求结果与内部有效记忆，递增epoch/phaseInstance，令所有旧jobs失效；同一抢占请求不得重复执行。旧jobs即使模型稍后返回，也不能写入状态、事件或有效记忆。
4. epoch过期是被取代，不是游戏失败；删除对应过期job后可在新状态合法登记新请求。若阶段已禁止插队，不再登记。网络/非法决策则blocked；只接受当前有效job的失败，旧job迟到失败不阻断新阶段。
5. 过期scope若仍有Harness processing租约，保留其执行状态等待完成或租约恢复；不得复用同scope并绕过串行保护。不同scope可继续。中断网络请求仅节省资源，不是正确性前提，不能保证供应商不计费。
6. 两个插队同时到达，先成功提交者生效，后者因epoch失效；若新阶段允许再次插队，必须基于新事实发起新判断，不能将旧提案直接套用。
7. 重启先恢复Harness租约，再处理持久job；已提交结果重放，未过期租约不重新调用。短事务回滚不留下部分状态变更、部分有效记忆或未原子提交的终局结果。

## 验收

新增中性游戏TB-09～TB-14见[测试契约](../testing/turn-based-matches.md)。真实PostgreSQL覆盖竞态、失败、恢复、两scope隔离与原子回滚；具体业务规则的验收由对应MOD文档定义，不作为框架契约的前置依赖。既有TB-01～08继续通过；v1同room同lane并发共享请求语义不变，v2不同lane允许并发。
