# 文档导航

当前规范入口：[开发指引](../AGENTS.md)、[架构指引](../ARCHITECT.md)。需求按主题维护于[.agents/note](../.agents/note/README.md)。

| 文档 | 作用 |
|---|---|
| [账号与世界观设计 v1](specs/accounts-worldview.md) | 已确认的公共模块、接口、数据与交互 |
| [账号与世界观测试设计 v1](testing/accounts-worldview.md) | U/W验收场景及数据 |
| [DeepSeek接入设计 v1](specs/deepseek-provider.md) | 已实现的V4.1 Flash协议与本地配置 |
| [DeepSeek测试设计 v1](testing/deepseek-provider.md) | 协议、密钥与真实冒烟验收记录 |
| [模型上下文前缀缓存设计 v1](specs/model-context-cache-v1.md) | 待确认的消息顺序与缓存用量接口 |
| [模型上下文前缀缓存测试设计 v1](testing/model-context-cache-v1.md) | 待确认的前缀、权限与用量验收场景 |
| [模型上下文缓存 v2](specs/model-context-cache-v2.md) | 已实施的共享公开前缀与真实命中率观测；待新局实测 |
| [模型上下文缓存 v2 验收](testing/model-context-cache-v2.md) | 已实施的前缀、权限和供应商对比用例 |
| [模型测试与日志 v2](specs/model-test-observability-v2.md) | 已实施的网页诊断查询、失败分类与持久记录 |
| [模型测试与日志 v2 验收](testing/model-test-observability-v2.md) | 已实施的成功、失败、恢复与隐私用例 |
| [狼人杀本机模型测试台 v1.1](../mods/werewolf/docs/web-model-test-v1-1.md) | 已实施的免手工口令与用户目录凭据装配；待网页新局实测 |
| [本机狼人杀测试运维 v1.1](specs/local-werewolf-test-ops-v1.md) | 待确认的旧账本、日志、四局回放清理与一条指令启动 |
| [本机狼人杀测试运维 v1.1 验收](testing/local-werewolf-test-ops-v1.md) | 待确认的清理边界、备份、启动与新局留痕用例 |
| [Robot 阵容升级 v5](specs/robot-roster-deepseek-v5.md) | 待确认的 12 DeepSeek＋1 Script 配置与房间接入 |
| [Robot 阵容验收 v5](testing/robot-roster-deepseek-v5.md) | 配置、路由、预算和恢复用例 |
| [模型对局 Token 用量记账 v1](specs/model-token-accounting-v1.md) | 已确认的按房间实际 Token 汇总与旧预留停用方案 |
| [模型 Token 记账测试设计 v1](testing/model-token-accounting-v1.md) | 成功、失败、重启和本机权限用例 |
| [模型房间单一宿主 v1](specs/model-room-single-owner-v1.md) | 待确认的同库调度所有权与恢复协议 |
| [模型房间单一宿主测试设计 v1](testing/model-room-single-owner-v1.md) | 双宿主、退出接管与启动边界 |
| [通用Context Composition设计 v1](specs/context-composition.md) | 待确认的多游戏背景与NPC状态组装协议 |
| [Context Composition测试设计 v1](testing/context-composition.md) | 待确认的CTX中性验收场景 |
| [框架规格](specs/framework.md) | MVP定义与协议细节 |
| [AI MUD框架规格](specs/ai-mud-framework.md) | realm、MOD、授权投影与共享任务契约 |
| [AI MUD框架验收](testing/ai-mud-framework.md) | MF-*中性场景与迁移检查 |
| [迁移计划与回退](ai-mud-migration-plan.md) | 旧档备份、恢复演练和部署顺序 |
| [框架测试](testing/framework.md) | F-*中性验收场景 |
| [测试数据](testing/fixtures.md) | 中性宿主与Mock定义 |
| [开发指南](development.md) | Docker、环境变量、运行与验证 |
| [验证记录](verification.md) | 实际执行证据和未验证项 |
| [武侠Quickstart](../mods/qingxi/README.md) | 游戏自己的规则与接入 |
| [Demo测试](../mods/qingxi/tests/README.md) | D-*专属测试和数值 |

