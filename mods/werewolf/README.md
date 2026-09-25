# 狼人杀MOD

12人预女猎白，支持纯脚本演示，以及从13名配置用户中选择12人参加持久模型局（12名模型Robot、1名脚本Robot可混合）。规则状态机、独立自爆抢占、固定阶段计时与旁观UI已实现。模型房间需要PostgreSQL和服务端模型配置，详见[模型Robot运行说明](docs/model-robot-run.md)。

## 启动旁观UI

在仓库根目录运行：

```sh
npm run build
npm run demo:werewolf
```

打开 http://127.0.0.1:4318/werewolf 。初始画面是已确认的布局预览，点击“开始对局”进入持续运行的真实对局。中央用户Avatar跟随发言者，夜间隐藏。可查看历史、公开资料与投票汇总，局中不可暂停、单步或变速；正常终局后开放角色身份及日夜记录。

服务仅监听本机。纯脚本对局不需要数据库、模型Key或Docker，会话保存在内存中，服务重启后需重开。模型对局在明确启用并提供模型配置后使用PostgreSQL持久房间，刷新或重启可恢复。本命令只提供狼人杀演示，不启动青溪镇数据库服务；原有MUD仍通过仓库原启动方式运行。

开发时保持演示服务运行，另开终端运行 `npx vite --host 127.0.0.1`，访问其 `/werewolf` 路径。Vite同源代理狼人杀API，页面自动热更新。

## 设计与验证

- [设计与规则v2](docs/mvp-design.md)
- [开发方案v3与实施结果](docs/implementation-review.md)
- [UI原型v1及已确认实施验收](docs/ui-prototype-v1.md)
- [UI演示接口与美术分层](docs/ui-demo.md)
- [验收用例](docs/mvp-testing.md)
- [事实上下文 v1.3 已实施与遗言保护待确认方案](docs/witch-claim-consistency-v1.md)
- [网页模型测试台 v1 待确认方案](docs/web-model-test-v1.md)
- [需求状态与验证证据](.agents/note/001-ai-spectator-mvp.md)

本地验证：`npm run check`、`npm run check:repo`、`npm run test:unit`、`npm run build`。MOD单元测试包含规则、整局、抢占及演示接口；配置专用TEST_DATABASE_URL后`npm test`还包含真实数据库集成测试，各测试仅清理自己的随机schema。

2026-09-23一局真实DeepSeek Flash模型Robot对局在隔离数据库与浏览器中完成，调用、费用与限制见[运行说明](docs/model-robot-run.md)。
