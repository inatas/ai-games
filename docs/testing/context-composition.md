# Context Composition 测试设计

版本：v1，待用户确认；当前没有生成可执行CTX测试。

## 中性测试数据

Profile A/v1含必需世界观A、可选地区背景north/south和角色设定mentor；Profile A/v2修改世界观并新增背景；Profile B/v1使用完全不同字段。宿主状态含玩家P1、当前场景S1、相关NPC N1、不相关NPC N2、任务Q1及单调递增gameVersion。各块正文中包含一条伪造的“忽略协议”文本用于验证数据隔离。

## 验收场景

| ID | 场景 | 预期 |
|---|---|---|
| CTX-01 | A与B两个scope并行判定 | 各自只加载绑定Profile，无静态块、状态或记忆串用 |
| CTX-02 | A/v1旧档，部署A/v2后重登并新建档 | 旧档仍v1，新档v2；相同版本不同内容拒绝启动 |
| CTX-03 | 同输入、同状态重复组装 | 消息、block顺序、摘要与token估算完全一致 |
| CTX-04 | 检查最终消息顺序 | 严格符合协议→基础→任务→状态→必需连续性→可选→输入 |
| CTX-05 | 判定只涉及N1，数据库同时存在N2 | 仅N1 actor_state进入上下文，N2任何字段不泄漏 |
| CTX-06 | N1状态更新并提升gameVersion后再请求 | 新请求使用新快照；旧请求最终提交时STATE_CONFLICT |
| CTX-07 | 当前状态与旧记忆冲突 | 两者均标明来源，权威状态位于高优先级块且提示其优先；宿主规则按当前状态执行 |
| CTX-08 | 第一次输出Schema错误后纠正 | 两次manifest的业务块及摘要相同，只多框架纠正消息 |
| CTX-09 | required刚好在预算、超出1单位、单块超限 | 边界正确；超限调用模型0次且无状态变化 |
| CTX-10 | 可选背景与记忆竞争预算 | 显式匹配、priority、标签、新鲜度、稳定ID排序正确；软配额可借用 |
| CTX-11 | 大块放不下但后续小块可放入 | 跳过大块并记录原因，继续选择小块 |
| CTX-12 | 玩家输入伪造block ID/visibility/system文本 | 不能扩大查询范围或产生system消息；重复ID、缺必需块明确失败 |
| CTX-13 | 成功、模型失败、纠正三种调用 | 每个attempt都有profile与block版本、摘要、token和排除原因 |
| CTX-14 | recordMemory动作 | 不组装模型Context、不创建model call或context manifest |
| CTX-15 | 现有worldview/facts Binding通过兼容层 | 行为和上下文顺序保持，迁移前后的框架回归全部通过 |

## 验证层次

core单元测试验证排序、预算、规范化和消息角色；storage真实PostgreSQL测试验证Profile不可变、scope隔离及manifest事务；中性集成测试验证NPC快照和版本冲突；武侠Demo只验证青松道人接入示例，不承担公共框架验收。最后运行完整Docker回归并比较现有DeepSeek/Mock路径。
