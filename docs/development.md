# 开发与环境

## Docker 是标准入口

安装并启动Docker Desktop（Windows/macOS）或Docker Engine及Compose v2（Linux）。本仓库提供配置，不自动安装系统虚拟化组件。镜像固定Node 24与PostgreSQL 18主版本，依赖由package-lock.json锁定；需要完全可复现镜像时由维护者进一步固定已验证digest。

```sh
docker compose config --quiet
docker compose up --build -d
docker compose ps
docker compose logs app
```

浏览器访问http://localhost:3000。健康检查等待PostgreSQL就绪后才启动app。应用自带幂等建表迁移；后续字段变更需要独立版本迁移，不能只修改CREATE TABLE IF NOT EXISTS。

可复制`.env.example`为`.env`设置APP_PORT、POSTGRES_PASSWORD与模型变量；默认口令仅用于不发布端口的本地开发库。已有卷的数据库密码不会因修改.env自动更新。`.env`不提交也不进入镜像。

停止：`docker compose down`。不附加`-v`，以免删除存档。PostgreSQL 18持久目录挂载到`/var/lib/postgresql`。

## 测试

```sh
docker compose --profile test run --build --rm tests
```

测试镜像构建先类型检查、仓库布局/文档检查和前端构建，再运行测试。postgres-test采用独立临时存储，不与开发库共享。每个集成测试组额外创建随机`harness_test_*` schema；测试结束只删除自己的schema。

可单独停止测试数据库：`docker compose --profile test stop postgres-test`。不要用测试脚本清空开发数据库。

## 宿主机调试（可选）

Node 24，执行`npm ci`，单元检查不需要数据库：

```sh
npm run check
npm run check:repo
npm run test:unit
npm run build
```

宿主机集成测试必须显式设置TEST_DATABASE_URL；没有时测试报错而非跳过。它应指向专用测试库。生产入口用DATABASE_URL或PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE连接外部PostgreSQL，`npm start`启动。默认HOST=127.0.0.1；Compose明确设为0.0.0.0。

Windows若系统npm包装器损坏，而node_modules/npm仍存在，可使用`node "C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js" <命令>`。仓库不修改全局Node安装。旧的自动启动embedded-postgres入口已移除，不再维护第二套默认环境。

## 模型

默认仓库配置为MODEL_MODE=mock，界面明确标示固定判定。MODEL_MODE=real要求MODEL_BASE_URL、MODEL_NAME、MODEL_API_KEY；MODEL_PROTOCOL可取`json-schema`或`deepseek`。DeepSeek V4.1 Flash使用`https://api.deepseek.com`、`deepseek-flash`和`MODEL_PROTOCOL=deepseek`，适配器发送`json_object + max_tokens + thinking.type=disabled`。Key只在服务端。本机`.env`已配置并完成真实冒烟，其他环境仍需分别验证。

## 国内镜像（可选）

在项目`.env`中配置以下变量，不需要修改Docker Desktop的全局设置：

```dotenv
NODE_IMAGE=m.daocloud.io/docker.io/library/node:24-bookworm-slim
POSTGRES_IMAGE=m.daocloud.io/docker.io/library/postgres:18-bookworm
NPM_REGISTRY=https://registry.npmmirror.com
```

Node/PostgreSQL采用[DaoCloud文档](https://github.com/DaoCloud/public-image-mirror)推荐的前缀方式；npm采用[npmmirror](https://npmmirror.com)。公共镜像存在限流与同步延迟，可删除上述变量恢复官方源；不要关闭TLS或删除lockfile的完整性校验。

若官方基础镜像已经下载，保持NODE_IMAGE与POSTGRES_IMAGE未设置即可复用它们，只设置NPM_REGISTRY加速依赖下载。切换镜像名可能需要重新查询清单，但相同内容的层可复用。镜像来源参数仅在构建/拉取时生效，不影响游戏数据卷。

## 接口及实现差异

宿主通过`harness.submit()`提交注册的Binding；无AI操作是`mode: recordMemory`绑定，不存在独立的公开recordMemory函数。武侠入口将业务资格错误记为异步`rejected/RULE_REJECTED`，detail表示具体游戏原因，便于一致的幂等查询。

scope令牌只保护本机Demo存档，不等于生产账号体系。禁止直接把当前Demo作为公网多租户服务。原始模型响应和数据库错误不返回玩家。

## 登录与世界观配置

打开应用后输入用户名（3–32位字母、数字或下划线）和密码（8–128字符）。新用户名自动创建；已有用户名校验原密码。默认记住30天无活动期限内的登录，继续同一存档；右上角登出仅撤销当前设备会话。另起江湖需确认，旧档案保留但本期不能切回。旧游客记录保留且暂不迁移，旧浏览器令牌不能登录账号。

世界观文件默认是[WORLD.md](../examples/wuxia-mud/WORLD.md)，服务端通过WORLDVIEW_PATH、WORLD_ID、WORLD_VERSION配置。编辑正文必须提升版本，再运行docker compose up --build -d。相同版本不同正文会拒绝启动，旧局保持已保存版本，新局绑定新版本。不得将模型Key或账号密码写入世界观。框架加载器上限16KiB；正文还需满足实际模型输入预算，超限会在调用前失败。

本地HTTP使用COOKIE_SECURE=false；HTTPS部署应设true并保持反向代理传递正确Host与Origin。Cookie是HttpOnly，客户端不读取凭据；所有写请求必须有同源Origin。账号/会话存放于开发数据库卷，docker compose down不会删除档案。不要通过删除数据卷处理登录问题。

公共模块接入：服务器导入@game-ai/identity的Identity、registerIdentityRoutes、sessionToken；宿主提供initialize(tx,scopeId)。行动调用harness.submit(input, tx => identity.authorizeCurrent(tx, token, input.scopeId))，避免只在事务外鉴权。前端从@game-ai/identity/browser导入useIdentity、LoginPanel；不要导入服务端包入口。
