# 项目画布的界面（canvas-client 轨道）

日期：2026-11-21 · 设计：`docs/superpowers/specs/2026-11-21-teams-flow-project-canvas-design.md` 第 5 节“项目画布”的界面部分 · 章程：`OpenMausBot-wt/CHARTER.md`

**目标：** 打开一个项目看到的画布：平移缩放、节点、连线、节点下方的面板、机器人节点、分镜节点、派发线、自动排列、项目设置，以及框选、复制粘贴、打组、撤销重做、小地图、节点列表这些编辑功能。数据只经过 `CanvasBackend`，这一轨道带一个内存里的实现和一个预览页。

**做法：** 照搬 infinite-canvas（MIT，`basketikun/infinite-canvas@9cd3deac`）的画布和节点逻辑：`web/src/pages/canvas/project.tsx`、`components/canvas/`、`lib/canvas/`。搬过来的文件开头保留它的版权和许可声明，`NOTICE` 和 `third_party/infinite-canvas/LICENSE` 写明出处。界面换成 MagicBot 自己的控件和颜色（`DESIGN.md`），文字都走 `t()`，不用 Ant Design、zustand、localforage、nanoid、motion。

## 这一块定下的细节

1. **数据只经过 `CanvasBackend`。** 画布从它读快照、发操作、订阅变化、上传文件、给机器人发任务、停止机器人、列模型、读写项目的生成设置、开始和取消生成。浏览器里不存任何东西。
2. **类型和操作用两个负责人提交的契约**：`shared/project-canvas.ts`（`canvas-server`）和 `shared/project-generation.ts`（`generation`），原样拿进来，不改。操作是 `add_node`（`nodeType`，不能是机器人）、`update_node`（`patch` 和 `metadata`，`null` 删掉键，`settings` 和 `file` 整个替换）、`delete_node`、`connect_nodes`、`delete_connections`、`set_viewport`、`set_background`。契约里没有的（机器人的头像、文本节点的回复写回哪里、最近的来往、打开对话）放在 `src/lib/project-canvas/types.ts` 和 `CanvasBackend` 里，在报告里列出来。
3. **本地先改，再交给后端。** 拖动和缩放节点时只改本地，松手时发一次操作。后端答复之前收到的新快照，会把还没确认的操作叠上去，画面不会跳回去。改内容的批次带 `baseRevision`；只挪位置、改大小、视口和背景的批次不带（后写的为准），生成中服务器改状态时不会把人的拖动整批拒掉。
4. **撤销和重做**按 infinite-canvas 的规则：最多 50 步，视口不算，撤销后清空选择。但记的是“操作和它的反向操作”，不是整份快照：文档在服务器上，机器人也会改，撤销只撤自己的改动。
5. **视口**改了 500 毫秒后保存（同 infinite-canvas），不进撤销。
6. **机器人节点**的编号是 `bot:<botId>`，快照里每个机器人都有节点和推出来的状态（`CanvasBotState`）。没人摆过的（`placed: false`）用服务器的默认布局，和程序的树是同一条规则，所以打开时照快照的位置画，不写回。机器人节点不能删除、复制、打组，只能挪和改大小，面板里不选模型。
7. **派发线**来自快照里 `kind: "dispatch"` 的连线：虚线、另一种颜色、没有连接点、点不中、删不掉。
8. **自动排列**：负责人在最左，下级在右边一列，每棵子树占自己的一段高度；机器人做出来的节点（`createdBy` 是它、或者从它连出来）排在它右边，从这些节点生成出来的跟着走。“整理”只排机器人和它们做出来的节点，把位置存回去，可以撤销。
9. **文本节点**的面板是“要写什么”和选一个机器人，发出去由机器人写，回复填进这个文本节点（`CanvasTaskRequest.targetNodeId`）；机器人在写的时候节点上显示“正在写”（快照里的 `writingInto`）；双击正文仍然可以直接改。
10. **生成**：程序先存好节点的提示词，再请服务器生成这个节点（`startGeneration(projectId, nodeId)`），服务器从节点存着的提示词、设置和连进来的文件开始；结果都在右边新建并连上，排在之前生成的下面。生成中，程序在将要出结果的地方画一个虚线的“生成中”节点。生成中可以取消，失败显示原因并可以重试，被拒绝时显示服务器的原因。
11. **设置的继承**用契约里的 `resolveSettings`、`modelOffers`、`settingProblems`：节点的 `settings` 只存它改过的项，其余跟项目设置走。面板里改过的项带“已改”的标记和“恢复默认”（删掉这个键）；项目设置改了，没改过的项跟着变。模型不提供的设置标出来。
12. **没有选 MCP 服务器**时生成按钮不能点，旁边说明要先在项目设置里选服务器，并给一个打开项目设置的按钮。
13. **`@` 引用**用 app 自己的 `MentionTextarea`：引用写成 `@图片 1` 这样的文字并高亮，不搬 infinite-canvas 的可编辑芯片输入框。
14. **不新增确认框。** infinite-canvas 的“清空画布”确认改成直接清空、可以撤销，并提示“已清空 · 撤销”。
15. **不搬的部分**：右侧助手面板、提示词库、“我的资产”、WebDAV、节点插件、本地代理、浏览器里调模型的图片工具（蒙版、放大、拆分、角度）、裁剪。
16. **快捷键**照搬：⌘Z / ⌘⇧Z / ⌘Y、⌘A、⌘G / ⌘⇧G、⌘C / ⌘V、Delete、Esc；在输入框里不生效。帮助在缩放条的“?”里，不占用 app 的全局“?”。

