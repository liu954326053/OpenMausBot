# 图片和视频生成、项目的生成设置：实现计划（generation 轨道）

日期：2026-11-21 · 设计：`docs/superpowers/specs/2026-11-21-teams-flow-project-canvas-design.md` 第 5 节"模型和生成""和 MCP 服务器的约定" · 分工：`OpenMausBot-wt/CHARTER.md`

**目标：** 项目画布上的图片和视频由服务器通过用户自己配置的 MCP 服务器生成。项目有自己的生成设置（图片、视频各自用哪个 MCP 服务器、哪些工具、默认模型和参数），节点继承、可以逐项覆盖。不管是用户在节点上点"生成"还是机器人通过工具触发，走同一段代码。没有界面。

**做法：** 服务器像"MCP 服务器"页面的"测试"那样按用户的身份连接一个已配置的服务器，用现成的连接池调用约定里的四个工具。对接 MCP 的那一层（`convention.ts`）只管"参数怎么拼、回答怎么读"，换成真正的服务器时只改它。

## 这一块定下的细节

### 程序自己调用 MCP 工具（主要的未知数）

现在已经有三处在对话之外由服务器自己连 MCP 服务器：`chat-apps-mcp.ts`（MCP 应用的视图调用工具）、`higgsfield-mcp.ts`（用 Higgsfield 生成头像）、`host/mcp-config.ts` 的 `test`（"测试"按钮）。照"测试"的步骤做，不写第二个 MCP 客户端：

1. 读 `config.json` 的 `mcpServers` 条目（`parseStoredMcpServer`）。
2. 拒绝：没有这个服务器、关着、在另一台电脑上运行（`runsOn`）、组织策略不允许（`mcpPolicyRefusal`）、属于某一个机器人（`bot`，它的密钥只给那个机器人）、Team Cloud 上每人各自登录的（`personMcp`）。
3. `McpKeys.warm` 和 `resolve`（不带机器人 id，按用户本人）把 `vault:<id>` 换成 Vault 里的值。
4. URL 服务器：`withMcpSignIn` 加上登录令牌；需要登录时拒绝并说明。服务器拒绝令牌（HTTP 401）时 `tokenRefused` 刷新一次再试。
5. 用 `mcp-app-connections.ts` 的 `AppConnections`（一个独立的池）发 `tools/list`、`tools/call`。命令服务器用 `mcpServersHost.probeAs` 的身份启动：开了机器人沙箱时在沙箱里，和"测试"一样。

密钥只在连接里用。设置、任务、日志、错误里都没有：服务器回来的错误文字先把配置里的值和像密钥的字符串遮掉（同 `chat-apps-mcp.ts` 的做法）。

### 和 MCP 服务器的约定

写在 `docs/project-generation-mcp.md`，给搭服务器的人看。要点：

- 四个工具，默认名 `list_models`、`generate_image`、`generate_video`、`task_status`；可选第五个 `cancel_task`，服务器有它时，取消任务也通知服务器。项目设置里每一项可以改成服务器上实际的名字。
- 回答放在 `structuredContent`，或者第一个文本块里的 JSON。`isError: true` 的回答是失败，文字就是原因。
- 发给服务器的参考文件（图片、音频）内嵌为 base64：`{ name, mimeType, data }`。远程和本机的服务器都能收，不需要服务器能访问 MagicBot。
- 服务器给回的结果文件：`{ url }` 或 `{ mimeType, data }`；也接受 MCP 自带的 `image` 内容块。网址只接受公网的 `https`，或者 MCP 服务器自己的地址（本机的测试服务器就是这样）。不接受本机路径。
- 图片可以直接给文件，也可以给任务编号；视频给任务编号。`task_status` 答 `queued`、`running`、`succeeded`、`failed`、`cancelled`，可选进度和下次查询的间隔。

### 项目设置

