# 无限画布按 index-v5 效果图原样迁移 设计

效果图在 `docs/无限画布效果图/index-v5/`（`index.html`、`app.js`、`render.js`、`panels.js`、`talk.js`、`data.js`、`icons.js`、`shell.css`、`nodes.css`、`panels.css`、`img/`）。效果图只读，不改。

## 1. 背景

程序现有的画布（`ProjectCanvas` → `ProductionBoard`）在 11-24 已经照这份效果图重写过一次（设计见 `2026-11-24-production-board-design.md`），但那是重新实现，并且做了四条取舍：卡片按类型固定尺寸、缩小后只画圆点标签、不做循环动效、卡片内没有数据的块不画。结果整体观感和效果图差得多。

这次把效果图画布区域的界面代码原样迁进来，替换现有的界面代码，同时保住现有画布的全部功能，并补齐效果图里有而程序没有的数据。

## 2. 已确认的决定

1. 原样照搬：效果图的 CSS、DOM 结构、引擎算法为准；不复用现有的界面代码。
2. 颜色跟随程序皮肤（13 套都要），不用效果图自带的深色配色。
3. 纸质单据（需求单、任务拆分、分集、分集摞、镜头）也取皮肤的颜色。监视器（分镜视频、成片、图片上的字幕条）固定用效果图的深色。
4. 对话窗和素材详情弹窗也按效果图代码重搬，接上真实功能。
5. 右侧面板保留在右侧、仍是三栏（团队 / 素材分类 / 分集）可收起，用效果图左侧团队栏的样式重写。
6. 技术路线：CSS 原样拷入；`render.js` 的模板改写成输出相同 DOM 的 React 组件；`app.js` 的引擎逐段移植成 TS。
7. 动效照效果图保留（含循环动效），在 `DESIGN.md` 写明例外。
8. 效果图有、程序没有数据的块也做出来，需要时改服务端。分镜草图除外：不出草图。
9. 备份放仓库内 `backups/canvas-before-mockup-port/` 并提交。
10. 直接在主工作目录（`main`）上做；提交只包含本次迁移的文件。不 push，不换包，除非另行要求。
11. 界面和服务端数据写在这一份设计和一份计划里，一起验收。

## 3. 范围

**删除并按效果图重写**

- `src/components/production-board/` 下的全部渲染代码（`ProductionBoard.tsx`、`board/`、`cards/`、`panels/` 里的组件）。
- `src/styles.css` 里的 `board-*` 样式和 `--color-board-*`、`--shadow-board*` 令牌；`scripts/check-skin-contrast.mjs` 里对这些令牌的检查改成检查新画布用到的配对（纸面上的字、色块上的字）。
- 引擎：`src/lib/production-board/layout.ts`、`edge-paths.ts`、`camera.ts`，以及 `src/components/production-board/board/camera.ts`。

**保留**

- 服务端、`shared/`（除第 11 节的增补）。
- `src/lib/project-canvas/`：控制器和后端接口。
- 数据模块（不含界面代码）：`src/lib/production-board/board.ts`、`edges.ts`、`stages.ts`、`types.ts`、`overlay.ts`；面板的数据模块 `board-index.ts`、`details-view.ts`、`panel-rows.ts`、`asset-words.ts`、`overlay-backend.ts`、`view-follow.ts`，移到 `src/lib/production-board/`。
- 画布外层：`ProjectCanvas.tsx` 的标题栏、设置按钮、保存失败提示，`ProjectSettingsDialog.tsx`。

**不迁移**

- 效果图顶栏（品牌、进度胶囊、“团队”“演示流程”“找负责人”按钮）和流程演示。
- 效果图左侧团队栏本体；它的样式用于右侧面板。
- 效果图的静态数据（`data.js`、`talk.js` 的对话内容、`img/`）。

## 4. 备份

第一步，单独一个提交。

- 目录 `backups/canvas-before-mockup-port/`，保持原路径结构：
  - `src/components/production-board/`、`src/components/project-canvas/`
  - `src/lib/production-board/`、`src/lib/project-canvas/`
  - `src/styles.css`、`src/locales/{en,zh,zh-tw,pt-br}.json`
  - `src/testing/production-board-sample.ts`
  - `scripts/board-visual-audit.ts`、`scripts/board-visual-compare.ts`、`scripts/testing/board-*`、`scripts/testing/project-canvas-preview.tsx`、`scripts/testing/project-canvas-ui.e2e.test.ts`
