# 狼人杀MOD

当前已有基础纯规则内核，尚无完整对局运行入口。目标是12个独立LLM角色自动完成一局狼人杀，人类仅旁观。最新十条裁定及五项边界已同步规则v2；规则已确认；15组狼人杀纯规则测试通过，整局抢占接入v2提案待确认。

- [设计与规则v2](docs/mvp-design.md)
- [验收用例WW-01～WW-76](docs/mvp-testing.md)
- [需求状态](.agents/note/README.md)

本地验证：在仓库根目录安装依赖后运行`npm run test:unit`，包含狼人杀测试；或用Node 24运行`node --test mods/werewolf/tests/rules.test.ts`。当前无旁观地址，不将纯规则测试当作可运行整局。
