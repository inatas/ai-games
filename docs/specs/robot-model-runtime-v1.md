# Robot模型席位运行时 v1（提案）

状态：待确认。本文定义Robot用户以模型身份参赛时，模型**路由、调用、上下文组装输入、结果输出**四段的接入契约。通用框架契约不在此重复：调用时序与截止见[运行时v3](turn-based-model-runtime-v3.md)，上下文装配机制见[Context Composition v1](context-composition.md)与[框架规格](framework.md)，狼人杀场景与输出契约见[MOD模型方案](../../mods/werewolf/docs/model-integration-v1.md)。本文只定义接入参数、职责边界、缺口与验收；确认前不写实现与可执行测试。

## 发言命名统一 v1（2026-09-26，已实施）

当前协议的 `DecisionInput.intent` 与 `current_action.request_type` 只使用 `SPEECH | SELECT`；模型发言结果字段为 `speech`，狼人杀普通发言行动为 `kind:'speech'`。跨层验收见[根需求 029](../../.agents/note/029-speech-terminology.md)，游戏接入见[狼人杀需求 008](../../mods/werewolf/.agents/note/008-public-evidence-and-terms.md)。旧协议房间需在部署前核对，不能自动按新定义恢复。

## v2 增量：统一决策适配与六区充足性（2026-09-23，已确认实施）

用户回复“确认，继续推进”，确认本增量的一名模型Robot与脚本Robot同局、统一决策输入输出、模型经Harness和六区授权上下文接入。真实试跑费用上限人民币10元；游戏默认动作整表及预言家随机合法查验已确认。未决的候选列表编码和人格生成细节不并入本轮。

本次目标是让一个模型Robot与脚本Robot在同一局中经过同一套**游戏决策入口**。这里须区分两种适配：`ModelAdapter`只把已封装的消息送往具体模型并取回文本；`DecisionAdapter`把一个席位的`DecisionInput`变成`DecisionOutput`，可由script或model实现。统一输入输出是游戏决策层的契约，不要求脚本Robot伪装成网络模型，更不能让模型Robot回落为随机脚本。

建议的中性契约为：

```ts
type DecisionInput = {
  requestId: string;
  actor: { roomId: string; seat: number; phaseInstance: number; windowId: string };
  intent: 'SPEECH' | 'SELECT';
  scene: string;
  context: AuthorizedContext;
  constraints: { deadlineAt: number; outputSchema: object };
};
type DecisionOutput = { kind: 'proposal'; value: Json } | { kind: 'no-valid-input'; reason: string };
```

`AuthorizedContext`由MOD按该席授权事实构造，`scene`、合法选项和截止点由宿主给出。`DecisionAdapter`接收冻结的同一份输入：script在本地以种子选择合法选项或固定发言；model通过Harness组合消息、预算、审计和`ModelAdapter`生成，再解码。两者只返回提案或无合法输入；原游戏裁判统一校验、等待截止点、执行默认动作、提交与公开。`candidates`等非执行日志字段不改变提案。Harness拥有上下文组装、请求生命周期和模型校验；脚本不必制造模型token用量，但同样留下决策来源和动作审计。

现有`RoomRuntime`已经拥有按`Seat.modelProfile`路由和Harness调用；现有`DemoRooms`则直接在`tick`内抽样、构造发言，尚无上述统一入口。实施时以持久`RoomRuntime`为模型局主路径，脚本与模型席位通过中性决策入口提交给同一个游戏裁判。`DemoRooms`保留为旧演示基线或在全部调用方迁移后移除，由实施方案确定；不得形成两套互相矛盾的规则结算。`RoomRuntime`现有普通任务单通道及失败即blocked，也不足以满足密封并行与截止默认，依赖[运行时v3](turn-based-model-runtime-v3.md)。

### 六区够不够

狼人杀已提出`rules / game_state / self / private_information / public_history / current_action`六区。**作为逻辑容器足够，本身不是完整输入。**是否能让模型分析、争论与行动，取决于区内必须含哪些权威数据，以及长历史如何按预算保留：

