# 需求：持久事实事件与投递

Status: implemented

## 需求

platform提供持久事实事件、同事务投递快照、有限租约重试、主体复验与因果链限制。状态变化与事件一起提交，任务奖励仍保持原子性。

## 范围

2026-09-17用户以“ok，开始”确认[详细设计v1](../../docs/specs/configured-game-runtime.md)与逐项实施。三层边界和首版限制以设计为准；青溪接入见[本地006](../../mods/qingxi/.agents/note/006-configured-runtime.md)。

## 验收

- [x] 对应[验收契约](../../docs/testing/configured-game-runtime.md)的EV-01～05行为实现与自动化回归，证据及覆盖限制见验证记录。
- [x] 最终源码在隔离Docker中TypeScript、72/72测试和Vite通过；最终锁文件离线npm ci成功。标准在线重建遇ECONNRESET，未伪记为通过，详见验证记录。

## 当前进展

已完成本阶段实现。检查点、先行失败测试、实际命令与阶段结果统一记录在[验证记录](../../docs/testing/configured-game-runtime-verification.md)，不将历史基线称为未经验证的稳定版本。按015→018顺序开发，全部本地提交，无push。

## 待完善

开发服务未部署、开发库未修改。真实模型、容量压测未运行；标准在线重建需网络恢复后再验证。未来扩展须另行确认。
