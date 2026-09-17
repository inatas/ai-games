# AI驱动MUD框架设计

版本v1：用户已确认。本文是实现契约；实际验证状态见[需求012](../../.agents/note/012-ai-mud-framework.md)。

三层调整后的模块归属以[三层设计](three-layer-architecture.md)为准：原mud-core机制拆入platform与game-systems，旧入口仅兼容；本文的游戏行为及存档隔离约束继续保持。

## 产品与分层

产品是AI驱动的多人在线角色扮演MUD框架。通用运行机制与题材规则分离，AI Harness作为子系统保留。

| 模块 | 职责 |
|---|---|
| identity | 账号、会话、角色归属、realm准入及当前角色授权 |
| platform | realm、角色身份、在线、频道/私聊、队伍关系、钱包账本 |
| game-systems | 房间与出口、NPC、空间策略、库存、共享任务及MUD视图 |
| core（现有Harness） | 记忆、上下文预算、模型调用协调、输出校验、受控提交 |
| model / storage | 模型适配；公共持久化、事务与迁移 |
| MOD | 属性定义、具体组织、技能、战斗公式、成长、物品效果、任务内容、地图、NPC及世界观 |
| apps | 注册MOD、装配服务；呈现经过授权的通用Web投影 |

保留packages/core现有名称与公共入口，避免与职责调整无关的改名。新增packages/mud-core；青溪镇迁至mods/qingxi。未来有实际复用需求再提取可选规则包，不预建武侠引擎。

依赖：MOD→game-systems/platform/core公共契约，game-systems→platform→core；core与platform不反向导入游戏系统。迁移归对应能力模块，storage保留组合迁移入口；MOD私有表由MOD迁移负责。浏览器只消费投影和公开素材。

## 世界定义与实例

地图契约MapDefinition独立于NpcDefinition。NPC的initialRoomId是可选出生位置，不是当前位置；MOD与World装配检查非空初始位置引用，允许未出生的NPC定义。地图校验与投影只接收地图。mud_npcs继续保存realm内唯一NPC的位置、状态与revision；NPC模块提供updateNpc，调用方验证目的房间。不增加实例表或自动剧情循环。

MOD版本定义一种游戏：manifest包含modId、version、兼容契约版本、内容版本、世界观版本、配置Schema与规则入口。realm是该MOD版本的运行实例；相同MOD可运行多个独立realm。MVP只在启动时显式注册受信任本地MOD，不接受用户上传代码。

加载时检查重复ID、引用完整性、规则注册、配置Schema及版本兼容；失败阻止对应realm启动，不静默加载其他版本。世界观是必需上下文，配置不能覆盖权限或工具契约。

## 数据所有权

| 对象 | 权威字段与约束 |
|---|---|
| realm | id、modId/modVersion、contentVersion、worldviewVersion、revision；共享房间、NPC与公共事件归realm |
| character | id、userId、realmId、playerScopeId、revision、active；位置归角色，对外只给授权投影 |
| player scope | 属性、背包、探索、个人任务、个人关系与个人记忆；每个角色唯一绑定 |
| party | id、realmId、revision、成员与生命周期；成员必须是同realm当前角色，同角色至多一队 |
| task instance | id、realmId、definitionId、partyId、状态及冻结参与者；个人任务由MOD的player scope管理 |
| reward claim | taskInstanceId、recipientCharacterId、rewardKey唯一，防止重放重复奖励 |
| presence | 当前会话活动及过期时间；不增加角色或Harness记忆版本 |

公共NPC的身份、位置和公共状态只有realm一份；对特定玩家的关系、私有剧情与记忆留在player scope。个人任务敌人与公共NPC明确区分，不能把所有敌人一律私有化。

继续保持每账号一个当前角色的MVP限制；realmId是显式关联，不因此开放多角色界面。新局保留旧scope历史，原子失活旧角色、撤销邀请、解除队伍关系，创建新角色；不重置realm和他人。旧角色不能继续领取奖励或占据队伍容量。

## 规则与行动契约

