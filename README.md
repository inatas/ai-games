# Game AI Harness

面向游戏的持续记忆与AI综合判定MVP。游戏负责自己的规则和运算；Harness组织记忆、调用模型、验证结果并协调可靠提交。包含一个独立武侠MUD接入示例。

## Docker 启动

需要运行中的Docker Engine和Compose v2。默认Mock不需要模型Key。首次输入用户名和密码自动创建账号，后续登录继续同一档案；默认记住登录，右上角可登出。

```sh
docker compose up --build -d
```

打开 [http://localhost:3000](http://localhost:3000)。停止用`docker compose down`，保留开发存档卷。

```sh
docker compose --profile test run --build --rm tests
```

测试连接独立的postgres-test，不使用开发存档。更多配置见[开发指南](docs/development.md)。已部署房间世界v2：12房间、5NPC、局部SVG地图、三类场景、任务与背包。本机配置DeepSeek真实模式，世界验证与回归证据见[示例验证记录](examples/wuxia-mud/docs/world-mvp-verification.md)，历史框架证据见[验证记录](docs/verification.md)。

## 阅读入口

- [AGENTS.md](AGENTS.md)：开发和验证流程。
- [ARCHITECT.md](ARCHITECT.md)：架构边界、依赖和不变量。
- [.agents/note](.agents/note/README.md)：分项需求、状态和待完善内容。
- [docs](docs/README.md)：规格、测试与操作文档。
- [武侠Quickstart](examples/wuxia-mud/README.md)：地图探索、人物交互、寻药、成长和宿主接入。

目录借鉴[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)的apps、packages、文档和Agent Notes分工；按本项目要求使用单数`.agents/note`，没有引入其Cordis插件系统或复制其产品规则。

## 源码布局

```text
.agents/note/             一份文件一个需求
apps/server/src/         服务装配和授权
apps/web/src/            React Demo
packages/core/src/      判定协调、上下文、公共接口
packages/identity/src/  公共账号、会话、当前档案及登录组件
packages/model/src/     模型与Mock适配
packages/storage/src/   PostgreSQL实现
examples/wuxia-mud/     游戏规则与专属测试
tests/integration/      中性框架集成测试
tests/support/          测试夹具、隔离数据库、崩溃进程
docs/                   规格、测试契约、使用文档
scripts/                仓库检查
```


