# 项目画布的界面（canvas-client 轨道）

日期：2026-11-21 · 设计：`docs/superpowers/specs/2026-11-21-teams-flow-project-canvas-design.md` 第 5 节“项目画布”的界面部分 · 章程：`OpenMausBot-wt/CHARTER.md`

**目标：** 打开一个项目看到的画布：平移缩放、节点、连线、节点下方的面板、机器人节点、分镜节点、派发线、自动排列、项目设置，以及框选、复制粘贴、打组、撤销重做、小地图、节点列表这些编辑功能。数据只经过 `CanvasBackend`，这一轨道带一个内存里的实现和一个预览页。

**做法：** 照搬 infinite-canvas（MIT，`basketikun/infinite-canvas@9cd3deac`）的画布和节点逻辑：`web/src/pages/canvas/project.tsx`、`components/canvas/`、`lib/canvas/`。搬过来的文件开头保留它的版权和许可声明，`NOTICE` 和 `third_party/infinite-canvas/LICENSE` 写明出处。界面换成 MagicBot 自己的控件和颜色（`DESIGN.md`），文字都走 `t()`，不用 Ant Design、zustand、localforage、nanoid、motion。

## 这一块定下的细节

1. **数据只经过 `CanvasBackend`。** 画布从它读快照、发操作、订阅变化、上传文件、给机器人发任务、停止机器人、列模型、读写项目的生成设置、开始和取消生成。浏览器里不存任何东西。
2. **操作**沿用 infinite-canvas 的 `canvas_apply_ops` 的名字：`add_node`、`update_node`、`delete_node`、`connect_nodes`、`delete_connections`、`set_viewport`、`set_background`。`update_node` 的 `metadata` 按键合并，值为 `null` 的键删掉；`groupId: null` 去掉分组。
3. **本地先改，再交给后端。** 拖动和缩放节点时只改本地，松手时发一次操作。后端答复之前收到的新快照，会把还没确认的操作叠上去，画面不会跳回去。
4. **撤销和重做**按 infinite-canvas 的规则：最多 50 步，视口不算，撤销后清空选择。但记的是“操作和它的反向操作”，不是整份快照：文档在服务器上，机器人也会改，撤销只撤自己的改动。
5. **视口**改了 500 毫秒后保存（同 infinite-canvas），不进撤销。
6. **机器人节点**的编号是 `bot:<botId>`。快照里每个机器人都有名字、头衔、是否负责人、状态、正在做什么、最新输出、等你回复的卡片。没有存过位置的机器人按树排好显示，人或机器人挪过以后才存位置。机器人节点不能删除、复制、打组，面板里不选模型。
7. **派发线**来自快照里 `kind: "dispatch"` 的连线：虚线、另一种颜色、没有连接点、点不中、删不掉。
8. **自动排列**：负责人在最左，下级在右边一列，每棵子树占自己的一段高度；机器人做出来的节点（`createdBy` 是它、或者从它连出来）排在它右边。“整理”只排机器人和它们做出来的节点。
9. **文本节点**的面板是“要写什么”和选一个机器人，发出去由机器人写；双击正文仍然可以直接改。
10. **生成**：空节点在原地出结果；有内容的节点在右边 96 像素处新建节点并连上；数量大于 1 时每个结果一个节点，往下排。分镜每次都在右边新建视频节点，再生成时排在上一个视频下面。生成中可以取消，失败显示原因并可以重试。
11. **设置的继承**：节点的 `settings` 只存它改过的项，其余跟项目设置走。面板里改过的项带“已改”的标记和“恢复默认”；项目设置改了，没改过的项跟着变。
12. **没有选 MCP 服务器**时生成按钮不能点，旁边说明要先在项目设置里选服务器，并给一个打开项目设置的按钮。
13. **`@` 引用**用 app 自己的 `MentionTextarea`：引用写成 `@图片 1` 这样的文字并高亮，不搬 infinite-canvas 的可编辑芯片输入框。
14. **不新增确认框。** infinite-canvas 的“清空画布”确认改成直接清空、可以撤销，并提示“已清空 · 撤销”。
15. **不搬的部分**：右侧助手面板、提示词库、“我的资产”、WebDAV、节点插件、本地代理、浏览器里调模型的图片工具（蒙版、放大、拆分、角度）、裁剪。
16. **快捷键**照搬：⌘Z / ⌘⇧Z / ⌘Y、⌘A、⌘G / ⌘⇧G、⌘C / ⌘V、Delete、Esc；在输入框里不生效。帮助在缩放条的“?”里，不占用 app 的全局“?”。

## 约束

- 新代码都在 `src/lib/project-canvas/` 和 `src/components/project-canvas/`，不碰 `ProjectView.tsx`（`sidebar` 轨道的）和章程列出的其他热点文件，`server/index.ts` 加 0 行。
- 页面组件 `ProjectCanvasPage` 的属性是 `{ projectId: string; selectedBotId?: string; backend: CanvasBackend }`。
- 每个新文件不超过 1,000 行（`file-size-ratchet`）。
- 新文字都在 `projectCanvas.` 前缀下，四个语言文件（英文、简体、繁体、巴西葡萄牙语）各加在一处，不动原有的键。
- `shared/project-canvas.ts`（`canvas-server`）和 `shared/project-generation.ts`（`generation`）还没有提交，类型先按章程写在 `src/lib/project-canvas/types.ts`，名字和章程一致，集成时换成共享的类型。

## 文件

| 文件 | 内容 |
|---|---|
| `src/lib/project-canvas/types.ts` | 画布文档、快照、机器人状态、操作、生成设置、模型、任务的类型（章程的契约） |
| `src/lib/project-canvas/backend.ts` | `CanvasBackend` 接口 |
| `src/lib/project-canvas/memory-backend.ts` | 内存里的实现：操作、修订号、订阅、模拟生成和机器人回复 |
| `src/lib/project-canvas/ops.ts` | 把操作应用到文档、算反向操作 |
| `src/lib/project-canvas/history.ts` | 撤销和重做 |
| `src/lib/project-canvas/geometry.ts` | 节点范围、分组、连线规则、曲线、视口换算、聚焦（搬自 infinite-canvas） |
| `src/lib/project-canvas/nodes.ts` | 默认尺寸、新建节点、复制粘贴 |
| `src/lib/project-canvas/selection.ts` | 框选、多选、相关高亮 |
| `src/lib/project-canvas/references.ts` | 连进来的参考内容和它们的标签 |
| `src/lib/project-canvas/settings.ts` | 设置的继承、常见选项 |
| `src/lib/project-canvas/tree-layout.ts` | 机器人树的排列和“整理” |
| `src/lib/project-canvas/generation.ts` | 生成结果放在哪里 |
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
