# 028 全仓三层归属重组

Status: proposed；开发方案 v1 已确认，实施中（2026-09-26）。

## 需求

用户明确要求“完成 docs 和代码结构化重组”，并确认范围为“整个仓库，按三层归属整理”。[需求027](027-layer-ownership-routing.md)已确立底层/游戏框架、清溪镇 MOD、狼人杀 MOD 的 note/docs 路由；本任务执行存量文件迁移和实现目录清理，不重定义游戏规则。

## 范围

### 文档归属

根 `docs/specs`、`docs/testing` 保留题材中性的 Harness、模型适配、身份、持久化、MUD/回合框架及跨 MOD 可复用协议。现有狼人杀专属的 `docs/model-robot-run.md`、`specs/testing` 中的 `local-werewolf-test-ops-v1`、`robot-roster-deepseek-v5`、`model-room-single-owner-v1` 搬至 `mods/werewolf/docs`，统一命名避免同名覆盖；与已存在的网页、模型、计时文档合并交叉引用，不复制互相矛盾的当前定义。根文档 `model-test-observability-v2`、`model-context-cache-v2` 和 `robot-model-runtime-v1` 中可复用的日志、缓存、模型决策协议留根层，狼人杀页面、事实投影和运行示例改由 MOD 既有文档拥有；本次只做章节归属整理，不更改未获确认的行为提案。

根 `docs` 中五个“文档已整理”旧跳转页在所有仓内入站链接更新后移除；其中武侠入口转向青溪镇，其余转向根层当前正文。逐一检查根文档其他题材内容，能独立迁移的放对应 MOD 文档，跨层内容拆分并互链。历史 note、确认记录和方案版本保留原路径及状态；本次不重编号、不伪造确认。三处 docs/README、三处 note/README、根 ARCHITECT.md 与必要的 Quickstart 更新为迁移后的唯一导航。

### 代码归属与目标目录

根 `packages/*` 保留中性契约与实现；应用入口负责装配、静态服务和路由挂载。狼人杀专属的 `apps/server/src/werewolf-*.ts`、只服务狼人杀房间的 `model-token-usage.ts` 移至 `mods/werewolf/server`；`apps/shared/werewolf.ts` 与当前只被狼人杀使用的 `robot-seating.ts` 移至 `mods/werewolf/shared`；`apps/web/src/werewolf/*` 移至 `mods/werewolf/web`；狼人杀静态图片从 `apps/web/public/werewolf` 移至 MOD 资源目录，并保持浏览器 URL `/werewolf/...` 不变。Robot 目录的 13 个用户、模型 profile 和头像素材当前均供狼人杀测试房间使用，移至 `mods/werewolf/robot-users`；原 `robot-users.ts` 验证/加载逻辑随 MOD 服务移动。`robot-adapters.ts` 中通用供应商 profile 装配若无需狼人杀引用可抽到 `packages/model`，脚本决策适配归狼人杀；不为一次使用预建抽象。

清溪镇专属的 `apps/web/src/mud.tsx`、`world-view.tsx`、`snapshot.ts`、`style.css` 移至 `mods/qingxi/web`；`apps/web/src/main.tsx` 保留为两个 MOD 的惰性入口。`apps/server/src/app.ts` 中的清溪镇宿主和狼人杀插件由薄装配调用连接，公共账号/Harness/存储仍由应用宿主装配，不把通用能力倒灌 MOD。`apps/server/src/main.ts` 保留进程入口。游戏专属测试迁至对应 `mods/*/tests`，中性框架测试留 `packages/*/tests` 或根集成目录；既有真实数据库集成测试按行为所有者分开。项目根的 `vite.config.ts`、`Dockerfile`、`compose.yaml`、`package.json` 与启动脚本保留应用配置职责，仅调整指向新入口、静态资源拷贝及测试 glob。

所有 TypeScript 相对导入、动态 import、资产 URL、文档链接、测试入口、Docker 构建路径和仓库检查同步调整；禁止保留旧目录转发模块或双份权威实现。`check:repo` 新增目录边界断言：框架源不引用 MOD，MOD 不引用其他 MOD，应用游戏专属逻辑不回流。浏览器仍只消费授权投影，不引入服务端游戏状态或密钥。HTTP URL、房间定义 ID、数据库表与已持久模型 profile 标识不变。

### 数据、部署及非范围

本重组不删除房间、账本、日志或模型凭据，不改数据库 schema/游戏状态格式，不创建付费对局。移动文件时保留 Git 历史可追踪性，先做现有工作检查点；服务切换前检查进行中旧版房间，构建后保持一个服务进程，不让新旧调度者并行访问同库。旧路径只在源码和文档中移除，存档使用的业务标识不变。现有历史提案仍可保持 proposed/archived 状态，不因目录迁移视为已实施。

## 验收

- 三层归属扫描：根 docs 无狼人杀/清溪镇专属权威正文，应用目录仅有装配入口；MOD 文档、服务、页面、资源和测试位于各自目录。混合文档的中性契约与 MOD 接入分别只有一个正文。
- 运行 `npm run check`、`npm run check:repo`、`npm run test:unit`、完整 `npm test`（独立测试库可用时）与 `npm run build`；先记录迁移前基线，迁移后对比单测数、失败原因和浏览器产物。新增边界检查要能拒绝故意引入的反向依赖。
- HTTP 与页面回归：根清溪镇页、`/werewolf`、公开演示及模型房间读取/恢复、`/robot-assets` 与狼人杀背景图均可访问；模型真实开局由用户网页发起，不由重组测试自动触发。
- 仓库内旧路径入站引用为零；文档相对链接检查通过；仅保留意图明确的历史文字描述。已有房间、账本和日志数量在无测试写入的部署步骤前后相同。

## 当前进展

已盘点根 docs、两个 MOD docs、`packages`、`apps/server`、`apps/web`、`apps/shared`、`robot-users` 和测试目录。根 docs 有狼人杀本机测试、阵容、模型房间专属正文，应用目录有大量 MOD 专属代码；现有五个根跳转页仅做旧链接入口。退水功能另由[狼人杀需求006](../../mods/werewolf/.agents/note/006-shared-sheriff-withdrawal.md)实施，不能把它的行为变更混入本重组审批。当前仅记录方案，**尚未执行全仓迁移**。

既有大改前检查点为 `main/c897051`；它记录退水功能及全仓重组之前的项目基线。退水代码在其后有未提交改动，开始本次迁移前会再次形成包含这批已验证改动的本地检查点，确认未暂存密钥、日志、数据库和构建产物。

## 待完善

用户已明确回复“确认按 v1 实施（推荐）”。先做检查点与迁移前基线，再按文档归属、服务端、前端与资产、测试/脚本/检查器的依赖顺序迁移，最后验证和更新三层索引。若盘点发现需要改变行为或公共 API，先更新受影响层的 note/docs 并重新审阅该新增范围。
