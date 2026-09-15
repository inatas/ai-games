# Quickstart：用框架接入一个超简易武侠 MUD

版本：0.1 ｜ 状态：已实现基础Demo；标准启动入口见 [开发指南](../../docs/development.md)

下一版v2设计：[房间驱动的武侠世界MVP](docs/world-mvp.md)、[地图表现](docs/map-presentation.md)、[验收用例](docs/world-mvp-testing.md)及[实施计划](docs/world-mvp-plan.md)，均待确认，尚未替代本文当前实现说明。

前置阅读：[框架定义](../../docs/specs/framework.md)。本Demo是独立游戏宿主，所有武侠逻辑都在examples/wuxia-mud中；core不认识侠义、师父、挑战或奇遇。

## 1. 演示目标与范围

玩家是初入江湖的旅人，在一个文本页面选择行善、奇遇、拜师、挑战，并可补充一句行动说明。游戏自行计算成本、资格和胜负；只在奇遇分支及师父态度两个位置委托AI综合判定。

单角色、一名师父、一个挑战对象、四种行动；不做地图移动、背包、装备、升级树、随机战斗、多人或游戏终局。无自动时间推进。AI输出有限枚举，页面显示游戏生成的实际结果，不由模型自由编造奖励。

## 2. 游戏自己的状态和规则

新游戏：银两silver=20、侠义virtue=0、武学skill=1、师承master=null、hostVersion=0。字段类型：前三者为非负整数，master为null或"青松道人"。每次成功游戏操作hostVersion+1，拒绝或失败不变。

scope对应此存档，memoryVersion初始0。framework version与hostVersion概念独立；本Demo所有成功行动都经框架事务，因此演示中两者一起增加，但不能把这个巧合写成框架规则。

| 行动 | 游戏规则与运算 | AI责任 | 框架接入 |
|---|---|---|---|
| 行善 | silver>=2；扣2，virtue+1 | 无 | recordMemory保存事实和事件 |
| 奇遇 | 仅能完成一次；按合法分支计算奖励 | 综合历史选择GIFT或GUIDANCE | assessment + 游戏apply |
| 拜师 | 未有师父且virtue>=2才可请求；ACCEPT令master="青松道人"、skill+1；DEFER无属性变化 | 基于行善记录和玩家陈述判断师父态度 | assessment + 游戏apply |
| 挑战 | skill>=2胜，否则败；胜silver+3，败无属性变化 | 无，胜负由游戏计算 | recordMemory保存结果 |

奇遇：GIFT令silver+4；GUIDANCE令skill+1。两分支都将游戏字段encounterDone设true；该字段初始false，成功后不可再次奇遇。本字段属于游戏，不是框架开放事项状态的隐式替代。

挑战不消耗资源、不影响skill，可重复。失败挑战是一次成功处理的游戏行动：有“落败”结果、事件和版本增加；技术失败/规则拒绝才是不提交。拜师DEFER同理，是合法判定，提交一次“暂缓收徒”事件。

拜师不足virtue或已有master时，在prepare阶段拒绝，不调用模型；事务中apply必须再次检查，防止等待期间发生变化。奇遇已完成也在入口与apply各检查一次。

## 3. 记忆如何帮助持续交互

开局在创建游戏的同一事务中写入事实投影，不调用模型；可将这些记录视为初始化，不增加memoryVersion。事实投影只含本Demo公开状态。

行善事件包括行为、实际silver/virtue变化、标签good_deed。宿主第一次行善同时open_item“曾帮助村民，后续相遇可参考”，来源为该行善事件；后续行善不重复创建该事项，是否已创建由宿主自己的记录引用决定。

奇遇prepare把该开放事项及来源列为必需上下文（存在时），再检索行善历史；AI在合法结果中选择。游戏apply完成奖励并关闭该事项（若存在）。未行善也可奇遇，只是不带该事项。奇遇失败、超时或提交冲突不关闭事项、不标encounterDone。

拜师prepare提供当前virtue、skill、已有师承、玩家陈述及行善历史。游戏的硬资格仍为virtue>=2；历史仅供AI判断ACCEPT或DEFER，不能绕过资格。

示例体现的是：游戏决定何时使用过去的行为，框架保证事实可保存和检索。框架不会主动产生奇遇、安排拜师或推迟某个游戏回合。

## 4. 接入步骤

### 步骤一：建立宿主与存储

Fastify服务注册框架core与PostgreSQL仓储。创建游戏表wuxia_characters：id、scope_id、silver、virtue、skill、master、encounter_done、good_deed_item_id、host_version；字段约束由宿主迁移定义。

