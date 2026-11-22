# 改名收尾和左侧调整：实现计划

日期：2026-11-22 · 依据：`docs/superpowers/specs/2026-11-22-rename-and-sidebar-polish-design.md` · 分支：`wt/polish`

## 每件事和做法

1. **改名**
   - 写一个一次性的替换脚本（不提交）：对 git 跟踪的文本文件，先把"不改"的写法换成占位符，再把 `OpenMausBot` 换成 `MagicBot`，最后把占位符换回去。
   - 整个文件跳过：`third_party/`、`src/locales/source-hashes.json`、`shared/package-fixtures/`、`pnpm-lock.yaml`、`LICENSE`、`NOTICE`、`enterprise/LICENSE`、`*.test.*` 和 `*.node-test.*`、`docs/superpowers/` 里今天这两份文档。
   - 行内保护：`milind-soni/OpenMausBot` 和 `Prudctual/OpenMausBot` 开头的整个地址、`X-OpenMausBot-`、`OpenMausBot-wt`、`OpenMausBot-lab`、`Workspace/OpenMausBot`、`(?:OpenMausBot|MagicBot)`、`an OpenMausBot build`、`an OpenMausBot server`、`Application Support/OpenMausBot`、`AppData/Roaming/OpenMausBot`、`.config/OpenMausBot`、`pair.thisOpenMausBot`、`modified: OpenMausBot`、`Changed for OpenMausBot`。
   - `liu954326053/OpenMausBot` → `liu954326053/MagicBot`；`electron-builder.yml` 的 `repo: OpenMausBot` → `repo: MagicBot`。
   - 逐类看 diff，再看剩下的每一处。测试文件里因为源文件改了而失败的，单独改。

2. **收件箱到顶部一行**
   - 先改测试：`Sidebar.header.test.ts` 加"高级模式的顶部一行里，收件箱在空白之前，列表里没有第二个"；`Sidebar.projects.test.ts` 把高级模式的顺序改成收件箱在主机器人之前；`InboxEverywhere.dom.test.ts` 加顶部样式的点击、数字和绿点。
   - `SidebarInboxRow` 加 `top` 和 `style`：顶部样式是 28px 高的按钮，图标不带底色，文字在 `@max-[176px]/sidebar-top` 时隐藏。
   - `Sidebar.tsx`：`advanced && density !== "icons" && !phone` 时把它放进 `data-sidebar-top-slot`、空白之前，列表里不再画。

3. **新建项目按钮**
   - 先改 `SidebarTeamProjects.dom.test.ts`：按钮是模块的第一个子元素，带 `ui-button-primary`；没有项目时模块里只有它。
   - `SidebarTeamProjects.tsx` 宽侧栏分支：按钮移到最前，换成 `.ui-button .ui-button-primary w-full`。

4. **"项目列表"和缩进**
   - 先改同一个测试文件：有项目时有 `data-sidebar-projects-label`，没有项目和搜索无结果时没有；项目行在带 `ps-3` 的容器里。
   - `en.json` 加 `teamProjects.list`: "Projects"，`zh.json` "项目列表"，`zh-tw.json` "專案列表"。其他语言回落到英文。

## 验证

`pnpm typecheck`、`pnpm lint`、`pnpm i18n:check`，涉及的 vitest 文件，文档和词汇测试。然后起隔离的假引擎环境和这个分支的界面，截中文浅色、深色图。不打包，不动正在运行的应用。

## 顺序

改名一个提交；界面三件事各一个提交；最后合并回 `main`。
