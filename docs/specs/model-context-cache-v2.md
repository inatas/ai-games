# 模型上下文缓存 v2（已实施，待实局验证）

关联[框架需求 023](../../.agents/note/023-model-context-cache.md)、[狼人杀需求 003](../../mods/werewolf/.agents/note/003-model-context-cache.md)与[验收说明](../testing/model-context-cache-v2.md)。用户于 2026-09-25 确认实施；v2 已部署到本地测试服务，真实供应商命中率仍待新局对比。

## 现状与目标

现有 `buildContext` 顺序为固定协议、游戏规则、世界观、**动态 Schema**、**CURRENT_FACTS**、记忆、输入。即使历史逐步增长，前面的 Schema、局面和席位信息一变化，后面的公共历史也不再是多席位的相同前缀。狼人杀实局曾报告命中不足 20%；该 MOD 的事实分段见[狼人杀模型接入](../../mods/werewolf/docs/model-integration-v1.md)。

DeepSeek [官方缓存说明](https://api-docs.deepseek.com/guides/kv_cache/)只保证已保存且完全匹配的输入前缀可命中，并说明缓存是尽力而为；本方案提高**可共享前缀**，不承诺任何固定命中比例。

## 消息与数据契约

通用 Harness 增加可选的受信任宿主 `promptParts: { sharedPublicFacts, dynamicFacts }`。未提供者沿用 v1 消息路径；`prepared.facts` 保持业务校验权威数据，不因提示分段而变化。宿主必须用同一冻结快照生成两段，不允许重复、遗漏或额外暴露事实。通用组装仅按分段输出，不从任意 JSON 中猜测哪些字段公开。

采用顺序：固定框架协议 system → 版本固定的游戏规则 system → 可选固定世界观 system → `SHARED_PUBLIC_FACTS` user → 当前 `OUTPUT_SCHEMA` system → 席位和阶段专属 `CURRENT_FACTS` user → 必需/可选记忆 user → 玩家输入 user；第二次纠正只在末尾追加指令。此顺序需通过 DeepSeek 及既有 json-schema 适配器的真实请求兼容性检查；若供应商拒绝交错的 system/user 消息，改用等价的尾部宿主 Schema 段并重新提交差异审阅，不能悄悄降低 Schema 约束。`sharedPublicFacts` 对同一房间、相同公开事件水位的所有席位须字节相同；事件用稳定 sequence、固定字段顺序和规范序列化，按时间追加。可把每条事件编码为独立有边界的记录，避免重排和当前时间戳破坏已形成的前缀。

`sharedPublicFacts` 仅包含宿主已授权的公开结算事实；各 MOD 决定哪些事实可进入该段。动态公开状态、身份、私有动作及结果、选项与截止时间位于其后。所有事实仍遵循“当前结算状态优先”，公共事件的顺序不赋予旧叙述更高权威；分段不得绕过 context budget 与宿主规则校验。

## v2.1 共用指导消息（已实施）

狼人杀发言规范为所有席位共用的规则文本，按[MOD 007](../../mods/werewolf/.agents/note/007-speech-output-rules.md)确认纳入缓存前缀。通用规则配置的 `guidance` 可选 `placement: stable`，仅由受信任 MOD 作者用于不含身份、昵称名单、私有情报或当前行动的座位无关文本；未标记的指导规则默认保持后部私有位置。规则仍先按当前 `DecisionInput` 匹配，未匹配者不发送。匹配的稳定 guidance 按优先级放在游戏规则之后的独立 system 消息，然后依次发送公开历史、动态 Schema、当前席位事实与记忆。原有授权、版本和预算不变；缓存命中率取决于供应商实际返回。

## 观测和验收判定

逐次记录供应商 `prompt_cache_hit_tokens/prompt_cache_miss_tokens`（有效时）及诊断用 `promptLayoutVersion`、前缀段摘要、各段字节数；只记录摘要不存第二份私有原文。按房间、席位、阶段和布局版本聚合 `sum(hit)/(sum(hit)+sum(miss))`，同时显示未报告调用数与首次冷请求。正常 inputTokens 包含缓存命中 token，不能把 hit 从输入账单里扣掉。

先离线比较同一历史轨迹下 v1/v2 相邻请求的字节级最长公共前缀及隐私边界；再在持久真实模型对局中采集同配置基线与新版的逐次 usage、调用次数、输入总 token、命中率。以明确改善可共享前缀且无越权/事实缺失为功能验收；实测命中率作为结果记录，若未提升则从前缀摘要定位原因再修订，不能仅凭静态规则“理应缓存”宣称成功。不扩供应商调用预算，不为测量重复发送完整对局调用。

## v3 分层知识与规则顺序（提案，尚未实施）

本段是 v2/v2.1 当前实现之上的待审阅方案；用户要求知识库分层且固定顺序，具体狼人杀文件由[MOD 模型设计](../../mods/werewolf/docs/model-integration-v1.md)拥有。通用框架接收已授权、已确定顺序的消息段，不知道板子、职业或术语的含义：

```ts
promptParts: {
  sharedKnowledge?: { id: string; content: string }[];
  sharedPublicFacts: Json;
  privateKnowledge?: { id: string; content: string };
  matchedGuidance?: string[];
  dynamicFacts: Json;
}
```

组装顺序为固定协议 → `sharedKnowledge`（由 MOD 依次给板子背景、全部职业描述、全部通用词条）→ `SHARED_PUBLIC_FACTS` → `privateKnowledge`（仅本人职业操作指南）→ `matchedGuidance`（仅本次命中的场景规则）→ `OUTPUT_SCHEMA` → `CURRENT_FACTS` → 记忆与输入。世界观如存在，放在共享知识之前的稳定位置，不能夹入私有内容或随席位变化。`sharedKnowledge`同板子、同知识版本时字节完全相同；职业描述与词条按稳定 ID 排序，既不由文件系统枚举顺序决定，也不按本人职业重排。公开历史保留在私有指南之前，以便同一公开水位的不同席位共享更长前缀。`privateKnowledge`只由受信任 MOD 按实际席位身份授权，不能因为它是固定文本就发给所有人。所有必需知识段均计入 token 预算，超限显式失败，不静默删词条或职业。

v2.1 的 `stableGuidance` 由规则匹配后提前放在共享前缀；这与用户指定的“职业指南之后才是 ruleset”冲突。v3 删除此前置语义：所有匹配的 guidance 经 `matchedGuidance` 放在本人指南之后，硬约束仍由规则引擎处理。迁移时更新 `Prepared`、上下文构造、规则装配、诊断布局版本及全部调用方，避免旧、新字段并存造成次序不确定。短期可能减少 SPEECH 规范跨职业共享的缓存长度，但全员背景、全职业描述、术语及公开历史仍提供共享前缀；真实命中率只以供应商返回的 usage 为准。

版本及恢复：受信任 MOD 提供确定性知识顺序和内容摘要，当前房间定义版本绑定选中板子与知识摘要；重复决策、重启恢复必须发送同一内容。运行中改文件不热更新；若重启后摘要不符，旧房间不能被新文本悄悄重放，需在部署前核对运行中房间并决定如何保留。协议不增加公共旁观字段、数据库表或新的模型调用。验收见[缓存测试 v3](../testing/model-context-cache-v2.md)。
