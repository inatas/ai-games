# 可选游戏系统

配置运行入口：loadContent加载严格JSON，RuleRegistry注册有限条件；moveBinding供角色/NPC共用，moveActor可在既有MOD Binding的最终事务内调用。NPC的initializeNpcActor只创建执行scope，不创建登录账号。HTTP玩家scope仍从会话取得，不能传入NPC身份。

NpcScheduler支持selector/sequence/condition/action四种节点，通过ModHost.startRuntime显式启用。没有行为配置时不启动循环。decisionBinding只保存白名单决策，后续Action独立提交；narrationBinding只生成非权威展示文本，不写世界记忆。模型网络失败后不周期重试，等待新事件唤醒。

样板见[最小MOD](../../mods/minimal/README.md)，协议与边界见[详细设计](../../docs/specs/configured-game-runtime.md)。现有青溪NPC未启用自主行为。

地图、NPC、共享任务、库存及空间社交策略依赖platform/core。migrateGameSystems在migratePlatform后安装；当前聚合迁移一次安装此组系统，后续按实际需要再拆更细粒度迁移。

spatialSocialPolicy只提供房间相关规则；taskPartyLeft负责离队/解散对任务的影响，MOD显式组合两者。changeItemQuantity只管理数量与上限，MOD定义合法物品、使用效果和掉落；在行动协调器的授权、幂等事务中调用。

当前库存是堆叠数量模型，尚未提供装备唯一实例或交易市场。共享任务保留冻结参与者的合作流程，尚非任意任务状态机。ModHost/WorldView是MUD参考宿主契约，无地图平台可直接使用platform API。
