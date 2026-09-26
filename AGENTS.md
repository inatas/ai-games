# 项目开发规则

任务开始先读[规则索引](.agents/rules/README.md)，按任务场景加载适用规则全文；范围扩大时补读。涉及子目录时，再读该目录的 `AGENTS.md`。本文件只规定入口和分工，详细门禁、验证与安全要求以规则正文为准。

## 需求归属

先按**目标行为**选需求 note 和 docs，不按代码所在的 `packages` 或 `apps` 目录判断：

| 行为归属 | 需求 note | 设计与验收 docs |
|---|---|---|
| 可跨 MOD 复用的底层和游戏框架能力 | [根 note](.agents/note/README.md) | 根 `docs/specs`、`docs/testing` |
| 清溪镇专属规则、Robot 和页面 | [清溪镇 note](mods/qingxi/.agents/note/README.md) | `mods/qingxi/docs` |
| 狼人杀专属规则、Robot 和页面 | [狼人杀 note](mods/werewolf/.agents/note/README.md) | `mods/werewolf/docs` |

若通用机制与 MOD 玩法同时变化，分两层建 note 和 docs，分别写接口与验收并互链。新独立行为建下一个 `NNN-topic.md`，更新同目录索引；同一行为的修订、缺陷修复和续做沿用原 note。以能否独立确认和验收判断是否为新 feature，先检查已有 note，不凭改动大小判断。状态和迁移遵循[Note 目录规范](.agents/note/AGENTS.md)。

[ARCHITECT.md](ARCHITECT.md)规定架构与依赖。note 记录需求来源、方案版本、范围与非范围、待裁定问题、确认依据、实施进度及验证证据；docs 按所属层的**已有架构主题**维护设计、接口、数据和验收，确无合适主题才新建。note 链接权威正文，不复制协议。规则改变时区分当前与拟议行为，实施后收敛为同一当前定义；接口变化同步调用方和验收说明。

## 开发顺序

1. 查现状、适用规则、相关 note 和权威 docs，确定行为归属。
2. 更新所属 note 与设计、接口、数据和验收说明，标记待确认，提交具体方案和范围供用户审阅；此时只做调查与文档，不写实现或可执行测试。
3. 用户明确确认方案后，按规则决定 Git 检查点，先写可失败的行为测试并观察失败，再实现和验证；已确认范围无需重复确认，范围变化只重审变化部分。
4. 将实际运行的结果与未验证项回填 note，并同步 docs。玩法规则裁定或单独的“继续”不代替开发方案确认；发现提前实现时按[开发方案确认规则](.agents/rules/development-approval.md)处理。
