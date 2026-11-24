# 漫剧制作看板（按 index-v5 效果图改造无限画布）设计

用户的效果图在 ORIGINAL 的 `docs/无限画布效果图/index-v5/`（`index.html`、`data.js`、`render.js`、`app.js`、`panels.js`、`talk.js`、`*.css`、`img/`），截图在 `/tmp/omb-v5-shots/01-opening.png` 到 `15-chat-lead.png`。效果图只能读，不能改，也不提交。

## 1. 已确认的决定

- 一个项目是一整部剧，含 N 集。
- 负责人、编剧、角色设计师、场景设计师：全剧各 1 个 bot。分镜师、后期：每集 1 个真实 bot（项目里的副本，名字是“源名 EP01”）。
- 负责人只做一次计划（需求单 + 任务拆分）。之后系统自动接力：编剧写分集 → 角色、场景并行 → 三项齐备 → 每集建自己的分镜师并派发 → 按并发设置生成视频 → 每集建自己的后期 → 该集成片和剪映草稿。
- 人不直接改素材，而是让 bot 改：点 bot 节点，贴着它弹出对话窗；点素材，弹只读详情，底部“让某人调整”打开负责它的 bot 的对话窗并带上这个素材作参考。
- 画布只留拖动、生成、播放、选用版本，其余编辑工具（新建节点、连线、分组、上传、撤销重做、删节点等）都收起不显示。
- 颜色用程序现有皮肤（深浅都要），不照搬效果图的配色；卡片形态、连线（6 种 × 3 种状态，带标签，引用线默认隐藏，等待中的线是虚线）、阶段和流程照效果图。
- 草图默认不出。镜头卡先显示文字设计；出了视频显示视频画面。
- 生成不设人工闸门：项目设置里有“视频并发”“图片并发”“同时进行的集数”（默认 2、2、3，最大 50）。
- 建团队只定负责人；团队图上的连线、画线、成员环节判定、建团队时规划环节，全部去掉。
- 效果图左侧的“团队（按协作顺序）+ 素材”面板保留，但做成右侧悬浮、可展开收起，和现有右侧导航合并成三栏：团队 / 素材分类 / 分集。
- 群聊只留全剧的几位（负责人、编剧、角色、场景）和调度记录；每集的 bot 不进群，各自单聊。侧栏：群聊、全剧几位、可折叠的“分集”（每集两位）。
- 工作区不再有 100 个 bot 的上限；交付前按 300 个 bot 压测。
- 全部做完再换包；不推送，除非用户要求。

## 2. 服务端（已完成，在 `wt/pipeline` 的检查点提交里）

- 调度引擎 `server/production/`：`engine.ts`（`advance()` 幂等、按项目串行）、`store.ts`（`<data>/productions/<projectId>.json`，权限 0600）、`assign.ts`、`lines.ts`、`plans.ts`、`routes.ts`、`host.ts`、`error-text.ts`；单测 `engine.test.ts`，端到端 `server/production.e2e.test.ts`。
- 线上类型 `shared/production.ts`：`ProductionWire`（plan、全剧 jobs 及状态、ready、episodes、tasks）、`ProductionEpisodeWire`（每集状态、分镜师和后期的 botId、镜头数、已选用数、生成中、失败）、`ProductionConcurrency`、`episodeCode(n)`（`EP01`）。
- 画布快照 `CanvasSnapshot` 带 `production?` 和 `drafts?: Record<集数, ProjectDraftWire>`；`CanvasBotState` 带 `episode?`、`stages`、`status`、`doing`、`output`、`waiting`。
- 节点角色 `metadata.role`：`brief`（需求单）、`plan`（任务拆分）、`episode`（分集剧本，`metadata.episode = n`）、`script`（旧项目的单本剧本，按第 1 集看）、`character`、`scene`（设定卡，与它生成的图片在一个组里）、`creation`（镜头的生成配置）、`take`（镜头的一个视频版本，最多一个 `selected`）、`final`（某集成片）。镜头、creation、take、final 带 `metadata.episode`；镜头带 `metadata.shot = { size, move, audio }`，时长是 `settings.seconds`，画面描述是 `prompt`；文字卡可带 `metadata.card`。
- 负责人工具 `production_plan`（只有负责人看得到）；路由 `/api/internal/project-canvas/plan`。
- 重试：`POST /api/team-projects/:id/production/retry`，body `{ job }` 或 `{ episode }`；未计划 409 `notPlanned`，没停下 409 `notStopped`，参数错 400。
- 每集草稿：`GET /api/team-projects/:id/timeline?episode=N`、`POST .../final`（带 `episode`）。
- 每集 bot：`teamProjects.episodeBot`，`TeamProjectWire.episodeBots: Record<botId, { number, job }>`，副本的 `teamProject.episode`。每集 bot 不进群聊。
- 生成并发在项目生成设置的 `concurrency` 里（服务端已收、已用）。
- 工作区 bot 上限已删。

