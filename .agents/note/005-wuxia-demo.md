# 需求：超简易武侠 MUD 宿主演示

Status: in_progress

归档说明：本文件保留基础Demo的历史需求及框架接入边界；后续游戏专属需求归[武侠本地note索引](../../examples/wuxia-mud/.agents/note/README.md)。本次目录规范整理不变更功能范围或验收状态。

## 需求

用行善、奇遇、拜师、挑战展示游戏如何调用Harness：游戏自己运算，AI只判定有限结果。

## 范围

一个角色、一名师父、一段奇遇、四种行动和React文本页面；不加入地图、装备或自主NPC。题材源码和测试放examples/wuxia-mud。

## 验收

- [ ] 按[Quickstart](../../examples/wuxia-mud/README.md)演示完整路径。
- [ ] D-*用例的数值和模型调用次数符合[测试文档](../../examples/wuxia-mud/tests/README.md)。
- [ ] 浏览器可创建存档、提交、刷新并恢复原结果。

## 当前进展

宿主规则、HTTP接口和页面已有实现。浏览器发现无body请求误带JSON Content-Type导致建档失败，已针对请求头条件修复，待最终浏览器复验。

## 待完善

真实模型语义评测和Docker内页面检查尚需证据；页面令牌只用于本机演示，不是生产账户系统。
