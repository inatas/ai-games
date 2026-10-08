# 模型Robot本地对局 v1

座位工具仍在`/werewolf`。当前目录包含`robot-001`～`012`共12名模型Robot，以及`robot-013`“星河”脚本Robot。模型服务启用后，可选择12名模型Robot满席，或选择包含“星河”的混合阵容，点击“开始游戏”进入独立的PostgreSQL持久房间。刷新后从已保存的房间号继续公共旁观，本地调试可切换席位视角。无模型服务时，手动座位工具只有1名脚本用户可选；独立的自动脚本演示仍可使用。

本机 Compose 测试把 DeepSeek 的`MODEL_BASE_URL`、`MODEL_NAME`、`MODEL_API_KEY`、`MODEL_PROTOCOL=deepseek`保存到用户专用的`~/.codex/ai-games-model.env`；仓库忽略的`.env`只保存`AI_GAMES_MODEL_ENV_FILE`的绝对路径及`WEREWOLF_MODEL_ENABLED=true`、`WEREWOLF_LOCAL_TEST=true`等非密钥开关。`docker compose up -d --no-build app`从该文件向后端容器注入环境变量，不需在网页重复输入。宿主机直启`npm run demo:werewolf`时仍需在服务进程环境中提供数据库和模型变量。缺模型凭据时服务启动失败，不会改用脚本代替。不要把密钥写进Robot JSON、浏览器或文档。后端进程须能访问DeepSeek。

本机 Compose 只把网页发布到`127.0.0.1:4318`，运行时继续使用现有持久 PostgreSQL。全局 MUD 的`MODEL_MODE=mock`不影响狼人杀模型房间。`WEREWOLF_LOCAL_TEST=true`时可直接在网页选模型、开局和查看诊断，不需要测试口令；关闭本机测试模式则拒绝付费开局和私有诊断。若改在宿主机启动同一数据库的模型房间服务，先执行`docker compose stop app`；旧容器即使没有发布端口，也会继续恢复房间并与宿主机服务并行调度。

以后在项目根目录运行 `npm run werewolf:web` 即可启动已有本机镜像并等待健康检查，成功后输出网页地址。该命令不清理历史数据、不重建镜像、不开新局；代码更新后的镜像构建另行执行。

`GET /api/werewolf/model/:id/usage`按局返回供应商成功响应报告的`inputTokens`、`outputTokens`、`reportedCalls`与`unreportedCalls`；本机测试模式下可访问。失败请求不记 Token；成功响应缺少 usage 时只增加`unreportedCalls`，不估算，也不换算人民币。API 端负责费用控制。旧`ww_model_budget`表已从本机开发库清理；模型服务不读写它。目录只公开模型席位是否可选，不返回 profile 环境变量名或密钥。本机访问边界由宿主端口绑定保证，不靠浏览器口令。

模型和脚本Robot共用[狼人杀阶段计时表](phase-timing-v1.md#计时表)与[游戏默认动作](action-deadlines-v1.md)。夜间即使女巫死亡，狼人和预言家的行动封盘后仍保持完整的女巫时段。提前提交合法发言或选择不会缩短阶段；无合法输入时按截止默认结算。模型不主动自爆。

框架的DecisionInput固定六区，MOD从席位授权视角提供事实和合法选项；脚本与模型均返回SPEECH/SELECT提案并经同一游戏规则校验。模型经Harness构造消息、记录调用及使用量、按绝对截止点取消；失效请求不得提交游戏变化。模型上下文超过预算时本阶段按无有效输入处理，到截止执行游戏默认动作。当前只使用Robot固定persona，不在开局生成新性格。

当前模型房间的服务端输入预算为100,000 UTF-8字节，内部窗口128,000，输出预留800 token；通用Harness默认同为100,000/128,000（默认输出预留仍为1,500）。这是保守字节预算，不是100K模型token。纯脚本房间无需模型凭据。

代码验证：类型检查、仓库检查、单元测试和前端构建。真实PostgreSQL集成测试需运行独立`postgres-test`环境，真实模型全局试跑需上述环境与凭据；两者未运行前不能视为端到端验收完成。

2026-09-23 在隔离PostgreSQL与本机4319端口，用一名DeepSeek Flash模型Robot及十一名脚本Robot完成一局标准速度对局；第5天狼人获胜。18次供应商响应、17次最终校验成功的决策（其中一次格式修复）、无调用失败；供应商报告输入60,423、输出1,185 token。当时旧预留账本记录0.677元估算上界；该数不是供应商账单，且此机制现已停用。完整内部请求与结果保存在本机忽略目录`.local/deepseek-trial-20260923-events.json`，不可直接公开给旁观者。
