# 回合决策规则引擎设计 v1（已确认实施）

## 文件目录与注册

- `packages/turn-based/src/decision-rules.ts`：题材中性类型、规则集校验、确定性评估与冲突判定，通过包公共入口导出。
- `packages/turn-based/src/runtime.ts`：在持久决策登记时应用规则，在提交时重验，不另建第二套模型路径。
- `mods/<mod>/src/decision-rules/`：各 MOD 的受信任 TypeScript 规则文件；`index.ts` 导出该 MOD 的版本化规则集。不能从客户端或模型请求加载可执行规则。
- 首版不设 JSON/YAML 动态规则目录、数据库规则编辑表或管理 API。概率等可调值是 MOD 服务端配置，具体数值随规则集版本固定。

## 边界

本协议是回合框架的题材中性策略层。MOD 拥有规则语义、触发谓词和目标选项；框架拥有注册、顺序、冲突、概率、持久化与执行审计。游戏硬规则始终先产生合法选项，并在最终提交再次校验。策略不能创造额外动作、改变阶段时间、声明游戏事实或替代超时默认。

## 拟议接口

以下为设计形状，名称尚未固定：

```ts
interface DecisionRule {
  id: string;
  priority: number;
  mode: 'require-option' | 'prefer-option';
  probability?: number; // 0..1，缺省为 1
  matches(input: DecisionInput): boolean;
  selectOption(input: DecisionInput): string | null;
}

interface DecisionRuleSet {
  id: string;
  version: number;
  rules: readonly DecisionRule[];
}

type RuleEvaluation = {
  allowedOptionIds: string[];
  requiredOptionId?: string;
  preferredOptionIds: string[];
  results: Array<{ id: string; sampled: boolean; matched: boolean; selected?: string }>;
};
```

`matches` 和 `selectOption` 是服务端 MOD 的受信任纯函数，不是序列化到房间或由模型执行的代码。框架传入的是当前座位授权 `DecisionInput`；MOD 自己在其私有逻辑中判断身份和局面，不向其他席位公开这些事实。`selectOption` 只能返回本次合法选项 ID；找不到时跳过该规则并记录结果，不能生成任意游戏动作。规则集 ID/版本及规则评估结果随房间持久化，函数实现由同版本 MOD 注册；恢复时版本不匹配报 `RULE_SET_MISMATCH`，不会换用新版规则。

## 顺序与冲突

1. MOD 生成游戏合法选项；无合法选项时沿现有流程处理，不运行策略代替游戏裁判。当前规则层只对 `controllerKind=robot` 的普通 SELECT 决策运行，不处理真人与中断通道。
2. 框架按 `priority` 降序、`id` 升序稳定遍历启用规则，评估触发条件及概率；概率使用本局稳定判定键，结果在有效决策前持久固定。规则版本和判定键不含模型输出。
3. `require-option` 命中后收窄候选；多个命中规则要求不同选项时报告冲突。`prefer-option` 当前只记入内部评估结果，不影响模型输入或最终选择；正式偏好提示留待后续版本。
4. 强制规则命中并确定唯一选项时，框架在决策登记事务内直接提交该动作，不发起模型或脚本请求；这保证规则生效，也避免为已确定动作付费。仍须经过 MOD 游戏验证器和普通原子提交。未命中时模型或脚本继续收到原合法选项。强制动作的规则判定与最终结果记入房间内部记录；不存在该次模型原提案或“模型偏离”记录。
5. 超时、非法输出和中断仍服从既有期限与默认结算；默认动作与策略冲突的处理需在接入 MOD 时写明，策略不推迟截止点或提前公开阶段结果。

同一规则每个 `room/seat/phase instance/rule version` 默认一次判定，使用稳定 SHA-256 键确定结果并将规则评估记录保存到房间；跨阶段延续的一局策略留待后续版本定义 occurrence。两次主机重试必须得到同一结果。公共视图、对手上下文与公开历史不得包含内部规则命中、概率或身份依据；受信任内部读可追溯规则评估及是否强制提交。

## 安全、恢复与部署

规则集由受信任装配注册并在开局校验 ID 唯一、版本可解析、概率范围和静态优先级；无运行中管理 API。房间保留规则集版本引用及必要判定结果，规则执行、决策与审计在现有事务/幂等边界内。模型等待期间不持数据库锁；提交时仍拒绝过期阶段。数据结构若需调整，由确认后的实施方案细化初始化与恢复验证；本设计不批准迁移或开发库重建。

## 验收

中性用例见[测试说明](../testing/decision-rules-engine-v1.md)。具体游戏用例和数值见 MOD 文档。本方案须与[框架 note 022](../../.agents/note/022-decision-rules-engine.md)一同确认后实施。
