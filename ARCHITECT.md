# 架构指引

## 开发架构与文档地图

项目分为统一底层、游戏形态框架和具体 MOD 三层。当前有**三个 note 归属目录**：底层与游戏框架层共用根 `.agents/note`，清溪镇使用 `mods/qingxi/.agents/note`，狼人杀使用 `mods/werewolf/.agents/note`。需求落在哪层，由**行为所有权**决定，而非页面、服务或测试文件实际放在哪个目录。一个狼人杀专属页面即使写在 `apps/web`，其玩法需求仍归狼人杀 MOD；多个游戏复用的房间调度或模型调用规则才归框架。下层不得引用上层的题材规则，跨层通过公开契约连接。

| 内容 | 归属 | 应维护的文档 |
|---|---|---|
| 底层通用能力，如模型适配、记忆、授权和持久化 | `packages/*`；根 `.agents/note/NNN-*.md` | 根 `docs/specs` 和 `docs/testing` 的对应主题；影响依赖边界时更新本文件 |
| 游戏形态框架，如回合房间、阶段窗口和抢占 | 相应框架包；同一个根 `.agents/note` | 根框架规格和测试契约；不写清溪镇或狼人杀专属规则 |
| 清溪镇规则、世界、策略、视图和素材 | `mods/qingxi/.agents/note/NNN-*.md`；实现可经 `apps/*` 装配 | `mods/qingxi/docs` 现有的游戏设计、接口及验收主题 |
| 狼人杀身份、竞选、房规、策略、视图和素材 | `mods/werewolf/.agents/note/NNN-*.md`；实现可经 `apps/*` 装配 | `mods/werewolf/docs` 现有的规则、计时、接口及验收主题 |
| 进程装配与页面宿主 | `apps/server`、`apps/web` | 归行为所有者的 note 和 docs；应用目录本身不决定需求归属 |

`.agents/note` 按**新的独立 feature** 编号，记录目标、范围、确认、实施证据及[生命周期状态](.agents/note/AGENTS.md)；同一 feature 的版本修订继续使用原 note。`docs` 按**架构主题**积累唯一权威正文，不随每个 feature 增生一组平行方案文件。先查需求索引与现有设计、接口、数据和测试文档；只有没有合适主题文档时才新建，并接入索引。note 负责索引和决策记录，docs 负责稳定的规则与契约，代码和可执行测试负责实现与验证。

例如，狼人杀“候选人共用退水窗口”是独立可验收行为，应使用新的狼人杀 note；规则写入狼人杀现有游戏设计，10 秒窗口写入阶段计时，超时默认写入行动截止，行为用例写入现有游戏测试契约。它不应追加在早期旁观 MVP note 的尾部，也不应为同一功能另建互相平行的设计和测试 docs。跨层需求分别建立框架与 MOD note，并链接到各自的契约，不把题材逻辑塞入通用层。

现存代码与文档仍有历史错位：游戏专属页面和服务位于 `apps/*`，部分狼人杀测试方案位于根 `docs`。完整迁移目标、依赖边界、兼容约束及验收见[重组方案028](.agents/note/028-repository-layer-reorganization.md)；方案未确认前，这里只说明拟议目标，不将其描述成当前目录状态。

## 开发流程与架构一致性

1. **发现与定位**：读根 `AGENTS.md`、规则索引及命中规则，先判定底层/游戏框架、清溪镇、狼人杀哪个层拥有目标行为；跨层则拆分职责。随后检查所选目录的需求索引、现有 note、对应层的 docs 和代码，明确是新 feature、原 feature 续做，还是已有实现缺陷。
2. **文档先行**：新 feature 建下一个序号 note，续做更新原 note；先更新对应既有的架构设计、接口、数据和验收说明。方案需覆盖状态转换、授权、事务、截止与恢复等实际相关边界，并写明非范围和待裁定项。拟议行为与运行中的当前行为明确区分。
3. **审阅与确认**：提交具体方案版本和实施范围。游戏规则裁定确定目标行为，不自动确认技术方案。未获明确方案确认前，只做调查与文档检查；不修改实现、可执行测试、迁移或部署配置。已确认范围内继续开发无需重复确认；新增范围单独审阅。
4. **测试与实现**：确认后按规模建立 Git 检查点，先写可失败的行为测试，再实现最小跨层改动。框架提供中性机制，MOD 提供题材规则，应用只装配和展示授权投影。接口变化同步改所有调用方；持久状态、并发、超时和重启按契约验证。
5. **验证与收敛**：运行与风险相称的定向、回归、类型及仓库检查，记录实际证据。完成后把 docs 改成单一当前定义，把 note 标为实际状态；未运行的真实数据库、浏览器或模型检查不得写成通过。历史提案可保留来源，但不能与当前规则并列为两个权威版本。

