# @game-ai/core

定义Binding、ModelAdapter、HarnessStore，提供Harness与buildContext。宿主注册规则；core没有游戏题材。通过构造参数注入存储、模型、时钟和预算。

持久化端口目前是PostgreSQL感知接口，core协调器仍有SQL；更换数据库需要独立设计，不宣称已经完全数据库无关。事务、生命周期细节见[架构指引](../../ARCHITECT.md)。
