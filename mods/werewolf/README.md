# 狼人杀MOD

规则v2及开发方案v3已确认。已完成日夜规则状态机、普通决策与独立自爆抢占适配，以及真实PostgreSQL整局/恢复验收。目标为12个独立LLM角色自动对局，人类仅旁观；当前没有应用启动或旁观页面入口。

- [设计与规则v2](docs/mvp-design.md)
- [开发方案v3与实施结果](docs/implementation-review.md)
- [验收用例WW-01～WW-80](docs/mvp-testing.md)
- [需求状态与验证证据](.agents/note/001-ai-spectator-mvp.md)

本地验证：仓库根目录运行`npm run test:unit`，包含42组MOD单元测试；配置专用TEST_DATABASE_URL后`npm test`还包含3组MOD数据库集成测试，测试只清理自己的随机schema。

整局使用全知确定性ScriptedModel，不代表真实AI表现。验收配置64k输入/128k窗口，默认8k预算不足以容纳后期记录时会安全暂停；真实模型需按实际窗口配置。应用自动开局、旁观API/UI、真实模型运行留待后续方案。

最新设计：[UI原型v1](docs/ui-prototype-v1.md)（参考网易狼人杀截图，静默自动对局，待确认后开发）。
