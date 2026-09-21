# 狼人杀MOD

12人预女猎白，支持固定/随机操作的静默整局旁观，不接入模型。规则状态机、独立自爆抢占与数据库运行适配已实现；当前UI使用本地内存演示服务。

## 启动旁观UI

在仓库根目录运行：

```sh
npm run build
npm run demo:werewolf
```

打开 http://127.0.0.1:4318/werewolf 。初始画面是已确认的布局预览，点击“开始演示”进入真实静默对局。可暂停、单步、切换1/2/4倍速、查看公开资料与投票结果；正常终局后开放角色身份及日夜记录。

服务仅监听本机，不需要数据库、模型Key或Docker。会话保存在内存中，闲置一小时过期；重启服务或刷新页面后可重新开局。本命令只提供狼人杀演示，不启动青溪镇数据库服务；原有MUD仍通过仓库原启动方式运行。

开发时保持演示服务运行，另开终端运行 `npx vite --host 127.0.0.1`，访问其 `/werewolf` 路径。Vite同源代理狼人杀API，页面自动热更新。

## 设计与验证

- [设计与规则v2](docs/mvp-design.md)
- [开发方案v3与实施结果](docs/implementation-review.md)
- [UI原型v1及已确认实施验收](docs/ui-prototype-v1.md)
- [UI演示接口与美术分层](docs/ui-demo.md)
- [验收用例WW-01～WW-80](docs/mvp-testing.md)
- [需求状态与验证证据](.agents/note/001-ai-spectator-mvp.md)

本地验证：`npm run check`、`npm run check:repo`、`npm run test:unit`、`npm run build`。MOD单元测试包含规则、整局、抢占及演示接口；配置专用TEST_DATABASE_URL后`npm test`还包含真实数据库集成测试，各测试仅清理自己的随机schema。

数据库整局使用确定性ScriptedModel，不代表真实AI表现。验收配置64k输入/128k窗口；真实模型配置与实际运行不在本版范围。