## 3. 去掉团队连线和环节判定

- 删：`server/team-flow/`、`server/team-judge/`、`peer-roster.ts` 里按连线的上下游与环节（`flowPlace`、`flowRelation`、`pipelineRosterWire`、`flowReach` 等）、`chief-of-staff.ts` 的 `pipelineReachRule`、`propose_team_setup` 的环节（`team-setup-requests.ts` 用 `team-judge/proposal` 的部分）、`side-jobs.ts` 的 `team-judge`、假 CLI 里对应的部分、`scripts/ci-scope.mjs` 的条目、`server/index.ts` 里接线的几行；客户端 `src/components/team-pipeline/`、`TeamCanvas.tsx` 的连线和画线、`src/state/team-pipelines.ts`、`src/lib/team-pipeline.ts`、相关预览、UI 测试、文档和语言键。
- 保留 `shared/team-pipeline.ts` 里画布还在用的：`FlowStage`（含 `scene`）、`FlowLineWire`、`PIPELINE_STAGES`、`ProjectPipelineWire`；画布服务端（`server/project-canvas/`）还在引用的模块先留着，列出来交给集成。
- 联系规则（团队里和项目里都一样）：负责人能联系每一位成员（项目里包括每集的 bot）；其他成员能联系负责人。旧数据里画过连线的团队，行为和没画过一样——旧的 `team-flows.json` 留在数据目录里不读也不删。
- 负责人的提示词里讲清楚：项目里先和人确认需求，然后调用 `production_plan`，之后系统自动接力，失败时会通知他。
- 新增一条端到端：数据目录里放一份画过连线的旧 `team-flows.json`，项目照样从计划跑到全部完成，负责人能联系到每集的 bot。

## 4. 看板（画布本体）

### 4.1 从快照到卡片

| 卡片 | 来自 | 内容（照效果图） |
|---|---|---|
| bot | `bot:<id>` 节点 + `bots[id]` + `production` | 头像、名字、头衔（每集的带 EP 码）、负责人标识、状态；当前任务、进度条和文字（如“分集剧本 12 / 60”“分镜视频 4 / 6”）、最近几步；失败时“重试” |
| 需求单 | `role: brief` | 标题、行（标签 + 值） |
| 任务拆分 | `role: plan` + `production.plan` + 各 job 状态 | T1…T5：任务名、负责的 bot、状态，并行的标记 |
| 分集 | `role: episode`（旧项目的 `script` 按 EP01） | EP 码、标题、梗概或开头几行、该集状态、派给谁 |
| 分集摞 | 没展开的若干集 | “EP04 – EP60”、集数、前几集标题 |
| 角色 | `role: character` 的组 | 名字、标签、图（组里选中的或第一张）、出场镜头 |
| 场景 | `role: scene` 的组 | 名字、副标题、图、出场镜头 |
| 镜头 | 镜头节点 | SH 码、标题、景别、运镜、时长、声音、引用的角色和场景（小头像） |
| 结果 | 镜头的 creation + 它的 takes | 选用版本的画面或占位、版本数和版本切换、生成中进度、失败原因、生成 / 播放 / 选用 |
| 成片 | `role: final` + `drafts[n]` | 封面或画面、时长、片段条、剪映草稿状态、打开剪映 |
| 其他 | 其他内容节点 | 照现有的文字、图片、视频节点显示 |

### 4.2 连线

类型：`dispatch` 任务派发、`output` 产出、`handoff` 交付、`gen` 生成视频、`derive` 细化衍生、`ref` 引用。状态：`done` 实线、`active` 实线加强调色（不做循环动画）、`wait` 虚线。

- 负责人 → 需求单、任务拆分（output）。
- 需求单 → 编剧（handoff）；任务拆分 → 编剧（dispatch，“派发 · 分集”）。
- 编剧 → 角色设计师、场景设计师（dispatch，“派发 · 角色表”“派发 · 场景表”）。
- 编剧 → 每张分集卡和分集摞（output，第一条标“分集剧本 × N”）。
- 角色设计师 → 角色卡、场景设计师 → 场景卡（output）。
- 分集卡 → 该集分镜师（dispatch，“派发 EP01”）。
- 分镜师 → 镜头（output）；镜头 → 结果（gen）；结果 → 该集后期（handoff，其中一条标“分镜视频 4 / 6”）；后期 → 成片（output，“合成 EP01”）。
- 分镜师细化出的场景：分镜师 → 该场景卡（derive），原场景 → 它（ref）。
- 角色、场景 → 镜头（ref）：默认隐藏；悬停或选中一张卡时显示与它相关的引用线；工具条上有“显示引用线”的开关。
- 状态从 `production` 和节点推出：任务 `done` → done，`working` → active，没开始 → wait；生成中 → active；有选用版本 → done。