| 区域 | 本轮最低内容 | 权限与预算 |
|---|---|---|
| rules | 板型、当前规则版本、胜负/死亡链、阶段截止及缺席默认 | 必需，不能截断 |
| game_state | 天/夜、阶段、存活与公开身份、警徽、已公布死讯、结构化票型 | 必需，依公开水位；不能混入未公布事件 |
| self | userId、座位、本局真实身份、技能资格与余量、固定persona及当前身份策略 | 本席私有且必需；战术偏好不覆盖规则 |
| private_information | 该席可知的队友、查验、授权刀口、药量及私人行动结果 | 依角色与时点裁剪；不可借观战视角扩大权限 |
| public_history | 按顺序的公开发言原文、遗言、公开投票/结算；本人已提交的主张和承诺 | 结构化索引与最近相关原文必需；更早原文按预算选择，保留来源与顺序 |
| current_action | SPEECH/SELECT意图、scene、发言目标或合法optionSet、约束、阶段/窗口ID、绝对截止点 | 必需；只给当前行动可用的选项 |

六区之外仍由Harness附带**协议与输出Schema**，由宿主附带`phaseInstance/windowId/actionId`、可见事件水位与来源版本。这些是信封元数据，不应伪装成第七种游戏事实。`public_history`不能只有一句自然语言摘要：模型判断“谁先说了什么、谁投了谁、主张是否反复”需要原始发言及结构化票型。本人的私有已提交行动、曾经公开的身份主张与事实查验也必须能区分；公开声称不能升级为系统事实。

输入预算先保协议、规则、本席事实、合法选项及必要的最近发言/票型；早期原文可选取、压缩为有来源的摘要，不能无声删除会影响本次选择的必需事实。每次组装记录内容版本、纳入/排除项和原因。必需内容超限时在调用前报`CONTEXT_TOO_LARGE`并遵循截止默认，不截断事实。真实模型质量还需用多局对比评估：合法动作率、引用发言和票型的准确率、自相矛盾率、私密信息泄漏率与不同persona的行为差异；单局可跑完不能证明六区的质量足够。

### 本次验收与待裁定

先用脚本/可控模型适配器的同一`DecisionInput`分别走SPEECH和SELECT，验证提交事件与默认规则一致；验证密封阶段模型席与脚本席并行不互泄秘密；验证长发言历史的预算裁剪保留最新必需记录；验证旧窗口、无效选项、重复提交与重启恢复均不能二次生效。随后用一个真实模型Robot加11个脚本Robot跑完全局，单列真实调用、用量与费用证据。具体测试在方案确认后再写。

待裁定：统一适配器是只用于新的持久模型局，还是同批迁移现有`DemoRooms`；首个真实模型试跑的请求/token/费用上限；`public_history`必需窗口采用“本日全部原文＋更早摘要”还是别的可复现策略；以及[Context Composition v1](context-composition.md)的Profile/Manifest是否同批实施。既有SELECT候选表示尚有两项未决，见[MOD方案](../../mods/werewolf/docs/model-integration-v1.md)。

## 现状与缺口

| 环节 | 已有实现 | 缺口 |
|---|---|---|
| Profile定义 | 狼人杀当前以 `mods/werewolf/robot-users/model-profiles/*.json` 保存env变量名；`loadModelProfiles`校验格式与唯一性 | 只校验引用，不解析变量、不构造适配器 |
| 路由 | `RoomRuntime`构造接收`Record<profileId, ModelAdapter>`，按`Seat.modelProfile`逐席取用；注册表缺失即`UNKNOWN_MODEL` | 服务端没有profile→适配器的装配层；脚本席位与模型席位不共用注册表 |
| Robot接线 | `RobotUser.control`已有`script`/`model`分支；模型用户当前标记不可用并由服务端拒绝 | 无“Robot用户→席位profile”的开局绑定；模型席位不能实际入场 |
| 调用 | Harness的claim/租约/一次纠正/原子提交已实现；宿主调度器已存在 | 按席密封并行、绝对截止、到期默认结算属[v3](turn-based-model-runtime-v3.md)提案 |
| 上下文 | Harness按worldview/facts/instructions/memory组装；MOD已有授权投影`actorView` | MOD侧决策编解码钩子属v3提案；Robot人格与战术未进入`self/agent`区 |
| 输出 | Schema校验、业务二次验证、单事务提交、`fw_model_calls`审计已实现 | SELECT候选日志字段、非法selected的截止点默认结算见[MOD方案v1.6](../../mods/werewolf/docs/model-integration-v1.md)；ContextManifest未落地 |

