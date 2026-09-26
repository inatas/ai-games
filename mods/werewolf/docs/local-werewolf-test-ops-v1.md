# 本机狼人杀模型测试运维 v1.1（已实施）

关联[账本需求 024](../../../.agents/note/024-model-token-accounting.md)、[日志需求 021](../../../.agents/note/021-event-log.md)、[MOD 网页需求 005](../.agents/note/005-web-model-test.md)及[验收说明](local-werewolf-test-ops-testing-v1.md)。本版只处理本机开发库的历史测试资料及本机启动命令，不改变游戏规则、供应商计费或模型调用协议。

## 现状与目标

本机 Compose 项目 `game-ai-harness` 的开发库 `harness` 中，停用的 `public.ww_model_budget` 只有 `trial-v1` 一行；当前模型服务不读写它。`public.fw_event_log` 目前有 2,162 条狼人杀模型事件，分布于历史房间 `4670c995-69aa-4ee6-a7ac-94a335930cbc`、`4fdbf3e3-bb47-497c-92e6-c9108b97e960`、`7f5b4df1-c981-4966-9c61-a095f427c72a`、`9fb0a9e2-ced6-4f69-abc9-93bd18979eab`。这 4 局均已结束或中止，另有 48 个座位、96 个独立 scope、886 条请求与 318 条记忆记录；所涉 scope 未被真人账号或武侠角色引用。数据库含私有模型上下文，备份只落在 Git 忽略的 `.local`，不复制到文档或输出。

## 清理事务

用户明确允许覆盖整个狼人杀 MOD 的旧账本、日志及这 4 局回放。本版先停止 Compose app 冻结写入，再核对 Compose 项目、数据库名、4 个终态房间 ID、表名、`mod_id='werewolf'` 和目标行数；对象不匹配时停止。先把当前开发库作完整本机 `pg_dump` 备份并校验可读取，备份失败不得删除。单个数据库事务中记录目标 room/scope 集合，显式删除这些 scope 的 `fw_requests` 与 `fw_memory`、48 个 `tb_seats`、96 个专属 `fw_scopes`、4 个 `tb_rooms`，以及 `fw_event_log` 中所有既有 `mod_id='werewolf'` 行，最后移除 `public.ww_model_budget`；任何断言或外键失败均回滚。检查 scope 不被其他对象引用，不以 `CASCADE` 越过边界。其他 MOD 的房间、日志和 scope 均保留。清理后验证在线库 4 个旧房间、旧日志及账本已消失；重启后新局仍可写入房间与日志。备份仅供本机恢复。

## 快速启动

新增 PowerShell 脚本 `scripts/start-werewolf-local.ps1`，并提供 `npm run werewolf:web` 快捷指令。脚本从 `$PSScriptRoot` 定位项目根目录，验证 `.env` 指向的 `AI_GAMES_MODEL_ENV_FILE` 存在、Docker Compose 可用且现有模型镜像可启动，再在项目目录执行 `docker compose up -d --no-build app`。等待健康接口成功后输出 `http://127.0.0.1:<APP_PORT>/werewolf`。脚本可重复运行；不接收或打印供应商 Key，不对旧库执行清理，不自动创建付费房间，不起第二个宿主机进程。若镜像缺失，给出需要构建的提示。Compose 宿主端口继续只绑定回环地址。

当前已运行的服务不依赖新增脚本；清理时先停 app，脚本完成并验证后由新脚本启动同一服务，供用户从网页亲自开新局。

## 实施记录（2026-09-26）

停服后将完整开发库备份到 Git 忽略的 `.local/ai-games-before-werewolf-reset-20260925.dump`（2,854,779 字节），并用 `pg_restore -l` 验证归档可读取。单事务断言房间归属、终态与目标行数后，删除 886 条请求、318 条记忆、48 个座位、96 个 scope、4 个房间和 2,162 条狼人杀日志，移除旧预算表；事务提交后复查狼人杀房间和日志均为 0、旧表不存在。`npm run werewolf:web` 已启动本机服务，健康接口和可用 DeepSeek profile 均返回 200；未发起新付费对局。

## 不在本版

不删除 PostgreSQL 卷、其他 MOD 的房间、供应商真实账单或其他 MOD 的日志；不实现待确认的单宿主数据库锁，不生成付费测试对局，也不自动绕过模型失败。旧房间 ID 被删除后，原网页恢复入口将返回未找到；用户的新局使用新 ID。

## v1.2：知识库与 SPEECH 协议的本机破坏性发布（2026-09-26）

用户在四层知识库代码完成、测试通过后明确允许“破坏性更新发布”，并允许删除过去旧的 AI 调用记录、协议和局游戏记录。沿用已确认 v1.1 的停写、备份、单事务定界清理、重建与健康检查流程；本次变更是新一批旧定义房间及其记录，旧协议代码已由 023/029 和 MOD 008 实施，不做存档兼容迁移。

只读盘点确认 Compose 项目为 `game-ai-harness`、数据库为 `harness`、网页端口为本机 `127.0.0.1:4318`。旧狼人杀房间共四局，均为 `finished`：`2522c8b0-0479-4494-8961-8a3bad8ef22e`、`266ef62e-da5b-4126-851c-6483ef995d60`、`634937f0-96d2-4806-936d-2494507f64cd`、`c16ffb1d-977e-4bf6-aa25-ca6d68f2ea79`。其关联范围为 48 座位、96 专属 scope、424 请求、416 记忆及 `mod_id='werewolf'` 的 1,317 条日志；没有真人 scope 或重置引用，也没有孤立狼人杀日志。`fw_event_log` 的 6 条其他日志保持原样；旧 `ww_model_budget` 已在 v1.1 删除，不再作为本次目标。

执行顺序：停旧 app 冻结写入；对整个 `harness` 开发库作新备份并校验归档；单事务按上述四个 UUID 与数量断言，检查没有新增狼人杀房间、非终态房间或跨 MOD scope 引用；显式删除关联请求、记忆、座位、scope、房间与全部狼人杀日志，不使用 `CASCADE`；提交后复查范围。然后以已通过类型、仓库和前端构建的新 app 镜像启动同一服务，核对 Compose 容器健康、网页、模型 profile 和空白狼人杀记录。不开付费新局、不动其他 MOD、账号、数据库卷或供应商账单。旧备份只配合旧代码恢复；浏览器中旧房间 ID 将返回未找到。

实施结果：旧 app 停止后生成并以 `pg_restore -l` 验证完整备份 `.local/ai-games-before-knowledge-release-20260926.dump`，大小 1,703,817 字节，SHA-256 为 `2BDA70FD814D8DC89575898A67C4E1D4311C82398C473471A197F2B69A912FE4`。忽略目录中的 `.local/werewolf-knowledge-release-20260926.sql` 对库名、房间状态、精确行数和外部引用设断言；单事务实际删除 424 请求、416 记忆、48 座位、96 scope、4 房间、1,317 条狼人杀日志。复查狼人杀房间/日志均为 0，其他日志仍为 6。新镜像 `sha256:dc72da7e7cf4165edf2784a0f4eb5ff6943b5d753060d9c5ad3ec47a9ac78423` 已由同一 Compose app 重建并健康，容器内知识 Markdown 20 篇；`/api/health`、`/werewolf` 均返回 200，模型 profile 接口可用，旧房间接口返回 404。未创建新付费局；真实 KV 命中率待用户新局观测。
