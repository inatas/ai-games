# 狼人杀简明规则集接入 v2（已确认实施）

通用配置与运行约束见[框架方案](../../../docs/specs/decision-rule-config-v2.md)。本 MOD 的作者文件为 `mods/werewolf/rules/ruleset.json`，首条规则按示例配置 `seer-first-day-run`，80% 强制上警。作者只需修改 `priority / instruction / enforcement / probability` 等可读字段，不直接编辑 TS 谓词。

四层人工知识库已接入；按[需求 008 v1.3](../.agents/note/008-public-evidence-and-terms.md)使用 `knowledge/boards`、`knowledge/roles`、`knowledge/terms`、`knowledge/guides`：板子背景按板子选，公开职业按该板子的全部职业选，词条全员逐篇加载，只有本人指南按真实职业选。四层知识属于固定解释文本；本 `ruleset.json` 才按当前职业、场景与条件匹配。知识与策略均不代替裁判代码。装配顺序及 KV 前缀见[模型接入方案](model-integration-v1.md)。

内部处理器拟放 `src/decision-rules/handlers.ts`，`id='seer-first-day-run'` 对应当前已实现的触发条件：当前座位真实身份为预言家、场景为首日 `nominations`、本人可报名。选项映射只从当次合法选项中选择 `nominate/run=true`。`src/decision-rules/index.ts` 静态导入 JSON、调用通用装配函数，并由 `definition.ts` 注册。原 `seer-first-day.ts` 中的作者配置移至 JSON，条件与选项代码留在内部处理器。

若未来要让模型在上警发言场景看到一条说明，应新增独立的 `guidance` 规则 ID 和对应场景处理器；本次第一条规则的说明仅在首日报名决策时适用。其他席位不得看到预言家专属说明。女巫平安夜公开刀口继续待单独定义，不借此配置自动启用。

验收：JSON 可由人读懂；修改 `instruction` 且未提升版本应触发摘要不匹配；已匹配规则进入本人模型请求，其他席位和公共旁观没有该文本；概率命中时程序强制合法上警，未命中时模型可自由选择；`guidance` 规则只影响模型上下文、不改变候选动作。上述核心行为已由定向与隔离 PostgreSQL 用例覆盖，证据见[MOD note 002](../.agents/note/002-decision-rules.md)。

## 发言输出配置 v3（已实施）

开发方案与验收见[MOD note 007](../.agents/note/007-speech-output-rules.md)。仍以 `mods/werewolf/rules/ruleset.json` 为唯一作者文件，拟增加 MOD 专属 `speech.maxChars` 与一条可读指导规则：

```json
{
  "id": "werewolf.robot-strategy",
  "version": 4,
  "speech": { "maxChars": 200 },
  "rules": [
    {
      "id": "seer-first-day-run",
      "priority": 100,
      "instruction": "首日通常应上警，结合自己的查验信息争取警徽。",
      "enforcement": "require-option",
      "probability": 0.8
    },
    {
      "id": "speech-language",
      "priority": 80,
      "instruction": "自称“我”或“X号”；提到其他玩家只用座位号，例如“3号”，不使用自己或他人的游戏昵称。",
      "enforcement": "guidance"
    }
  ]
}
```

通用编译器不接受顶层 `speech`，因此由 MOD 校验该字段，向通用编译器传入其原有三字段视图，并让完整文件参与版本摘要。MOD 的 `speech-language` 处理器只匹配 `SPEECH`，包括竞选、PK、白天和遗言；通用框架按优先级提供 guidance，放在本人职业指南之后。`placement` 已移除，配置含此字段会在装配时失败。`maxChars` 是所有玩家发言的游戏硬上限，作用于行动 Schema、Robot 输出 Schema 与提案解码，不能只靠 instruction 保证。昵称要求是模型指导，不据此拒绝真人发言。`xxxx` 没有明确内容，暂不配置必含文本。

当前配置与[框架缓存 v3](../../../docs/specs/model-context-cache-v2.md)一致；发言任务统一称 `SPEECH`，结果字段仍为 `speech`，内部行动种类为 `kind:'speech'`。