结论：四段的**机制**大多已有权威设计，真正要新增的是①服务端profile装配与按席绑定②v3的并行/截止/编解码③Robot人格注入与审计补全。不新造第二套协议。

## 一、模型路由

分三级，职责不重叠：

1. **Profile定义（配置层）**。MOD的 profile 文件声明`id`、`adapter`、`defaultProtocol`与`environment`（`baseUrl/model/apiKey/protocol`四个**环境变量名**）；狼人杀当前放在 `mods/werewolf/robot-users/model-profiles/<id>.json`。配置只保存变量名，不保存密钥、不保存供应商URL值。校验规则沿用现有：id唯一且匹配`^[a-z0-9-]+$`、`adapter`当前仅`chat-completions`、四个键名匹配`^[A-Z][A-Z0-9_]*$`。重复或非法profile在启动时失败。
2. **Registry装配（服务端）**。apps/server启动时把每个profile解析为适配器实例，形成`profileId → ModelAdapter`注册表，注入`RoomRuntime`。缺失的环境变量、非HTTPS且非本机的baseUrl、不支持的protocol都在**启动期**失败；不在局中降级、不跨供应商自动重试。
3. **按席绑定（开局）**。Robot用户的`control.modelProfile`在开局装配时写入该席`Seat.modelProfile`；同一局允许每席不同profile，也允许多席共享同一profile（共享适配器实例）。浏览器只提交userId名单与白名单profile名，不提交baseUrl、Key、scopeId或Prompt。

脚本席位与模型席位**共用游戏决策注册表**：脚本用户映射到内置`script-fixed`／`script-random`决策适配器（不读环境变量）；模型用户的决策适配器再查找相应`ModelAdapter`。这样两类席位共享决策输入、输出与裁判提交路径，不要求脚本产生伪造的模型调用记录。既有`DemoRooms`演示基线的去留由v2增量待裁定，不把网络调用塞进`DemoRooms.tick`。

不可用处理：profile未就绪（缺env或缺授权）时，该Robot用户在目录中标为不可用、随机补满排除、服务端拒绝以其开局，**不得静默降级为随机脚本**（沿用020 v2已实现行为）。局内profile配置固化，恢复时不得替换模型；模型差异不改变信息权限、合法选项、阶段期限与默认判定。

## 二、模型调用

- **触发方与归属**：只由受信任宿主（apps/server调度器）驱动`tick`/`tickInterrupt`；浏览器只读旁观。不新增浏览器可调用的模型入口。
- **时序**：短事务登记（`requestId`、`phaseInstance`、`decisionEpoch`、`actionId`、席位profile、memoryVersion、授权facts）→ 释放全部锁 → `Harness.submit`（claim → prepare/组装 → 模型 → 校验 → 提交事务）→ 到期由裁判默认结算。模型等待期间不持行锁。
- **期限**：阶段绝对截止点持久化，不因重启延长；单次调用上限取`min(callTimeout, 剩余时间−3s)`；剩余不足3秒不发新调用；格式纠正、校验与提交都计入原截止点。恰好到期判迟到。
- **并发**：密封阶段按席并行登记与执行，各席独立scope；同席同scope保持串行。夜间共享窗口需同时容纳5个普通任务，**启动前**校验供应商并发限额，不足时在开局配置处拒绝或明确提示，不偷偷延长固定窗口。
- **取消与失效**：阶段切换、合法抢占、关停、超时都会abort；旧响应不得写入状态、事件或有效记忆，也不得复活旧阶段。网络失败不自动重试。
- **幂等**：`requestId`+输入hash；已提交结果按原requestId重取，不重新调用模型；租约只保护执行归属，不等于游戏时间。
- **预算**：沿用房间`maxRequests`，新增按profile的token/费用上限与整局上限；接近上限时中止并在内部审计记录原因码，公共投影不揭密。

