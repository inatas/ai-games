# 框架测试数据与 Mock 契约

版本：0.2 ｜ 状态：数据契约；中性夹具已位于tests/support/counter.ts

配套[框架测试规格](./framework.md)。本文件只含中性替身，不导入游戏题材。

## 1. 宿主替身

B0：scope=S1、memoryVersion0；宿主表counter0、version0、allowed=true；有效记忆空。binding-A版本1；input严格{text:string}，长度1～2000码点；output严格{decision:"ACCEPT"|"DEFER"}，禁止额外字段。

prepare返回当前counter/allowed和version字符串。validate在allowed=false且ACCEPT时返回HOST_DENIED。apply锁宿主记录并核对version：ACCEPT令counter+1，DEFER不变；两者version+1，返回{counter:实际值}，追加公开事件payload={decision,counter}。这只是测试逻辑。

B-DENY改allowed=false；binding-B改ACCEPT为counter+10。S1/R1/E1是别名，运行时通过确定性生成器映射UUID。

## 2. 记忆与上下文夹具

MEM-FULL：memoryVersion1；事实status={value:2},sourceVersion="2"；公开E1={value:1}；SU1摘要“previous value 1”，sourceIds=[E1],sourceVersion="1"；O1=open，内容“pending matter”，来源E1；均S1，有对应committed来源请求。

MEM-OPEN同MEM-FULL；关闭O1后memoryVersion2，原ID重发不变；新ID重复关闭由宿主拒绝，不再次提交。

C-FIT：必需块7000token；E3 importance3/sequence3、E2 importance2/sequence2、E1 importance1/sequence1，均S1/public/tag=x，每条500token；E2多次命中。结果[E3,E2]、总8000，E1淘汰。

C-OVER：必需块8001。C-PRIVATE：另加S2公开EX及S1内部EI，即使标签相同也过滤；把EX/EI指定为必需ID时INVALID_INPUT。

计数器注入并计算完整消息和协议开销，窗口16000、输出预留1500；真实计数器另验证，不把字符数当token数。

## 3. Mock

| ID | 原始内容/行为 |
|---|---|
| M-ACCEPT | {"decision":"ACCEPT"} |
| M-DEFER | {"decision":"DEFER"} |
| M-BAD | `{broken` |
| M-EXTRA | {"decision":"ACCEPT","extra":true} |
| M-TYPE | {"decision":1} |
| M-UNKNOWN | {"decision":"OTHER"} |
| M-LARGE | 超过16KiB |
| M-TIMEOUT | 30秒前不完成 |
| M-NETWORK | 标准供应商不可用异常 |

按(requestId,attempt)脚本匹配，未注册调用使测试失败，不回退真实模型。默认model=mock-v1，usage输入100/输出20；缺失变体null→unknown。

格式错误最多纠正一次；业务拒绝不纠正；网络直接failed。断言消息包含必要事实及scope，不逐字锁死提示文案。

## 4. 时钟与故障

时间基准2026-09-14T00:00:00Z；单次30秒、总75秒、租期90秒，等于expiresAt即过期。统一注入时钟，不混用实时NOW。屏障释放迟到响应，可模拟忽略Abort。

| 点位 | 位置 | 动作 |
|---|---|---|
| H-CLAIM | 领取事务已提交 | 终止测试服务进程 |
| H-MODEL | 模型发出后返回前 | 阻塞、取消、迟到 |
| H-HOST | 最终事务已写宿主 | 异常/进程终止 |
| H-MEMORY | 已写记忆但未标committed | 异常/进程终止 |
| H-COMMITTED | 提交后响应前 | 丢响应 |

隔离PostgreSQL schema/数据库，从空库迁移，至少两连接；清理仅针对测试创建资源。不暴露故障注入HTTP端点。异常回滚后另事务记错；崩溃后到期扫描恢复。

## 5. 落位

tests/support保存中性数据、Mock、时钟、屏障；mods/qingxi/tests保存Demo数据。有效夹具需Schema/引用校验。

哈希使用递归键排序的规范化JSON，数组保序，包含操作种类、binding及版本、input、expectedMemoryVersion；不含动态时间。当前可执行数据位于tests/support/counter.ts，故障子进程位于tests/support/crash-worker.ts。

