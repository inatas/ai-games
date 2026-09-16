# 验证记录

日期：2026-09-16。此文件区分设计验收清单与实际运行结果。

当前武侠世界v2已部署：房间、NPC、任务、地图与场景的最新结果见[示例验证记录](../examples/wuxia-mud/docs/world-mvp-verification.md)。下文保留各历史阶段的检查证据和当时限制。

## 已执行的基础验证

目录整理前，19个测试组通过，使用真实PostgreSQL 18，覆盖中性宿主判定、结构纠正、幂等、scope并发、超时、事务回滚、实际进程终止恢复、来源隔离，以及武侠完整路径。TypeScript检查和前端构建通过。

## 本次目录与 Docker 调整

源码改为workspace的src入口，测试按归属移动；标准环境不再自动启动embedded-postgres。Docker Compose提供应用及数据库，测试通过TEST_DATABASE_URL连接独立数据库。

最终回归：TypeScript检查通过，仓库目录/8份需求/文档链接检查通过，Vite构建通过；21个测试组全部通过，包括真实PostgreSQL事务与进程终止测试。此次仅为宿主机回归，使用工作区已下载的PostgreSQL临时启动测试库并结束后关闭，没有安装或启动Docker。

首次回归连接旧数据库时遇到ECONNREFUSED，确认旧进程已停止后改用独立临时测试库，最终通过。Browser创建存档的请求头问题已修正，HTTP集成建档通过；修复后的完整浏览器重载操作尚未复验。

## Docker Desktop 实测

用户安装Docker Desktop后，Compose配置检查、镜像构建、应用启动均通过。app和postgres健康，/api/health返回status=ok、modelMode=mock。Linux容器内21组测试全部通过，包含独立PostgreSQL数据库、事务回滚和进程终止恢复。构建中的TypeScript、目录检查及Vite构建通过。测试构建使用registry.npmmirror.com成功安装依赖；Node和PostgreSQL复用官方镜像缓存。DaoCloud镜像地址仅作为可选配置，未执行拉取验证。

## 尚未验证

- 完整浏览器断网、多标签并发和Cookie过期故障注入尚未自动化；正常登录与续玩流程已实测。
- 真实模型的广泛语义质量、峰值负载和供应商侧取消计费行为尚未验收；当前只完成一次DeepSeek V4.1 Flash成功奇遇和一次安全失败路径。
- 自主规划、多Agent/NPC互动：仅需求草案，不在当前实现范围。

不能据此宣称全部F/D验收项已完成；目前测试组包含参数化子场景，并非每条文档用例都已有独立测试。


## 公共账号与世界观 v1

用户确认v1后生成代码。新增公共identity模块及浏览器入口；storage负责公共迁移、世界观加载和版本保存；core将世界观计入必需上下文，武侠仅提供初始化回调和背景正文。

Docker Linux容器完整回归28组全部通过，类型检查、仓库检查、前端构建通过。覆盖账号唯一性、错误密码、会话恢复/滑动过期/撤销、Origin校验、限流窗口恢复、单一当前档案、重置回滚/幂等/并发，以及世界观加载/版本/预算/纠正/调用追溯。首次回归HTTPS测试因模拟Host默认80端口与HTTPS Origin不一致失败；修正测试Host后全部通过，未放宽Origin校验。

本地应用已重新构建启动，app和postgres均healthy。浏览器使用临时qa账号实测：首次登录创建、行善一次、刷新仍登录且银两18/侠义1、登出、重登恢复同一记录、新局确认后银两20/行动0，最后退出测试账号。旧游客提示显示正常，升级保留原开发数据库卷。

世界观注入与协议校验已在DeepSeek真实奇遇中完成一次验证，但不等于广泛叙事效果验收。详细覆盖与未自动化UI子场景见[测试设计](testing/accounts-worldview.md)。

## DeepSeek V4.1 Flash

用户确认[接入设计](specs/deepseek-provider.md)后完成公共适配器扩展。本地`.env`以real模式配置，密钥未进入源码、镜像、文档或日志。官方`GET /models`认证通过并包含`deepseek-flash`；应用容器healthy，健康接口返回real。

完整Docker回归29组通过，包括通用Chat Completions协议和DeepSeek专用`json_object + max_tokens + thinking.type=disabled`协议。真实奇遇请求committed，调用记录：模型`deepseek-flash`、输入400 tokens、输出6 tokens、世界观`wuxia/1`；游戏按宿主规则执行GIFT，银两20→24、memoryVersion=1、encounterDone=true。

第一次真实请求以字符串发送thinking，供应商返回400；框架记录`MODEL_UNAVAILABLE`且银两20、memoryVersion=0、encounterDone=false。根据官方Schema修正为对象并加入回归测试后成功。真实模型原始正文及密钥未记录。