### 4.3 布局

- 从左到右五个阶段带：需求（负责人、需求单、任务拆分）→ 分集（编剧、分集卡）→ 角色 · 场景（与分集平级：角色在上、场景在下）→ 分镜 · 视频 → 后期。
- 每集的“分镜师 → 镜头 → 结果 → 后期 → 成片”只对进行中的集和人点开的集展开，其余的集收进分集摞。
- 客户端算位置，卡片尺寸固定（按类型，内容过长在卡内滚动或截断），不量 DOM。人拖动过的卡记下位置（存进画布文档的节点位置），以后以它为准。
- 远景：缩小到一定程度后卡片换成简化的标签（名字 + 状态色），保证 60 集也流畅；只画视口内的卡片。
- 顶部阶段条：五个阶段的名字和状态，点了定位到该阶段。小地图保留。
- 空状态（还没有计划）：只有负责人卡和一句提示“先在群聊里和负责人确认需求”。归档项目只读；项目文件夹丢失时照现在的提示。
- 旧项目（没有 production 的）：照新看板画，`script` 节点当 EP01，没有 `episode` 的镜头当 EP01。

### 4.4 画布上还能做的

- 拖动卡片、平移、缩放。
- 生成：镜头卡 / 结果卡上的生成（视频）、角色和场景卡上的生成（图片）——走现有的 `startGeneration`。
- 播放视频；在结果卡上切换版本并“选用”（现有的 `selectTake`）。
- 失败的任务或集：卡上“重试”，调重试路由。
- 点 bot → 对话窗；点素材 → 详情。

## 5. 浮层

- **右侧悬浮面板**（替换现有的 `CanvasNav`，同样悬浮在右侧、可展开收起）：三栏。
  - 团队：按协作顺序（负责人、编剧、角色、场景、各集分镜师、各集后期），头像、名字、头衔、状态；点了定位到它并打开它的对话窗。
  - 素材分类：角色、场景、镜头（按集）、成片；点了定位并选中。
  - 分集：每集一行，EP 码、标题、状态、进度（已选用 / 镜头数）；点了展开那一集并定位。
- **对话窗**：贴在 bot 卡旁边，跟着镜头移动；显示和这个 bot 的往来（现有的 `readExchange`），底部输入框发任务（现有的 `sendTask`）；参考托盘：连入它的素材和人从“添加参考”里挑的素材；分镜师默认可取用全剧的角色卡、场景卡（效果图的 `extraRefs`），但不画线。可停止（`stopBot`）、可在聊天里打开（`openChat`）。等人回答的卡（`waiting`）照现在的显示。
- **素材详情**：模态弹窗，只读：标题、类型、图片 / 视频、属性（如角色的标签、场景的副标题、镜头的景别运镜时长声音、版本）、提示词、出现在哪些镜头；底部“让某人调整”——负责它的 bot（角色 → 角色设计师；场景 → 场景设计师，分镜师细化的归该分镜师；镜头、结果 → 该集分镜师；成片 → 该集后期；分集 → 编剧；其他 → 负责人）——打开它的对话窗并把这个素材放进参考。

## 6. 侧栏、群聊、设置

- 侧栏项目下：群聊；全剧的几位（名字后面是角色，负责人有专属标识，已有）；可折叠的“分集”，每集一行可展开，下面是该集的分镜师和后期。
- 项目群聊的成员只显示全剧的几位；调度记录照现在的活动行。
- 项目设置（`ProjectSettingsDialog`）的生成设置里加三项：视频并发、图片并发、同时进行的集数（1 到 50）。
- 客户端测试夹具补 `episodeBots`。

## 7. 压测

- 用 `scripts/bench-many-bots.ts` 在隔离夹具里建约 300 个 bot（含一个 60 集项目的 120 个每集 bot 的规模），量服务端的列表、快照、侧栏接口和 bot 的 `list_bots`；找出热点并修。客户端热点（侧栏渲染、看板渲染）报告给对应的人。

## 8. 皮肤与设计规范

- 只用现有的主题变量，深浅两套皮肤都要截图检查。
- 守 `DESIGN.md`：动效不超过 300ms、不做循环或吸引注意的动画、句子式大小写、圆角和字号用现有档位、只有悬浮的东西才有阴影；字体不从网上加载。
- 中文用词：负责人、编剧、角色设计、场景设计、分镜、后期；选用；剪映；成片；分集；派发。
