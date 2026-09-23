# 需求 Notes

配置运行升级（详细设计v1已确认，按015→018完成实现；最终验证见各note）：

- [015 事实事件与投递](015-event-delivery.md)：implemented，原子落库、幂等投递与恢复。
- [016 角色/NPC共用Action](016-shared-actions.md)：implemented，共用移动与独立NPC执行scope。
- [017 配置地图与移动](017-configured-map.md)：implemented，严格JSON及最小MOD样板。
- [018 行为树与调度](018-behavior-trees.md)：implemented，持久调度、有限模型决策与叙述边界。

上述合并回归72/72通过；在线重建网络限制、未部署及真实模型未运行见[验证记录](../../docs/testing/configured-game-runtime-verification.md)。

[014 未发布阶段移除旧版兼容](014-breaking-cleanup.md)：implemented；旧入口/迁移清理完成，61项测试通过，开发库已重建并部署健康。

[013 三层游戏平台](013-three-layer-platform.md)：implemented；三层拆分、库存与钱包基础能力，63项回归及备份恢复通过，部署健康。

此目录使用用户指定的单数`note`。每个编号文件只承载一个可继续完善的需求，保留目标、边界、验收、实现进展和未决问题；不把这里当作日志堆积处。

本目录管理框架公共能力和仓库级需求。MOD专属需求归`mods/<mod>/.agents/note`，独立编号；归属和跨层拆分规则见[开发指引](../../AGENTS.md)。青溪镇入口：[游戏需求索引](../../mods/qingxi/.agents/note/README.md)。现有005保留为Quickstart接入边界及历史入口。

命名：`NNN-topic.md`。状态：draft（未纳入当前开发）、in_progress（已实现部分或仍待验收）、implemented（对应验收有证据）、rejected（记录理由）。按同一个文件持续完善，不因小修订重复创建需求。

从[TEMPLATE.md](TEMPLATE.md)开始。架构不变量归[ARCHITECT.md](../../ARCHITECT.md)，开发流程按[项目规则索引](../rules/README.md)加载，具体测试契约归[docs/testing](../../docs/testing/framework.md)。需求状态变更必须引用实际证据；尚未运行的Docker或真实模型检查不算通过。

| 需求 | 状态 | 内容 |
|---|---|---|
| [001](001-harness-boundary.md) | in_progress | 框架边界与宿主接口 |
| [002](002-continuous-memory.md) | in_progress | 持续记忆和上下文 |
| [003](003-reliable-execution.md) | in_progress | 幂等、事务、恢复 |
| [004](004-model-adapter.md) | in_progress | 模型适配与校验 |
| [005](005-wuxia-demo.md) | in_progress | 武侠Quickstart与Demo |
| [006](006-repository-docker.md) | implemented | 目录和Docker环境 |
| [007](007-agent-planning.md) | draft | 未来自主规划与Agent路由 |
| [008](008-npc-interaction.md) | draft | 未来NPC互动和历史事件响应 |

| [009](009-accounts-persistence.md) | implemented | 公共账号与持续档案（v1已确认并实现） |
| [010](010-worldview-context.md) | implemented | 公共世界观上下文（v1已确认并实现） |
| [011](011-composable-game-context.md) | draft | 可组合的多游戏上下文（v1待确认） |
| [012](012-ai-mud-framework.md) | in_progress | AI驱动MUD框架与MOD边界；主要代码和数据迁移已验收，窄屏/键盘人工验收待做 |


[019 房间制回合游戏框架](019-turn-based-matches.md)：implemented，v1与抢占v2已实现并有真实数据库证据；首个游戏见[狼人杀需求](../../mods/werewolf/.agents/note/README.md)。

019 v3：[模型运行时扩展提案](../../docs/specs/turn-based-model-runtime-v3.md)，draft；v2已实现，v3待确认。

[020 Robot用户目录](020-robot-users.md)：implemented；独立用户配置与素材、默认脚本控制，游戏接入归MOD。

[021 统一执行事件日志](021-event-log.md)：draft；底层审计、模型输入输出留痕与无真实模型整局核查方案，v1待确认。

[022 AI决策规则引擎](022-decision-rules-engine.md)：draft；通用规则集运行、优先级、概率与恢复方案 v1 待确认；游戏规则实例归各 MOD。
