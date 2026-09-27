# 狼人杀需求

本目录编号 note 的状态见下列索引；状态规则与工作流见[本目录 AGENTS.md](AGENTS.md)。`proposed` 包含待确认、实施中和范围内待验收，不能从“已有代码”推断已完成。

- [001 全AI十二人旁观MVP](001-ai-spectator-mvp.md)：proposed；规则v2、抢占v3及无模型旁观UI已确认并实施，真实模型与生产调度待后续方案。最新全仓156项回归通过，证据见note。
- 公共回合制能力见[根需求019](../../../../.agents/note/019-turn-based-matches.md)。
- [UI视觉与交互方案](../../docs/ui-prototype-v1.md)，[演示接口与素材说明](../../docs/ui-demo.md)，[启动方法](../../README.md)。
- [头像状态方案](../../docs/avatar-states-v2.md)：死亡覆盖v3.2已实施；六类简化平面图片、棕褐统一配色，夜亡保留“出局”，覆盖头像加原外框总面积并使用2px纯黑边，沿用当前角色可见权限；浏览器组件验收通过，前轮138项单元通过。开发记录归001。

原型v2.1已完成：[主界面](../../docs/prototypes/ui-v2-avatar-main.png)、[状态对照](../../docs/prototypes/ui-v2-avatar-states.png)。预言家标签为好/狼，补充毒杀，音频暂不做；应用实现范围仍待后续确认。

001后续：[模型接入v1开发方案](../../docs/model-integration-v1.md)，draft，待用户确认；当前无模型与旁观版本已由用户验收。

- [002 Robot策略规则集](002-decision-rules.md)：proposed；预言家首日 80% 概率上警 v1 已实施，女巫平安夜公开刀口留待单独裁定；依赖[框架需求 022](../../../../.agents/note/022-decision-rules-engine.md)。
- [003 狼人杀模型规则前缀](003-model-context-cache.md)：proposed；稳定牌局规则前置与动态事实去重 v1 已确认实施，依赖[框架需求 023](../../../../.agents/note/023-model-context-cache.md)。
- [004 狼人杀事实上下文与遗言一致性](004-witch-claim-consistency.md)：proposed；事实上下文投影 v1.3 已实施并验证，遗言拦截待单独确认；双服务调度另见[根需求 025](../../../../.agents/note/025-model-room-single-owner.md)。
- [005 网页模型对局测试台](005-web-model-test.md)：implemented；本机免手工口令、用户目录凭据与一条指令启动均已部署，待网页新局实测；旧账本/日志清理见根需求 021、024。
- [006 警长共用退水窗口](006-shared-sheriff-withdrawal.md)：implemented；全体候选人共用 10 秒退水窗口，再锁名单投票，网页真人新局待复核。
- [007 发言输出规则配置](007-speech-output-rules.md)：implemented；200 字上限与共用座位号称呼规则已接入，稳定指导前置；真实 KV 命中率待新局观察。
- [008 公开证据链与狼人杀术语](008-public-evidence-and-terms.md)：proposed；四层人工知识库及公共证据链 v2 已实施，真实模型效果待验收。
- [009 JEV 与现有模型的 SELECT 旁路对比](009-jev-select-shadow-comparison.md)：proposed；v1 获得 000015 实局对照，v1.1 已关闭本机旁路并验证服务健康，后续真实 SELECT 零旁路调用待自然对局复核。
- [010 狼人杀模型网络失败恢复](010-model-network-retry.md)：proposed；v1.1 已部署本地服务，真实模型断网对局与供应商账单待复核。

当前没有 `rejected` 或 `archived` 的狼人杀 note；状态变化时同步本索引。
