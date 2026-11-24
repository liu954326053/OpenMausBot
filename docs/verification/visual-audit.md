# 效果图 vs 实现：制作看板的视觉对照

`pnpm vis:audit` 把老板的静态效果图（`docs/无限画布效果图/index-v5/`）和 MagicBot 的制作看板放在同一个视口下，
逐元素量同一组属性，并给出差距分、报告和左右拼图。改完看板重跑，差距分应当下降。

```sh
pnpm vis:audit
pnpm vis:audit --viewport 760x520
pnpm vis:audit --only cards,chrome,panels
pnpm vis:audit --app-url http://127.0.0.1:8790/__production-board.html
```

首版覆盖 15 个元素：阶段条、画布工具栏、小地图、10 种卡片（智能体、需求单、任务拆分、分集剧本、分集摞、镜头、
角色、场景、分镜视频、成片）、对话窗和详情弹窗。

## 它怎么跑

- **效果图**必须经 http 提供（`file://` 被拒），默认挂在 `127.0.0.1:8781`。端口被占用会直接报出来，换
  `--mockup-port`。
- **实现**从 8790 起找一个空闲端口，起一个 Vite 预览，页面是仓库自己的
  [`project-canvas-preview.tsx`](../../scripts/testing/project-canvas-preview.tsx)：真实看板组件加
  `productionBoardSample` 的样例剧，和 `board-cards-shots.ts`、`scripts/testing/project-canvas-ui.e2e.test.ts` 用的是同一套。
  同时用 `control-omb launch` 背后的 `launchVerificationServer` 起一个隔离夹具：临时数据目录和 HOME、假引擎、
  自选端口，`/api` 代理到它，不读也不写 `~/.magicbot` 或 `~/Library/Application Support/MagicBot`。
  要审计已经打开在隔离夹具里的真实项目看板，用 `--app-url`，工具就不再自己起预览和夹具。
- 截图与求值用 [`headless-chrome.ts`](../../scripts/testing/headless-chrome.ts)，和 `verify-*.ts` 同一套无头
  Chrome；整轮占 `/tmp/omb-ui-fixture.lock`（第一行 `vis-audit <pid>`），跑完释放。
- 两边都按 `prefers-reduced-motion: reduce` 渲染，避免截图落在入场动画中间；效果图的 Google Fonts 请求被拦掉。

## 量什么

每个元素取 `getBoundingClientRect` 和 `getComputedStyle`：

| 项 | 说明 |
|---|---|
| 宽高 | 布局尺寸（屏幕尺寸 ÷ 看板缩放），不受看板当前缩放影响 |
| 圆角 | 四角分别比 |
| 背景、边框色 | 在页面里经 canvas 归一成 RGBA 再比 |
| 边框 | 上边的宽度、样式（实线/虚线/无）和颜色 |
| 阴影 | 第一层的偏移、模糊、扩散；有没有阴影单独算 |
| 字号、行高 | 根元素的计算值 |
| 内边距 | 四边分别比 |

报告里的「屏幕」一行是 `getBoundingClientRect` × 当前看板缩放，只用来对照截图，不参与评分。

## 差距分

每项归一成 0–1，按权重加权后乘 100：

| 项 | 权重 |
|---|---|
| 尺寸（宽 + 高） | 0.20 |
| 边框 | 0.17 |
| 背景 | 0.16 |
| 内边距 | 0.15 |
| 字号与行高 | 0.14 |
| 阴影 | 0.10 |
| 圆角 | 0.08 |

两边都没有这个元素记 100 分，排在最前。报告按差距分从大到小排；`parity.json` 里每个属性都有
效果图值、实现值和差异。

## 产出

默认写到 `/tmp/omb-vis-audit/`：

```
mockup/            效果图整板（board-open.png 打开时、board-stage1.png 阶段 1、board.png 全局）与每个元素的原图
app/               实现侧同样的图
side-by-side/      左右等高拼图（.png 给老板看，.html 可单独打开）
parity.json        元素 → 效果图值 / 实现值 / 差异 / 分数
report.md          按差距排序的中文报告，每个元素带截图路径
```

## 改对照表

`scripts/testing/board-visual-map.json`，一行一个元素：

```json
{
  "id": "k-bot",
  "name": "智能体卡片",
  "section": "cards",
  "mockup": ".k-bot",
  "mockupNode": "lead",
  "app": "[data-board-card=\"bot\"]",
  "appStage": "brief"
}
```

- `section`：`cards`、`chrome`、`panels`，配合 `--only`。
- `mockupNode`：效果图里代表这个元素的节点 id；工具会把它移到画面中央再量。
- `appStage`：先按数字键 1–5 聚焦看板的这个阶段，再找元素。
- `appReveal`：看板里把元素显示出来的开关；找不到元素时先点它一次再量（小地图在窄于 720 的看板上默认折叠，
  用工具条上的 `[data-board-chrome-button="minimap"]` 打开）。
- `mockupOpen` / `appClick`：量对话窗、详情弹窗前要先打开它们。

改完选择器重跑即可；选择器写错时工具会报出是哪个元素、哪个选择器。新增一种卡片就在表里加一行，
`id` 用小写字母和连字符。

## 这一版没量到的

- 卡里每一行文字的字号、层级和换行：只量根元素。
- 颜色是否来自主题变量：只比计算后的颜色。设计说明颜色用程序现有皮肤、不照搬效果图配色，所以纯色差要结合这一条读；形态、尺寸、圆角、间距、字号仍照效果图。
- hover、focus、生成中、失败重试等交互态：只比静止态。
- 图片、视频内容：只看它们占的框。
- 阴影只取第一层。
- 边框只量上边（四条边不同的卡片按上边算）。

## 失败时

- `端口 8781 被占用`：关掉占用它的程序，或 `--mockup-port 8782`。
- `端口 8790–8799 都被占用`：`--app-port` 换一段。
- `隔离夹具没起来`：先单独跑
  `node --experimental-strip-types scripts/control-omb.ts launch` 看它打印的日志路径。
- `效果图里找不到 …`：对照表的选择器或代表节点 id 写错了。
- 看板预览没起来：通常是那个端口的 Vite 或预览页有编译错误，看终端里 Vite 的第一段报错。
