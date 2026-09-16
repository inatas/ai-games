# 武侠游戏需求 Notes

本目录存放武侠示例专属需求：角色设定、世界观正文、背景故事、行动规则、拜师、挑战和奇遇等。公共能力需求仍归[框架需求索引](../../../../.agents/note/README.md)。

遵循[根目录开发指引](../../../../AGENTS.md)与[示例开发指引](../../AGENTS.md)，从[公共模板](../../../../.agents/note/TEMPLATE.md)开始，按本目录独立编号命名NNN-topic.md。模板中的相对链接须按本地位置调整；沿用draft、in_progress、implemented、rejected状态及需求、范围、验收、当前进展、待完善字段。每份note记录待确认版本或已确认范围，并链接设计、测试数据和实际验证证据。

## 现有需求入口

| 入口 | 用途 |
|---|---|
| [既有005需求](../../../../.agents/note/005-wuxia-demo.md) | 基础Demo的历史需求及框架接入边界 |
| [Quickstart与游戏规则](../../README.md) | 当前四种行动、运算和接入步骤 |
| [游戏测试与数据](../../tests/README.md) | 当前游戏验收与测试数据契约 |

| [001 房间驱动的武侠世界](001-room-world.md) | implemented：世界MVP、L2＋轻量L3，v2已确认并部署；验证边界见记录 |
| [002 角色成长与确定性战斗](002-character-growth-combat.md) | in_progress：v3已确认，执行成长、师门任务与战斗闭环 |
| [003 共享江湖与轻量社交](003-shared-realm-social.md) | in_progress：v3已确认，执行共享空间、聊天与临时队伍 |

后续新增或调整游戏功能在本目录记录。跨层需求分别链接框架note与本地note，公共协议仅在框架文档维护。
