# 目录职责与文档归属

适用场景：阅读或评审架构、规划模块、创建或调整需求与文档、修改代码、跨包或MOD接入。

修改代码前阅读[架构指引](../../ARCHITECT.md)，再阅读对应的[需求索引](../note/README.md)与需求正文。MUD目标架构迁移历史见[需求012](../note/012-ai-mud-framework.md)。

## 目录与职责

每个开发任务在建 note、改 docs 或写代码前，先判断目标行为属于哪一层。当前只有三个 note 归属入口，底层与游戏框架共用根入口：

| 行为所有者 | note 入口 | docs 入口 |
|---|---|---|
| 底层及游戏框架（跨 MOD 可复用） | [根 `.agents/note`](../note/README.md) | 根 `docs/specs`、`docs/testing` 及相关架构主题 |
| 清溪镇 MOD | [清溪镇 `.agents/note`](../../mods/qingxi/.agents/note/README.md) | `mods/qingxi/docs` 与本地测试契约 |
| 狼人杀 MOD | [狼人杀 `.agents/note`](../../mods/werewolf/.agents/note/README.md) | `mods/werewolf/docs` 与本地测试契约 |

先问规则/契约是否能脱离某个 MOD 复用；能则归根目录，不能则归对应 MOD。代码位于 `apps/server`、`apps/web` 或公共包并不自动决定需求归属。跨层任务分别维护根 note/docs 与 MOD note/docs，各自定义接口和验收、互相链接；不在单个 note 或 docs 中混写两层权威规则。

- `packages/*/src`：可复用能力；跨包只使用 `@game-ai/*` 公共入口，不绕过导出读其他包的src。
- `packages/*/tests`：包自身单元测试；`tests/integration`：真实数据库和框架集成；`tests/support`：中性测试工具。
- `apps/server/src`：Fastify装配、鉴权与进程入口；`apps/web/src`：React Demo界面。
- `mods/qingxi`：武侠游戏规则、Quickstart、专属测试；不得反向导入core。
- `.agents/note`：框架公共能力及仓库级需求；每项新的独立 feature 使用新序号文件，同一 feature 的修订在原文件维护，包含范围、验收、进展和未决项；状态与索引按该目录的 AGENTS.md、README.md 维护。
- `mods/qingxi/.agents/note` 与 `mods/werewolf/.agents/note`：各 MOD 专属需求，各自独立编号。
- `docs`：根目录只维护底层/游戏框架主题；MOD 专属规则、界面、数据与游戏验收分别归其 `mods/<mod>/docs`。各层优先更新对应既有文档，只有缺少合适主题时才新建。

### 需求与文档归属

目标目录为`mods/<mod>`：具体世界的内容配置、规则实例、可执行规则、素材、测试和需求归其本地。通用房间/实体机制、realm/player/party归属与协调、身份授权及AI Harness能力归根需求。迁移期间`mods/qingxi`继续作为青溪镇唯一编辑入口，迁移后保留来源链接，不并行维护两份规则。具体门派、技能数值或题材公式不因被称为“规则”而进入通用框架。

按需求职责归档，不按当前实现文件所在位置归档。账号与会话、持续记忆、上下文组装、模型适配、通用校验和执行属于根目录note；游戏世界观正文、背景故事、NPC设定、行动资格、奖励和剧情属于对应示例的note。即使游戏页面位于apps/web，游戏专属需求仍归示例。

MOD如有自己的AGENTS.md，可补充本地指引；无论是否存在本地文件，都继承根目录及按需加载规则中的需求确认门禁、测试和安全规则，不重复维护另一套审批流程。MOD note沿用根目录模板与状态定义，使用NNN-topic.md命名，在本地README.md维护索引；根目录索引提供MOD入口。

MOD README.md作为Quickstart；较详细的游戏设计放mods/<mod>/docs，游戏测试用例说明和数据契约可放本地docs或tests/README.md，并由note链接到唯一正文。新增 MOD feature 使用下一个序号 note；相关规则与验收更新相应架构文档，不按每个 feature 默认新建 docs。可执行游戏测试归mods/<mod>/tests，框架测试保持题材中性。

跨框架与游戏的需求拆成相互链接的两份note：框架note定义通用能力与契约，示例note定义接入方式和游戏验收。分别记录确认范围及验证证据，不复制协议正文。已有根目录示例note可保留为接入边界与历史索引；后续游戏细节在示例目录持续完善，迁移时保留来源链接及确认记录。

## 文档权威

用户当前指令优先；AGENTS.md提供规则入口与文档分工、开发顺序总说明，本目录rules管对应场景的详细门禁和流程，ARCHITECT.md管架构、依赖与文档结构，docs/specs和docs/testing管协议细节，note管各 feature 的需求演进与验收进度。发现冲突时同步修正，不保留两个相反的当前定义。更改这些指引不需要额外人为审批流程。
