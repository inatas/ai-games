# DeepSeek V4.1 Flash 测试设计

版本：v1，用户已确认；实现和实际执行状态见[验证记录](../verification.md)。

| ID | 场景 | 预期 |
|---|---|---|
| DS-01 | DeepSeek协议生成请求 | URL为`/chat/completions`；模型为`deepseek-flash`；发送`json_object`、`max_tokens`、`thinking: {"type":"disabled"}`；不发送`json_schema`或`max_completion_tokens` |
| DS-02 | 合法JSON但不符合宿主Schema，第二次修正成功 | 两次均使用DeepSeek参数；只提交第二次合法结果 |
| DS-03 | 空content、非2xx、超时、超大响应、截断JSON | 返回既有安全错误；不写入游戏状态；日志无密钥和原始供应商正文 |
| DS-04 | Mock及通用json_schema协议回归 | 现有通用适配器行为保持，DeepSeek配置不进入Mock测试容器 |
| DS-05 | 使用提供的密钥调用`GET /models` | 认证成功且列表包含`deepseek-flash`；输出不包含密钥 |
| DS-06 | Docker real模式启动 | app健康；健康接口显示real；浏览器不获得模型密钥或服务端配置 |
| DS-07 | 临时账号执行一次奇遇 | 请求最终committed，模型调用记录为`deepseek-flash`并带世界观版本；游戏变化符合宿主允许结果 |
| DS-08 | 真实请求失败 | 游戏状态与记忆不变；只记录脱敏错误码；不得把失败冒充成功 |

执行顺序：先运行协议单元测试和完整Mock/Docker回归，再进行DS-05；通过后切换real容器执行DS-06～DS-08。真实调用只做一次成功路径，避免无意义费用。配置文档记录模型标识、时间和验证结果，不记录密钥、余额或供应商响应正文。

## 执行结果

DS-01～04的本地协议测试与完整Docker回归通过；DS-05模型列表包含`deepseek-flash`；DS-06应用healthy且健康接口为real；DS-07真实奇遇committed并记录模型、usage及世界观版本；DS-08由首次错误参数请求实际验证，状态和记忆保持初始值。真实供应商Abort未额外发起调用，取消行为由本地协议服务测试覆盖。
