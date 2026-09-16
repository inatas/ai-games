# 武侠 MUD：Demo 测试用例与数据

版本：0.1四动作规则回归 ｜ 世界v2完整路径见[世界测试设计](../docs/world-mvp-testing.md)，实际执行见[验证记录](../docs/world-mvp-verification.md)。下列D-*继续验证原数值及事务语义，夹具须设置对应行动房间；真实移动额外产生事件，不能用旧五步版本计数衡量世界完整流程。

本文件严格依据[Quickstart](../README.md)，不作为框架逻辑规范。F-*负责通用可靠性；D-*负责游戏运算与实际接入。

## 1. 夹具与Mock

W0：silver20、virtue0、skill1、master=null、encounterDone=false、goodDeedItemId=null、hostVersion0；scope memoryVersion0；已初始化公开事实投影，无事件、摘要或开放事项。

| ID | 相对W0的覆盖 |
|---|---|
| W-POOR | silver1 |
| W-EXACT | silver2 |
| W-QUALIFIED | virtue2；供资格分支测试；不伪造历史 |
| W-STRONG | skill2 |
| W-MASTER | master=青松道人、skill2、virtue2 |
| W-ENCOUNTER-DONE | encounterDone=true |

带连续历史的用例应从W0通过行动构建，而非只改virtue假装有历史。无历史的W-QUALIFIED专门证明硬资格与AI历史输入是不同数据。

| Mock | rawText |
|---|---|
| Q-GIFT | {"choice":"GIFT"} |
| Q-GUIDANCE | {"choice":"GUIDANCE"} |
| Q-ACCEPT | {"choice":"ACCEPT"} |
| Q-DEFER | {"choice":"DEFER"} |
| Q-CHEAT | {"choice":"GIFT","silver":999} |
| Q-TIMEOUT | 发出后30秒不返回 |

Mock不读取题材规则替系统算结果，按requestId/attempt固定返回。Key只用测试占位符，默认usage输入100/输出20。Q-CHEAT两次都返回同非法内容，用来验证最终拒绝。

## 2. 公共断言

每例新游戏，合法UUID请求；成功操作hostVersion和memoryVersion各加1、事件1；事实投影等于真实公开状态。技术失败与业务拒绝不改状态、记忆、事项或版本。初始化事实不增加版本和事件数。

游戏错误：INSUFFICIENT_SILVER、LOW_VIRTUE、ALREADY_APPRENTICED、ENCOUNTER_COMPLETED，宿主prepare阶段记为异步rejected/RULE_REJECTED并带detail；若在最终回调前提已变化则框架STATE_CONFLICT或RULE_REJECTED/detail，不能产生部分效果。

U=宿主逻辑单元，I=宿主+框架+PostgreSQL，E=浏览器，R=真实模型评测。

## 3. 测试用例

| ID / 层 | 前置与步骤 | 精确预期 |
|---|---|---|
| D-01/I,E | 新建W0读取页面 | 20/0/1/null；encounterDone=false；版本0，模型0 |
| D-02/U,I | W0行善 | silver18、virtue1；版本1、事件1；开放事项1，来源该事件；模型0 |
| D-03/U,I | W-POOR行善 | rejected/INSUFFICIENT_SILVER，silver1，状态及记忆不变，模型0 |
| D-04/U,I | W-EXACT行善 | silver0、virtue1，成功；不负值 |
| D-05/I | W0连续行善两次 | 16/2/1/null；版本2、事件2；仅一个开放事项，来源仍第一次事件 |
| D-06/U,I | W0拜师 | rejected/LOW_VIRTUE，模型0，无事件或版本变化 |
| D-07/U,I | W-QUALIFIED拜师，Q-ACCEPT | master青松道人、skill2；silver20、virtue2；版本1、事件1，模型1 |
| D-08/U,I | W-QUALIFIED拜师，Q-DEFER | 属性不变，但版本1、事件1，合法“暂缓”结果，模型1 |
| D-09/U,I | W-MASTER拜师 | rejected/ALREADY_APPRENTICED，模型0，无变化 |
| D-10/U,I | W0挑战 | 落败；属性不变，版本1、事件1，模型0 |
| D-11/U,I | W-STRONG挑战 | 获胜，silver23，skill2，版本1、事件1，模型0 |
| D-12/U,I | W0奇遇，Q-GIFT | silver24、skill1、encounterDone=true；版本1、事件1，无开放事项可关闭；模型1 |
| D-13/U,I | W0奇遇，Q-GUIDANCE | silver20、skill2、encounterDone=true；版本1、事件1 |
| D-14/I | W0行善后重启，再奇遇Q-GUIDANCE | prepare含行善事件及open事项；最终18/1/2/null，事项closed；版本2、事件2 |
| D-15/I | W-ENCOUNTER-DONE再次奇遇 | rejected/ENCOUNTER_COMPLETED，模型0，不重复奖励 |
| D-16/I | W0行善后奇遇Q-TIMEOUT | failed/MODEL_TIMEOUT；仍18/1/1，版本1、事件1；事项open、encounterDone=false |
| D-17/I | W0奇遇Q-CHEAT两次 | rejected/MODEL_INVALID_OUTPUT；silver20、版本0、事件0、encounterDone=false；调用2 |
| D-18/I,E | W0奇遇Q-GIFT成功，丢响应并原ID重发 | 原成功结果，无第二次奖励；silver24、事件1、模型1；不能因已奇遇而拒绝原ID |
| D-19/I | 按Quickstart完整路径：善、善、拜ACCEPT、挑战、奇遇GUIDANCE | 19/2/3/青松道人；版本5、事件5、模型2；事项closed，encounterDone=true |
| D-20/E | 四按钮和说明框，处理中刷新再查询 | 状态显示一致；不重复提交；恢复原请求；结果由游戏模板生成 |

## 4. 真实模型评测

D-21/R：分别从W0奇遇、从真实两次行善路径拜师，各跑3个独立会话。验证choice属于对应枚举；输出不包含数值修改；游戏apply始终正确计算。记录每次选择及上下文，允许GIFT/GUIDANCE或ACCEPT/DEFER不同，不把某个固定剧情当硬断言。

另人工检查拜师上下文确实包含行善事实和玩家说明、奇遇带未闭合事项。框架只保证传递，模型是否恰当使用历史属于游戏体验评估；若质量不足调整宿主提示，不给core加武侠规则。

## 5. 实现顺序与门槛

先D-01～06、10～11做确定性动作；再D-07～09、12～17接Mock判定和持续记忆；最后D-18～21做整体验收。所有D用例通过且F用例通过，才称Demo和框架接入完成。

数据建议置于examples/wuxia-mud/tests/fixtures，Mock放同目录；不得混入tests/framework。代码与Mock见game.test.ts，未执行项和验证范围由验证记录维护。

