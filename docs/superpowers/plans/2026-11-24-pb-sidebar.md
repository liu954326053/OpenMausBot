# 左侧的分集、项目群聊成员、项目设置的并发：实现计划（pb-sidebar 线）

日期：2026-11-24 · 设计：`docs/superpowers/specs/2026-11-24-production-board-design.md` 第 6 节

**目标：** 一个项目是一部剧，每集有自己的分镜机器人和后期机器人（`episodeBots`）。左侧在项目下面把全剧的机器人和分集分开，60 集时也好找、好读、不卡；项目群聊只列全剧的机器人；项目设置能改视频并发、图片并发和同时进行的集数。

**做法：** 服务器已经做完（`TeamProjectWire.episodeBots`、群聊不放分集机器人、`ProjectGenerationSettings.concurrency`），这一线只改应用。新代码放在自己的新文件里，现有文件只改接线。

## 文件

| 文件 | 负责 |
|---|---|
| `src/lib/team-projects.ts` | `splitEpisodeBots`：把项目的机器人分成全剧的和每一集的（按集数，每集先分镜后后期）；`team()` 排序用位置表，不再每次比较都 `indexOf` |
| `src/components/team-projects/SidebarProjectEpisodes.tsx`（新） | "分集"一行、每集一行、展开后那一集的机器人；状态点；选中落在看得见的那一行 |
| `src/components/team-projects/SidebarTeamProjects.tsx` | 项目下面：群聊、全剧的机器人、"分集" |
| `src/components/team-projects/SidebarProjectRow.tsx` | 机器人行可以再往里缩一级，职责可以由调用方给 |
| `src/components/project-view/ProjectChat.tsx` | 项目自己的群聊，成员只列全剧的机器人 |
| `src/lib/project-canvas/settings.ts` | 并发：服务器没给时用默认值；把人填的字读成 1–50 的整数 |
| `src/components/project-canvas/ProjectSettingsDialog.tsx` | "制作"一组三个数字框，校验，和其他设置一起保存 |
| 约定里列的失败测试 | 补上真实的 `episodeBots`、`concurrency` |
| `scripts/testing/sidebar-episodes-preview.tsx`、`sidebar-episodes-shots.ts`（新） | 60 集项目的左侧和设置窗口的截图 |
| `src/locales/*.json` | `sidebarEpisodes.*`、`projectSettings.*`，放在 `teamProjects.changes.review` 后面 |

## 这一块定下的细节

### 左侧

- 项目展开后从上到下：项目群聊；全剧的机器人（负责人、编剧、角色设计、场景设计和其他成员，和现在一样）；"分集"一行。项目还没有分集机器人时没有"分集"。
- "分集"默认收起。展开后每集一行（EP01、EP02……按集数），每集也默认收起；展开一集列出它的分镜和后期机器人，名字后面是职责（职责空时写"分镜""后期"），点了打开它的对话。
- 展开状态和项目行一样只在这次运行里记住（`project-episodes:<项目>`、`project-episode:<项目>:<集数>`）。
- 状态点（等你 > 未读 > 在干活，和项目行同一套）：一集收起时，那一集的行上有它的机器人的点；"分集"收起时，"分集"行上有所有分集机器人的点。展开后点在下面的行上。项目行照旧算全部。
- 选中：打开的对话是分集机器人时，选中落在看得见的最里面那一行（项目行、"分集"、那一集或机器人本身），和现在项目收起时选中项目行一样。从 ⌘K 打开分集机器人不自动展开。
- 搜索照旧只按项目名，项目下面不列东西；⌘K 能找到分集机器人，所在写项目名。
- 60 集：收起时只画"分集"一行；展开时每集一行，收起的集不画机器人。

### 项目群聊

- 项目自己的群聊，成员只列全剧的机器人：服务器不把分集机器人放进群聊，应用这边再去掉 `episodeBots` 里的，以防人手动加过或老数据。派发的提示行照旧。

### 项目设置

- 类型的设置下面一组"制作"，图片和视频两页都显示：视频并发、图片并发、同时进行的集数，默认 2、2、3。
- 每个是数字框，只收 1–50 的整数；不对时框变红，下面一行红字（"视频并发：请输入 1 到 50 之间的整数。"），点保存不发出去。保存和其他设置一起走 `saveGenerationSettings`。
- 服务器没给 `concurrency`（老服务器、老样例）时显示默认值。归档的项目只读。

## 步骤

1. 计划。
2. 补齐失败测试里的 `episodeBots`、`concurrency`。
3. 设置：`settings.ts` 的纯函数和测试，对话框和 DOM 测试，文案。
4. 左侧：`splitEpisodeBots` 和测试；"分集"组件和 DOM 测试（顺序、收起、状态点、选中、60 集）；⌘K、搜索的测试。
5. 项目群聊成员和测试。
6. 预览页；深色和浅色截图：60 集收起和展开、窄窗口、设置窗口，放 `/tmp/omb-wt-pb-sidebar/`。
7. 约定的检查，写报告。
