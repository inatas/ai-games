# Robot用户配置集

users每份JSON定义一个持久userId，代表独立Robot用户，不是座位或游戏身份。复制用户须新建UUID；同局禁止同一用户占多席。assets集中保存公开头像和人物素材，当前13名用户复用3张用户授权素材。avatar为裁剪参数，portrait.variant只指定现有展示遮罩，与游戏身份无关。

`robot-001`～`012`使用模型控制，`robot-013`（星河）保留随机合法脚本及固定短句。性格保存为固定初始资料；脚本不模拟性格推理。

昵称、头像、性别可公开；persona/control仅服务端读取。不要存Key、密码、好友关系、资产或对局记忆。userId使用UUID以便未来关联用户体系；当前本地目录不会为机器人创建真人登录账号，也未接通好友或送礼。运行期间对局使用资料快照，编辑配置重启服务后用于新局。

## 模型Robot

当前共13个用户，其中12个模型用户引用`model-profiles/environment-default.json`，1个脚本用户为`robot-013.json`。模型房间可以选择12名模型用户，也可以将脚本用户加入混合阵容。

profile统一引用现有服务端环境变量：MODEL_BASE_URL、MODEL_NAME、MODEL_API_KEY、MODEL_PROTOCOL。运行 DeepSeek 对局时明确设置`MODEL_PROTOCOL=deepseek`和对应的模型地址与名称。文件仅保存变量名称；加载目录不读取变量值、不验证凭据可用性、不发起模型请求。

未配置模型服务时，12名模型用户在座位工具中禁选，唯一脚本用户无法补满12个座位；独立自动脚本演示仍可运行。按[模型Robot本地对局](../docs/model-robot-run.md)启用持久模型服务后，13名用户均可选，满12人即可手动开局。复制模型Robot时须生成新UUID，可共享同一modelProfile。
