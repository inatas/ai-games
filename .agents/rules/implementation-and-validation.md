# 实施、验证与安全

适用场景：编写或修改代码、可执行测试、运行检查、模型接入、数据库操作、环境与部署操作。实施前先按[开发方案确认规则](development-approval.md)确认授权范围；本文件不替代审批。

## 实施要求

1. 行为、边界或环境改变时，先新增或更新拥有该需求的note；纯机械整理无需重复建需求。
2. 对规则接口、幂等、事务、恢复先写或修改可失败的行为测试，再实现；题材断言归Demo测试。
3. 接口变化更新全部调用方、说明和相关验收用例。需求的“已实现”不能代替测试证据。
4. 使用TypeScript严格模式、ESM和包导出；代码需保持可读，不能用压缩代码替代清晰模块。
5. PostgreSQL事务不能跨模型或网络等待。失败不得产生部分游戏变化或有效记忆。
6. 仅把已实际运行的检查标为通过。没有Docker或真实模型凭据时明确记为未运行，不用Mock冒充。

## 检查入口

```sh
docker compose up --build -d
docker compose --profile test run --build --rm tests
npm run check
npm run check:repo
npm run test:unit
```

宿主机集成测试必须显式设置TEST_DATABASE_URL；每组测试只创建/清理自己的随机schema。不要连接生产库；用户授权的开发库重建必须独立执行并核实目标，不得由测试隐式执行。Docker说明见[开发指南](../../docs/development.md)。

模型Key仅由服务端环境注入，不写入源码、日志、存档或前端。宿主负责scope授权，框架负责scope内检索和提交。不要通过改测试预期掩盖数据一致性问题。
