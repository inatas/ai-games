# AI驱动的多人MUD框架

通用运行层管理realm、角色、房间拓扑、在线状态、聊天、队伍与共享任务；MOD提供世界观、地图、角色属性及具体规则。Game AI Harness负责持续记忆、上下文、模型判定和可靠提交。青溪镇是首个可玩MOD，中性测试MOD验证相同框架能运行另一种题材。

## Docker 启动

需要运行中的Docker Engine和Compose v2。默认Mock不需要模型Key。首次输入用户名和密码自动创建账号，后续登录继续同一档案；默认记住登录，右上角可登出。

```sh
docker compose up --build -d
```

打开 [http://localhost:3000](http://localhost:3000)。停止用`docker compose down`，保留开发存档卷。

```sh
docker compose --profile test run --build --rm tests
```

测试连接独立的postgres-test，不使用开发存档。更多配置见[开发指南](docs/development.md)。[MUD架构](docs/specs/ai-mud-framework.md)、[验收契约](docs/testing/ai-mud-framework.md)及[迁移记录](docs/ai-mud-migration-plan.md)解释共享世界和旧档升级。历史世界证据见[青溪镇验证记录](mods/qingxi/docs/world-mvp-verification.md)。

## 阅读入口

- [AGENTS.md](AGENTS.md)：开发和验证流程。
- [ARCHITECT.md](ARCHITECT.md)：架构边界、依赖和不变量。
- [.agents/note](.agents/note/README.md)：分项需求、状态和待完善内容。
- [docs](docs/README.md)：规格、测试与操作文档。
- [青溪镇Quickstart](mods/qingxi/README.md)：地图探索、人物交互、寻药、成长和双人护送。

目录借鉴[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)的apps、packages、文档和Agent Notes分工；按本项目要求使用单数`.agents/note`，没有引入其Cordis插件系统或复制其产品规则。

## 源码布局

```text
.agents/note/             一份文件一个需求
apps/server/src/         服务装配和授权
apps/web/src/            React Demo
packages/core/src/      判定协调、上下文、公共接口
packages/mud-core/src/  通用房间、MOD注册、realm、社交与共享任务
packages/identity/src/  公共账号、会话、当前档案及登录组件
packages/model/src/     模型与Mock适配
packages/storage/src/   PostgreSQL实现
mods/qingxi/     游戏规则与专属测试
tests/integration/      中性框架集成测试
tests/support/          测试夹具、隔离数据库、崩溃进程
docs/                   规格、测试契约、使用文档
scripts/                仓库检查
```


