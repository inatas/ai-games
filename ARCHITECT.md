# 架构指引

## 产品边界

项目产品方向已调整为AI驱动的多人在线角色扮演MUD框架。通用MUD运行层提供共享世界、实体、授权视角与协作机制；MOD拥有具体题材、内容与可执行游戏规则。青溪镇是首个MOD，门派、武功、内力和伤害公式均属于该MOD。

Game AI Harness是其中供游戏按需调用的AI判定子系统。NPC与历史事件持久存在；当游戏需要综合推理时才调用模型。Harness不内置回合、题材、战斗、数值成长、剧情触发或NPC自主循环。

分层与契约见[AI MUD框架设计](docs/specs/ai-mud-framework.md)和[需求012](.agents/note/012-ai-mud-framework.md)。v1已获确认；实际通过项与部署状态记录在需求note。

## 依赖方向

```text
apps/server ──► registered MOD host + mud-core + identity + core + model + storage
apps/web    ──► generic HTTP WorldView + identity browser adapter
identity    ──► core persistence contracts + public HTTP/browser adapters
mods/qingxi ──► mud-core + core contracts + storage transaction
mud-core    ──► core contracts
model       ──► core model contracts
storage     ──► core persistence contracts
core        ──► own types + AJV
```

core不导入apps、MOD、mud-core、具体模型或PostgreSQL驱动。mud-core不导入题材MOD；浏览器不导入服务端规则。当前HarnessStore是PostgreSQL感知的事务接口，协调器仍使用SQL；本MVP不声称可无成本切换其他数据库。包导出指向TypeScript源码，由tsx启动，当前不发布npm制品。

## 公共账号与基础世界观

identity属于框架公共模块，负责密码、持久会话、当前scope授权及幂等新局；服务器装配公共路由，浏览器通过identity/browser入口复用登录组件，不能把服务端密码模块打入前端。storage拥有公共表迁移、世界观文件加载与版本存储。宿主仅提供initialize(tx,scopeId)初始化游戏数据，不自行生成登录凭据。

每用户一个当前scope和角色。行动登记在同一事务内通过authorizeCurrent校验，随后锁定realm、scope；新局遵循同一顺序并使旧角色失活、退出队伍、撤销邀请。processing时拒绝切换。旧局持久保留但不能通过公共游戏API继续读写。读状态和记忆使用同一事务，防止返回混合版本。跨角色共享写入以短事务锁定realm；模型等待期间释放全部锁。

世界观是服务端受信任配置，以worldId/version固定关联scope，每次assessment及纠正都加入完整系统上下文并记录版本摘要。它属于必需预算，不能被可选历史挤出，也不授权越过协议、宿主规则或Schema。旧游客scope允许世界观为空以兼容既有记录，新账号档案由配置完成绑定。具体题材正文仍由宿主提供。详细协议见[账号与世界观](docs/specs/accounts-worldview.md)。

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

Docker Compose提供`app + postgres`；测试profile提供`tests + postgres-test`。只有app端口映射到宿主127.0.0.1，数据库不发布端口；开发库持久卷与测试临时库分离。容器内服务监听0.0.0.0，宿主直接运行默认127.0.0.1。

React页面消费通用WorldView；青溪镇是首个受信任MOD。中性测试MOD通过同一HTTP宿主证明引擎可更换世界观、属性和规则。未来规划器、Agent路由、互动会话位于Harness上方：父任务不得持有scope锁等待子任务；每一步分别提交。见对应未来需求，不在当前MVP加入空实现。

## 变更规则

地图与NPC分别定义：MapDefinition仅含房间、出口和地图版本；NpcDefinition含身份描述及可选initialRoomId（仅用于初始化）。World可组合两者；地图投影不依赖NPC。运行时位置继续以mud_npcs为准，updateNpc归NPC模块，保持锁与revision协议。MOD装配校验初始位置引用；无出生位置的NPC允许仅存在于目录。不新增实例系统或数据库迁移。

新增能力优先扩展已明确的Binding/ModelAdapter/记忆操作接口。涉及跨包协议、状态格式、事务边界或权限的改动，同步更新本文件、需求note和测试。协议详见[框架规格](docs/specs/framework.md)，框架验收详见[测试规格](docs/testing/framework.md)。