## 约束

- 新代码都在 `src/lib/project-canvas/` 和 `src/components/project-canvas/`，前两个阶段不碰 `ProjectView.tsx`（`sidebar` 轨道的，第三阶段按任务接进画布）和章程列出的其他热点文件，`server/index.ts` 加 0 行。
- 页面组件 `ProjectCanvas`（`src/components/project-canvas/ProjectCanvas.tsx`）的属性是 `{ projectId: string; selectedBotId?: string; backend: CanvasBackend; topBarSlot?: ReactNode }`；`topBarSlot` 是顶栏里“团队有变化”的位置，任务说明里没有，报告里列出。
- 每个新文件不超过 1,000 行（`file-size-ratchet`）。
- 新文字都在 `projectCanvas.` 前缀下，四个语言文件（英文、简体、繁体、巴西葡萄牙语）各加在一处，不动原有的键。
- `shared/project-canvas.ts` 和 `shared/project-generation.ts` 按负责人提交的原样单独提交一次。第二阶段的服务器改动只在 `shared/project-canvas.ts` 加了 `CanvasTaskRequest.targetNodeId` 和 `CanvasBotState.writingInto`。

## 文件

| 文件 | 内容 |
|---|---|
| `shared/project-canvas.ts`、`shared/project-generation.ts` | 两个负责人的契约，原样 |
| `src/lib/project-canvas/types.ts` | 契约里没有、只在程序里用的类型：机器人的样子、从文本节点发的任务、最近的来往 |
| `src/lib/project-canvas/backend.ts` | `CanvasBackend` 接口 |
| `src/lib/project-canvas/memory-backend.ts` | 内存里的实现：操作、修订号、事件、照服务器的规则模拟生成结果的位置和机器人回复 |
| `src/lib/project-canvas/ops.ts` | 把操作应用到文档、算反向操作 |
| `src/lib/project-canvas/history.ts` | 撤销和重做 |
| `src/lib/project-canvas/geometry.ts` | 节点范围、分组、连线规则、曲线、视口换算、聚焦（搬自 infinite-canvas） |
| `src/lib/project-canvas/selection.ts` | 框选、多选、相关高亮、复制粘贴 |
| `shared/project-canvas-references.ts` | 连进来的参考内容和它们的编号（`canvas-server` 的，画布、机器人的任务和生成共用） |
| `src/lib/project-canvas/settings.ts` | 面板里每一项是继承还是改过、恢复默认（在 `resolveSettings` 之上） |
| `src/lib/project-canvas/tree-layout.ts` | 机器人树的排列和“整理” |
| `src/lib/project-canvas/generation.ts` | 交给生成的参数、分镜“生成中”占位的位置 |
| `src/lib/project-canvas/controller.ts` | 画布的小 store（`useSyncExternalStore`） |
| `src/components/project-canvas/*.tsx` | 页面、视口、节点外壳、连线、各类节点和面板、工具栏、小地图、缩放条、节点列表、右键菜单、项目设置 |
| `src/testing/project-canvas-sample.ts`、`scripts/testing/project-canvas-preview.tsx` | 预览页和样例数据（负责人、三个成员、一个分镜和它的视频、一张上传的图片、一个文本节点） |
| `NOTICE`、`third_party/infinite-canvas/LICENSE` | 出处和许可 |
| `src/locales/{en,zh,zh-tw,pt-br}.json` | 新文字 |

