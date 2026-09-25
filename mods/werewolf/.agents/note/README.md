# 狼人杀需求

- [001 全AI十二人旁观MVP](001-ai-spectator-mvp.md)：in_progress；规则v2、抢占v3及无模型旁观UI已确认并实施，真实模型与生产调度待后续方案。最新全仓156项回归通过，证据见note。
- 公共回合制能力见[根需求019](../../../../.agents/note/019-turn-based-matches.md)。
- [UI视觉与交互方案](../../docs/ui-prototype-v1.md)，[演示接口与素材说明](../../docs/ui-demo.md)，[启动方法](../../README.md)。
- [头像状态方案v2](../../docs/avatar-states-v2.md)：待确认，统一死亡图案/单层边框/移除装饰及九类状态，含视角与音频接入选项。

原型v2.1已完成：[主界面](../../docs/prototypes/ui-v2-avatar-main.png)、[状态对照](../../docs/prototypes/ui-v2-avatar-states.png)。预言家标签为好/狼，补充毒杀，音频暂不做；应用实现范围仍待后续确认。

001后续：[模型接入v1开发方案](../../docs/model-integration-v1.md)，draft，待用户确认；当前无模型与旁观版本已由用户验收。

- [002 Robot策略规则集](002-decision-rules.md)：in_progress；预言家首日 80% 概率上警 v1 已实施，女巫平安夜公开刀口留待单独裁定；依赖[框架需求 022](../../../../.agents/note/022-decision-rules-engine.md)。
- [003 狼人杀模型规则前缀](003-model-context-cache.md)：in_progress；稳定牌局规则前置与动态事实去重 v1 已确认实施，依赖[框架需求 023](../../../../.agents/note/023-model-context-cache.md)。
- [004 狼人杀事实上下文与遗言一致性](004-witch-claim-consistency.md)：in_progress；事实上下文投影 v1.3 已实施并验证，遗言拦截待单独确认；双服务调度另见[根需求 025](../../../../.agents/note/025-model-room-single-owner.md)。
- [005 网页模型对局测试台](005-web-model-test.md)：v1 已部署本地，待新局实测；本机免手工口令与用户目录凭据 v1.1 待确认。
