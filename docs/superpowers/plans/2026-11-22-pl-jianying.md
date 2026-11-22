# 剪映草稿的服务器端：实现计划（第 6 块，服务器）

日期：2026-11-22 · 设计：`docs/superpowers/specs/2026-11-22-drama-pipeline-and-jianying-design.md` 第 6 节 · 分工：`OpenMausBot-wt/PIPELINE-CHARTER.md`

**目标：** 每个项目有一份时间线（镜头顺序）；所有镜头都有选用的视频时，程序在剪映的草稿目录里写一份草稿，素材按绝对路径指向项目文件夹里的视频；时间线变了就更新草稿，剪映保存过的不动，另存一份带序号的；点"编辑"把剪映带到前台；`产出` 文件夹里出现的成片交回画布；后期机器人有读时间线和调整顺序两个工具。不做界面。

**做法：** 新代码都在 `server/project-draft/`，机器人工具的定义在 `server/drivers/agents-project-timeline-tools.ts`。`server/index.ts` 只加一行。画布那边用自己声明的小接口（`ProjectDraftCanvas`），测试用内存实现，真的由集成接上。

## 合同

`shared/project-draft.ts` 已经提交。接口：`GET`/`PUT /api/team-projects/:id/timeline`、`POST …/draft/open`、`POST …/final`。补两处：`ProjectTimelineWire.leftOut?`（被去掉的镜头），机器人把镜头放回来时要知道它的 id；`ProjectFinalResult`（`POST …/final` 回答成片节点的 id）。

## 分块

1. **找剪映**（`jianying.ts`）：Mac 上看 `/Applications/VideoFusion-macOS.app` 的 `Info.plist` 取版本，草稿目录从 `~/Movies/JianyingPro/User Data/Config/globalSetting` 的 `currentCustomDraftPath` 读，读不到用默认目录；Windows 上是 `%LOCALAPPDATA%\JianyingPro\...` 和 `draft_content.json`。所有路径可注入。结果：可用、`not-installed`、`unsupported-version`。会写的版本集中在一个表里（现在只有 11.8）。
2. **视频文件**（`video-file.ts`）：按内容判断是不是视频；MP4/MOV 读出时长、宽高、帧率，草稿用文件自己的数值，读不出时用画布给的。
3. **时间线**（`store.ts`、`timeline.ts`、`drafts.ts`）：每个项目一个文件 `<数据目录>/project-timelines/<项目 id>.json`，记顺序、被去掉的镜头和写过的草稿。没排过的镜头排在排过的后面，按画布的顺序。选用的视频不在项目文件夹里、不是视频或文件不在时，这个镜头算没有视频。
4. **写草稿**（`draft-file.ts`、`drafts.ts`）：从 11.8.0 的空白模板出发，一条视频轨，片段首尾相接、不裁剪、速度 1，画面尺寸和帧率取第一段。文件夹名是去掉路径符号的项目名，只写在草稿目录里面。记下写出的时间线文件的哈希；更新时文件还是那份就原地重写，不是就另写一份带序号的，状态变成 `kept`。内容没变不重写。
5. **打开剪映**（`open.ts`）：先查应用包里有没有能直接打开某份草稿的入口（URL scheme、命令行参数）；确定有才用，否则只打开应用。用干净的环境变量启动。查的结果：11.8.0 没有这样的入口，所以只打开应用，回答 `opened: "app"`。
6. **成片回来**（`drafts.ts` 的 `lookForFinals`，由 `host.ts` 定时调用）：轮询有草稿的项目的 `产出` 文件夹（只看这一层，生成的结果在它的子文件夹里），出现画布上没有、大小不再变、内容是视频的文件时交给画布接口。`POST …/final` 对指定的文件做同样的事。
7. **机器人工具**（`tools.ts`、`tool-route.ts`、`server/drivers/agents-project-timeline-tools.ts`）：`timeline_get_state`、`timeline_set_order`，只给项目里环节含"后期"的机器人；服务器按 `pipelinePlaceOf` 拒绝其他机器人。新开关 `OMB_PROJECT_TIMELINE`，照画布工具的方式接进目录、工具组、桥接和测试。
8. **接口和宿主**（`routes.ts`、`host.ts`）：路由、`draftWire(projectId, auth)`（给快照）、`writeDraftIfReady(projectId)`（给接力和集成）、`onTimelineChange(listener)`、`onDraftChange(listener)`、`connectCanvas(canvas)`。服务器是不是在用户自己的电脑上：桌面应用启动的服务器（`OMB_DESKTOP_PARENT=1`）且请求来自本机的所有者（loopback）；否则回答 `unavailable` / `remote`。

## 验证

- 每块先写测试，全部在临时文件夹里跑，不碰剪映自己的目录。
- 在这台 Mac 上用写草稿的代码往剪映真实的草稿目录写一份 `MagicBot测试-pl-jianying`，指向两段样例视频，确认剪映把它登记进 `root_meta_info.json`。不启动、不退出剪映。
