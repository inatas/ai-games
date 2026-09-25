# 狼人杀本机模型测试台 v1.1（已实施）

关联[需求 005](../.agents/note/005-web-model-test.md)与[验收说明](web-model-test-testing-v1-1.md)。本版只调整本机测试授权和模型凭据装配；既有 v1 的座位 profile、持久房间、日志、回放与缓存统计保持原契约。

## 页面与接口

本机测试页加载时直接请求服务端的可用 profile 列表。座位管理不展示测试口令或“连接模型服务”；模型诊断也不要求再次解锁。模型 profile 不可用时显示具体状态，不提示用户输入供应商 Key。`GET /api/werewolf/model/profiles`、`POST /api/werewolf/model/start`、带 `seat` 的房间视角、模型事件/调用详情/用量接口只在显式本机测试模式中供本机测试台使用。模型 Key 不经过浏览器。

删除本机测试模式对 `x-model-test-token` 和 `MODEL_TEST_TOKEN` 的依赖。现有普通公开房间投影保持公开。若应用未进入本机测试模式，则付费开局和私有诊断接口拒绝访问；未来远程管理访问另行设计用户身份授权，不把“知道房间 ID”当作访问许可。

## 本机边界与凭据

Compose 通过 `WEREWOLF_LOCAL_TEST=true` 显式声明本机测试模式，并将 Docker 宿主端口固定绑定到 `127.0.0.1`。容器内部仍监听内部网卡；项目不把容器内的 `request.ip` 当作宿主用户身份。若启用模型房间但模型环境缺失，服务启动失败。该模式意味着本机可访问者可发起付费对局并读私有日志，因此不用于远程部署或共享主机。

供应商凭据放在当前用户专用的 `~/.codex/ai-games-model.env`。这是项目专用文件，不读取或改写 Codex 自身的认证配置。项目忽略的 `.env` 仅保存 `AI_GAMES_MODEL_ENV_FILE` 指针及非密钥开关；Compose 的 `env_file` 把凭据直接注入后端容器。Profile JSON 仅引用变量名；不同 Robot 或座位可选不同 profile。文件不进入 Git、网页包、API 响应、房间存档或调用日志。本机现有 DeepSeek 凭据已迁移，确认新容器可用后清除了项目 `.env` 的旧副本；过程中未打印密钥值。

本版不提供网页编辑 Key、不自动从 Codex 账户获取供应商 Key、不改变模型调用预算或价格控制，也不为各模型建立独立服务进程。
