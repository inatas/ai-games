# 能力包

| Workspace | 责任 | 入口 |
|---|---|---|
| @game-ai/core | 公共接口、上下文、判定协调器 | core/src/index.ts |
| @game-ai/model | Mock与供应商协议适配 | model/src/index.ts |
| @game-ai/storage | PostgreSQL事务和持久记忆 | storage/src/index.ts |
| @game-ai/platform | 基础realm、身份引用、在线、IM频道、队伍、钱包账本与无地图注册 | platform/src/index.ts |
| @game-ai/game-systems | 可选地图、NPC、任务、库存与空间策略 | game-systems/src/index.ts |

每包源码在src，包自身测试在tests。跨包使用workspace名称，禁止跨目录访问其他包内部文件。所有包当前private，源码由tsx执行，不构成已发布SDK。
