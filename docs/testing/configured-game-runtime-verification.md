# 配置运行升级验证记录

日期：2026-09-17。范围为用户确认的[设计v1](../specs/configured-game-runtime.md)、需求015～018与青溪006。

## 检查点

| 基线 | 用途及当时证据 |
|---|---|
| main/762bdfaa2cd7787032570ca41e87fdd650e6f85d | 重构前代码与设计，保留用户删除旧示例README；当时仅文档检查通过，宿主缺tsc |
| main/63e103ffbc591c609204aa9505874964dbb64c89 | 事件阶段；镜像内类型检查、62项回归通过 |
| main/2d3e3943b0ef34ce6b98dcf3b4dbdbb211d84019 | 共用移动阶段；原62项通过，新增Action Schema问题修复后定向通过 |
| main/edfe6c48d0d28cf66094827c04d50b1666288385 | JSON地图/最小MOD阶段；64项完整回归及后加3项定向验证通过 |

所有提交仅本地，未推送。没有提交密钥、数据库、日志、依赖或构建产物。

## 已运行证据

- 每阶段先新增行为测试，分别观察到缺少事件/Action/配置/行为树/模型接口的失败，再实现。
- 额外先行测试发现并修正：模型失败被周期重复调用、错误行为Action参数未在启动时拒绝。
- `docker compose --profile test run --build --rm tests`：完成过一轮标准构建，TypeScript、仓库检查、Vite通过，71/71测试通过。最终增加显式AJV依赖声明后，在线npm ci遇ECONNRESET，最终在线重建未通过。
- 最终源码通过现有测试镜像挂载packages/tests/mods/apps运行：TypeScript、72/72真实数据库及单元回归、Vite构建均通过，0失败/跳过。测试容器以root运行构建以写入镜像内node_modules临时目录，不改宿主依赖或开发库。
- 最终package-lock.json与game-systems/package.json以只读方式挂载到一次性容器，`npm ci --ignore-scripts --offline --no-audit`成功安装115个包，验证锁文件和显式依赖一致。
- 单独以`NODE_ENV=production`复核最终前端构建通过，主JS为241.68kB（gzip 76.67kB）；避免测试镜像NODE_ENV=test影响生产构建判定。
- 后续定向验证：调度恢复与模型到动作4/4通过；角色/NPC通行与无位置拒绝1/1通过；错误配置及行为树6/6通过，镜像内TypeScript通过。
- 宿主`npm run check:repo`通过；`git diff --check`无差异格式错误。
- 复用旧测试镜像执行Vite曾因node_modules目录权限失败；标准Docker构建已通过，不需要修改项目权限或Dockerfile。

## 用例映射

| 契约 | 实际测试文件/现有回归 |
|---|---|
| EV-01～05 | tests/integration/events.test.ts：事务回滚、幂等冲突、过期租约与旧执行者、接收者隔离/失活、重试限制；behavior.test.ts：持久事件唤醒与因果链；原共享任务测试继续证明奖励原子性 |
| AC-01～05 | tests/integration/actions.test.ts：角色/NPC共用移动、同门槛拒绝/通过、无位置拒绝、独立NPC scope、禁用与重放；configured-mod.test.ts拒绝HTTP伪造Actor；原Harness/MF测试继续覆盖模型等待和版本冲突 |
| MP-01～05 | packages/game-systems/tests/content.test.ts：严格字段、路径、引用、条件与Action参数；configured-mod.test.ts：真实HTTP与重启；青溪原地图/移动/库存回归 |
| BT-01～06 | packages/game-systems/tests/behavior.test.ts及tests/integration/behavior.test.ts：优先级、顺序、循环拒绝、提交前中断、提交后重启、并发唤醒、不追赶漏过时刻、模型终态与独立Action；action-model.test.ts：白名单决策与非权威叙述 |
| QCR-01～04 | mods/qingxi/tests的D/WM/CG/SR/QX：原成长数值、师承资格、地图/NPC、护送、私密投影回归 |

恢复用例使用真实PostgreSQL中的持久状态与注入中断；新增调度测试不是操作系统级kill测试，既有Harness进程死亡测试仍运行。Mock模型只证明协议，不证明真实模型语义质量。

## 运行与范围限制

开发app和开发数据库保持原状态，本轮未部署、未重建开发库，因此没有声称完成开发库备份/恢复或发布验收。新增数据结构仅在隔离postgres-test及随机schema验证。发布时仍需按开发指南核实目标、备份和隔离恢复。

未调用真实模型，未进行并发容量压测或新增人工浏览器验收。青溪不启用自主NPC行为，最小MOD默认行为配置为空；行为树及模型接口需MOD显式装配。YAML解析、Lua沙箱、动态热加载、推送协议和可视化编辑器均不在本次范围。
