# Robot用户配置集

users每份JSON定义一个持久userId，代表独立Robot用户，不是座位或游戏身份。复制用户须新建UUID；同局禁止同一用户占多席。assets集中保存公开头像和人物素材，目前12个昵称复用3张用户授权素材。avatar为裁剪参数，portrait.variant只指定现有展示遮罩，与游戏身份无关。

默认control为随机合法脚本，speech固定一句话，modelProfile=null；性格先保存为固定初始资料，脚本不模拟性格推理。未来模型控制及人格生成另按已确认方案接入。

昵称、头像、性别可公开；persona/control仅服务端读取。不要存Key、密码、好友关系、资产或对局记忆。userId使用UUID以便未来关联用户体系；当前本地目录不会为机器人创建真人登录账号，也未接通好友或送礼。运行期间对局使用资料快照，编辑配置重启服务后用于新局。

## 模型Robot（配置就绪，尚未调用模型）

`users/robot-013.json`定义“星河”，独立userId，control.kind为model，modelProfile引用`model-profiles/environment-default.json`。当前共13个用户，其中12个脚本用户可用于无模型对局。

profile统一引用现有服务端环境变量：MODEL_BASE_URL、MODEL_NAME、MODEL_API_KEY、MODEL_PROTOCOL（未设置时协议默认json-schema）。文件仅保存变量名称；加载目录不读取变量值、不验证凭据可用性、不发起模型请求。实际模型名称取决于未来运行时注入的MODEL_NAME，本次不指定新的供应商。

默认座位工具显示“星河 · 模型服务未配置”，禁选并从随机补满中排除。按[模型Robot本地对局](../docs/model-robot-run.md)启用持久模型服务后，它可与11名脚本Robot同局；纯脚本演示入口仍拒绝模型用户。复制模型Robot时须生成新UUID，可共享同一modelProfile。