初始化游戏与scope/事实投影在一个事务完成。React显示状态和四个动作按钮，无需框架提供通用游戏UI。用户附加说明限制0～200码点，不用于自动路由其他行动。

### 步骤二：先实现不使用AI的运算

游戏service实现doGood与challenge。调用recordMemory，在宿主回调中锁角色、核对hostVersion、检查前提、计算变化并返回事件/事实更新。框架负责记忆合法性、幂等和事务。

先验证“行善20→18、侠义0→1”和“初始skill1挑战落败”，此时完全不需要模型Key。

### 步骤三：注册两个判定绑定

| binding | 输入Schema | 严格输出Schema |
|---|---|---|
| wuxia.encounter v1 | {note:string}，0～200码点，无额外字段 | {choice:"GIFT"或"GUIDANCE"}，无额外字段 |
| wuxia.apprenticeship v1 | 同上 | {choice:"ACCEPT"或"DEFER"}，无额外字段 |

prepare提供当前hostVersion、事实与检索条件。输出只含choice，没有银两/武学变化字段；模型无权决定奖励数量。

validate检查候选合法性以外的宿主前提；apply在框架事务里锁角色，检查prepare读到的hostVersion，重验规则，计算表中效果，生成实际结果与MemoryChange。游戏apply负责关闭事项、更新encounterDone和角色事实投影。

### 步骤四：接入Web请求

先接入公共POST /api/auth/login登录/自动注册，GET /api/auth/session恢复，POST /api/auth/logout登出，POST /api/game/current/reset开启新局；宿主提供initialize(tx,scopeId)初始化规则数据。移除游客新建接口，游戏路由使用HttpOnly会话Cookie授权，并在行动登记事务中校验当前scope：GET /api/wuxia/games/:id读公开状态；POST /api/wuxia/games/:id/actions提交{requestId,expectedMemoryVersion,action,note}；GET /api/wuxia/games/:id/requests/:requestId查询结果。

action仅为good_deed/encounter/apprenticeship/challenge。游戏按action调用recordMemory或assessment，框架不解释action。统一202登记、200查询终态；业务资格拒绝由已登记请求返回rejected/RULE_REJECTED及detail游戏原因；输入/幂等冲突仍通过HTTP状态返回。

为保证幂等，宿主重复请求先重取原请求，不能先因“已奇遇/已拜师”拒绝旧成功请求；同ID改变action或note属于冲突。宿主把action包含在传给框架的规范化请求内容中，或使用不同bindingId标识，避免两动作哈希碰撞。

页面处理中禁止新动作，刷新继续查询原ID。结果显示模板叙事、真实变化及当前状态；不暴露原始模型响应、Key或内部日志。

### 步骤五：从Mock切换真实模型

先按[Demo测试与数据](./tests/README.md)跑固定脚本，再配置一个真实供应商。演示时允许合法选择不同，不能强求每次同一剧情；游戏运算必须始终满足规则。

在仓库根目录执行docker compose up --build -d，打开http://localhost:3000。默认Mock无需Key；真实模型通过.env注入。测试使用docker compose --profile test run --build --rm tests。当前机器的Docker由用户自行安装，容器验证状态另见docs/verification.md。

## 5. 一条完整演示路径

| 步骤 | 游戏状态silver/virtue/skill/master | 版本 | 模型 |
|---|---|---|---|
| 新建 | 20/0/1/null | 0 | 无 |
| 行善 | 18/1/1/null | 1 | 无 |
| 再行善 | 16/2/1/null | 2 | 无 |
| 拜师ACCEPT | 16/2/2/青松道人 | 3 | 1次 |
| 挑战 | 19/2/2/青松道人 | 4 | 无 |
| 奇遇GUIDANCE | 19/2/3/青松道人 | 5 | 1次 |

版本列在本路径中同时表示hostVersion和memoryVersion。奇遇完成后encounterDone=true，开放事项closed。每个成功行动一条游戏事件，总5条；开放/关闭事项不另算游戏事件。模型调用总2次。

## 6. 目录与验收边界

开发流程见[本地开发指引](AGENTS.md)，游戏需求见[本地note索引](.agents/note/README.md)。游戏专属新增或调整在本地记录；公共框架能力在根目录note记录，跨层需求相互链接。

examples/wuxia-mud/src保存规则、绑定、迁移；apps/web/src保存React页面；examples/wuxia-mud/tests保存游戏用例，apps/server/src负责装配。框架core不能导入这个目录。

Demo验收四个动作和上述接入链路，不代表框架内置这些规则。框架可靠性由F-*验证；Demo数值和语义由D-*验证。新增游戏只写自己的宿主和测试，不修改框架内容。


