# 模型对局 Token 用量记账 v1

状态：已实现。需求入口：[024](../../.agents/note/024-model-token-accounting.md)；验收：[测试设计](../testing/model-token-accounting-v1.md)。

## 目标与边界

狼人杀模型房间只记录供应商实际报告的输入、输出 token，按房间查询。项目不计算人民币，不自行预留或限制费用；API 端的费用控制不在本项目实现。保持模型请求、上下文和游戏裁决流程不变。

## 数据与接口

现有 `fw_event_log` 中的 `model.call.finished.v1` 是每次供应商成功返回的持久记录，`room_id` 对应对局，`details.usage.inputTokens/outputTokens` 是供应商报告值。一次请求的格式修复可能产生两条完成事件，两次调用都实际耗用 token，均计入。游戏后来拒绝行动或响应过期，也不抹去已成功返回的模型用量。`model.call.started.v1`、`model.call.failed.v1`、模拟适配器和脚本行动不计入。

新增只读 `GET /api/werewolf/model/:id/usage`，沿用现有模型房间诊断接口的本机访问限制和房间存在性检查，返回：

```json
{
  "roomId": "<uuid>",
  "inputTokens": 0,
  "outputTokens": 0,
  "reportedCalls": 0,
  "unreportedCalls": 0
}
```

只汇总 `simulated=false` 的完成事件。`usage` 两字段都为非负安全整数时计入合计并增加 `reportedCalls`；缺失、`null` 或无效时仅增加 `unreportedCalls`，不猜测 token。汇总使用 PostgreSQL 数值求和，并在返回前检查 JavaScript 安全整数范围；越界明确失败，不截断。查询可用于运行中及已结束房间，不返回模型上下文、密钥、私人角色或单次响应正文。

## 状态、幂等与部署

继续由 Harness 在收到供应商成功响应后写完成事件。用量查询从事件即时聚合，不维护第二份可漂移的余额。相同事件不会因重启或重复查询重复计数；若供应商确实成功处理了两次请求，则两条完成事件都计入。网络失败无完成事件，Token 统计不变。

狼人杀服务停止装配调用前的费用预留适配器，`MODEL_INPUT_CNY_PER_MILLION`、`MODEL_OUTPUT_CNY_PER_MILLION`不再是该服务启动前提。旧 `ww_model_budget` 表及 9.986936 元历史预留保持原样供审计，不再读取或写入；本版不执行删除、清零或价格迁移。此方案移除项目侧 10 元预留限制，模型请求会受供应商账户及其 API 端限制约束。

本地后端须从允许访问 `https://api.deepseek.com` 的运行环境启动；上线前用不计费的认证端点做连通与权限检查。服务仍仅监听本机，开局及私有诊断保持 `LOCAL_ONLY` 限制。环境修复不改变事件字段或历史房间状态。
