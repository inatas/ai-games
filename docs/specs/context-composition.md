# 通用 Context Composition 设计

版本：v1，待用户确认。本文扩展框架的上下文层；当前DeepSeek配置和现有世界观注入不依赖本设计实施。

## 设计目标

同一个Harness进程可以服务不同游戏。每个存档绑定自己的游戏ID和Context Profile版本；每次AI判定由框架按统一协议组合该游戏的世界观、相关背景、权威运行状态、NPC当前状态、持续记忆、任务契约和玩家输入。

框架负责装配机制，不拥有游戏内容。它不知道“侠义”“阵营”“血量”的含义，不决定哪些NPC出场，也不从叙事推导权威状态。游戏宿主选择本次相关资料并提供实时快照，游戏的`validate/apply`继续执行硬规则。

## 五类来源

| 来源 | 示例 | 所有者 | 默认策略 |
|---|---|---|---|
| 基础设定 | 世界观、时代、物理规律、叙事边界 | 游戏配置 | 必需、版本固定 |
| 背景资料 | 地区史、门派、任务前情、人物设定 | 游戏配置 | 按ID或标签选择，必需或可选 |
| 权威快照 | 时间、地点、玩家状态、相关NPC当前状态 | 游戏宿主 | 必需、每次实时读取 |
| 持续记忆 | 已发生事件、关系、摘要、未了事项 | Harness存储，内容由宿主产生 | 必需来源链加按相关性筛选的可选历史 |
| 本次契约 | 判定说明、允许输出Schema、玩家输入 | Binding及请求 | 必需 |

NPC当前状态只是权威快照。例如同一NPC的身份、公开态度、受伤情况、所在地点和与玩家关系可以组成一个`actor_state`块。NPC是否需要作为Agent运行是更上层的编排决策；不参与当前判定的NPC不会仅因存在于数据库而进入上下文。

## Profile与Block

每个游戏提供不可变的`GameContextProfile`：

```ts
type GameContextProfile = {
  gameId: string;
  version: string;
  blocks: StaticContextBlock[];
};

type StaticContextBlock = {
  id: string;
  kind: 'worldview' | 'background' | 'character_bible' | 'style';
  content: string;
  required: boolean;
  tags: string[];
  priority: 0 | 1 | 2 | 3;
  digest: string;
};
```

部署目录采用一份`context.json`清单引用Markdown文件，例如`WORLD.md`、`lore/region.md`、`characters/master.md`。清单声明稳定ID、kind、required、tags和priority；路径只能位于该游戏配置根目录，禁止路径穿越。单块上限16KiB、静态配置总量上限256KiB；加载时校验UTF-8、重复ID和内容摘要。同`gameId/version`内容不同则拒绝启动。

scope保存`game_id/context_profile_version`，玩家请求不能指定或覆盖。配置升级只影响新存档；旧存档继续解析已持久化的Profile快照。不同游戏可以拥有相同block ID，但查询始终同时限制gameId/version。

## 宿主动态上下文

Binding的`prepare`扩展为返回结构化查询与动态块：

```ts
type PreparedContext = {
  requiredBlockIds: string[];
  loreTags: string[];
  dynamicBlocks: Array<{
    id: string;
    kind: 'world_state' | 'scene_state' | 'player_state' | 'actor_state' | 'quest_state';
    payload: Json;
    sourceVersion: string;
    required: true;
  }>;
  memory: {
    subjectIds: string[];
    tags: string[];
    requiredMemoryIds: string[];
    visibility: Visibility[];
  };
};
```

宿主在`prepare`中查询自己的游戏表，选择当前场景参与者并序列化所需字段。动态块最多64个、总128KiB；ID唯一、JSON深度和字符串长度受限。框架不允许玩家输入直接变成block ID、subject范围或visibility；这些字段只能来自部署时注册的Binding代码。

每个相关NPC一个独立`actor_state`块，便于预算、来源和更新追踪。内部策划备注、其他玩家秘密、未被当前角色感知的信息不应由宿主提供；框架仍按scope和visibility做边界检查。若游戏要模拟NPC私有认知，应创建宿主授权的独立视角scope或明确的内部判定Binding，不能在公共玩家判定中混入全部NPC秘密。