- `backups/canvas-before-mockup-port/README.md`：来源提交、文件清单、还原方法（把目录内容拷回原路径）。
- 不参与构建：仓库根目录的 `backups/` 不在 `tsconfig.json`、vitest 的 `include`、打包文件清单里。另外把 `backups/**` 加进 `.oxlintrc.json` 的 `ignorePatterns`，并在 `src/styles.css` 里用 `@source not` 排除，使 Tailwind 不扫描它。

## 5. 目录与文件对应

`src/components/production-board/` 的新内容：

| 新文件 | 来自效果图 |
|---|---|
| `styles/shell.css`、`styles/nodes.css`、`styles/panels.css` | 同名文件，按 6.1 的机械改动拷入 |
| `styles/skin.css` | 新增：变量到皮肤令牌的映射、监视器的深色值、阴影 |
| `styles/additions.css` | 新增：效果图没有的状态和控件 |
| `styles/index.css` | 按顺序引入以上五个文件 |
| `ProductionBoard.tsx` | `index.html` 的 `.stage` 结构 + `app.js` 的启动、事件 |
| `engine/camera.ts` | `app.js`「相机」 |
| `engine/layout.ts` | `app.js` `layout`、`bbox`、`worldRect`、阶段范围 |
| `engine/edges.ts` | `app.js` `assignPorts`、`port`、`drawEdge` |
| `engine/minimap.ts` | `app.js`「小地图」 |
| `engine/script-page.ts` | 把一集的剧本文字分成场景行、动作、角色名、台词（`sc-slug`、`sc-act`、`sc-who`、`sc-dlg`） |
| `nodes/*.tsx`（Bot、Brief、Tasks、Episode、EpisodeStack、Character、Scene、Shot、Result、Final、Other） | `render.js` 的 `tpl.*` |
| `chrome/StageBar.tsx`、`Caption.tsx`、`Toolbar.tsx`、`Minimap.tsx`、`Toast.tsx` | `index.html` + `app.js` |
| `panels/ChatWindow.tsx`、`DetailModal.tsx`、`SidePanel.tsx`、`EpisodeMenu.tsx` | `panels.js`、`shell.css` 的团队栏 |

图标用程序已有的 `lucide-react`，与效果图 `icons.js` 同名同形。

## 6. 样式

### 6.1 拷入时的机械改动

三个 CSS 文件的规则不改，只做这些改动：

1. 整个文件包进画布根节点的类 `.mj-board { … }`（CSS 嵌套），不影响程序其余界面。
2. `:root` 上的变量、`body` 的字号行高和颜色，改挂在 `.mj-board` 上；`html, body` 的尺寸规则删除。
3. 元素级重置（`*`、`h1…`、`ul`、`button`、`img`）放进 Tailwind 的 `base` 层，使它不盖掉嵌在画布里的程序组件（等人回答的卡片）。
4. 所有 `@keyframes` 名字加 `mj-` 前缀（`spin`、`pulse` 与 Tailwind 的同名动画冲突）。
5. 颜色变量的定义移到 `skin.css`；写死的颜色（如 `rgba(26, 30, 35, .94)`、`rgba(255, 255, 255, .1)`、连线的 `rgba(69, 191, 174, .62)`）改成由变量经 `color-mix` 得到。
6. 删除顶栏的规则（`.topbar`、`.brand*`、`.run`、`.top-actions`）和左侧团队栏的定位规则；`.btn`、`.pane-head`、`.sec-lbl`、`.rrow`、`.legend` 保留。
7. 字体：`--sans`、`--mono` 取皮肤的字体；不加载网络字体，删掉效果图里为网络字体加的 `word-spacing`。

### 6.2 变量映射（`skin.css`）

| 效果图变量 | 皮肤令牌 |
|---|---|
| `--bg` | `--color-app` |
| `--panel` | `--color-panel` |
| `--card` | `--color-card` |
| `--card-2` | `--color-control` |
| `--line` | `--color-edge` |
| `--line-2` | `--color-hairline` |
| `--text`、`--text-2`、`--text-3` | `--color-ink`、`--color-ink-secondary`、`--color-ink-tertiary` |
| `--amber`、`--amber-ink` | `--color-warning` |
| `--teal`、`--teal-ink` | `--color-success` |
| `--paper` | `--color-menu` |
| `--paper-2` | `--color-panel` |
| `--paper-line` | `--color-hairline` |
| `--ink`、`--ink-2`、`--ink-3` | `--color-ink`、`--color-ink-secondary`、`--color-ink-tertiary` |
| `--r`、`--r-sm` | 效果图原值 10px、6px |

