# vis-chrome：看板外观对齐效果图

对齐 `docs/无限画布效果图/index-v5/` 的连线、阶段条、工具栏、小地图与浮动提示。不碰 `cards/`、`styles.css`、`card-view.tsx`。

## 改动

1. **BoardEdges**：按状态着色（done 青绿 / active 琥珀虚线+流动 / wait 灰虚线 / ref 细虚线 / derive 细差）；标签 dispatch 实心青绿胶囊、wait 虚线边、其余面板色；远景藏箭头与标签。流动动画用 SVG `<animate>`，`prefers-reduced-motion` 时关掉。
2. **BoardStageBar**：数字圆章 1–5 + 阶段名；状态色圆章；当前阶段整颗 chip `bg-control`；阶段间 10×1 细线。紧凑形态只留当前名 + 五个圆章，量宽逻辑不动。
3. **BoardToolbar**：顺序缩小 | 百分比 | 放大 | 分隔 | 全局（图标+字）| 引用线（图标+字，窄屏也留字）| 小地图。表面 `bg-panel/94`、12 圆角、32 高按钮、按压琥珀色。
4. **BoardMinimap**：右下；宽 220（面板占宽时 end 让位或收成 150）；kind 配色接近效果图；视口琥珀边；`<720` 默认隐藏，人点过以人的选择为准。
5. **ProductionBoard**：网格 28px、ink ~10%；工具栏左下 + 上方 hint（首次操作后淡出）；小地图独立右下。
6. **i18n**：en / zh / zh-tw / pt-br 补 hint、工具栏短文案；不改 source-hashes。

## 验证

先红后绿 DOM 测试；`tsc -b`、lint、i18n:check、check:contrast；生产看板 DOM 测试；Chrome 截图到 `/tmp/omb-vis-chrome/`（UI 锁）。