- 存在数据目录：`<data>/project-generation/<项目 id>.json`（设置和任务），`<data>/project-generation/last-settings.json`（用户上一次保存的设置）。
- 一个项目第一次读设置时，从上一次保存的设置复制一份；没有就用默认值（没有服务器、没有模型）。
- 节点的设置：节点覆盖的每一项优先，其余用项目的。`resolveSettings` 在 `shared/project-generation.ts`，服务器和界面共用。
- 模型不提供的选项：保存时和使用时都拒绝，并列出模型提供的选项。模型没给某一项的列表时，用固定的常见选项（图片比例 1:1、2:3、3:2、3:4、4:3、9:16、16:9、21:9；清晰度 auto、low、medium、high；数量 1 到 4；视频分辨率 480p、720p、1080p；比例 16:9、9:16、1:1、4:3、3:4、21:9；时长 5、10 秒）。
- 保存时模型列表来自服务器，最近 5 分钟内取过的直接用；服务器连不上又没有取过时，保存被拒绝并说明。

### 生成任务

- 状态：`queued`（排队）、`running`（已交给 MCP 服务器）、`done`、`failed`、`cancelled`。每次变化先写盘，再通知。
- 通知：`start` 时给的回调，加上 `onJobChange` 注册的监听（重启后接着跑的任务只有后者能收到，所以画布服务器应在启动时注册一个）。
- 同时最多 3 个任务在跑，其余排队；一个项目最多 50 个没结束的任务。
- 交给工具的就是提示词、参考文件和合并好的设置，原样不改。模型不支持参考图或参考音频却带了，拒绝，不悄悄丢掉。
- 轮询：默认 3 秒，服务器给的间隔限制在 1 到 30 秒。连续 5 次查不到算连不上。图片 15 分钟、视频 60 分钟没结果算超时。
- 重启：排队的重新排；在跑且有任务编号的接着查；在跑但还没拿到任务编号的（服务器停时请求正在路上），标为中断，请用户重试，不重复提交以免重复扣费。
- 取消：停止等待和查询，服务器有 `cancel_task` 时通知它；结果不存。
- 结果存进项目文件夹的 `产出/图片` 或 `产出/视频`：文件名来自请求给的名字（如节点标题）去掉不能用的字符，加时间和任务编号的一段，扩展名按文件内容判断；用独占创建，不会覆盖已有文件；每一级文件夹都必须是真文件夹，不是链接，不用递归创建，所以拔掉的硬盘不会被重新建出来。
- 失败的原因用用户能照着做的话说：没有选 MCP 服务器、服务器连不上、需要登录、工具不存在、模型不认识、选项模型不提供、服务器上的任务失败（带服务器给的原因）、结果下载不了、超时、中断。

### 机器人的上限

- 一个机器人不经用户确认，24 小时内最多开始 8 张图片和 3 个视频（一次生成 4 张图算 4 张）。超过时 `start` 拒绝并给出已用数和上限，由集成阶段出确认卡片；用户确认后带 `confirmed: true` 再调用，不计入上限。
- 用户在节点上点"生成"不受上限限制。

## 约束

- `server/index.ts` 只加一行，调用本模块。新文件都不超过 1000 行。
- 注释只写代码说不出来的东西（`AGENTS.md`）。
- 新的 `serverError.projectGeneration.*` 句子有英文、简体中文、繁体中文、巴西葡萄牙文。

## 文件