## 顺序

1. 模型、`CanvasBackend` 和内存实现；视口、节点外壳、连线、选中和面板。
2. 内容节点和面板：文本、图片、视频、音频、文件、生成配置、组；参考栏、`@`、模型、图片和视频设置；上传和拖入文件。
3. MagicBot 加的：机器人节点、分镜节点、派发线、树形排列和“整理”、项目设置、顶栏里“团队有变化”的位置。
4. 其余编辑：框选和多选、全选、复制粘贴、打组和解散、撤销重做、底部工具栏、小地图、缩放条和重置、聚焦、左侧节点列表和搜索、右键菜单、快捷键帮助。

## 验证

- 单元测试：几何、操作和反向操作、撤销重做、选择、连线规则、设置继承、树形排列、生成结果的位置。
- DOM 测试（happy-dom）：节点外壳、各个面板。
- 预览页截图放在 `/tmp/omb-wt-canvas-client/`，用独立的预览，不碰正在用的 app 和数据；占用 UI fixture 时按章程加锁。

## 第二阶段：接真的服务器

合进 `wt/canvas-server` 的 `4909861ad` 之后，两个契约用负责人的版本。

1. **`src/lib/project-canvas/server-backend.ts`**：`createServerCanvasBackend(store)` 用 app 自己的 `api()` 发请求，用 `/api/events` 的帧（`listenLiveFrames`）听 `project-canvas` 事件，不另写 fetch。409 的冲突、过期和只读变成 `CanvasBackendError`；生成接口回的 `GenerationFailure` 变成 `Refused`。
2. **契约外的几样**用 app 的东西：机器人的样子从 store 的 `bots` 读；最近的来往读机器人项目对话（`mainThreadId`，任务就发到这里）的最近消息；打开对话用 `openBot` / `openThread`；停止对它每个在忙的对话发 store 的 `interrupt`。
3. **`baseRevision`**：取画布当时的修订号，但不早于自己上一批的修订号，免得和自己的上一批冲突。冲突时这一批不生效，显示服务器的原因，再读一次快照。
4. **重读**：每个事件、以及实时流重连后漏掉事件时，都先读快照、再读机器人的样子。
5. **样子跟着 store**：`src/components/project-canvas/ServerProjectCanvas.tsx` 是项目页要放的组件。它旁边有个不画东西的小组件读 store，store 里机器人的样子和交给画布的不一样时（app 刚读完数据、改了头像、新机器人进来）让画布重读；画布本身不跟着 store 的每次变化重画。
6. **生成**照 `canvas-server` 合进 `main` 的样子做：开始走画布的 `POST .../canvas/generate { nodeId }`，取消走生成的 `POST .../generation/jobs/:jobId/cancel`，生成接口的拒绝原样显示。机器人超过每天的上限时，它的节点显示服务器那张确认卡片的原因（用 app 的 `approvalDetailText`，人的语言），在对话里回答：store 的 `answerCard` 要对话已经读进来，否则会把回答当成一条普通消息发出去，所以画布不直接回答卡片。
7. **端到端**：`scripts/testing/project-canvas-server-preview.tsx` 把 `ServerProjectCanvas` 放在 app 的 `StoreProvider` 里，经预览的代理接真的服务器（`launchRestartableServer`，脚本化的假引擎，生成接 `startFakeGenerationMcp`）。`scripts/testing/project-canvas-ui.e2e.test.ts` 用 agent-browser 走：快照画出项目的机器人（颜色来自 store）、改动刷新后还在、上传进 `素材`、带参考的任务到达机器人、外面的修改让打开的画布更新、打开对话和停止走 app 的导航和 Stop、图片节点生成一张图、停止一个生成、在文本节点里请机器人写（先显示“正在写”，回复再写进节点）、删掉机器人的分镜再撤销（回来还是机器人的，机器人还能改它）。
8. **端到端找出的三处界面问题**（真鼠标才会出，happy-dom 里看不到）：在节点上一按就抓住指针，Chrome 把 click 和 dblclick 发给抓指针的元素，双击写字、双击改名、双击看大图都打开了“加节点”菜单——改成拖动起来才抓；平移工具下按画布空白处 `preventDefault`，焦点不走，正在写的文字不保存——只对中键（它会开浏览器的自动滚动）这样做；平移或拖动时面板被卸掉，回来时展开的对话等状态没了——改成只藏起来。
9. **服务器的两处改动**在 `canvas-server` 合进 `main` 后加进了它的模块，带测试：
   - **撤销时加回删掉的节点**：文档存储在画布文件里记下 `CANVAS_HISTORY` 范围内删掉的内容节点是谁做的；人加回同类型的同一个 id 时，节点回到它的制作者手里，机器人还能改、删、生成它，也还在它的那一列。机器人加节点永远是它自己的。
   - **`targetNodeId`**：`CanvasTaskRequest.targetNodeId` 必须是这块画布上的文本节点。服务器跟着这条任务的消息（排队的等它送进对话，用 `queueId` 认出来），等回答这条消息的那一回合结束：成功就把最后的回复（照 `output` 去掉密钥，截到 `CANVAS_CONTENT_MAX_CHARS`）写进节点，发 `document` 事件，制作者不变；回合失败、被停、节点没了或项目归档时不写。快照的 `CanvasBotState.writingInto` 列出它在写的节点（对话在忙或在排队时），刷新后画布还显示“正在写”。插进正在跑的回合的任务、和别的排队消息合成一回合的任务、服务器在回复前重启的任务，都不写。