不新增皮肤令牌，13 套皮肤和自定义主题都自动适配。

### 6.3 色块上的字

效果图用同一个 `--ink` 做“纸上的字”和“色块上的字”（如 `.bot-talk`、`.tag`、`.schip .fno`、`.elabel.t-dispatch`、`.btn-gen`）。跟随皮肤后这两个角色不同：`skin.css` 新增 `--on-fill`（取 `--color-app`；青绿色块上取 `--color-success-ink`），并覆盖所有“背景是 `--text`、`--amber`、`--teal`，字是 `--ink`”的规则，使它们的字用 `--on-fill`。背景是 `--ink`、字是 `--paper` 的规则（`.sh-no`、`.tk-who`、`.ep-no`）不需要改。

### 6.4 监视器

`.k-result`、`.k-final`、`.sn-cap`、`.code`、`.rs-tag`、`.rs-ver` 上重新声明效果图的深色变量值（`--text: #e9ebed`、`--text-2: #b6bdc4`、`--text-3: #8d969f`、`--line: #333a42`、`--line-2: #4d5660`、`--amber: #f2a53c`、`--teal: #45bfae`、`--bg: #13161a`、`--card: #22272d`、`--mon: #0d0f12`），所有皮肤下一样。“尚未生成”的空监视器（透明底）用皮肤的颜色。

### 6.5 阴影

效果图的阴影是为深色底调的。`skin.css` 定义 `--shadow-node`、`--shadow-node-drag`、`--shadow-float`：暗色皮肤用效果图原值，亮色皮肤用同形状、8%–22% 墨色的轻阴影；按皮肤的 `--code-color-scheme` 区分。

### 6.6 `additions.css`

效果图没有的状态和控件，用它已有的词汇画：失败态（`data-state='failed'`，用 `--color-danger`）、只读、空状态提示、其他类型节点、分集列表、右侧面板的三栏切换、版本切换胶囊、对话窗里的停止按钮。三个原样文件保持可与效果图逐行对照。

## 7. 动效

照效果图保留：节点和连线的入场渐显、状态灯呼吸、进行中连线的流光、引用线的三层流光、生成中的扫光、生成按钮的脉冲、选中时其余节点和连线变暗、镜头缓动（220ms–1400ms）、提示淡出。

`prefers-reduced-motion: reduce` 或程序的 `[data-reduced-motion="true"]` 时全部关闭，镜头直接到位（效果图的 `reduce` 分支）。

`DESIGN.md` 增加一节说明：制作看板照它的效果图画，圆角、字号、阴影和动效是效果图的，颜色是皮肤的。

## 8. 引擎

算法和常数照 `app.js`，下面只写与真实数据有关的推广和保留的现有行为。

### 8.1 相机

- `cam {x, y, z}`，只改 `.world` 的 transform；`ZMIN 0.07`、`ZMAX 2`、`FAR 0.32`。
- 滚轮和捏合以指针为中心（系数 0.0016，捏合 0.012）；双指捏合；`animateTo` 用效果图的缓动和几何缩放插值；`fitRect` 的上下留白 60 / 56。
- 网格 28px，随缩放分级放大；`--ew`、`--ls` 按效果图计算。
- 保留现有行为：每个项目记住镜头位置和展开的集；`focusBotId` 变化时定位到该 bot；卡片内可滚动的区域里滚轮滚动内容而不是缩放；浮层和工具条上的指针不触发平移。

### 8.2 卡片尺寸

- 宽度照效果图：bot 320（负责人 380）、需求单 330、任务拆分 330、分集 400、分集摞 400、角色 400、场景 340、镜头 470、分镜视频 320、成片 620、其他 320。
- 高度由内容撑开。每张挂载的卡片用 `ResizeObserver` 量高，高度变了就重排（效果图的 `relayout`）。没挂载过的卡片用该类型上一次量到的高度，没有就用效果图里该类型的高度作估计值。
- 人拖过的卡片保存位置（现有的 `update_node`），以后以它为准。