| 文件 | 内容 |
|---|---|
| `shared/project-generation.ts` | 契约：设置、模型、任务、路由的请求和回答、`resolveSettings`、模型能选什么、哪些设置不被提供 |
| `server/project-generation/mcp-access.ts` | 按用户身份找到并连接一个已配置的 MCP 服务器，列工具、调用工具，错误归类 |
| `server/project-generation/convention.ts` | 约定的四个工具：参数和回答的格式。换服务器时只改这里 |
| `server/project-generation/settings.ts` | 每个项目的设置、上一次保存的设置、保存时的检查 |
| `server/project-generation/results.ts` | 读参考文件、下载和解码结果、存进 `产出/…` |
| `server/project-generation/jobs.ts` | 任务：排队、运行、轮询、取消、写盘、重启后接着跑、通知 |
| `server/project-generation/ceiling.ts` | 机器人的上限 |
| `server/project-generation/host.ts` | 把以上接起来，给 `index.ts` 那一行用 |
| `server/routes/project-generation.ts` | `/api/team-projects/:id/generation/…` |
| `server/testing/fake-generation-mcp-server.ts` | 按约定实现的测试服务器 |
| `docs/project-generation-mcp.md` | 约定 |

## 接口

```ts
// GET  /api/team-projects/:id/generation/settings          → { settings, servers }
// PUT  /api/team-projects/:id/generation/settings          ← ProjectGenerationSettings → { settings }
// GET  /api/team-projects/:id/generation/models?kind=…     → { models }（可带 server、tool 预览还没保存的服务器）
// POST /api/team-projects/:id/generation/jobs              ← StartGenerationInput → 202 { job }
// GET  /api/team-projects/:id/generation/jobs              → { jobs }
// GET  /api/team-projects/:id/generation/jobs/:jobId       → { job }
// POST /api/team-projects/:id/generation/jobs/:jobId/cancel → { job }
```

被拒绝时回答 `GenerationFailure`：`{ code, error, errorKey, errorParams?, reason?, problems? }`。

## 任务

- [ ] **1. 契约。** `shared/project-generation.ts` 和它的测试：合并设置、常见选项、不被提供的设置。
- [ ] **2. 测试用的 MCP 服务器。** 几个图片和视频模型，各自的选项不同；稍等一会儿给出真实的小图片和小视频；可以让它失败、把任务一直挂着直到放行、要求一个密钥。
- [ ] **3. 连接 MCP 服务器。** `mcp-access.ts`：拒绝的各种情况、密钥、登录、命令服务器和 URL 服务器、错误里不带密钥。
- [ ] **4. 约定。** `convention.ts`：四个工具的参数和回答，文档。
- [ ] **5. 设置。** 存、读、第一次读时继承上一次保存的、保存时检查。
- [ ] **6. 结果文件。** 参考文件读取和大小限制；结果下载（只许公网 https 或服务器自己的地址）、解码、判断类型、命名、存放。
- [ ] **7. 任务和上限。** 状态、轮询、取消、超时、重启后接着跑、通知、并发、上限。
- [ ] **8. 路由和接线。** `server/index.ts` 一行。
- [ ] **9. 真服务器上的端到端测试和证据。** 证据放 `/tmp/omb-wt-generation/`。
- [ ] **10. 检查。** 类型检查、lint、i18n、行数、相关测试。

## 怎么验证

- 单元测试：合并设置、拒绝模型不提供的选项、任务的各个状态、结果的命名、上限。
- 端到端（`server/project-generation.e2e.test.ts`，真服务器，`launchRestartableServer`，测试 MCP 服务器另起一个进程）：从 MCP 服务器取到模型列表；保存设置，新项目从它开始；生成一张图，工具收到的参数等于合并后的设置，文件在 `产出/图片`；生成一个要等一会儿的视频，回调看到每个状态，文件在 `产出/视频`；取消一个任务；一个任务带着服务器给的原因失败；视频任务进行中重启服务器，重启后任务完成；没有选 MCP 服务器时被拒绝并说明；日志、任务和错误里都没有密钥。

## 已知的不足

- 结果网址的下载不走 HTTP 代理设置。
- Team Cloud 上每人各自登录的 MCP 服务器不能用来生成（不知道该用谁的登录）。
- 属于某一个机器人的 MCP 服务器不能用来生成。
- 机器人触发生成时，Vault 里的密钥按用户本人读，不按那个机器人读：服务器是用户在项目设置里选的，机器人看不到密钥；花钱的风险由上限管。
