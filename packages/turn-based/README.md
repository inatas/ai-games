# 房间制回合游戏框架

独立第二层包`@game-ai/turn-based`，复用`@game-ai/core`的Harness及持久化契约。与MUD的`@game-ai/game-systems`互不依赖；不创建地图、NPC、玩家账号、任务、背包或道具系统。

## 宿主接入

宿主提供已迁移的HarnessStore（现有PostgresStore即可）、受信任RoomDefinition和模型白名单。必须先迁移统一底层，再迁移本包。以下为装配片段，game与models由宿主定义：

```ts
import { RoomRuntime } from '@game-ai/turn-based';

await store.migrate();
const runtime = new RoomRuntime(store, game, models, {
  harness: { callTimeoutMs: 30_000, inputBudget: 8_000 },
});
await runtime.migrate();
const room = await runtime.create('explicit-run-key');
for (let seat = 1; seat <= game.seats; seat++) {
  await runtime.seat(room.id, {
    seat, name: `AI ${seat}`, modelProfile: `seat-${seat}`,
  });
}
// 调度器调用；每次最多推进一个模型决策。不要为blocked状态自动resume。
await runtime.tick(room.id);
const publicSnapshot = await runtime.spectate(room.id);
// 关闭服务时等待正在执行的请求退出。
await runtime.close();
```

`models`的键对应modelProfile，值为ModelAdapter。允许多个席位使用同一提供商适配器，但每席有独立执行scope与上下文；使用现有ChatCompletionsAdapter即可接入LLM，凭据由服务器环境注入。

可运行的中性定义见[测试夹具](../../tests/support/turn-based.ts)，真实数据库装配见[集成测试](../../tests/integration/turn-based.test.ts)。狼人杀接入未在本轮实现。

## 游戏定义

- `id/version/seats/instructions`固定到对局；修改规则需使用新版本，已有对局遇版本不匹配会拒绝执行。
- `initialize`在最后一个座位加入的事务内调用一次，生成私有状态、首个阶段与初始事件。
- `project(state, seat)`只返回对应席位可知的事实；`seat=null`只返回公共事实。不要返回全部state后在前端隐藏。
- `validate`校验动作资格；严格Schema由框架与Harness校验。返回true才允许提交。
- `onDecision`仅用于sequential阶段即时事件，如公开发言；sealed阶段不调用它，避免提前泄露票型。
- `resolve`在阶段所有席位完成后调用一次，接收按actors列表排序的决策，返回下一状态、可选事件，以及下一phase或终局result，二者必须且只能有一个。
- `reveal`可选，仅正常finished时用于旁观复盘；未配置时不输出原始私有state。

回调必须是同步、无IO的受信任游戏代码，不能发起模型调用或自行写库。回调接收副本，状态仅通过返回值进入事务。不是第三方代码沙箱。

## 阶段与可见性

Phase包含key、公开label、round、mode、actors和决策JSON Schema。actors必须是非空且不重复的已入座席位。纯自动规则结算由resolve同步完成，不增加无执行者的空阶段。

sequential按actors顺序执行，后续席位能看到已提交的公开事件。sealed也可串行调用模型，但投票不公开、私有state不变，其他席位的上下文不受本轮先交票影响；收齐后由resolve决定公开内容。每阶段实例有独立递增编号，同名阶段重复出现也不会接收旧请求。

事件audience为public、指定座位号数组或after-game。每次动作额外记录仅本人可见的decision审计事件；正常结束后旁观者获得全部游戏事件和reveal投影，AI上下文不会因此转成全知。异常blocked/aborted不揭密。

这些是服务端API：inspect、seat、create、tick、resume和Room包含内部数据，不得直接暴露给浏览器。公共HTTP需由宿主鉴权并只序列化spectate结果。当前包不新增HTTP路由或UI。

## 一致性与恢复

- 唯一runKey保证重复创建幂等；相同席位配置重复加入无副作用，不同配置拒绝。满员后自动开局。
- 每room同一时刻只有一个持久pending决策；多个进程重复tick共用requestId。模型期间不持数据库事务或行锁，不阻塞其他room。
- 房间、事件、底层记忆和Harness结果同事务提交。房间锁先于scope/request锁；模型输入在登记时冻结，提交时重验阶段和请求。
- 崩溃后可重复tick：尚未提交给Harness的请求按原ID提交；正在执行的请求等待租约，过期后blocked；已提交的动作不重调模型。供应商已返回但数据库尚未提交时，不保证外部计费恰好一次。
- 网络失败、非法结果、超时进入blocked，保存安全错误码；没有随机代打或无限重试。修复原因后宿主显式resume，下一tick生成新请求，旧尝试仍保留。
- 默认最多200个阶段实例、2000个决策请求（包含失败后的显式重试）；超过即aborted。单请求Schema纠正最多一次，超时和上下文限制由Harness处理。没有按供应商账单统计的整局token预算。
- 新表为tb_rooms及tb_seats；数据迁移只创建当前表，不清库、不自动重开已结束对局。正常重启需要保持definition版本、模型profile映射及runKey一致。

## 验证

仓库根目录：`npm run check`、`npm run check:repo`、`npm run test:unit`、`docker compose --profile test run --build --rm tests`。宿主运行集成测试必须显式设置TEST_DATABASE_URL；只创建并清理本次随机schema。

详细契约见[设计](../../docs/specs/turn-based-matches.md)和[验收](../../docs/testing/turn-based-matches.md)。