## 三、上下文组装输入

职责切分：**MOD决定该席能看到什么**（授权投影），**core决定怎么装**（顺序、预算、去重、来源标记），**model包只接收最终messages**。框架不拥有游戏内容，也不从叙事推导权威状态。

- **MOD侧**：`decisionSpec(state, phase, seat, lane)`是MOD受信任纯函数——**入参可以接触全量`state`，但返回给模型的内容必须只基于该席授权投影**：本次`facts`增量、`instructions`、按该席裁减的`outputSchema`（optionSet必须是该席合法子集，不能给跨角色联合schema）与不可变`codecData`。当前实现的事实信封由[`actorView(room, seat, def)`](../../packages/turn-based/src/engine.ts)给出：`self`／`seats`／`phase`／`def.project(state, seat)`／`visibleEvents(room, seat, reveal=false)`；它与旁观投影共用同一个`project`函数，只以viewer区分，且终局`reveal`与replay永不进入模型视图。`lane`决定使用角色scope还是`interrupt:<seat>`scope。事实在登记时冻结，晚启动任务看不到其他席尚未公开的密封选择。狼人杀的固定六区（rules／game_state／self／private_information／public_history／current_action）与场景清单见[MOD方案](../../mods/werewolf/docs/model-integration-v1.md)。
- **Robot侧新增**：`self/agent`区注入该Robot的人格与身份战术（persona、roleStrategy；来源模式fixed/generated/hybrid）。人格只能影响偏好，不授予额外技能、不改变合法选项、不覆盖系统规则；人格与战术标签不进公共DTO、选座列表或对手上下文。
- **记忆边界**：每个参赛席位拥有自己的角色scope，抢占使用独立interruptScope；`visibility`、`subjectIds`、`requiredMemoryIds`只由服务端Binding代码决定，玩家与浏览器输入不能指定。两个scope不共享模型原始输出，不扫描他人记忆。
- **数据可信度**：第三方发言以带`actor`、时间、来源的untrusted claim数据块进入上下文，不能成为system指令；"我是预言家"只是声称，不是`role=seer`事实。
- **预算**：必需内容（协议、规则、本席授权事实、合法选项、结构化投票/死亡/警徽/查验）不可静默截断；超限在调用前返回`CONTEXT_TOO_LARGE`并走默认结算，不随机删除前一天事实。可选历史按相关性与priority裁剪。
- **可追溯**：每次尝试记录profile、prompt版本、上下文摘要、选项摘要与各块来源版本；[ContextManifest](context-composition.md)是否本轮落地见待裁定。

## 四、结果输出

- **通路**：`rawText`（上限16KiB）→ `JSON.parse` → `outputSchema`严格校验（Ajv、`additionalProperties=false`、枚举为当前optionSet）→ 业务二次验证（游戏`validate`）→ 解码为引擎动作 → 单事务提交（房间状态＋有效记忆＋请求终态）。模型输出只作为数据，不作为可执行代码。
- **SELECT**：输出`{selected, candidates?}`。引擎**只执行`selected`**；非法selected不执行、不换目标、不二次调用模型、不从候选补正，等同"该席没有合法游戏输入"，在该阶段截止点由裁判默认结算。`candidates`仅作内部日志，不参与判定、不改变状态。SPEECH输出`{speech}`，长度由 MOD 的输出 Schema 与游戏裁判规则限制。
- **失败分类**：格式/Schema错误最多一次纠正；业务非法直接拒绝；网络错误不重试；超时与非法输入走同一默认结算路径。业务拒绝不自动改选目标。数据库或规则异常`blocked`，不伪装成默认成功。
- **审计**：记录每次尝试的profile、实际返回model、用量、耗时、错误码、纠正次数与提交终态；审计存profile与prompt/上下文/选项摘要，不把私密正文发到公共DTO。
- **公共投影**：只消费已提交事件；生成中不广播未校验片段，不预填固定句子；夜间不因生成时长或失败暴露行动者、角色生死或人数。

