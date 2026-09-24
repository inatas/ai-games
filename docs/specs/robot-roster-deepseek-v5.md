# Robot 阵容升级 v5：12 DeepSeek＋1 Script

状态：用户已确认实施。需求入口：[020 Robot 用户](../../.agents/note/020-robot-users.md)；验收用例：[v5 测试说明](../testing/robot-roster-deepseek-v5.md)。

本文件保留v5当时的预留预算方案；当前Token记账及预算边界由[Token记账v1](model-token-accounting-v1.md)取代。

## 目标与本次范围

本地 Robot 目录保持 13 名独立用户。将 `robot-001.json`～`robot-012.json` 的 `control` 从脚本切换为 `{ "kind": "model", "modelProfile": "environment-default" }`；将 `robot-013.json` 的 `control` 改为原有随机脚本配置。昵称、userId、头像、性别、固定人格均不变。模型 profile 继续由服务端环境变量取 DeepSeek 地址、模型名、协议和密钥；用户配置中不存凭据。

本次调整模型房间的阵容限制：12 个不同 Robot 用户，至少 1 个模型用户，允许模型席位数 1～12。原 1 模型＋11 脚本存档的读取与恢复路径不变；新局可以使用全部 12 名模型用户，也可选择保留的脚本用户组成混合阵容。`/api/werewolf/model/start` 路径、请求格式和持久房间流程不变。无模型演示仍有独立的 `/api/werewolf/demo` 自动局入口；用户目录只剩 1 名脚本后，手动选 12 名纯脚本用户的入口自然无法开局，不创建虚构脚本用户。

`WerewolfModelService` 仍在启动时装配单个共享模型 profile，12 名用户通过各自 userId 和席位 scope 独立决策。`RoomRuntime` 保持现有窗口、截止点、恢复、幂等与权限投影。模型错误或费用超限沿用当前阶段默认处理，不静默改为脚本。模型调用保留此前 10 元持久预留上限；12 模型整局可能在达到上限前终止模型调用，不能据旧单模型对局费用保证完整终局。真实 DeepSeek 试跑及预算上调另行确定。

## 接口与数据

- Robot JSON：只修改上述 13 个文件的 `control` 对象。一个 userId 仍只占一个席位，13 用户总数固定。
- Profile：复用 `environment-default`；本地启用前必须提供 DeepSeek 对应的 `MODEL_BASE_URL`、`MODEL_NAME`、`MODEL_PROTOCOL=deepseek`、`MODEL_API_KEY` 及现有价格变量。若这些环境变量不是 DeepSeek 配置，服务端不会凭 Robot 昵称推断供应商。
- `setupRobotRoom`：从“恰好 1 个模型”改为“至少 1 个模型”，保留 12 个唯一用户、robot 类型校验、阵容签名与已存在房间的幂等行为。
- 旧房间恢复：模型注册表保留 `robot-001`～`012` 旧席位使用的 `script:<userId>` 控制器（原随机策略与固定短句），只供已保存的席位 profile 寻址；新局使用当前用户配置，不会因此把模型 Robot 变回脚本。
- 目录与 UI：目录仍暴露 13 条公开资料；模型服务就绪时 13 人均可选择，随机补满选 12 人；未就绪时只有唯一脚本可选，页面不会伪称能够补满。没有数据库结构变更或迁移。

## 实施与边界

确认后先写失败行为测试，再修改模型房间阵容校验及 13 份 JSON，更新依赖旧 12 脚本目录的测试和运行说明。执行定向测试、全仓单元、类型、仓库与构建检查；若隔离 PostgreSQL 可用，再跑房间恢复与事件日志集成测试。仅在用户另行要求实际开局且环境与价格可用时发起收费调用。现有未提交的 UI、规则与上下文工作不覆盖、不回退。

确认映射：`robot-001`～`012` 为模型，`robot-013` 为唯一脚本；用户已明确指定并要求实施。
