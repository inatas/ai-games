# 需求：游戏无关的 AI 判定 Harness

Status: in_progress

## 需求

游戏拥有自己的逻辑和运算，只把部分综合判定交给AI。框架负责长期记忆、上下文、模型、校验和受控执行，不包含历史、武侠或战争规则。

## 范围

Binding提供prepare/validate/apply；core不导入具体游戏或模型驱动。无AI动作使用recordMemory模式。当前不实现通用游戏DSL、自主Agent循环、回合或终局。

## 验收

- [ ] F-01/02/26：替换中性宿主计算而不改core。
- [ ] F-24：无AI动作也可原子记录事实。
- [ ] 仓库检查拒绝packages源码导入apps/examples。

## 当前进展

代码已位于[core](../../packages/core/src/index.ts)，具备注册与提交接口；[架构指引](../../ARCHITECT.md)明确了依赖方向。完整运行证据统一见[验证记录](../../docs/verification.md)。

## 待完善

稳定公开SDK前需定义版本兼容策略；当前workspace私有，导出TypeScript源码。不要把接口可替换误称为已经支持任意数据库。
