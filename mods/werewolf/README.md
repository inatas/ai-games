# 狼人杀MOD

目标为12个独立LLM角色自动对局，人类仅旁观。规则v2已确认；现有纯规则、整局状态机和普通决策适配属于提前实现待审阅，开发方案v3尚待确认。当前没有应用启动或旁观入口。

- [设计与规则v2](docs/mvp-design.md)
- [开发方案v3：基线复核与自爆抢占接入](docs/implementation-review.md)
- [验收用例WW-01～WW-80](docs/mvp-testing.md)
- [需求状态与历史验证证据](.agents/note/001-ai-spectator-mvp.md)

本地验证：仓库根目录安装依赖后运行`npm run test:unit`。已有39组MOD测试通过的历史证据，完整对局使用全知确定性测试策略，不代表真实模型游戏表现。异步抢占、真实数据库恢复、旁观API/UI仍未完成。
