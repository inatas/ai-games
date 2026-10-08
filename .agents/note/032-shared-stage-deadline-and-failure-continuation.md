# 032 连续阶段共用截止与失败续接

Status: proposed

## 需求

多个顺序交互可属于同一个固定窗口：成功立即进入下一步，终止失败可按宿主规则续接，最后等待原截止。现框架每次切阶段重新计时、失败等到截止，无法表达这些行为。归回合框架；接入需求见[MOD 016](../../mods/werewolf/.agents/note/016-wolf-team-deliberation.md)，题材策略不进入框架。

## 方案 v1：已确认，实施中

2026-10-09 用户对上一轮提交的根 032 v1 回复“实施”，确认本范围；015／016 的批准继续有效。权威设计见[窗口扩展](../../docs/specs/turn-based-matches.md#连续阶段窗口扩展v1待确认)，验收见[窗口与失败续接](../../docs/testing/turn-based-matches.md#连续阶段窗口与失败续接v1待确认)。

## 范围

- Phase.windowGroup 及 Room.windowGroup 持久保存相邻同组阶段的原期限，不重新授时；离组恢复正常窗口，同组不得更改长度。
- RoomDefinition.fallbackOnFailure 允许终止失败后立即使用现有 fallbackDecision；默认仍等截止，业务分支由宿主定义。
- RoomDefinition.minDecisionTimeMs 提供按剩余时间准入，不足时默认动作续接，不派发供应商请求；规则动作先于此检查。
- Decision.origin 由可信运行时记录 model／script／rule／default／external，不能让模型伪造来源，外部旧入口默认 external。
- RoomDefinition.revealEvent 允许宿主指定私有事件终局仍不公开；默认终局公开行为保持，公共事件与可信 inspect 不受影响。

不包含题材聊天／共享记忆、DSL、更多重试、预算上调、供应商恰好一次、清库或旧存档适配。保持短事务、scope、epoch、幂等与现有附加记忆机制。

## 验收

- [ ] TB-WG01～06：同组不延时、离组正常、失败续接、固定等待、准入不足不发请求、来源不可伪造。
- [ ] TB-WG07～09：隔离数据库恢复／并发／事务／晚到，默认不启用不改变行为，被限制私有事件终局不公开。

## 当前进展

已核对 startWindow、失败分支、reserve、acceptDecision 与 spectatorView。改前本地检查点 main/53abc53，保留此前项目状态，未声称该基线完全验证。公共实现和可执行测试尚未开始。

## 待完善

待用户仅确认根层新增范围。确认后测试先行、实现并联合 MOD 验收，一起发布，不先发布仅个人计划的中间版本。