### 8.3 布局

列和间距照效果图：负责人 `x=0`；需求单和任务拆分 `x=500`，间隔 48；编剧 `x=960`；`XA=1640`、`XB=2260`、`XS=2960`、`XV=XS+590`、`XP=XV+560`、`XF=XP+470`；`G=28`、`RG=34`、`SPLIT=96`；分镜师之间 44。

- `XA` 列：分集卡和分集摞居中堆叠；角色设计师在上、场景设计师在下，分别对着角色卡和场景卡的中点。
- `XB` 列：展开各集的分镜师居中堆叠；角色卡在上、场景卡在下，离中间带 `SPLIT`。
- 镜头区（`XS`、`XV`、`XP`、`XF`）按集分块，自上而下：
  - 每块是该集细化的场景（在镜头行上方）和若干“镜头 + 分镜视频”行，行高取两者较高的加 `RG`。
  - 第一块以第一位分镜师的中点为中心；其后每块与上一块间隔 120。
  - 每集的后期和成片对着本集镜头块的中点；块高取镜头行、后期卡、成片卡三者的最大值。
  - 展开的集还没有镜头、后期和成片时不占块。
- 效果图的 3 集示例是这套规则的特例，结果一致。
- 生产流程之外的节点排在全部卡片下方，每行 8 个。
- 阶段范围（阶段条定位用）是该阶段卡片的外接框外扩 48。

### 8.4 连线

- 端口分配、贝塞尔控制点、箭头、起点圆点、标签位置照 `assignPorts`、`drawEdge`；引用线从素材右侧同一端口扇出，进镜头时角色走上方、场景走下方。
- 类名 `edge t-<类型> s-<状态>`；6 类（`dispatch`、`output`、`handoff`、`gen`、`derive`、`ref`）× 3 状态（`done`、`active`、`wait`）来自现有的 `edges.ts`。
- 引用线默认隐藏；工具栏开关打开后显示并流光；悬停或选中一张卡时高亮与它相关的引用线。

### 8.5 远景

缩放小于 32% 时加 `lod-far`：卡片照画，bot 卡内容淡到 25% 并盖上名牌（岗位名，每集的 bot 带集数），连线去掉箭头、圆点和标签。不再有圆点标签视图。

### 8.6 选中

- 点 bot：打开对话窗并选中它。点素材：选中并打开详情弹窗。点空白：取消选中并关对话窗。
- 选中时：`has-sel`，选中的 `is-sel`，与它相连的 `is-rel`，其余变暗；相连的连线和标签 `is-on`。
- 选中的就是对话窗或详情弹窗打开的那张卡；浮层关闭即取消选中。
- 区分点击和拖动的阈值 4px。

### 8.7 小地图

`<canvas>`，照 `setupMinimap`、`drawMinimap`、`miniJump`。颜色从画布根节点的变量读取（底 `--bg`，bot 按状态 `--amber`、`--teal`、`--text-3`，单据 `--line-2`，视口框 `--text`），皮肤变了重画。窄于 520 的画布默认隐藏，人点过以人的选择为准。

### 8.8 阶段条和说明

五个阶段的圆章和名字，状态来自现有的 `stages.ts`；效果图没有的失败态样式在 `additions.css`。点一个阶段：镜头移到该阶段并在阶段条下显示说明气泡（`.caption`）；人一操作画布就收起。五段说明是通用文案（见第 12 节）。画布当前所在的阶段标 `aria-current`。右侧面板展开时阶段条让开它；放不下时只留圆章和当前阶段的名字（现有行为）。

### 8.9 工具栏、提示、提示条

- 工具栏照效果图：缩小、百分比（点了回到 100%）、放大、分隔、全局、引用线开关、小地图开关。
- 提示一行，首次操作后淡出，9 秒后也淡出。
- 提示条（`.toast`）：操作失败的原因、引用线开关的反馈。

### 8.10 键盘

方向键平移 80；`+`、`=`、`-` 缩放；`0` 全局；`1`–`5` 到阶段；`Esc` 关对话窗并取消选中；节点上 `Enter`、空格等同点击。焦点在输入框、对话框、菜单里时不响应。

### 8.11 性能

保留两条现有做法：只挂载视口内（外扩 480px）的卡片和连线；没开工的集收进分集摞。60 集、300 个 bot 的项目按这两条仍然流畅。

