# 无模型旁观UI实施契约（v4）

所属[需求001](../.agents/note/001-ai-spectator-mvp.md)，当前行为以[观战流程与演出v4](spectator-flow-v4.md)为准。v3的局中暂停与单步已替换。

## 页面与素材

/werewolf 是独立React入口，保留木纹舞台、十二席、公开记录和历史浮层。MUD入口与样式保持隔离。
中央用户Avatar由speakerSeat决定，仅在上警、PK、放逐讨论和遗言阶段展示；夜间及其他阶段隐藏。点击头像只查看资料和手工标记。

三张用户直接提供的Avatar位于apps/web/public/werewolf/user-avatar-{brown,pink,blue}.png，原始参考归档在docs/prototypes。中央人物以CSS轮廓裁切，去掉截图的座位号/昵称；圆头像与中央形象使用相同稳定映射，在十二席临时复用。Avatar与游戏身份无关，不为狼人或神职更换。原图分辨率较低，放大仍保留原素材清晰度限制；没有重绘为另一种形象。

背景与木纹沿用既有素材。昼夜日月/云层、墓地木牌与乌鸦由CSS/SVG实现。过场2秒，已公开死讯公告3秒，可关闭，不阻塞对局时钟；减少动效模式取消运动。首夜天亮后仍先竞选，正式公布死讯才显示墓碑。

## 本地服务与接口

独立入口apps/server/src/werewolf-demo.ts，默认仅监听127.0.0.1:4318，也可作为隔离Fastify插件装配到主应用。内存会话最多100个，闲置一小时回收；无模型、RTC、数据库或生产持久恢复。

| 请求 | 输入 | 语义 |
|---|---|---|
| POST /api/werewolf/demo | seed（uint32）、strategy（fixed/random） | 创建并立即开始运行 |
| GET /api/werewolf/demo/:id | 会话UUID | 只读当前游戏快照，未知或过期返回404 |

原step/control接口已删除，不能从HTTP暂停或单步。服务宿主每100毫秒调用tick，按原截止点结算，不依赖GET或浏览器是否前台；关闭Fastify时清理计时器。重复tick不重复执行，迟到tick按截止点补齐。每次转换成功才提交游戏/随机/时钟/事件，异常停止该局而不泄露部分动作。

创建请求拒绝多余字段与类型强转，有Origin时要求同源。UUID仅作为本机临时会话凭据，不提供会话列表。

## 公开数据与页面行为

DemoSnapshot包含speakerSeat、nightSegment（shared/medicine/null）、timing.remainingMs，以及事件sequence/day/period/type/data和真实speeches。前60秒共享行动、后30秒女巫窗口，即使对应角色已死也不缩短。夜间actor/speakerSeat/progress恒为null。

公开events使用连续公开序号，不通过序号间隙暴露私密动作数量；终局时已有公开序号保持稳定。完整私密历史仅在finished的replay中返回，角色列表同样只在正常终局开放。

放逐投票事件补充当轮sheriff和runoff。主记录按“被投者 ← 投票者”汇总，加权总票数明确显示；弃票/未投分列，PK独立成轮。汇总和详情共用同一事件，不拿当前警长反推过去票权。

页面每250毫秒读取快照，历史/资料/设置浮层打开时继续读取，现场倒计时不停。历史面板显示现场阶段与剩余秒数，新增记录不抢走用户滚动位置。关闭面板回到当前现场，不补播陈旧过场。

同一浏览器标签页用sessionStorage记录当前会话与种子，刷新后读取原局；服务重启或会话过期则回到可开局状态。此为页面续看，不是数据库恢复。临时网络错误继续重连。局中仅保留开始/重开，终局可查身份与复盘记录，本版没有可播放复盘控件。

## 验收

spectator-flow.test.ts、demo-http.test.ts、demo.test.ts、watchable.test.ts验证独立时钟、只读GET、接口移除、发言者投影、公布时机、演出去重、票型及确定性整局。实际浏览器证据归需求note。既有头像权限和死亡状态规则继续有效；真实局保持公共旁观。

## 旁观视角

左下角公共旁观可在开局后切换1—12席，选择前不显示身份；角标“视角”与上方信息卡表示所选席位。点击信息卡展开该席位授权的队友、狼刀、好/狼查验、药量与刀口。切回公共清除私密展示。刷新和重开回公共，时间持续运行。
GET /api/werewolf/demo/:id可选?seat=1至12；省略为公共。响应perspective为public或seat联合类型，公共events及speeches不变。仅本地演示使用，无正式账号权限。