## 五、装配与安全

密钥只由服务端环境注入，profile只保存变量名；Key不入源码、日志、存档或前端。对话局使用独立路由前缀，与无模型演示路由清晰分隔。私密调试座位切换仅本地开放。真实付费运行前须单独确认供应商、profile、并发与预算。

## 六、实施拆分

1. 确认本文与依赖项的版本范围（v3运行时、MOD方案v1.6、人格来源）。
2. 建立Git检查点；不对既有未提交改动做清理或回退。
3. 先写中性失败测试：profile装配（缺失env／非法／重复）、按席路由、不可用用户拒绝、预算中止。
4. 实现服务端profile→模型适配器与Robot→席位绑定；脚本与模型接入同一决策注册表，模型席位再调用模型适配器。
5. 按v3实现密封并行、绝对截止、编解码与截止点默认提交。
6. MOD接入六区上下文、SELECT/SPEECH编解码与候选日志字段。
7. 验证：单元与中性契约 → 真实PostgreSQL并发与恢复 → 1模型席位+11脚本席位整局 → 12席；真实模型证据单列profile、额度与时间。

## 七、验收说明

| 用例 | 通过标准 |
|---|---|
| RM-01 Profile装配 | env变量名解析正确；缺失/非法/重复/未知adapter在启动期拒绝；日志与错误信息不含密钥值 |
| RM-02 按席路由 | 同局至少两个不同profile，逐席捕获真实请求证明路由与型号正确；多席共享同一profile不串扰 |
| RM-03 不可用处理 | profile未就绪的Robot不可选、不可随机补满、不能绕过UI开局、不静默降级为脚本 |
| RM-04 期限与并行 | 密封席并行启动，提交顺序不影响结算；到期默认结算一次且不因纠正延时 |
| RM-05 并发限额 | 供应商并发不足以覆盖共享窗口时在开局前拒绝或提示，窗口不被延长 |
| RM-06 上下文隔离 | 每席请求只含授权事实；不含他人秘密、未公布死讯、他人analysis或终局replay |
| RM-07 上下文预算 | 必需块超限返回`CONTEXT_TOO_LARGE`并走默认结算，不删规则、不静默截断 |
| RM-08 输出权威 | 非法selected不执行、不换目标、不从候选补正；仅改动candidates不改变动作与事件 |
| RM-09 恢复与幂等 | 已提交请求重取不重调模型；未过期按requestId恢复；租约过期只兜底一次；双宿主不产生第二次有效动作 |
| RM-10 审计 | 记录profile/model/用量/耗时/错误/纠正；公共DTO、对手上下文与历史不出现密钥、人格标签与私有概率 |
| RM-11 预算中止 | 请求/token/费用超限时中止或拒绝开局，原因只进内部审计，不揭示私密行动数量 |
| RM-12 端到端 | 1模型席位+11脚本席位完整终局，再12席；Mock路由通过不冒充真实供应商证据 |

## 八、待裁定

1. 首个profile/供应商/模型、试运行席位、并发上限与请求/token/费用预算；本文不猜供应商规格。
2. 脚本席位是否统一并入profile注册表（本文建议是；`DemoRooms`演示基线不受影响）。
3. 本轮是否落地ContextManifest及`fw_context_manifests`表，或先只做请求摘要。
4. 模型局是否使用独立路由前缀并与无模型演示并存于同一页面。
5. 人格来源：本轮只做固定人格，还是同时做开局生成（fixed/generated/hybrid）。
6. 依赖项确认顺序：v3运行时与MOD方案v1.6是否与本方案同批确认。