## 9. 节点

DOM 结构和类名照 `render.js`。每种节点的数据：

| 节点 | 数据 |
|---|---|
| Bot（`k-bot`） | 头像框画岗位图标（负责人 megaphone、编剧 pen-line、角色 drama、场景 mountain、分镜 clapperboard、后期 scissors、其他 bot），不画 bot 自己的头像；名字、每集的集数章、岗位名；状态；原著块（负责人，见 11.1）；开工条件（分镜师，现有的 `gate`）；当前任务、进度条和两端文字（现有的 `progress`）；步骤日志（现有的 `steps`，带时间）；技能标签（见 11.2）；“对话”按钮；失败时“重试” |
| 需求单（`k-brief`） | `REQ`、标题、版本 `v<版本号>`；行；页脚“整理：负责人名 · 计划时间”和“已确认”印章（有计划时） |
| 任务拆分（`k-tasks`） | `TASKS`、完成数 / 总数；每行状态圆章、`T<n>`、任务名、“平级”标记、负责的 bot（点了定位到它）；页脚“拆分：负责人名 · 计划时间”和一句“平级的任务齐备后开始分镜” |
| 分集（`k-ep`） | 打孔；集数章、标题、版本；梗概；剧本页（`script-page.ts` 分行，超出渐隐）；页脚“镜头数 · 时长”和该集分镜师（点了定位）；失败时“重试” |
| 分集摞（`k-epmore`） | 起止集数、“其余 N 集”；前几集和最后一集的标题；点了打开分集列表 |
| 角色（`k-char`） | 定妆图（组里选用的，否则第一张）、编号、角色定位章、“定妆 v<第几张图>”；名字；年龄和身份；标签；行（造型、声线）；色板；出场镜头；没有图时“生成图片” |
| 场景（`k-scene`） | 气氛图、编号、细化标记和细化它的分镜师；名字、副标题；标签；机位数（见 11.3）；用于哪些镜头、版本；色板条；没有图时“生成图片” |
| 镜头（`k-shot`） | 镜号章、标题、集数和时间码；画框：有选用版本时是它的画面，否则效果图的“绘制中”占位换成“尚无画面”；景别、运镜、时长；画面描述；声音；引用的场景和角色（点了定位）；页脚状态和按钮（生成、查看结果、重新生成）；提示词在视频之后改过时标“已过期” |
| 分镜视频（`k-result`） | 监视器里是选用版本的 `<video>`；镜号、版本和版本数；播放按钮和进度条照效果图，播放真实视频；生成中、失败、尚未生成的覆盖层；页脚时间、名字、状态；版本切换胶囊和“选用” |
| 成片（`k-final`） | 标题行和状态；监视器：成片视频，没有时是第一个到位片段的画面，叠集名、集数和时长；时间线：刻度、画面轨（每个镜头一段，按状态）、配音 / 字幕 / 音乐轨（见 11.5）；页脚规格标签（分辨率、片段数）和“打开剪映草稿” |
| 其他 | `.node` 的卡片底，画文字、图片或视频，以及失败时的“重新生成” |

画面缩略图（镜头的画框、成片的片段）用该视频的首帧：`<video preload="metadata">`，地址带 `#t=0.1`，只在卡片挂载时加载。

## 10. 浮层

### 10.1 对话窗（`.bchat`）

结构、尺寸、贴着卡片的箭头、窄画布时变成底部抽屉，照 `panels.js` 的 `place`、`measure`。

- 头部：岗位图标、名字、岗位和集数、状态、关闭。
- 对话区：真实往来（`readExchange`），回复流式更新时不整窗重画并跟随滚动；系统行；等人回答的卡片照现有的显示。
- 快捷按钮：每个岗位两条通用问句（见第 12 节），点了作为真实任务发出。
- 参考托盘和选择器：默认是连入它的素材；分镜师另带全剧的角色和场景；可删、可从选择器添加；点缩略图在画布上定位。
- 输入框和发送（`sendTask`）；工作中时显示停止（`stopBot`）；“在聊天里打开”（`openChat`）。
- 归档项目：只读，没有输入区。

### 10.2 素材详情（`.dm`）

