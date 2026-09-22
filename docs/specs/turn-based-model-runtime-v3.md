# 房间模型运行时 v3（提案）

状态：待确认。归属需求019；不改变已实现v2，通用文档只使用题材中性契约。游戏接入细节由MOD本地文档引用本规范。

## 目标与职责

在既有RoomRuntime/Harness之上补齐按席密封并行、绝对期限、任务协议编解码、超时默认提交及持久展示门控。不将游戏场景枚举、角色、规则或默认动作写入框架。保留同scope串行、模型等待无事务、最终重验及游戏/记忆/请求原子提交。

## 拟新增契约

- RoomDefinition可选decisionSpec(state,phase,seat,lane)：受信任纯函数，返回该席授权facts增量、instructions、模型outputSchema与不可变codecData；最终decodeDecision(modelOutput,codecData)返回原引擎动作。输出映射后仍执行原validateDecision/validateInterrupt，不能绕过业务资格；模型输出不作为可执行代码。
- 仅MOD回调可接触完整state，返回值必须基于授权投影。提供中性测试证明其他席私有数据不进入模型请求。未配置spec的定义保持v2原生动作协议。
- 定义提供timerPolicy及fallbackDecision(state,phase,seat,reason)；无策略保持原阻塞行为。默认动作由游戏定义拥有，框架不发明规则。fallback为受信任纯确定行为，非法则blocked。
- Phase/Room持久字段：windowId、startedAt、deadlineAt、notBeforeResolveAt（可选固定窗口）、admissionEpoch；任务包含actionId、lane、seat、option/schema/prompt摘要、codecData、事实水位及deadlineAt。字段最终命名在编码前固定；不以网页倒计时代替持久截止点。
- lane支持ordinary:<seat>及interrupt:<seat>；顺序阶段只允许当前一席ordinary，密封阶段允许多个独立席位。普通任务使用各自scope，抢占使用既有interruptScope。每席每窗口有效普通任务唯一，恢复重用requestId。

## 并行与版本

现有acceptDecision每次递增decisionEpoch不可直接用于并行密封。调整为：窗口收集期间单席提交只更新room.revision和该席任务状态；全局admissionEpoch在新窗口、抢占或废弃时更新。最终提交检查windowId/phaseInstance/epoch、任务requestId及该席尚未提交。不同席位提交不能互相作废；同席重复/旧epoch必须失败。结算按照定义的actors顺序归一化，不依赖网络返回先后。

在窗口开放时冻结该轮可见事实，不把其他席未公开决策加入晚启动任务。结果可在短事务内提交至密封集合，达到完整条件且notBeforeResolveAt到达才结算。固定窗口不能因缺席、默认动作或模型速度提前泄漏信息。没有固定窗口约束时可按定义提前结算。

## 截止、失败与租约

Harness请求增加可选绝对notAfter；登记、模型调用、纠正及最终提交都以min(原总预算,绝对剩余)为界，不因恢复重新获得时长。单次callTimeout受剩余预算约束。租约只保护执行归属，不是游戏时间；过期游戏动作不能等长租约结束才继续。失效请求可仍等待外部供应商结束，但提交栅栏永久阻断；旧执行者不能释放新请求的租约。

调度器独立扫描到期窗口，不等待某个generate承诺返回。默认提交使用确定性标识(actionId, fallback)与房间锁，终态只能accepted或fallback一次。Harness原请求失败/失效状态、游戏默认动作、内部审计由明确的事务路径协调；不得把失败提案当有效记忆。默认动作也重验window/epoch及业务资格。缺省不是重新向模型请求，网络错误不自动重试。

格式修正最多一次，仍同requestId且受原期限限制；业务拒绝不自动改选。数据库或规则异常blocked，不能伪装成模型超时成功。记录内部reason，不向公共投影泄漏哪个私密席位出错。

## 展示门控

可选已提交输出展示窗口作为显式持久状态，包含可公开eventId、开始/结束时间与待进入下一阶段的transition；结果一旦公开，不在恢复时撤销或重复append。处于展示期不再提交同一普通动作，不提前启动下一普通席位计时；可抢占通道由定义给出有效资格。展示结束与抢占共用窗口/epoch锁，展示期间不持数据库锁。纯密封动作不要求展示门控。实际时长与公开DTO由宿主/MOD定义。

## 恢复和迁移

锁序沿用room→scope→request；所有登记和提交是短事务。启动扫描未结束房间：已提交任务重取；有效未完成任务保留请求标识；到期窗口按默认动作一次推进；展示状态按原截止点结束。关闭取消本进程调用并等待清理，不清空数据库。多宿主调度只能产生一次有效动作。

需要修改types/engine/runtime/schema、core绝对截止请求契约与全部调用方。采用新版定义/存档版本；对未发布旧数据不承诺自动迁移，但禁止启动静默清库。实施前保存Git检查点，数据库改动在独立测试schema验证；开发库切换需明确目标与保留方案。

## 验收（先失败测试，再实现）

- TR3-01：密封3席延迟模型并行启动，提交顺序不影响结算；每席一次有效动作。
- TR3-02：中途重启不重置deadline；恰好截止拒绝模型结果；纠正不延时。
- TR3-03：正常成功、默认动作、抢占三方竞争唯一提交；旧失败不能blocked新窗口。
- TR3-04：默认动作事务回滚、重复扫描、双宿主不会双提交或产生部分有效记忆。
- TR3-05：密封收集不泄漏其他席选择；notBeforeResolveAt阻止早结算。
- TR3-06：codec仅接受保存的选项映射，旧映射/错误席位/额外字段拒绝；decode后仍业务校验。
- TR3-07：展示恢复、展示末端抢占、已提交事件只公开一次；下一动作计时不会提前开始。
- TR3-08：原v2无deadline/codec策略定义仍通过；同scope串行和有效租约不复用。

单元测试使用中性定义与可注入时钟；事务/抢占/恢复必须真实PostgreSQL集成；不得以Mock通过替代真实数据库证据。此提案未执行实现、迁移或模型调用。
