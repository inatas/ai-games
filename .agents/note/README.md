# 需求 Notes

此目录使用用户指定的单数`note`。每个编号文件只承载一个可继续完善的需求，保留目标、边界、验收、实现进展和未决问题；不把这里当作日志堆积处。

命名：`NNN-topic.md`。状态：draft（未纳入当前开发）、in_progress（已实现部分或仍待验收）、implemented（对应验收有证据）、rejected（记录理由）。按同一个文件持续完善，不因小修订重复创建需求。

从[TEMPLATE.md](TEMPLATE.md)开始。架构不变量归[ARCHITECT.md](../../ARCHITECT.md)，开发流程归[AGENTS.md](../../AGENTS.md)，具体测试契约归[docs/testing](../../docs/testing/framework.md)。需求状态变更必须引用实际证据；尚未运行的Docker或真实模型检查不算通过。

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

