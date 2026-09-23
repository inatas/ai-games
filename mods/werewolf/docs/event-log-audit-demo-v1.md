# 狼人杀事件日志审计演示 v1（待确认）

目标：玩家仍能看正常对局，开发者可从事件日志逐条判断模型席何时接到 SPEAK/SELECT、实际看到了哪些事实和选项、输出是否被裁判接受。此文只定义游戏接入，公共表与接口见[统一执行事件日志](../../../docs/specs/execution-event-log-v1.md)。

建立专用本机审计 Demo 入口：固定种子或显式 seed，恰好一席为“模拟模型”，其余席位用现有脚本 Robot；座位与身份仍按普通开局绑定。模拟模型适配器必须接收真实 Harness 的最终 `ModelRequest`，在当前 Schema/optionSet 内确定性回复发言短句或合法选项，不向 DeepSeek 或其他供应商发送请求。日志注明模拟，不在 UI 标成真实 AI 对战，也不消耗已设人民币 10 元试跑额度。

每次授权上下文按阶段重新构造，保留 rules、game_state、self、private_information、public_history、current_action 六区；日志中的最终 messages 要能与六区及当时的公开事件水位核对。每条该局日志的 `mod_id=werewolf`、`room_id=<对局 ID>`；Robot 动作的 `user_id` 取座位绑定的 Robot 用户，`seatId` 只放详情。夜间私密行动、未公布死讯、同阵营队友和查验结果分别按既有身份投影；审计记录仅本机内部可读，普通公共/座位旁观都不能看到其他人的私密 prompt。

验收用多个种子覆盖至少一次夜间 SELECT、白天 SPEAK、白天投票 SELECT 及到期默认；检查事件顺序、发起 Robot userId/seat、窗口时间、selected/speech、结果码和死亡/胜负链。虚拟时钟只用于自动化整局生成审计证据；正常页面不增加暂停、单步、倍速或缩短已确认的游戏阶段。
