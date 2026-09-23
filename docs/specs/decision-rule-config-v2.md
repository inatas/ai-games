# 简明规则集配置 v2（已确认实施）

## 目标与当前边界

用户明确要求先做到 `id / priority / instruction / enforcement` 这种人能阅读的配置层级，暂不实施启动时由模型编译自然语言。现有 v1 TS 规则回调与框架执行器是基线；本版仅把规则**作者入口**改成简明数据，并把适用说明加入当前席位私有模型上下文。MOD 仍负责确定性触发条件和合法动作映射，框架仍负责版本、排序、概率、强制执行与审计。

## 文件、字段和示例

每个 MOD 在自己的 `rules/ruleset.json` 维护一套版本化配置；狼人杀路径为 `mods/werewolf/rules/ruleset.json`。文件只含数据，不写 TS 函数、任意条件表达式或模型提示模板语法。示例：

```json
{
  "id": "werewolf.robot-strategy",
  "version": 2,
  "rules": [
    {
      "id": "seer-first-day-run",
      "priority": 100,
      "instruction": "首日通常应上警，结合自己的查验信息争取警徽。",
      "enforcement": "require-option",
      "probability": 0.8
    }
  ]
}
```

`id` 是 MOD 内受信任处理器的稳定键。`priority` 为整数，降序排列、同值按 ID 排列。`instruction` 是非空短文本，进入当前席位私有上下文，不作为游戏事实。`enforcement` 仅允许 `guidance` 或 `require-option`。`guidance` 只加文本；`require-option` 在命中时沿用 v1 的程序约束。`probability` 是 `require-option` 的可选 0～1 数值，缺省为 1；它只控制强制效果，未命中仍可给模型该条 instruction。`guidance` 不接受 probability，避免把“是否显示说明”与“是否强制动作”混淆。

## 规则注册与执行

- MOD 在内部注册与配置 `id` 对应的纯 `matches(DecisionInput)`，以及强制规则的 `selectOption(DecisionInput)`；这段代码是游戏适配，不再作为人维护的规则文件。未知 ID、缺少处理器、强制规则没有合法选项映射、重复 ID、未知字段、无效概率或空说明在装配时拒绝。
- 框架通用装配函数把配置与 MOD 处理器合成为当前 `DecisionRuleSet`，并计算配置摘要。房间固定 `id/version/digest`；重启时若同版本内容变了则拒绝自动决策，不静默使用新文案。配置改变必须增加版本。当前不提供运行中热编辑或管理 API。
- `matches` 先用当前席位授权的 `DecisionInput` 判定。已匹配的说明按优先级进入 `context.rules.strategy_rules`，供模型和脚本看到；未匹配、其他座位及公共视图均不包含。说明低于游戏硬规则、合法选项和输出 Schema。现有 `definition.instructions` 继续保留。
- `require-option` 的概率命中且选项合法时，维持 v1 在房间事务内直接提交的行为，不调用模型/脚本；未命中时说明仍可进入本席决策上下文，模型自行选择。`guidance` 不过滤选项、不覆盖输出。硬规则始终先生成合法选项，策略不可增加动作。

## 接口、恢复与范围

拟增加题材中性的 `RuleSetConfig`、`RuleHandlerRegistry` 和 `compileDecisionRuleSet`；在现有 `RoomDefinition.decisionRules` 与 `RoomRuntime.reserve` 路径接入，不另建模型运行时。MOD 静态导入 JSON 并注册处理器；Framework 不读取 MOD 文件路径或理解角色词语。新增 `room.ruleSet.digest` 以固定提示内容；现有房间版本变更按本项目未发布阶段策略处理，本次不迁移开发库或部署。模型调用、密钥与费用行为保持现状，**不在启动时调用编译模型**。

实施顺序：确认本版与 MOD 接入方案 → 编写配置验证、指导规则上下文隔离、强制规则概率及恢复的失败测试 → 实现通用装配与决策输入扩展 → 迁移 WW-R01 配置并移除被替代的 TS 作者入口 → 运行类型、仓库、单元及隔离 PostgreSQL 回归，并回填实际证据。

不包含自然语言自动编译、女巫平安夜声明、规则 UI、热更新、跨 MUD 调度或真实模型付费联调。自然语言编译保留为后续备选方案，不与本版同时实施。

## 待确认

本文件及[狼人杀配置映射](../../mods/werewolf/docs/decision-rule-config-v2.md)已由用户在审阅后回复“实施”确认。实施与验证证据回填根 note 022 和 MOD note 002。
