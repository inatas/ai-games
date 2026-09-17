# 最小配置 MOD

复制本目录后修改content/manifest.json及其引用的JSON。房间、出口和NPC只声明内容；规则函数通过显式ID注册。样板不含任意脚本执行或动态加载。

集成入口见[src/host.ts](src/host.ts)，使用现有buildApp的host参数装配。默认仅提供移动，不自动启动巡逻。测试入口为根目录Docker测试profile；无需新增账号系统、HTTP路由或数据库驱动。

规则permit演示有限条件扩展；未提供相应能力的执行者不能通过。行为树实例及运行恢复由框架中性测试验证，MOD可按需配置。