MOD提供定义与服务器规则：属性Schema及初值、组织与加入规则、技能资格/消耗/效果、战斗结算、任务与奖励、可见性裁剪及可用动作。简单内容用数据；复杂行为用TypeScript，不强行数据化全部逻辑。

通用引擎负责动作注册、严格输入Schema、授权、版本、幂等、事务、事件与投影；MOD负责是否合法及如何计算。服务器从身份确定actor与realm，不接受客户端声明的奖励、所有者或权威状态。规则执行禁止模型/网络等待；AI需要时先读取授权快照，释放事务后调用，最终事务重验全部依赖版本。

新增协调层不能只依靠“同player scope串行”保护共享对象。请求记录actor/realm、输入摘要、依赖对象版本；最终事务锁定所读写的共享资源，重验状态，原子提交游戏效果、必要记忆、事件、领取记录与请求结果。失效提案返回冲突，不重复结算。

统一锁序：授权用户（多用户按ID排序）→realm→party/task（类型及ID排序）→player scope（ID排序）→实体/领取记录。MVP共享写操作可用realm行锁串行化短事务；数据库事务不跨AI等待。新局、移动、聊天收件人确定、组队与奖励均遵守这一顺序，禁止不同路径反向获取锁。

## 共享任务

party持有任务实例，领取时冻结参与者名单，之后入队者不自动取得该任务奖励资格。MOD决定具体目标、贡献条件和奖励公式；框架检查领取者属于已冻结参与者且仍是授权当前角色。

完成任务与奖励领取采用唯一记录防重。队伍人数要求由MOD传给通用任务协调器。离队者不再推进原任务且丧失未领取奖励资格；最后一名成员离开或队伍解散，未完成任务取消，未领取奖励失效，保留历史。青溪镇提供两人护送药箱委托，具体数值见其[本地需求](../../mods/qingxi/.agents/note/004-qingxi-mod.md)。

## 聊天与在线

所有查询强制realmId。say保存发送瞬间同房在线接收者，离开后仍可读当时收到的消息，后来进入者不能回看。tell仅双方可读，目标必须是同realm当前角色。chat为realm公共频道，返回有限条历史；新加入者可看该realm最近公共历史。消息和队伍写入都有内容摘要，重复ID改内容返回冲突。

presence通过认证心跳维护，登出撤销相应会话，多个会话只要一个有效则在线。只读游戏快照不更新角色表或制造游戏事件。列表不包含密码、用户私有字段或其他玩家任务内容。

## 授权上下文

身份服务先确定调用者与角色归属；MUD引擎结合realm、位置、可见性和MOD规则生成授权视角。Harness只收到该视角中的事实与获准记忆引用，不自动扫描realm数据库。角色、realm、party的记忆不因同处一个世界而混读。

MVP沿用现有Harness玩家scope记忆，realm公共事实通过宿主事实输入提供；暂不扩展全局AI记忆检索。只有允许的信息才可进入模型，不能先把NPC秘密和私聊送入模型再要求其保密。记录判定依赖的公共状态版本，公共NPC移动或任务变化后拒绝过时提案。

## Web与接口

通用客户端消费WorldView：realm/version、当前场景、可见实体、出口、属性显示描述、技能/任务/物品卡片、允许动作、社交投影。标签、图标和美术资源由MOD公开配置提供，浏览器不硬编码青松门或固定hp/qi字段。

目标接口为/api/mud/current、/api/mud/actions、/api/mud/requests/:requestId及对应social/presence路由。服务器从当前身份解析角色，不通过任意scopeId获取世界。迁移期间保留/api/wuxia兼容适配，委托同一服务且不复制规则；旧requestId继续返回原结果。错误保留INVALID_INPUT、FORBIDDEN、STATE_CONFLICT、IDEMPOTENCY_CONFLICT以及MOD提供的规则原因码。

## MVP边界

交付青溪镇一个可玩MOD，加一个中性的自动化测试MOD，证明引擎不依赖武侠词汇、属性或公式。末世完整内容留到后续；测试MOD只验证替换世界观、属性与规则入口。保留Web、PostgreSQL与现有Docker服务划分，暂不引入消息队列、WebSocket、插件市场、热加载或沙箱。
