# @game-ai/storage

PostgresStore实现短事务、scope内记忆查询和来源校验。fw_memory以kind区分事实、事件、摘要及事项；fw_requests与fw_model_calls保存请求和诊断。业务表由宿主维护，通过同一事务句柄提交。