10. **还要服务器做的**（报告里列出，没有改契约）：
    - **参考的名字**：画布给参考起名“文本 1”“图片 1”（按种类和连进来的顺序，组会展开成里面的节点），人在消息里用 `@文本 1` 指它；服务器的 `references.ts` 写的是 `Text "<标题或 id>"`，没标题的节点给机器人看到的是一串 id，连进来的组整个被跳过。两边应该用同一套名字，最好把 `connectedReferences` 挪进 `shared/`，两边都用它。
    - **生成配置节点**：契约给 `config` 节点 `prompt`、`settings` 和 `generationMode`，但服务器只生成分镜、图片和视频节点，画布上的“生成配置”节点现在点生成会被拒。
    - **`canvas-server` 下一次合进来的**：节点的错误和拒绝带上目录键（`5cb525b19`），合进来后画布用人的语言显示；派发线跟着团队的流程走（`6c5ac5ddc`），画布照快照画派发线、收到事件就重读，应该不用改。
11. **接进项目页**等侧栏那一轨合进 `main`：在 `StoreProvider` 里的项目页放 `<ServerProjectCanvas projectId={project.id} selectedBotId={…} topBarSlot={…团队有变化的提示…} />`，不用再写别的。

## 第三阶段：接进项目页

合进侧栏（`538d05793`）、`canvas-server` 的第二次（`58d8d2cff`）和 `main-fixes`（`13e88638d`）之后。

1. **项目页**（`ProjectView`）里面换成 `<ServerProjectCanvas projectId selectedBotId topBarSlot />`。属性、读列表时的转圈、项目没了（归档或删除）就打开主机器人，都留着。原来页面上有、画布画不出的，放进画布的顶栏（`topBarSlot`）：
   - 项目文件夹的路径，文件夹在的时候显示；
   - “团队有变化”，点开 `TeamChangesDialog`，远程客户端不显示；
   - 项目自己的群聊：有群聊时才出现的一个按钮，点开是 `SidebarPopoverMenu` 的菜单，未读的带强调色的点，选一个就打开它。