`sourceVersion`必须来自权威状态版本。模型等待期间，最终事务仍通过现有`gameVersion`重验；快照过时则拒绝提交，不能把旧NPC状态用于新结果。

## 固定装配顺序与权威级别

```text
1. FRAMEWORK_PROTOCOL            框架固定安全与输出协议
2. GAME_FOUNDATION               世界观及必需基础设定
3. TASK_CONTRACT                 Binding说明与OUTPUT_SCHEMA
4. AUTHORITATIVE_STATE           世界、场景、玩家、NPC、任务快照
5. REQUIRED_CONTINUITY           必需背景与记忆来源链
6. OPTIONAL_CONTEXT              可选背景和历史记忆
7. PLAYER_INPUT                  本次输入
```

只有1～3使用system消息。动态状态、背景正文、记忆和玩家输入均包装为带类型与来源的JSON数据块，不能提供新的系统指令。背景资料即使包含“忽略此前规则”等文字，也只是数据。

发生冲突时：框架协议和输出Schema不可覆盖；当前权威状态优先于背景设定及历史记忆；宿主硬规则优先于模型描述；同类型当前状态按`sourceVersion`由宿主保证一致。框架发现同ID不同内容、缺失必需块或版本不一致时直接失败，不自行猜测。

## 选择和预算

协议、基础世界观、任务契约、权威快照、必需背景和必需记忆全部属于required，不能截断。它们加输出预留超过窗口时返回`CONTEXT_TOO_LARGE`且不调用模型。

剩余预算由可选背景和可选记忆共享。选择顺序为显式匹配优先，再按priority降序、相关标签命中数降序、新鲜度降序、稳定ID升序。为避免背景或记忆独占全部空间，Profile可声明两类软配额；未使用配额可由另一类借用。单个可选块放不下时跳过并继续尝试后续更小块，而不是立即停止。

组装结果使用稳定的canonical JSON，同一输入和同一快照产生相同消息与摘要。纠正调用复用完全相同的Context Frame，只追加框架纠正消息，避免第二次调用看到不同NPC状态或背景。

## 可追溯清单

每次模型尝试保存`ContextManifest`：profile ID/版本/摘要、所有动态块ID/kind/sourceVersion/摘要、选中的静态和记忆ID、逐块估算token、被排除可选块及原因、总输入预算。正文继续存在各自权威存储中，调用表默认不重复保存敏感正文。

建议新增`fw_context_manifests(scope_id, request_id, attempt, profile_digest, blocks_json, input_tokens)`，与`fw_model_calls`一一关联。该清单用于回答“模型当时看到了什么版本”，不允许通过它绕开原scope授权读取正文。

## 公共模块边界

- `packages/core`：Block类型、选择排序、预算、固定消息布局、ContextManifest。
- `packages/storage`：Profile不可变存储、scope绑定、manifest持久化；不解析游戏payload。
- `packages/model`：只接收最终messages，不选择背景或NPC。
- 游戏宿主：配置静态内容，查询动态权威状态，决定相关NPC和记忆检索线索。
- Agent编排层：决定是否唤醒NPC/剧情Agent；若调用Harness，仍使用同一Context Frame协议。

## 与当前实现迁移

现有`fw_worldviews`记录迁移为Profile中的必需`worldview`块，保持worldId/version和摘要；当前`facts`迁移为必需`player_state`或宿主命名的权威块；`subjectIds/tags/requiredMemoryIds`移入`PreparedContext.memory`。旧API保留一个版本周期的兼容适配，生成相同顺序，之后再移除。

武侠Quickstart会提供自己的`context.json + WORLD.md + lore/*.md`，并在拜师时提供青松道人的当前`actor_state`；测试中另建一个无题材中性宿主和第二个完全不同的游戏Profile，证明框架没有耦合武侠字段。

## 待确认决策

请确认v1的四个关键点：静态资料使用`context.json + Markdown`；动态NPC状态由宿主`prepare`按本次参与者提供；只有协议、基础设定和任务契约使用system角色；每次调用单独持久化不含正文的ContextManifest。确认后再生成实现与可执行测试。
