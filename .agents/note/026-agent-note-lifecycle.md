# 026 Agent Note 状态与索引规范

Status: implemented

## 需求

用户要求 Notes 有明确的 `proposed / implemented / rejected / archived` 状态，并在当前仓库 Note 目录提供 AGENTS.md 与 README.md，说明规范、工作流并索引已有记录。`C:\Git\ai-robot\.agents\notes` 是参考样例，修改目标为本仓库 `C:\Git\ai-games`。

## 范围

本次在根目录和两个现有 MOD 的 `.agents/note` 目录提供或更新 AGENTS.md、README.md；统一编号 note 的状态值，保留原文件路径和历史正文；让仓库检查只把编号文件视为需求 note，并检查规范状态和唯一索引。当前不迁移为按状态分目录，也不修改参考仓库。

## 验收

- [x] 根目录 26 份、青溪镇 6 份、狼人杀 6 份编号 note 各有一个规范 `Status:`，且在本目录 README 恰好出现一次。
- [x] 四种状态的含义、迁移、批准与验收边界及接力规则在 AGENTS.md 可查；模板默认 `proposed`。
- [x] `npm run check:repo` 与 `git diff --check` 通过；新增 AGENTS.md 不被误判为需求 note。

## 当前进展

已按参考样例制定四态生命周期并保留现有平铺路径。根目录及两个 MOD 目录共 38 份编号 note 的规范状态与唯一索引由 `scripts/check-repo.mjs` 检查；`npm run check:repo` 输出 `421 files, 38 requirement notes`，`git diff --check` 通过。根、青溪镇、狼人杀目录的 AGENTS.md 与 README.md 均已同步，模板默认 `proposed`。未修改参考仓库，也未迁移目录结构。

## 待完善

本次范围无剩余工作。后续每次新增或变更 note，依目录 AGENTS.md 同步状态和索引；当前无依据将已有记录标为 `rejected` 或 `archived`。