上述流程的操作性门禁以[开发方案确认规则](.agents/rules/development-approval.md)、[实施与安全规则](.agents/rules/implementation-and-validation.md)和[目录归属规则](.agents/rules/repository-layout.md)为准；本节说明流程如何保持三层架构及文档一致性。用户本次对文档组织的要求优先于旧的归档习惯。

## 产品边界

项目采用统一基础框架，第二层分别承载MUD游戏框架与房间制回合游戏框架，第三层MOD拥有具体游戏内容与规则。2026-09-20用户已确认房间制回合框架独立建设，不强制整合MUD；通用框架v1已实现，狼人杀接入尚未完成，见[需求019](.agents/note/019-turn-based-matches.md)及[架构大纲](docs/specs/turn-based-matches.md)。现有MUD运行层提供共享世界、实体、授权视角与协作机制，青溪镇为其首个MOD，门派、武功、内力和伤害公式均属于该MOD。

Game AI Harness是其中供游戏按需调用的AI判定子系统。NPC与历史事件持久存在；当游戏需要综合推理时才调用模型。Harness不内置回合、题材、战斗、数值成长、剧情触发或NPC自主循环。

当前三层契约见[三层设计](docs/specs/three-layer-architecture.md)和[需求013](.agents/note/013-three-layer-platform.md)。用户已确认；原[需求012](.agents/note/012-ai-mud-framework.md)保留MUD迁移历史。基础层负责realm、通信、组队和钱包；可选系统负责地图、NPC、任务与库存；MOD负责玩法。真实支付为可选平台集成，尚未接入渠道。

## 依赖方向

下图为现有实现。已新增独立房间制回合框架，狼人杀MOD正在实现：狼人杀→房间制回合框架→统一底层；房间制回合框架与game-systems互不依赖，底层不得反向导入任一框架。应用分别装配两种游戏类型。


```text
apps/server ──► registered MOD host + platform + game-systems + identity + core + model + storage
apps/web    ──► generic HTTP WorldView + identity browser adapter
identity    ──► core persistence contracts + public HTTP/browser adapters
mods/qingxi ──► game-systems + platform + core contracts + storage transaction
game-systems ──► platform + core contracts
platform    ──► core contracts
model       ──► core model contracts
storage     ──► core persistence contracts
core        ──► own types + AJV
```

core不导入apps、MOD、platform、game-systems、具体模型或PostgreSQL驱动。platform不导入可选系统或查询空间/任务/库存状态；由服务端策略提供局部收件人、邀请资格、任务退出回调。回调与基础操作处于同一事务。game-systems不导入MOD；浏览器只导入视图类型。当前持久化接口仍感知PostgreSQL，不声称可无成本更换数据库。

## 公共账号与基础世界观

identity属于框架公共模块，负责密码、持久会话、当前scope授权及幂等新局；服务器装配公共路由，浏览器通过identity/browser入口复用登录组件，不能把服务端密码模块打入前端。storage拥有公共表迁移、世界观文件加载与版本存储。宿主仅提供initialize(tx,scopeId)初始化游戏数据，不自行生成登录凭据。

每用户一个当前scope和角色。行动登记在同一事务内通过authorizeCurrent校验，随后锁定realm、scope；新局遵循同一顺序并使旧角色失活、退出队伍、撤销邀请。processing时拒绝切换。旧局持久保留但不能通过公共游戏API继续读写。读状态和记忆使用同一事务，防止返回混合版本。跨角色共享写入以短事务锁定realm；模型等待期间释放全部锁。

世界观是服务端受信任配置，以worldId/version固定关联scope，每次assessment及纠正都加入完整系统上下文并记录版本摘要。它属于必需预算，不能被可选历史挤出，也不授权越过协议、宿主规则或Schema。Harness允许不绑定世界观的独立scope；游戏账号由宿主配置完成绑定。具体题材正文仍由宿主提供。详细协议见[账号与世界观](docs/specs/accounts-worldview.md)。