模态弹窗，照 `renderModal`：类型和编号、标题、关闭；左侧媒体（图片、视频和版本、单据的静态纸张卡）；右侧简介、属性、提示词或画面描述、被哪些镜头复用、上游和下游；页脚“在画布中定位”和“让某人调整”（打开负责它的 bot 的对话窗并带上该素材）。数据来自现有的 `details-view.ts`。

### 10.3 右侧面板

悬浮在右上，可收起；三栏：

- 团队：按协作顺序的 bot 行（`.rrow`），点了定位并打开对话窗；底部是连线图例（`.legend`）。
- 素材分类：分集、角色、场景、镜头、分镜视频、成片，每行数量，点了镜头移到这一类。
- 分集：每集一行，集数、标题、状态、已选用数 / 镜头数，点了展开并定位到该集。

### 10.4 分集列表

点分集摞弹出，列出收起的和人手动展开的集；选一集展开或收回。用选择器的列表样式（`.pk-*`）。

## 11. 数据补齐（服务端）

### 11.1 原著信息（负责人卡的原著块）

- `shared/production.ts`：新增 `ProductionSource { title: string; author?: string; tags?: string[]; quote?: string; from?: string; cover?: string }`；`ProductionPlanInput.source?`、`ProductionPlanWire.source?`。`cover` 是项目文件夹内一张图片的相对路径。
- `production_plan` 工具的输入加可选的 `source`，说明里写清每一项：书名、作者、题材与章数字数这类标签（最多 4 个）、一句引文（最多 200 字）、来源（如“你上传的 TXT”）、封面图路径。
- `server/production/engine.ts` 的 `planInput` 校验并存进计划；`cover` 按项目文件路径的现有规则校验，不存在就拒绝并说明。
- `server/chief-of-staff.ts` 的负责人提示词：计划时一并交原著信息。
- 界面：有 `source` 才画原著块。有封面图画图；没有就画效果图那种带竖排书名的色块封面。“改编为 N 集”取计划的集数。

### 11.2 技能标签

程序没有逐个 bot 的技能数据。按岗位各三个固定标签，写在语言文件里，照效果图：负责人（需求澄清、找书选题、任务拆分）、编剧（小说改编、分集剧本、人物小传）、角色（角色定妆、色板、一致性锚点）、场景（气氛图、光影设定、机位建议）、分镜（镜头设计、场景细化、图生视频）、后期（剪辑合成、配音配乐、字幕调色）。没有岗位的 bot 不画标签。只改客户端。

### 11.3 机位数

- `CanvasCardFacts.cameras?: number`（1–99 的整数）。
- `server/project-canvas/ops.ts` 的卡片校验、`canvas_apply_ops` 工具的卡片说明加这一项。
- 场景设计师的任务文案（`server.production.task.scene`）要求每个场景写机位数。
- 界面：有才画“N 机位”。

### 11.4 版本号和印章

- `CanvasNodeMetadata.version?: number`，由服务端设置，操作里不能写（同 `role`）。
- `brief`、`plan`、`episode`、`character`、`scene` 这几种文字节点加入画布时是 1；之后每次操作改了它的 `content`、`card` 或 `prompt` 加 1。负责人再次计划时需求单加 1。
- 旧数据没有版本号的按 1 显示。
- 界面：需求单、分集、场景显示 `v<版本号>`；角色的“定妆 v<n>”是组里图片的张数；分镜视频的“V<n> · 共 n 版”是现有的版本数；“已确认”印章在有计划时显示。

### 11.5 成片的配音、字幕、音乐轨

程序写的剪映草稿只有画面轨；配音、字幕、音乐是人或后期在剪映里加的。

- `shared/project-draft.ts`：`ProjectDraftWire.tracks?: Array<{ kind: "voice" | "subtitle" | "music"; segments: Array<{ startMs: number; durationMs: number }> }>`。
- 草稿状态是 `written` 或 `kept` 时，从程序写的那份草稿的 `draft_info.json` 读轨道：文字轨是字幕；音频轨里素材类型是配音或录音的是配音，其余是音乐。每条轨最多 200 段；读不出来或版本不认识就不带 `tracks`，不报错。
- 界面：画面轨总在；有哪条轨画哪条。

### 11.6 夹具

内存后端（`src/lib/project-canvas/memory-backend.ts`）和样例剧（`src/testing/production-board-sample.ts`）带上 11.1–11.5 的全部字段，预览页里每一块都能看到。

## 12. 文案和语言

