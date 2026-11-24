# 对话窗与素材详情对齐效果图（vis-panels）

目标：把 `src/components/production-board/panels/` 里的对话窗与素材详情，按 `docs/无限画布效果图/index-v5/panels.css` 重做外观；行为、数据与无障碍保持不变。

## 范围

- 自有：`panels/*`、`panels/testing/*`、`boardPanels.*` 文案
- 不动：`ProductionBoard.tsx`、`board/*`、`cards/*`、`src/styles.css`、`shared/*`、服务端
- 效果图目录、`/tmp/omb-v5-shots/` 只读

## 对话窗

1. 容器 420 宽、`max-h calc(100% - 72px)`、14px 圆角、`bg-panel`、加粗 hairline、淡入；贴卡片一侧 12px 菱形箭头，位置由落点算出（`data-side`），小屏 `is-sheet` 无箭头。
2. 头部：34px 方头像（工作态 `bg-warning text-app`）、15px/600 名字、12px 三级副标题、右侧状态；内边距与下边框照 `.bc-head`。
3. 对话区 264px 上限、12px 内边距；气泡 12px 圆角、贴角 4px，我方底色 `bubble-user`。
4. 输入区：52px 缩略参考块 + 悬停/触屏删除圆点、参考标签行、92px 文本域（`bg-app`、8px、hairline、聚焦二级灰）、34px「@ 参考」与琥珀发送胶囊（禁用 `control` + 三级灰）。
5. 选择器照 `.pk-*`：44×30 缩略图、13px、8px 圆角、hairline、悬停 `card`、sticky 头。
6. 保留：流式回复不整窗重画、滚动跟随、Esc/点外关闭、焦点归还、`aria-live`。

## 素材详情

1. 遮罩与弹窗：`ui-scrim`、`min(980px,100%)`、14px 圆角、220ms 上浮淡入、`prefers-reduced-motion` 不放大。
2. 头：12px 类型 + 版本胶囊 + 17px/600 标题省略 + 关闭。
3. 体：左媒体 1.3、右信息 1、左边框 hairline；人物 `data-kind=char` 媒体 0.85。
4. 左栏：图片 `figure`（8px、`bg-inset`）+ 说明行（12px 三级、右分辨率）；单据静态纸张卡（可选中文字，不可拖拽）；视频 16:9 + 24px take 胶囊（等宽、当前 `success` 边）。
5. 右栏：简介 14px/1.6、分节 12px 三级、dt 64px、提示词块 `bg-card`、使用处 108px 16:9 网格卡、空态 13px 三级。
6. `<=760px` 上下堆叠、遮罩内滚动；保留 Esc、焦点归还、滚动位置、`data-*`、定位。

## 测试

- DOM 先红后绿：宽度/箭头/sheet/头像工作态、发送禁用、参考删除、详情类型与版本、双栏比例、take 当前态、使用处数量、760 堆叠。
- `tsc -b`、lint、i18n、contrast、panels 目录 vitest。
- 真实 Chrome 截图 1440×900 与 760×520，双皮肤。

## 选择

- 琥珀、青绿、纸张在现有皮肤里没有对应 token：先用 `warning`、`success`、`card` 代替，并在汇报里请卡片线统一加 `--color-board-*`。
- 阴影用 `popover-surface` / `ui-modal` 的皮肤阴影：`styles.css` 的规则不在 layer 内，工具类覆盖不了，也不该为一次改动手写 rgba。
