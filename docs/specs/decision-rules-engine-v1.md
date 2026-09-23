# 回合决策规则引擎设计 v1（待确认）

## 边界

本协议是回合框架的题材中性策略层。MOD 拥有规则语义、触发谓词和目标选项；框架拥有注册、顺序、冲突、概率、持久化与执行审计。游戏硬规则始终先产生合法选项，并在最终提交再次校验。策略不能创造额外动作、改变阶段时间、声明游戏事实或替代超时默认。

## 拟议接口

以下为设计形状，名称尚未固定：

```ts
type DecisionRule = {
  id: string;
  version: number;
  enabled: boolean;
  priority: number;
  mode: 'require-option' | 'prefer-option';
  probability?: number; // 0..1，缺省为 1
  matches(context: AuthorizedDecisionContext): boolean;
  selectOption(context: AuthorizedDecisionContext, legalOptions: DecisionOption[]): string | null;
};

type RuleEvaluation = {
  allowedOptionIds: string[];
  requiredOptionId?: string;
  applied: Array<{ ruleId: string; version: number; occurrence: string; sampled: boolean }>;
};
```

`matches` 和 `selectOption` 是服务端 MOD 的受信任纯函数，不是序列化到房间或由模型执行的代码。框架传入的是当前座位授权快照；MOD 自己在其私有逻辑中判断身份和局面，不向其他席位公开这些事实。`selectOption` 只能返回本次合法选项 ID；找不到时跳过该规则并记录原因，不能生成任意游戏动作。规则集版本快照与抽样结果持久化，函数实现由同版本注册表解析；若恢复时找不到对应版本，停止该房间自动决策并报告配置故障，不用新版规则代替。

## 顺序与冲突

1. MOD 生成游戏合法选项；无合法选项时沿现有流程处理，不运行策略代替游戏裁判。
2. 框架按 `priority` 降序、`id` 升序稳定遍历启用规则，评估触发条件及概率；概率使用本局稳定判定键，结果在有效决策前持久固定。规则版本和判定键不含模型输出。
3. `require-option` 命中后收窄候选；多个命中规则要求不同选项时报告冲突。`prefer-option` 只在请求中表达倾向，不缩小选项，也不保证模型遵守。
4. 模型或脚本接收同一受约束输入；输出必须属于允许集合。服务端提交事务复核房间阶段、规则快照、抽样结果、约束与 MOD 游戏验证器。模型偏离强制规则时，不直接执行其提案；若规则已确定唯一合法选项，按该选项提交并记录偏离。该覆盖动作必须与普通动作走相同业务验证和原子提交。
5. 超时、非法输出和中断仍服从既有期限与默认结算；默认动作与策略冲突的处理需在接入 MOD 时写明，策略不推迟截止点或提前公开阶段结果。

同一规则每个 `room/seat/phase instance/rule version` 默认一次判定；跨阶段延续的一局策略须由 MOD 提供稳定 occurrence 键。两次主机重试必须读同一判定记录。公共视图、对手上下文与公开历史不得包含内部规则命中、概率或身份依据；管理员审计可追溯原提案、覆盖原因及最终结果。

## 安全、恢复与部署

规则集由受信任装配注册并在开局校验 ID 唯一、版本可解析、概率范围和静态优先级；无运行中管理 API。房间保留规则集版本引用及必要判定结果，规则执行、决策与审计在现有事务/幂等边界内。模型等待期间不持数据库锁；提交时仍拒绝过期阶段。数据结构若需调整，由确认后的实施方案细化初始化与恢复验证；本设计不批准迁移或开发库重建。

## 验收

中性用例见[测试说明](../testing/decision-rules-engine-v1.md)。具体游戏用例和数值见 MOD 文档。本方案须与[框架 note 022](../../.agents/note/022-decision-rules-engine.md)一同确认后实施。
