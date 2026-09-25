# Agent Notes 目录规范

本目录继承[根开发规则](../../AGENTS.md)、[架构指引](../../ARCHITECT.md)和按任务加载的[详细规则](../rules/README.md)。本文件只规定 note 的目录操作、状态与接力；不另设审批门禁。

## 文件与归属

- 新的独立**底层或游戏框架层** feature 使用本目录下一个三位序号 `NNN-topic.md`；清溪镇 feature 归[清溪镇 note](../../mods/qingxi/.agents/note/README.md)，狼人杀 feature 归[狼人杀 note](../../mods/werewolf/.agents/note/README.md)，各自编号。先判断规则/契约能否脱离具体 MOD 复用，再按目标行为及验收边界判断 feature，不按聊天轮次、代码文件数或 `apps/*` 路径判断。
- 同一 feature 的方案修订、实现进展、缺陷修复及验收续做更新原 note。跨框架与 MOD 时分别维护相互链接的 note，避免一份文件同时拥有两层协议。
- 从[TEMPLATE.md](TEMPLATE.md)创建新 note，并在[README.md](README.md)维护**每个当前编号 note 恰好一条**索引。`Status:` 使用规范状态；状态与证据必须一致。
- note 记录“为什么做、确认了什么、做到了哪、下一步是什么”；本目录的通用规则、接口、数据和测试契约链接到根 `docs/specs`、`docs/testing` 的对应架构主题。MOD 玩法正文归其本地 docs，避免重复维护两套正文。

## 状态与迁移

| Status | 含义 | 进入条件 |
|---|---|---|
| `proposed` | 提案、待确认、已确认但实施中，或部分验收未完成 | 创建时默认；当前范围仍有必需实现或验收工作 |
| `implemented` | 当前明确范围已完成并有实际验证证据 | note 列明实现位置、已运行检查、结果及范围外限制；仅有代码或计划不够 |
| `rejected` | 方案经明确裁定不采用 | 记录决定依据和理由；重新提出时建后继 note 并互链 |
| `archived` | 历史上适用但现已失效或被替代 | 写明失效原因、适用历史范围及后继链接；不得充当当前规范 |

`proposed → implemented/rejected/archived`；`implemented → archived` 在被替代时发生。已实施 feature 新增独立目标时建新 note；同一目标新增未完成范围时，可回到 `proposed`，保留原已实施范围和证据。状态是当前**整份 note 的范围**，不是审批结论；“已确认”和“待真实用户复核”另外写清。没有明确拒绝或替代依据，不把旧 note 猜测性地标为 `rejected` 或 `archived`。

当前仓库保持平铺路径，状态以文件内 `Status:` 和 README 索引为准，不因状态迁移移动文件。这样已有链接不失效；将来若另行决定按状态分目录，须统一迁移全部入站链接与索引。

## 工作流与交付

1. 开始前搜索 README、相关 `proposed` 和 `implemented` note，再核对真实代码与测试。若记录过时，修正本次涉及的事实。
2. 按[开发确认规则](../rules/development-approval.md)先写 note 与相应既有 docs，提交具体版本供审阅；用户已确认的范围不重复申请。方案确认后才写可执行测试与实现。
3. 实施期间更新已完成项、未完成项、阻塞和下一步验证；中断时保持 `proposed`，不能因会话结束提前标 `implemented`。
4. 完成时记录实际文件、执行过的检查与结果、未运行检查及原因。改变 `Status:` 时同步 README 状态与简述；归档或拒绝时保留历史并互链后继。
5. 交付时引用相关 note，区分工程实现、自动验证、网页人工验收与真实模型/平台验收。不得把模拟通过写成真实验收。

不记录凭据、生产私密数据、完整聊天记录或内部思考过程；可复查的决定依据用简短摘要和链接表达。
