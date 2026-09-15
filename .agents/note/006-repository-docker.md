# 需求：清晰的仓库组织和 Docker 环境

Status: implemented

## 需求

参照DeepSeek Harness的职责分层组织项目。用户明确要求`.agents/note`存放一个个可完善的需求，AGENTS.md和ARCHITECT.md负责规范，环境用Docker。

## 范围

apps入口、packages能力包、src/tests归属、examples游戏、docs使用说明；npm workspaces与公共导出；Docker Compose运行和独立测试库。不复制参考仓库的全部插件体系，不自动安装系统Docker或虚拟化组件。

## 验收

- [x] npm run check与check:repo通过，移动后无失效导入或文档链接。
- [x] Dockerfile/Compose定义应用、开发库、独立测试库及健康检查。
- [x] docker compose up --build能启动；测试profile成功；实际未运行须明确记录。

## 当前进展

目录、workspace导出、[Dockerfile](../../Dockerfile)和[Compose](../../compose.yaml)已配置；已移除默认embedded-postgres自动启动入口。

## 待完善

Docker Desktop上的配置检查、构建、启动、健康检查与Linux容器内21组测试均通过，证据见[验证记录](../../docs/verification.md)。项目.env启用国内npm镜像并实测构建通过；Node/PostgreSQL复用官方缓存，另提供可选DaoCloud地址，未修改全局Docker设置。完整浏览器交互仍由Demo需求跟进，可选DaoCloud拉取尚未验证。


