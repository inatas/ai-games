# 需求：青溪配置运行框架接入

Status: implemented

## 需求

使用配置地图和共同Action迁移既有青溪玩法，减少重复运行代码。

## 范围

用户回复“ok，开始”确认[青溪接入v1](../../docs/configured-runtime.md)。仅迁移现有内容和资格，不新增NPC自主巡逻，不改变属性005或奖励。公共协议见[框架设计](../../../../docs/specs/configured-game-runtime.md)。

## 验收

- [x] QCR-01～04由既有青溪地图/游戏/护送回归覆盖，最终源码72/72合并回归通过；构建验证方式与限制见验证记录。

## 当前进展

2026-09-17：重构前检查点main/762bdfaa2cd7787032570ca41e87fdd650e6f85d。青溪12房间/23出口/5NPC已迁入JSON，通行判断与地图展示复用规则，move调用公共Action并产生事实事件。初始化保持幂等；其他玩法保留原Binding。

各阶段检查点、命令和结果见[统一验证记录](../../../../docs/testing/configured-game-runtime-verification.md)。开发服务尚未部署，未修改开发库。

## 待完善

未来青溪NPC自主行为变更须独立评审游戏影响，当前保持关闭。开发服务未部署，真实模型未运行。
