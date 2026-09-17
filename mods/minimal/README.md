# 最小配置 MOD

复制本目录后修改content/manifest.json及其引用的JSON。房间、出口和NPC只声明内容；规则函数通过显式ID注册。样板不含任意脚本执行或动态加载。

集成入口见[src/host.ts](src/host.ts)，使用现有buildApp的host参数装配。默认仅提供移动，不自动启动巡逻。测试入口为根目录Docker测试profile；无需新增账号系统、HTTP路由或数据库驱动。

规则permit演示有限条件扩展；未提供相应能力的执行者不能通过。行为树实例及运行恢复由框架中性测试验证，MOD可按需配置。

样板host明确给当前执行者提供allowed=true；真实MOD应从受信任状态读取自己的资格。不能把浏览器传入的allowed当作事实。

例如在新realm启动前，将content/behaviors.json配置为以下内容，即可启用guide来回移动：

```json
[
  {
    "id": "patrol", "npcId": "guide", "intervalMs": 3000,
    "root": {
      "type": "sequence",
      "children": [
        {"type": "action", "actionId": "move", "params": {"exitId": "east"}},
        {"type": "action", "actionId": "move", "params": {"exitId": "west"}}
      ]
    }
  }
]
```

每步独立提交；路线不匹配时失败，不会传送或自动寻路。内容部署后不可用相同版本静默更改已有行为。修改既有realm配置应按根开发指南明确升级或重建，普通重启保留进度。

接入模型时由受信任host注册decisionBinding/narrationBinding，并配置相应白名单和授权事实；样板默认没有模型决策或自动叙述。详细的无网络协议测试见[模型边界测试](../../tests/integration/action-model.test.ts)及[调度测试](../../tests/integration/behavior.test.ts)。
