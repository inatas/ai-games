# 需求：模型适配和受控判定

Status: in_progress

## 需求

用统一接口接入真实模型与测试Mock，输出必须符合宿主给出的Schema，不能让模型自行修改游戏数据。

## 范围

兼容Chat Completions JSON-schema协议、响应上限、超时取消、最多一次格式纠正、用量记录。仅实现一个供应商协议适配，不做自主路由。

## 验收

- [x] F-03～06/11/12/28/29：格式、错误、超时和日志。
- [x] 本地协议服务验证通用及DeepSeek请求格式、错误和取消。
- [ ] 真实DeepSeek正常冒烟已通过；真实取消不在本次授权调用范围，仍由本地协议测试覆盖。

## 当前进展

[模型包](../../packages/model/src/adapters.ts)与[协议测试](../../packages/model/tests/adapter.test.ts)已实现。默认Demo使用固定Mock并在页面标明。

DeepSeek V4.1 Flash v1已实现，详见[供应商设计](../../docs/specs/deepseek-provider.md)、[测试设计](../../docs/testing/deepseek-provider.md)与[验证记录](../../docs/verification.md)。密钥认证、模型列表、real容器健康和真实奇遇提交均通过；调用记录为`deepseek-flash`并带`wuxia/1`世界观版本。

## 待完善

真实供应商取消路径尚未发起计费请求，仅由本地协议服务验证Abort；真实模型语义质量需要随着更多游戏场景单独评测。密钥只存在被忽略的本地`.env`，不得进入源码、日志和文档。

## 确认记录

用户已确认DeepSeek v1，并要求完成配置。批准`deepseek-flash`、`json_object + max_tokens`、默认关闭思考模式，以及一次模型列表检查和一次真实奇遇调用。按官方Chat Completions对象Schema实现为`thinking.type=disabled`。