效果图写死的中文全部改成语言键，四种语言（en 为源，zh、zh-tw、pt-br）。文案相同的沿用现有的 `productionBoard.*`、`boardCards.*`、`boardPanels.*` 键；不再用到的键删除。新增：

- 五段阶段说明（通用，不含剧名和人名）。
- 每个岗位三个技能标签、两条快捷问句。
- 连线图例、分集列表、提示条的文案。

中文用词沿用现有的：负责人、编剧、角色设计、场景设计、分镜、后期；选用；剪映；成片；分集；派发。

## 13. 可达性

照效果图：画布 `role="application"` 和操作说明；节点可聚焦，`aria-label` 是类型和标题；阶段条 `nav`、工具栏 `role="toolbar"`、按钮的 `aria-pressed`；对话窗 `role="dialog"`、对话区 `role="log"`；详情弹窗 `aria-modal`，打开时焦点进入，关闭时归还。焦点环用皮肤的 `--color-focus`。

## 14. 边界状态

- 还没有计划：只有负责人卡和一句提示。
- 归档项目：只读，生成、选用、重试、发送都不显示，仍可看和拖动镜头。
- 项目文件夹丢失：标题栏照现在的提示，图片和视频位置显示占位。
- 生成被拒绝或失败：卡上显示原因（现有的错误文案），提示条给出操作失败的原因。
- 旧项目（没有制作流程的）：`script` 节点当第 1 集，没有集数的镜头当第 1 集（现有的 `board.ts`）。
- 对话窗打开的 bot 或详情打开的素材被删：关闭浮层。

## 15. 测试

- 引擎单测：`layout`（效果图 3 集示例的坐标、多集分块、拖过的卡片、流程外节点）、`edges`（端口分配、路径、箭头、标签点、引用线的进出）、`camera`（缩放夹取、以点为中心缩放、`fitRect` 留白）、`minimap`（比例、点选换算）、`script-page`（分行）。
- 节点的 DOM 测试：每种节点的类名、结构和各状态；有数据才画的块（原著、技能、机位、印章、音轨）两种情况都测。
- 浮层的 DOM 测试：对话窗（往来、发送、停止、参考增删、只读、抽屉形态）、详情弹窗（各类型、让某人调整）、右侧面板三栏、分集列表。
- 画布的 DOM 测试：选中和变暗、远景类名、引用线开关、键盘、拖动后调用 `move`、点击不被拖动吞掉、视口外不挂载。
- 服务端单测：`production_plan` 的 `source` 校验和存取、卡片的 `cameras`、版本号的增加规则、草稿轨道的读取（含读不出来的情况）。
- 旧界面的测试随旧代码进备份并从 `src/` 删除；保留模块的测试不动。`ProjectCanvas.dom.test.ts`、`ProjectView.board.dom.test.ts`、`scripts/testing/project-canvas-ui.e2e.test.ts`、预览页、`scripts/testing/board-visual-map.json` 和对照脚本改用新的选择器（与效果图同名的类）。

## 16. 验证

按 `docs/verification/README.md`，只在隔离夹具里验证，不碰正在用的程序和数据。

- 功能：打开项目；拖动卡片后重新打开位置仍在；生成图片和视频；切换并选用版本；失败后重试；展开和收回一集；对话窗发送、流式回复、停止、增删参考；详情里“让某人调整”；打开剪映草稿；归档项目只读。
- 数据：用假引擎让负责人带 `source` 计划、场景设计师写机位数、改写一张卡片看版本号加 1；用草稿夹具看音轨。
- 视觉：`pnpm vis:audit`，与效果图对照，尺寸、圆角、间距、字号的差应接近 0，颜色按设计不同。Midnight 和 Daylight 两套皮肤，1440×900 和 760×520，截图：打开时、阶段 4、全局、对话窗、详情弹窗。
- 检查：`tsc -b`、服务端的 `tsc -p tsconfig.server.json`、`pnpm lint`、`pnpm i18n:check`、`pnpm check:contrast`、改动目录的 vitest、文件大小限制的测试。

## 17. 不做

- 分镜草图。
- 流程演示、效果图顶栏和左侧团队栏。
- bot 的英文岗位名。
- 生成进度的百分比和排队名次（服务端没有这两项数据；生成中只显示“生成中”）。
- 画布上的编辑工具（新建节点、连线、分组、上传、撤销重做、删节点），与上一版相同。