2. **从侧栏打开**：项目行打开画布；搜索时项目还是一行，行上写着搜到的机器人，点它打开画布并选中搜到的机器人的节点（几个都搜到时先选负责人）；打开着的项目在别处或在侧栏菜单里被归档，就回到主机器人。没有删除项目的接口，归档走的是同一条路。
3. **合进 `canvas-server` 的第二次之后**：
   - 参考的编号用 `shared/project-canvas-references.ts`，画布自己那份 `references.ts` 和 `projectCanvas.reference.label` 删掉。名字是 `{种类} {序号}`，种类的词是 `server.projectCanvas.reference.*`，和服务器写给机器人、写进生成提示词的一样。
   - 任务和生成带上页面的语言（`CanvasTaskRequest.language`、`CanvasGenerateRequest.language`，取 `activeLocale()`），服务器用它给参考起名、写生成提示词开头的编号行。`startGeneration` 改为接 `CanvasGenerateRequest`。
   - 节点的错误按 `errorKey` 和 `errorParams` 用人的语言显示，没有键、键不是 `serverError.*`、或参数不全时显示 `errorDetails`。拒绝和请求失败（`body` 里带键）也一样，都走 `serverErrorText`（画布里是 `canvasErrorText`）。
   - 生成配置节点：画布这边本来就能点生成，内存实现照服务器的规则放结果（在配置右边，从配置连出）。
4. **端到端找出的问题**：
   - 后进团队的机器人，默认位置可能正好是一个已经摆过的机器人的位置（树的顺序变了，摆过的没动），画在它下面。服务器的 `botFrames` 改成：没人摆过的机器人从默认位置往下挪，避开画布上的节点和排在它前面的机器人（`clearBelow`）。
   - 第二阶段“停止一个生成”那一步，图片提示词没有 `[task]`，假的 MCP 300 毫秒就答完，那一步要在这 300 毫秒里点到“停止”才过。改成 `[task][hold]`，生成一直等到被停。
5. **端到端加的步骤**：
   - 页面换成中文，一张图连进一个生成配置节点：面板的参考写着“图片 1”，生成的图在配置右边、从配置连出；MCP 收到的提示词以中文的编号行开头，参考图就是那张图。再让它失败，节点上是“gen 没能生成：没有灵感”。
   - 发给机器人的任务里，参考写成 `Text 1`、`Image 1 "board.png"`。
   - 项目页的几步之外，新进团队的机器人不压着任何节点。

## 第四轮：@ 列出的就是一起送去的

合进 `canvas-server` 的第三次（`8c0ce9c1a`）之后。

1. **生成的节点只列会送去的**：`generationKindOf` 挪进 `shared/project-canvas.ts`，两边用同一个。有生成种类的节点，`mentionReferences` 只列图片、音频和文本；视频不会送去，不列。
2. **面板上方的参考条**就是面板的那份列表，编号和 @ 一样，有图的图片节点自己是“图片 1”。只有直接连进这个节点的参考能在这里去掉，节点自己的图不能。分镜的条只放图片和音频。机器人和文本节点的面板，条和输入框用同一份列表。
3. **空的图片、视频节点生成时**第一张放进节点本身，不画旁边的占位（`takesResultInPlace`）；内存实现也这样放，后面的照旧放在右边、从它连出。
4. **适合图片的大小有下限**：`fitNodeSize` 不小于节点能拖到的最小尺寸，除非最大尺寸不允许。端到端找出来的：假 MCP 的图是 48×48，节点跟着变成 48×48，被两边 48 宽的连线把手整个盖住，一点就开始连线、打开“加节点”菜单，面板打不开，也就没法再生成一次。
5. **项目页顶栏的文件夹**用等宽字体（`font-mono`），照旧截断，`title` 里是完整路径。
6. **端到端加的步骤**（中文页面，截图 14 到 18）：
   - 空的图片节点“教堂”生成时，“生成中…”在它自己里面，旁边没有占位；图放进节点本身（220×220，不出新节点，文件在磁盘上）。
   - 连进图、导演的便签和一段视频后，@ 列的是“图片 1 教堂”“图片 2 board.png”“文本 1”，没有视频；条上“图片 1”不能去掉，另外两个能。
   - 再生成一次，占位和新图都在它右边、从它连出；MCP 收到的提示词以“参考图片编号：图片 1、图片 2。”开头，便签在“【文本 1】”下面，参考图先是它自己的图，再是 board.png。
   - 截图前用节点列表把它放到画面中间（100%）。重新打开页面前先适合视图、等这个视图存好：画布打开时回到存下的视图，只画看得见的节点。
