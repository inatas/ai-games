# @game-ai/storage

PostgresStore实现短事务、scope内记忆查询和来源校验。fw_memory以kind区分事实、事件、摘要及事项；fw_requests保存请求，fw_event_log保存模型调用诊断。业务表由宿主维护，通过同一事务句柄提交。
