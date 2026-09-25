# 本机狼人杀模型测试运维 v1.1（已确认，实施中）

关联[账本需求 024](../../.agents/note/024-model-token-accounting.md)、[日志需求 021](../../.agents/note/021-event-log.md)、[MOD 网页需求 005](../../mods/werewolf/.agents/note/005-web-model-test.md)及[验收说明](../testing/local-werewolf-test-ops-v1.md)。本版只处理本机开发库的历史测试资料及本机启动命令，不改变游戏规则、供应商计费或模型调用协议。

## 现状与目标

本机 Compose 项目 `game-ai-harness` 的开发库 `harness` 中，停用的 `public.ww_model_budget` 只有 `trial-v1` 一行；当前模型服务不读写它。`public.fw_event_log` 目前有 2,162 条狼人杀模型事件，分布于历史房间 `4670c995-69aa-4ee6-a7ac-94a335930cbc`、`4fdbf3e3-bb47-497c-92e6-c9108b97e960`、`7f5b4df1-c981-4966-9c61-a095f427c72a`、`9fb0a9e2-ced6-4f69-abc9-93bd18979eab`。这 4 局均已结束或中止，另有 48 个座位、96 个独立 scope、886 条请求与 318 条记忆记录；所涉 scope 未被真人账号或武侠角色引用。数据库含私有模型上下文，备份只落在 Git 忽略的 `.local`，不复制到文档或输出。

## 清理事务

用户明确允许覆盖整个狼人杀 MOD 的旧账本、日志及这 4 局回放。本版先停止 Compose app 冻结写入，再核对 Compose 项目、数据库名、4 个终态房间 ID、表名、`mod_id='werewolf'` 和目标行数；对象不匹配时停止。先把当前开发库作完整本机 `pg_dump` 备份并校验可读取，备份失败不得删除。单个数据库事务中记录目标 room/scope 集合，显式删除这些 scope 的 `fw_requests` 与 `fw_memory`、48 个 `tb_seats`、96 个专属 `fw_scopes`、4 个 `tb_rooms`，以及 `fw_event_log` 中所有既有 `mod_id='werewolf'` 行，最后移除 `public.ww_model_budget`；任何断言或外键失败均回滚。检查 scope 不被其他对象引用，不以 `CASCADE` 越过边界。其他 MOD 的房间、日志和 scope 均保留。清理后验证在线库 4 个旧房间、旧日志及账本已消失；重启后新局仍可写入房间与日志。备份仅供本机恢复。

## 快速启动

新增 PowerShell 脚本 `scripts/start-werewolf-local.ps1`，从 `$PSScriptRoot` 定位项目根目录，验证 `.env` 指向的 `AI_GAMES_MODEL_ENV_FILE` 存在、Docker Compose 可用且现有模型镜像可启动，再在项目目录执行 `docker compose up -d --no-build app`。等待健康接口成功后输出 `http://127.0.0.1:<APP_PORT>/werewolf`。脚本可重复运行；不接收或打印供应商 Key，不对旧库执行清理，不自动创建付费房间，不起第二个宿主机进程。若镜像缺失，给出需要构建的提示。Compose 宿主端口继续只绑定回环地址。

当前已运行的服务不依赖新增脚本；清理时先停 app，脚本完成并验证后由新脚本启动同一服务，供用户从网页亲自开新局。

## 不在本版

不删除 PostgreSQL 卷、其他 MOD 的房间、供应商真实账单或其他 MOD 的日志；不实现待确认的单宿主数据库锁，不生成付费测试对局，也不自动绕过模型失败。旧房间 ID 被删除后，原网页恢复入口将返回未找到；用户的新局使用新 ID。