## 五层与不变量

| 层 | 必须保持 |
|---|---|
| 持续记忆 | scope隔离；已提交事实与失败提案分开；来源可追溯；游戏状态优先于历史摘要 |
| 上下文 | 宿主授权范围内检索；必需内容不截断；预算超限在调用前失败 |
| 模型适配 | 只返回数据；无数据库权限；格式最多纠正一次；网络失败不自动重试 |
| 校验 | 严格Schema；游戏验证器负责业务资格；执行前重验宿主版本 |
| 执行 | 只调用已注册MOD宿主；同scope串行，共享写入锁定realm；游戏变化、记忆、结果一个事务提交 |

生命周期：登记并释放短事务→读取事实/记忆→模型→校验→最终事务→提交。等待期间不持有行锁。到期请求失败后，旧执行者不得覆盖新提交。已提交结果按原requestId重取，不重新运行模型。无AI动作使用recordMemory模式绑定，共享相同提交机制。

事实、事件、摘要和开放事项在实现中合并到`fw_memory`，用kind区分并按scope查询；这是MVP物理布局，逻辑职责仍分离。来源引用限定本scope事件；公开记录不能引用内部来源，避免泄漏。

## 环境与装配

Docker Compose提供`app + postgres`；测试profile提供`tests + postgres-test`。app端口按用户确认映射主机网卡，数据库不发布端口；开发库持久卷与测试临时库分离。容器内服务监听0.0.0.0，宿主直接运行默认127.0.0.1。

React页面消费通用WorldView；青溪镇是首个受信任MOD。中性测试MOD通过同一HTTP宿主证明引擎可更换世界观、属性和规则。未来规划器、Agent路由、互动会话位于Harness上方：父任务不得持有scope锁等待子任务；每一步分别提交。见对应未来需求，不在当前MVP加入空实现。

## 变更规则

跨游戏框架的系统按实际需求抽象。背包、道具等当前保持已有归属，未来多个框架确有共用需求后再提取共同契约；本轮不预建公共玩法系统或将库存迁入底层。


配置驱动运行见[详细设计v1](docs/specs/configured-game-runtime.md)及需求015～018：用户已确认并实施。事件基础设施归platform，Action、地图规则与行为树归game-systems，JSON内容与受信任规则函数归MOD。NPC有独立执行scope，但没有账号/玩家角色；调度位于Harness上方，保持Harness无自主NPC循环的不变量。事件与状态同事务提交，模型决策和后续动作分别提交，叙述不成为权威事实。

未发布阶段不维护旧包、旧API或旧数据升级路径，按当前结构初始化；必要时显式重建本项目开发库。旧代码通过Git查看，不留在运行路径。当前版本重启须保留状态，事务、授权和幂等规则不变。详见[需求014](.agents/note/014-breaking-cleanup.md)。

地图与NPC分别定义：MapDefinition含房间、出口、注册条件引用和地图版本；NpcDefinition含身份描述及可选initialRoomId（仅用于初始化）。World可组合两者；地图投影不依赖NPC。运行时位置以mud_npcs为准，玩家/NPC普通移动共用moveActor；既有管理/任务状态更新保留锁与revision协议。MOD装配校验初始位置引用；无出生位置的NPC允许仅存在于目录。配置不执行任意代码，首版无Lua、YAML解析或通用规则DSL。

第二层框架的设计、接口、验收与包文档使用题材中性的示例，不引用第三层具体实现作为范例或协议依据。具体规则和接入映射归MOD本地文档，由MOD引用框架契约；需求索引可保留跨层需求追踪链接。

新增能力优先扩展已明确的Binding/ModelAdapter/记忆操作接口。涉及跨包协议、状态格式、事务边界或权限的改动，同步更新本文件、需求note和测试。协议详见[框架规格](docs/specs/framework.md)，框架验收详见[测试规格](docs/testing/framework.md)。

房间阶段抢占v2提案见[抢占设计](docs/specs/turn-based-interrupts.md)：允许阶段内独立插队、短事务提交、旧响应失效；提案待确认，尚未改变当前单pending实现或Harness同scope串行不变量。
