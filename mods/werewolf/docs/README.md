# 狼人杀 MOD 文档

本目录只维护狼人杀专属规则、阶段计时、默认动作、Robot 策略、页面与游戏验收。开发任务先按[项目层级规则](../../../AGENTS.md)判断归属；本 MOD 的 feature 记录在[狼人杀 note 索引](../.agents/note/README.md)。可跨 MOD 复用的房间、模型或持久化契约归[根 docs](../../../docs/README.md)及[根 note](../../../.agents/note/README.md)，双方需要接入时分层互链。

优先更新已有架构主题：[游戏规则](mvp-design.md)、[阶段计时](phase-timing-v1.md)、[行动截止与默认结算](action-deadlines-v1.md)、[游戏验收](mvp-testing.md)、[模型接入](model-integration-v1.md)及相应页面设计。只有没有合适主题时才新建文档；note 记录方案与进度，docs 维护对应层的设计和验收正文。历史版本文件保留来源，但不能与当前版本并列为两个权威规则。

实现目录为 `../src`（规则与状态）、`../server`（房间 HTTP 与模型服务）、`../shared`（旁观 DTO）、`../web`（页面及 public 素材）、`../robot-users`（本 MOD 测试阵容）与 `../tests`。本机运行见[模型Robot说明](model-robot-run.md)，服务与诊断见[本机测试运维](local-werewolf-test-ops-v1.md)和[模型测试日志](model-test-observability-v2.md)。
