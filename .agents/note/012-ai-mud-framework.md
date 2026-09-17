# 需求：AI驱动的多人MUD框架与世界MOD

Status: in_progress

## 需求

将项目整体定位升级为AI驱动的多人在线角色扮演MUD框架。AI Harness是框架中的判定子系统；青溪镇是包含内容配置和可执行规则的首个MOD。通用包不内置门派、内力、侠义、感染度或特定伤害公式。

## 范围

用户已确认详细方案v1并要求实施：通用MUD核心、身份授权、realm/player/party边界、MOD装配、授权上下文、旧档迁移及Web投影。详见[设计](../../docs/specs/ai-mud-framework.md)、[测试契约](../../docs/testing/ai-mud-framework.md)和[迁移计划](../../docs/ai-mud-migration-plan.md)。

包括共享任务归属与一次性奖励机制；青溪镇提供其具体玩法规则。不包含完整末世游戏、任意第三方代码沙箱、规则DSL、运行时热加载或自主Agent循环。框架011仍是独立待确认需求，本次不自动批准其全部接口。

## 验收

- [x] MF-01～03：依赖边界、MOD加载及题材中性测试夹具。
- [x] MF-04～07：realm隔离、角色授权、共享NPC及视角过滤。
- [x] MF-08～11：队伍、共享任务、并发和幂等。
- [x] MF-12：旧档备份、隔离恢复、双次迁移、冲突报告及原请求重放。
- [ ] MF-13：通用Web和桌面浏览器已验证；窄屏视觉及键盘全流程尚需人工验收。
- [x] MF-14～15：授权上下文与全量回归。

## 当前进展

2026-09-17：用户评审轻量拆分后明确要求“core中完成拆分，并在mod中完成编码调整”，范围已确认。检查点main/80f3252622db8ba9c1acdba9673ac00244fc02bf，工作区干净，基线未在本机验证。拆分地图/NPC契约与校验，World保留组合；可选initialRoomId表示出生位置，运行时更新归NPC模块。无数据库变更。验收：无NPC地图可投影、无出生位置NPC可注册、重复NPC/无效出生位置被拒绝、现有移动和迁移语义保留。接入见青溪004。本轮验证待记录。

用户已通过“按照你产出的新的架构和note，开始调整编码并完成最终迭代”确认详细v1及青溪镇004。实现前检查点为main/84cee66（与工作区一致，无需空提交）；该基线未完成多人数据库验收。

2026-09-17：新增mud-core、共享realm/NPC、角色与在线投影、聊天/队伍/共享任务、MOD注册和通用Web接口；青溪镇迁至mods/qingxi，中性station MOD使用同一HTTP宿主与另一套属性/世界观。Docker全量测试55/55通过，构建含TypeScript、仓库边界和前端检查。公共NPC在AI等待期间移动会拒绝过时判定；旧社交请求重放、NPC冲突回滚和MOD缺失规则入口在建表前失败均有独立测试。

部署前停止app并将开发库备份至被Git忽略的`.local/backups/ai-mud-preupgrade.dump`（38096字节，SHA-256 `80CF78C1D96B0C7646D6ED2EA8899B97F10D2F4420C31D31D2C1AD6926AA0487`）。在postgres-test的独立`ai_mud_restore_20260917`库中`pg_restore --exit-on-error`成功，运行`scripts/verify-mud-restore.ts`连续迁移两次通过：原`fw_scopes=7`、`fw_users=3`、`fw_sessions=3`、`fw_requests=55`、`fw_memory=62`、`wuxia_characters=7`均保留；新`mud_realms=1`、`mud_characters=7`、`mud_npcs=5`。开发app已升级并显示healthy，开发库数量核对`7|3|55|62|7|5|1`；浏览器恢复原账号、房间、属性及已完成任务。

2026-09-16：已检查现有实现；基线候选为main/8cf7b04，工作区干净。该版本仅完成静态检查与非数据库回归，不能称为已通过多人验收。当前NPC仍按scope存储，社交没有显式realm，party无共享任务，尚未实现本需求。

## 待完善

本轮NPC/地图拆分验证：2026-09-17执行`docker compose --profile test run --build --rm tests`，59/59通过；镜像构建中TypeScript、仓库检查及Vite构建通过。新增地图独立投影及NPC目录校验测试，现有共享移动冲突/迁移回归通过。未调用真实模型。

窄屏布局和键盘全流程未在实际小视口浏览器中运行；MF-13在完成此人工验收前保持未勾选。真实DeepSeek在本次迁移后未再次调用，模型协议与Mock集成测试均通过。当前开发应用为real provider配置，密钥仍只由服务端环境读取。
