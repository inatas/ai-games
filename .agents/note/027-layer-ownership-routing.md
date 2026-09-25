# 027 开发任务层级归属与文档路由

Status: implemented

## 需求

用户明确当前项目有三个 note 归属目录：根 `.agents/note` 承载底层与游戏框架层，`mods/qingxi/.agents/note` 承载清溪镇 MOD 层，`mods/werewolf/.agents/note` 承载狼人杀 MOD 层。每个开发任务都应先判断属于哪一层，再选择对应 note；docs 应同样按层级归属。

## 范围

本次统一项目级规则、架构指引、目录归属规则、开发顺序、Note 目录指引和 docs 导航中的三层路由。用行为所有权与跨 MOD 复用性判断归属；跨层任务拆分并互链；代码落在 `apps/*` 不改变归属。已有根 docs 中历史 MOD 文件保留导航，本次不批量移动或改写其协议。

## 验收

- [x] 根 AGENTS.md 与 ARCHITECT.md 明列三个 note 目录及对应 docs 目录，并给出可操作的任务分类步骤。
- [x] 规则和目录指引明确底层/游戏框架共用根 note/docs、两个 MOD 各用本地 note/docs，跨层需拆分并互链。
- [x] 根 docs README 作为三层导航入口，同时说明历史 MOD 专题文件不改变新归属规则；两个 MOD docs 也有本地导航。
- [x] `npm run check:repo` 与 `git diff --check` 通过；没有迁移既有文档或改动游戏实现。

## 当前进展

三层路由已写入项目级 AGENTS.md、ARCHITECT.md、目录归属与开发确认规则、根 note 指引和根 docs README；两个 MOD docs 新增本地 README。`npm run check:repo` 通过（424 files、39 requirement notes），`git diff --check` 通过。未移动历史文件或修改游戏实现。

## 待完善

本次范围无剩余工作。后续新开发任务先按本规则判层，再选择本层已有 note 或新序号 note，以及对应的架构主题 docs。根 docs 中历史 MOD 文件的路径迁移不在本次范围，具体任务涉及它们时再核对归属和入站链接。
