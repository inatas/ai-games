# DeepSeek V4.1 Flash 接入设计

版本：v1，用户已确认并完成实现。本文描述对公共模型适配层的协议扩展，不包含密钥值；关联需求为004，验收见[测试设计](../testing/deepseek-provider.md)和[验证记录](../verification.md)。

## 官方接口基线

目标模型标识为`deepseek-flash`，对应DeepSeek V4.1 Flash；OpenAI兼容Base URL为`https://api.deepseek.com`，实际请求为`POST /chat/completions`。DeepSeek JSON Output使用`response_format: {"type":"json_object"}`，生成上限参数使用`max_tokens`。系统消息已包含JSON字样、输出Schema与只返回JSON的约束，满足JSON Output的提示要求。

## 公共适配器调整

`ChatCompletionsAdapter`增加显式协议配置，而不是在游戏或武侠示例中判断供应商：

| 配置 | 通用默认 | DeepSeek配置 |
|---|---|---|
| responseFormat | json_schema | json_object |
| maxTokensField | max_completion_tokens | max_tokens |
| thinking | 不发送 | {"type":"disabled"} |

DeepSeek接入由服务端环境选择上述公共适配器能力。Chat Completions的实际字段为`thinking: {"type":"disabled"}`。MVP默认关闭思考模式，因为当前判定只在严格枚举中选择，目标是降低延迟和费用；未来若需要复杂规划，再通过经文档确认的配置开放`enabled`与reasoning_effort。公共适配器继续执行HTTPS限制、30秒调用超时、256KiB响应包络、16KiB模型文本、最多一次格式纠正、严格Schema校验和错误脱敏。

`json_object`只保证合法JSON，不保证符合业务Schema；框架现有AJV校验和一次纠正仍是最终结构保障。DeepSeek返回空content、非2xx、超时、无choices或截断JSON均按现有错误路径处理，不提交游戏状态。

## 本地配置

仅在根目录被`.gitignore`排除的`.env`保存：

```dotenv
MODEL_MODE=real
MODEL_BASE_URL=https://api.deepseek.com
MODEL_NAME=deepseek-flash
MODEL_PROTOCOL=deepseek
MODEL_API_KEY=<仅本地保存>
```

密钥不得进入源码、Docker镜像层、Compose展开输出、文档、测试快照、日志或浏览器。Compose只在运行时向app容器注入。测试容器不注入真实密钥。前端健康接口只显示`modelMode=real`，不返回供应商地址、模型名或凭据。

## 实际验证

确认后先调用`GET /models`验证密钥与`deepseek-flash`可用，再通过应用创建一个临时测试账号，执行需要AI的奇遇动作，确认请求提交、世界观上下文、JSON结果、调用记录和游戏状态提交。该真实调用会产生少量Token费用。完成后退出测试账号；测试档案保留在开发库，不删除用户已有档案。

真实冒烟失败时保留Mock回归结果，记录HTTP类别和框架错误码，不记录DeepSeek响应正文或密钥。配置完成以app容器healthy、`/api/health`返回real、真实AI动作committed为准。

2026-09-16实测：密钥可读取模型列表且包含`deepseek-flash`；应用容器以real模式健康启动；一次临时账号奇遇请求committed，模型记录为`deepseek-flash`、输入400 tokens、输出6 tokens、世界观`wuxia/1`。宿主接受GIFT后银两20→24、encounterDone=true。测试账号已退出，密钥及供应商原始正文未写入验证记录。

首个请求因把`thinking`误写为字符串而被DeepSeek返回400，框架按`MODEL_UNAVAILABLE`回滚且状态未变化。对照官方对象Schema修正为`{"thinking":{"type":"disabled"}}`后通过；协议测试已锁定该结构。

## 已确认范围

用户已确认使用`deepseek-flash`、DeepSeek专用`json_object + max_tokens`协议、默认`thinking.type=disabled`，并授权一次模型列表检查及一次武侠奇遇真实调用。
