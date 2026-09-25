# Agent Notes 索引

本目录使用单数 `note`，保存**底层与游戏框架层**的需求、决策和验证记录。新 feature 用新的三位序号；同一 feature 的修订沿用原 note。先判断行为归属；MOD 专属需求分别见[青溪镇](../../mods/qingxi/.agents/note/README.md)和[狼人杀](../../mods/werewolf/.agents/note/README.md)。目录操作、状态定义与迁移条件见[AGENTS.md](AGENTS.md)，新文件从[TEMPLATE.md](TEMPLATE.md)开始。

状态以文件中的 `Status:` 为准，索引同步维护：`proposed` 包括待确认、实施中和范围内待验收；`implemented` 要有完成与验证证据；`rejected` 保留不采用的依据；`archived` 保留失效或被替代的历史及后继链接。当前采用平铺文件，不按状态移动路径。状态不是用户批准与否，确认依据另写在 note 中。

| 编号与主题 | 状态 | 当前范围或接力信息 |
|---|---|---|
| [001 框架边界](001-harness-boundary.md) | proposed | Harness 边界与宿主接口仍在持续核验 |
| [002 持续记忆](002-continuous-memory.md) | proposed | 记忆和上下文能力持续完善 |
| [003 可靠执行](003-reliable-execution.md) | proposed | 幂等、事务与恢复持续完善 |
| [004 模型适配](004-model-adapter.md) | proposed | 模型适配与校验持续完善 |
| [005 武侠 Quickstart](005-wuxia-demo.md) | proposed | 历史接入边界；游戏题材后续归青溪镇 MOD |
| [006 仓库与 Docker](006-repository-docker.md) | implemented | 目录与开发环境 |
| [007 Agent 规划](007-agent-planning.md) | proposed | 未来规划与路由，尚未纳入实现 |
| [008 NPC 互动](008-npc-interaction.md) | proposed | 未来互动与历史事件响应 |
| [009 账号持久化](009-accounts-persistence.md) | implemented | 公共账号与持续档案 |
| [010 世界观上下文](010-worldview-context.md) | implemented | 公共世界观约束 |
| [011 可组合游戏上下文](011-composable-game-context.md) | proposed | v1 方案待确认 |
| [012 AI MUD 框架](012-ai-mud-framework.md) | proposed | 主要迁移已有证据，剩余人工验收见 note |
| [013 三层游戏平台](013-three-layer-platform.md) | implemented | 三层架构、共享能力和验收 |
| [014 未发布阶段兼容清理](014-breaking-cleanup.md) | implemented | 旧入口与迁移清理 |
| [015 事实事件与投递](015-event-delivery.md) | implemented | 原子落库与幂等投递 |
| [016 角色与 NPC 共用 Action](016-shared-actions.md) | implemented | 共用行动和执行 scope |
| [017 配置地图与移动](017-configured-map.md) | implemented | 严格 JSON 与 MOD 接入 |
| [018 行为树与调度](018-behavior-trees.md) | implemented | 持久调度与有界模型决策 |
| [019 房间制回合框架](019-turn-based-matches.md) | implemented | v1 与抢占 v2；新提案仍单独标注待确认 |
| [020 Robot 用户目录](020-robot-users.md) | implemented | 用户配置与脚本控制 |
| [021 模型调用事件日志](021-event-log.md) | implemented | 持久调用诊断；真实网页实局待用户复核 |
| [022 AI 决策规则引擎](022-decision-rules-engine.md) | proposed | 通用规则已部分实施，剩余范围见 note |
| [023 模型上下文缓存](023-model-context-cache.md) | implemented | 前缀与用量观测已实施；真实命中率待对比 |
| [024 模型 Token 用量记账](024-model-token-accounting.md) | implemented | 按成功响应 usage 汇总，旧预算表已清理 |
| [025 模型房间单一调度宿主](025-model-room-single-owner.md) | proposed | 防止双服务并行推进；方案待确认 |
| [026 Agent Note 生命周期](026-agent-note-lifecycle.md) | implemented | 四态、目录规范与唯一索引检查已落地 |
| [027 开发任务层级归属](027-layer-ownership-routing.md) | implemented | 三个 note 目录及对应 docs 的路由规则已写入项目入口 |
| [028 全仓三层归属重组](028-repository-layer-reorganization.md) | proposed | v1 待确认；迁移根目录错位文档与应用中的 MOD 专属代码 |

目前没有标为 `rejected` 或 `archived` 的编号 note。状态变化时同步此表；不要因暂时无人开发就把 `proposed` 猜作 `rejected`，也不要因代码已存在就把待验收范围标为 `implemented`。

权威架构见[ARCHITECT.md](../../ARCHITECT.md)，开发顺序见[根 AGENTS.md](../../AGENTS.md)和[规则索引](../rules/README.md)。设计与验收正文按主题维护在 `docs`；本索引只定位 note，不复制协议或充当测试报告。
