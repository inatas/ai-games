# 需求：超简易武侠 MUD 宿主演示

Status: in_progress

归档说明：本文件保留基础Demo的历史需求及框架接入边界；后续游戏专属需求归[青溪镇note索引](../../mods/qingxi/.agents/note/README.md)。

## 需求

用行善、奇遇、拜师、挑战展示游戏如何调用Harness：游戏自己运算，AI只判定有限结果。

## 范围

一个角色、一名师父、一段奇遇、四种行动和React文本页面；不加入地图、装备或自主NPC。题材源码和测试放examples/wuxia-mud。

## 验收

- [ ] 按[Quickstart](../../examples/wuxia-mud/README.md)演示完整路径。
- [ ] D-*用例的数值和模型调用次数符合[测试文档](../../mods/qingxi/tests/README.md)。
- [ ] 浏览器可创建存档、提交、刷新并恢复原结果。

## 当前进展

基础四动作规则继续回归；账号和长期档案已由公共identity接管。房间世界v2及其地图、NPC、任务实现与实际证据统一记录在[青溪镇001](../../mods/qingxi/.agents/note/001-room-world.md)，本文件保留原接入需求的历史入口。

## 待完善

完整多人世界及广泛真实模型语义评测不在当前范围；后续游戏需求使用示例本地note。当前Cookie会话流程及浏览器验证以公共身份文档和示例最新验证记录为准。
