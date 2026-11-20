# 项目机器人的工作区放进项目文件夹：实现计划（第 3 块的一部分）

日期：2026-11-20 · 设计：`docs/superpowers/specs/2026-11-20-projects-templates-skills-design.md` 的“机器人工作区的位置”“项目文件夹找不到时”“归档”“安全”，以及“风险和还没验证的事”第 2、5 条

**目标：** 属于项目的机器人（记录里有 `teamProject { id, role }`），它自己的文件（记忆、学到的技能等）放在 `<项目文件夹>/.magic-team/bots/<role>/`。项目文件夹找不到或项目已归档时，它不干活，程序也不会把文件夹重新建出来。不属于项目的机器人一点不变。

**做法：** 所有代码都通过 `server/workspace.ts` 的 `workspaceDir(botId)` 找机器人的文件夹。让这一个函数认项目，再逐处检查那些自己拼 `<数据目录>/workspaces/...` 路径、或者默认“机器人的文件就在数据目录里”的地方。项目清单不归我管，我只通过 `TeamProjectLookup` 问项目文件夹在哪，测试里用假的。

**状态：** 已实现，下面写的都是代码现在的样子。

## 这一块定下的细节

1. **路径。** `workspaceDir(botId)`：项目机器人返回 `<项目文件夹>/.magic-team/bots/<role>`，其他机器人返回 `<数据目录>/workspaces/<机器人编号>`（和原来一样）。它只算路径，不查磁盘、不抛错。项目机器人的项目查不到、或者算不出路径时，它返回数据目录里的那个路径；那里对项目机器人来说只有密钥文件和留下的工具，读不到别的，而所有写入都先经过 `ensureWorkspace` / `ensureWorkspaceFolder`，会被拒绝，所以不会写错地方。
2. **谁是项目机器人。** `Store` 的构造函数登记 `setTeamProjectMemberships`，按编号从机器人记录里读 `teamProject`。所以从 `teamProject` 写上的那一刻起就生效，重启后也一样，`server/index.ts` 不用为此加行。记忆分层（Team Cloud 的 `<编号>--room-…`）、已删除的机器人、不认识的编号都查不到，按普通机器人算。
3. **`role` 必须能当一个文件夹名。** 不能为空、不能含 `/ \ : * ? " < > |` 和控制字符、不能以点开头（点开头的名字留给 `.deleted` 和 `.adopting`）、不能以点或空格结尾、不能是 Windows 的设备名、不超过 200 字节。不合格就当作“找不到所属项目”，机器人不运行。模板的角色标识和后加入机器人的 `member-xxxxxxxx` 都合格。
4. **不运行的三种原因**，按这个顺序判断：
   - `unknown_project`：`TeamProjectLookup` 不认识这个项目（包括还没调用 `setTeamProjectLookup`、`projects.json` 读不出来，以及 `role` 不合格）。宁可不运行，也不退回数据目录。
   - `archived`：项目有 `archivedAt`。不查磁盘。
   - `folder_missing`：项目文件夹不是一个存在的目录。硬盘没接上时路径不存在，读作“不在”。项目文件夹的路径在这台电脑上不是绝对路径时（比如在 Windows 上做的备份恢复到 Mac，记录里是 `C:\Users\…`）也读作“不在”，并且不拿它拼任何路径，免得相对于程序的当前目录读写。
5. **绝不重建项目文件夹。** 给项目机器人建文件夹时：先确认项目文件夹在，再一层一层建 `.magic-team`、`bots`、`<role>`、`memory`…，每层都用不带 `recursive` 的 `mkdir`。不带 `recursive` 的 `mkdir` 在上一层不存在时一定失败，所以从结构上就建不出项目文件夹。已存在的那一层必须是真目录，是符号链接或文件就拒绝（防止有人在项目里放一个链接，把机器人的文件引到别处）。
6. **接管原来的文件夹。** 建项目时，导入器先把初始记忆和模板自带的技能写进 `<数据目录>/workspaces/<编号>/`，之后 `projects` 才写上 `teamProject`。所以第一次给项目机器人准备文件夹时，如果项目里还没有它的文件夹、而数据目录里有内容，就把内容搬过去：先复制到 `bots/.adopting/<role>`，再原地改名为 `<role>`，最后删掉数据目录里已搬走的部分。始终复制、不跨盘改名，任何一步失败都不丢东西，下次再从头来。不搬的：两个密钥文件夹（`.magicbot-secrets`、旧名 `.openmausbot-secrets`）、`tools/`（见第 8、9 条）和程序自己建的技能链接（下次用时重建）。搬完以后数据目录里仍然留着这个机器人的（空）文件夹：沙盒的固定挂载、MCP 工具的运行目录都靠它。
7. **记忆的索引、技能的清单和开关状态、记忆的修改记录都留在数据目录**，按机器人编号和相对路径记，不用改。项目文件夹不在时不同步索引、不对比修改记录，否则拔掉硬盘会被当成“机器人把记忆全删了”。
8. **密钥文件留在数据目录。** 用户通过密钥卡片交给机器人的文件仍放在 `<数据目录>/workspaces/<编号>/.magicbot-secrets/`。项目文件夹可能在网盘同步目录或没有权限控制的外接盘上，而且是整个项目所有机器人的工作文件夹。
9. **机器人留下的 MCP 程序（`tools/`）留在数据目录。** 这些程序由应用自己启动、不再问用户，放进项目文件夹后同项目的其他机器人或同步工具都能改它。
10. **删除项目机器人。** 项目里它的文件夹不删，改名移到 `<项目文件夹>/.magic-team/bots/.deleted/<role>-<UTC 时间>/`（重名时加 `-2`、`-3`…）；数据目录里它的文件夹照旧删除。项目文件夹不在、或查不到项目时，项目里什么都不碰、什么都不建。所有删除的入口（界面的删除、导入失败的回退、建项目失败的回退、团队备份的回退）都走 `store.deleteBot`，所以只改了这一处。
11. **检查点不收 `.magic-team/`。** 机器人在项目文件夹里干活时，检查点会给工作文件夹拍快照、列出改动。`.magic-team/` 加进排除清单，记忆不进快照，改动列表里也不出现记忆文件。
12. **不干活时怎么表现。** 复用“暂停机器人”的那一个关口（`BotHolds`），在它外面包一层（`withTeamProjectStops`）：
    - 用户给它发消息、Bot API：请求被拒绝（409，`bot_held`），返回一行原因；用户的这条消息不会存下来。
    - 例行任务、触发器：自动的那一次安静取消，不新建对话、不提醒任何人；用户手动点运行的那一次失败并显示原因。
    - 其他机器人交给它工作：对方得到一句英文说明（只有模型看），并被告知该对用户说什么。
    - 群聊里轮到它：跳过，并在群里写一行原因。同一个对话、同一个机器人、同一个原因只写一次，直到它又能运行为止；程序重启后会再写一次。群自己暂停了这个机器人时，只写群原来的那一行。
    - 记忆整理、引擎预热等后台工作：跳过，不出声。
    - 项目的原因排在“被你暂停”之前：两者都成立时说项目的原因。
    - “被你暂停”的列表（`heldBots()`、`state()`）不包含这些机器人，界面的“恢复”按钮不受影响。
13. **提示词。** 项目机器人的“文件位置”一段多一句：`sharedBotFolder` 是它在这个项目的 `.magic-team` 里自己的文件夹，记忆和学到的技能都在那里；`.magic-team` 里只能动这个文件夹，其余是队友的记忆和应用保存的副本，不许改、移、删、整理，批量替换和格式化也要绕开。“记忆”一段说记忆文件在“这个项目的 `.magic-team` 里你自己的文件夹”，不再说“在项目文件夹之外”。技能的路径（`Read "<自己的文件夹>/skills/<名字>/SKILL.md"`）跟着 `workspaceDir` 走，自动是对的。
14. **跨盘。** 数据目录和项目文件夹常常不在同一个盘，跨盘改名会失败（EXDEV）。两处原来靠改名的地方补上跨盘的做法，而且只对项目机器人生效：发布学到的技能（复制到目标旁边再原地改名，之后照旧校验内容），移除技能链接（确认是程序自己建的链接后原地删除）。其他机器人跨盘时的表现和原来一样（失败）。
15. **项目文件夹不在时的技能。** 安装、学习（新建和更新）、开启、删除都被拒绝，并说明原因（“找不到项目文件夹…”）；不删除“程序建过哪些链接”的记录，也不建任何东西。关闭照常可以（开关状态在数据目录里），文件夹回来后下一次同步会把链接去掉。技能列表里它们显示为关闭，警告写的是文件夹找不到，而不是“技能文件被改过”。提示词里不列它们。
16. **放宽访问只在每一层都是真文件夹时。** 凡是因为“这是机器人自己的文件夹”而不再询问就能读写的地方（沙盒挂载、OpenCode 的免审批目录、读自己的文件免审批、搬到 Cloud 时读文件），用的都是 `teamProjectBotFolderInPlace`：`.magic-team`、`bots`、`<role>` 三层都是真目录才算。在项目文件夹里干活的任何人都能放一个链接进去，所以不能只看路径。
17. **已归档项目的机器人，文件仍然可读可写**（比如用户在界面里改它的记忆），只是不接新工作。

## 约束

- `server/index.ts` 最多增加 4 行：实际增加 0 行，8 行在原行内改。`server/store.ts` 净减 1 行。`server/skills.ts` 行数不变（1379，正好是上限）。`server/workspace.ts`、`server/workspace-backup.ts` 都不到 1000 行。
- 不属于项目的机器人走的代码路径和原来相同：凡是改动的地方都写成“项目机器人的路径 ?? 原来的表达式”，或者先问一句“是不是项目机器人”。
- 人设、部门的背景说明、团队记忆仍在数据目录（`<数据目录>/bots/<编号>/SOUL.md`、`section-contexts.json`、`team-memory.json`），它们不经过 `workspaceDir`，这一块不动它们，并用测试确认。
- `.magic-team/team/` 和 `project.json` 是 `projects` 写的，我只管 `.magic-team/bots/<role>/`（以及同一层的 `.adopting`、`.deleted`）。
- 给人看的话都来自语言文件：`server.teamProjectBot.folderMissing / archived / unknown` 三句（en、de、zh、zh-tw、pt-br），`serverError.teamProjectBot.folderMissing / unknown / ownFolderBlocked` 三句（en、zh、zh-tw、pt-br，并登记在 `server/user-errors.ts`）。
- 验证只用独立的测试实例和临时文件夹。

## 检查清单：每一处假定“机器人的文件在数据目录里”的地方

**记忆**

| 位置 | 原来 | 处理 |
|---|---|---|
| `workspace.ts` `workspaceDir` 和所有读取（`readMemoryFile`、`loadMemory`、`listMemoryTopics`、`readMemoryTopic`、`listMemoryLogs`、`readMemoryLog`、`memoryTopicIndex`、`memoryFilesOnDisk`、提示词） | 拼数据目录路径 | `workspaceDir` 认项目，读取都跟着对 |
| `workspace.ts` `ensureWorkspace` | 递归建目录 | 项目机器人：检查、逐层建、接管；其他机器人不变 |
| `workspace.ts` `appendMemoryLog`、`writeMemoryLog`；`memory-store.ts` `writeMemoryDoc` | 自己递归建 `memory/log` | 改用 `ensureWorkspaceFolder(botId, "memory", "log")` |
| `workspace.ts` `writeMemoryFile`、`updateMemory`、`writeMemoryTopic`、`appendMemoryArchive` | 先 `ensureWorkspace` 再写 | 不用改：写之前都过 `ensureWorkspace` |
| `memory-store.ts` `resolveMemoryPath`、`memoryOverview`、`readMemoryDoc`、`deleteMemoryDoc`、`openMemoryLocation` | 走 `workspaceDir` / `ensureWorkspace` | 不用改 |
| 记忆索引（`message-db.ts`，数据目录里的 SQLite）和 `workspace.ts` `syncMemoryIndex` | 按编号 + 相对路径 | 留在数据目录；项目文件夹不在时不同步，回来后下一次搜索自动补齐 |
| 记忆修改记录（`memory-journal.ts`） | 数据目录，对比磁盘 | 留在数据目录；项目文件夹不在时不对比 |
| 记忆整理（`memory-upkeep.ts`） | `ensureWorkspace` | 不用改：不干活的机器人被 `BotHolds` 过滤掉；万一抛错，本来就被接住并记日志 |
| `server/index.ts` 每轮结束后写的记忆日志 | `appendMemoryLog` | 不用改：走上面的函数；文件夹中途消失时被拒绝，外层本来就接住 |
| `memory-forget.ts`、`recall.ts`、`cloud-send-memory.ts`、`team-backup.ts`、`routes/bots-create.ts`、`host/team-messages.ts` | 走上面的函数 | 不用改 |
| `memory-move.ts`、`host/cloud-team-host.ts`、`host/team-member-left.ts`、`host/delete-leftovers.ts`、`host/lending-lifts.ts`、`lending-memory.ts` | Team Cloud 的记忆分层、出借 | 不适用：分层的编号不是机器人编号，查不到项目，仍在数据目录 |

**机器人自己的技能**

| 位置 | 原来 | 处理 |
|---|---|---|
| `skills.ts` `ensureSkillsRoot` | 递归建 `skills/` | 改用 `ensureWorkspaceFolder(botId, "skills")` |
| `skills.ts` 安装、读取、链接 | 走 `workspaceDir` | 内容在 `<自己的文件夹>/skills/`，链接在 `<自己的文件夹>/.claude、.agents、.grok/skills`；清单、开关状态和隔离区留在 `<数据目录>/skill-state/<编号>/` |
| `skill-storage.ts` `publishReviewedRevision` | 从数据目录改名进 `skills/.revisions/` | 项目机器人跨盘时复制到目标旁边再原地改名，之后照旧校验内容 |
| `skills.ts` `removeOwnedNativeLink` | 把链接改名进数据目录的隔离区 | 项目机器人跨盘时，确认它确实是指向自己技能的链接后原地删除 |
| `skills.ts` `syncSkillLinks`、`setSkillEnabled`、`removeSkill`、`skillListing`，以及报“技能目录必须是真目录”“技能文件被改过”的几处 | 文件夹读不到就当成被改坏了 | 项目文件夹不在时：不同步、不清记录，拒绝并说明真正的原因（第 15 条） |
| `skills.ts` `nativeLinkDirectory` | 逐层、不递归 | 不用改：项目文件夹不在时建不出来 |
| `imported-skills.ts`、`skill-task-links.ts` | 链接建在对话文件夹（数据目录） | 不适用；链接指向 `workspaceDir` 下的技能，跟着对 |
| `host/skills-library.ts`（技能库） | 数据目录 | 不适用：技能库不是机器人自己的文件 |

**AI 能访问的文件夹**

| 位置 | 原来 | 处理 |
|---|---|---|
| `bot-box/plan.ts`、`box.ts`（Linux 的机器人沙盒） | 固定挂载 `<数据目录>/workspaces/<编号>` | 项目机器人多挂一处：项目里它自己的文件夹，可读写；Team Cloud 上只读团队记忆的那种访客这一处挂成只读。数据目录里那个照旧（项目机器人那里也有这个文件夹，见第 6 条） |
| `own-file-reads.ts` | 自己的文件 = 数据目录里三处 | 加上项目里它的文件夹 |
| `drivers/acp/opencode-go.ts` | 免审批目录、禁用项目配置只认数据目录 | 免审批目录加上项目里它的文件夹；工作文件夹在它里面时同样禁用项目配置 |
| `index.ts` `messageFileRootsForThread`、`dataExportRoots`、`botSettingsFile` | 走 `workspaceDir` | 不用改 |
| 其他引擎的 `--add-dir`、Codex 的可写目录 | 不含机器人文件夹 | 不适用 |
| VM 的主目录（`vm-home`、`vm-homes/`） | 数据目录 | 不适用：不放机器人自己的文件 |
| `bot-box/program-trust.ts` | 不从机器人能写的目录启动程序 | 不用改：项目文件夹和任何“工作文件夹”一样对待 |
| `host/secret-cards.ts`（密钥文件、清扫 `workspaces/*`） | `workspaceDir(分层)` | 改用 `privateBotFolder`：密钥文件留在数据目录，清扫照旧 |
| `mcp-bot-servers.ts`、`host/mcp-servers-host.ts`、`host/mcp-chat.ts` | `tools/` 和运行目录在数据目录 | 留在数据目录；`mcp-chat.ts` 改用 `privateBotFolder`，三处一致 |
| `host/checkpoint-seeds.ts`（启动后预读工作文件夹） | 文件夹不存在就跳过 | 不用改：不建任何东西 |

**备份、恢复、导出、搬到 Cloud、删除、其他**

| 位置 | 原来 | 处理 |
|---|---|---|
| `workspace-backup.ts`（整体备份和恢复） | 只走数据目录 | 不改代码。备份不含项目文件夹里的任何内容，也不碰它；`projects.json` 在数据目录里，会跟着备份走。恢复不往项目文件夹写，也不把它退回旧的样子。测试确认 |
| `workspace-backup-policy.ts` `managedTaskSkillLink` | 认数据目录里的技能链接 | 不改：对话文件夹里指向项目技能的链接按“工作文件夹里的链接”略过，并给出原有的提示（“它们指向的东西不在这份备份里”），说的是实情 |
| 恢复时改写旧路径（`workspace-backup-paths.ts`） | 改写数据目录里的文件 | 不改：只改写恢复出来的数据目录里的文件；项目文件夹里的记忆文件不在备份里，也不会被改写（见“已知的不足”） |
| `moved-paths-repair.ts` | 改写数据目录里记忆文件中的旧路径 | 不适用：只在 Cloud 上运行，而搬上 Cloud 的机器人不带 `teamProject` |
| `checkpoints.ts` | 给工作文件夹拍快照 | 排除 `.magic-team/` |
| `cloud-send-files.ts`（搬到 Cloud，发送方） | 遍历 `<数据目录>/workspaces/<编号>` | 发送方把 `workspaces/<编号>/…` 对应到真实的文件夹（数据目录和项目里的都列，同名时用数据目录的）；接收方不变。`teamProject` 是服务器私有字段，不随机器人上 Cloud |
| `share.ts` 导出模板到机器人文件夹 | 递归建目录 | 写之前先让 `workspace.ts` 检查并准备好文件夹（`prepareOwnFolder`），它返回一个在机器人自己的文件夹里逐层建目录的函数，`writeFolder` 建每一个目录都经过它，不再递归。文件夹一开始就不在、或者写到一半不见了，都拒绝并说明原因，什么都不重建 |
| `host/app-publisher.ts` | 只读 `workspaceDir` | 不用改 |
| `store.ts` `deleteBot` | `rm -r` 数据目录里的文件夹 | 改用 `retireWorkspace(bot)`（第 10 条） |
| `bot-folder.ts`（人设）、`section-context.ts`（背景说明）、`team-memory.ts`（团队记忆） | 数据目录 | 不动，测试确认 |
| `handoff-files.ts`、`cloud-sync*.ts`、`skills-library.ts` `threadFolder`、对话文件夹 `task-workspaces/` | 数据目录 | 不适用：对话文件夹不搬 |
| 界面（`src/`）、`electron/`、`scripts/` | — | 查过：没有一处自己拼 `workspaces/<编号>` 路径 |
| 单独的进程（备份的 worker、MCP 代理、配对命令行等） | — | 查过：它们不对机器人自己的文件夹做读写；沙盒的挂载方案在主进程里算 |

**递归建目录（主要风险）：** 逐个查了主进程里所有带 `recursive` 的 `mkdir`，会落到项目路径上的只有上面 `share.ts` 那一处，已改。其余的：

| 位置 | 建在哪里 | 处理 |
|---|---|---|
| `imported-skills.ts` `ensureRealDirectory` | 只用于导入技能的目录和它的 `.staging`（数据目录） | 不适用 |
| `skill-share.ts` `writeJsonRecord` | 技能库根目录（数据目录） | 不适用 |
| `memory-move.ts` `moveMemoryLayer` | 唯一的调用方是 Team Cloud 给用户自己的 MagicBot 分记忆层，那个机器人没有 `teamProject` | 不适用 |
| `skill-storage.ts` `publishPrepared`（跨盘时的补法） | 每个文件只补建缺的一层 | 不用改：学到的技能只有 `SKILL.md` 和 `references/<主题>.md`，最深一层 |
| `bot-box/self-check.ts` | 按工作文件夹建目录 | 不适用：只在 Linux 沙盒里面跑，不在主进程 |

## 文件

| 文件 | 改动 |
|---|---|
| `server/team-project-folders.ts`（新） | 项目和成员的查询、路径、三种原因、给人看的原因、`role` 检查、逐层建目录、接管、删除时移走、“每层都是真文件夹”的判断。不依赖数据库，驱动也能引用 |
| `server/workspace.ts` | 对外的入口（见“接口”）；`workspaceDir`、`ensureWorkspace` 认项目；`privateBotFolder`、`ensureWorkspaceFolder`、`prepareOwnFolder`、`retireWorkspace`；提示词；索引在文件夹不在时不同步 |
| `server/host/team-project-stops.ts`（新） | 包在 `BotHolds` 外面的一层 |
| `server/index.ts` | 0 行新增，8 行在原行内改：两处 import、包上 `BotHolds`、群聊的一行原因、密钥文件夹、读自己文件、导出前的准备、把项目清单的查询交给 `setTeamProjectLookup` |
| `server/store.ts` | 构造时登记成员查询；删除改用 `retireWorkspace`（净减 1 行） |
| `server/memory-store.ts`、`server/memory-journal.ts` | `memory/log` 的建法；项目文件夹不在时不对比 |
| `server/skills.ts`、`server/skill-storage.ts` | `skills/` 的建法；两处跨盘；文件夹不在时的拒绝和原因 |
| `server/checkpoints.ts` | 排除 `.magic-team/` |
| `server/bot-box/plan.ts`、`box.ts` | 沙盒里的项目文件夹 |
| `server/own-file-reads.ts`、`server/drivers/acp/opencode-go.ts` | 自己的文件夹多一处 |
| `server/host/mcp-chat.ts` | 运行目录用 `privateBotFolder` |
| `server/cloud-send-files.ts` | 发送方的路径对应 |
| `server/share.ts`、`server/host/share.ts` | 可选的 `prepareBotFolder`；`writeFolder` 可以接一个建目录的函数，不给时和原来一样递归建 |
| `server/team-projects/testing.ts`（`projects` 的文件，+4 行） | 测试用的整套安装里把项目清单的查询交给 `setTeamProjectLookup`；`projects` 已确认保留 |
| `server/user-errors.ts`、`src/locales/{en,de,zh,zh-tw,pt-br}.json` | 六句话 |

## 接口

```ts
// server/workspace.ts
export function setTeamProjectLookup(lookup: TeamProjectLookup): void;
export function teamProjectFolderReady(folder: string): boolean;

export function setTeamProjectMemberships(membership: (botId: string) => TeamProjectMembership | undefined): void;
export type TeamProjectStop =
  | { reason: "unknown_project" }
  | { reason: "archived" }
  | { reason: "folder_missing"; folder: string };
/** 为什么这个项目机器人现在不能运行；能运行或不属于项目时为 null。 */
export function teamProjectStop(botId: string): TeamProjectStop | null;
/** 项目里它自己的文件夹；不属于项目、或算不出路径时为 null。只算路径。 */
export function teamProjectBotFolder(botId: string): string | null;
/** 项目机器人的文件现在读不到（所以“没找到”不说明任何事）。 */
export function teamProjectFilesAway(botId: string): boolean;
/** 用给人看的话说它自己的文件夹现在为什么用不了；能用或不属于项目时为 null。 */
export function teamProjectFolderProblem(botId: string): string | null;

export function workspaceDir(botId: string): string;
/** 数据目录里它的文件夹（所有机器人都有）；项目机器人只在这里放密钥文件和留下的工具。 */
export function privateBotFolder(botId: string): string;
export function ensureWorkspace(botId: string, language?: string): string;
/** 它文件夹里的一个子文件夹，建好并返回路径。 */
export function ensureWorkspaceFolder(botId: string, ...parts: string[]): string;
/** 给自己会在机器人文件夹里建目录的代码用：项目机器人先检查并准备好，返回一个在它自己的文件夹里逐层建目录的函数
 * （每次都重新检查项目文件夹，不在时拒绝；给的路径不在它的文件夹里时报错）。不属于项目的机器人什么都不做，返回 null。 */
export function prepareOwnFolder(botId: string): ((path: string) => void) | null;
/** 删除机器人时处理它的文件夹，不抛错。 */
export function retireWorkspace(bot: { id: string; teamProject?: TeamProjectMembership }): void;

// server/team-project-folders.ts
/** 项目里它自己的文件夹，仅当 .magic-team、bots、<role> 三层都是真目录；否则 null。 */
export function teamProjectBotFolderInPlace(botId: string): string | null;

// server/host/team-project-stops.ts
export function withTeamProjectStops(holds: BotHolds, deps: {...}): BotHolds & { noteRoomSkip(botId: string, threadId: string, language?: string): void };
```

集成要接的地方，现在都已经接好，合并我的标签即可，不用再加代码：

1. 启动时调用 `setTeamProjectLookup(...)`：已在我的分支上，写在 `server/index.ts` 创建项目服务的那一行里（`setTeamProjectLookup(teamProjects.lookup)`）。这一行在服务器开始监听、例行任务和记忆整理启动之前执行。
2. `projects` 的 `folderState` 改用 `teamProjectFolderReady(folder)`：`projects` 自己在 `lab-contract-projects-5` 里做了。
3. `projects` 给机器人写上 `teamProject` 之后调一次 `ensureWorkspace(bot.id)`（建项目时和后加入的机器人）：`projects` 已做。初始记忆和模板技能当场搬进项目文件夹；文件夹有问题时建项目这一步就失败，可以整体撤销。
4. 撤销建项目时先删机器人、再删 `.magic-team`：`projects` 已做。
5. 项目群聊和没有自己工作文件夹的项目机器人，工作文件夹是项目文件夹：`projects` 已做。
6. 我的分支包含 `lab-contract-projects-7` 和 `lab-contract-rename-tests-2`（`projects-8`、`-9` 只改了 `projects` 自己的文件，我用不到）。
7. 写测试的人要知道：在真的 `Store` 里给机器人写上 `teamProject` 的测试，必须先调用 `setTeamProjectLookup`，否则这个机器人读作“找不到所属项目”，`ensureWorkspace` 会拒绝。`server/team-projects/testing.ts` 已经这样做了。

## 任务

- [x] **1. 路径和三种原因。** `server/team-project-folders.test.ts`。
- [x] **2. 建文件夹和接管。** 同上：逐层建、项目文件夹不在时什么都不建、链接挡路时拒绝、接管、普通机器人不变。
- [x] **3. 记忆。** `server/workspace-team-project.test.ts`：读、写、日志、主题、索引搜索；文件夹不在时索引保留、不记改动。
- [x] **4. 技能。** `server/skills-team-project.test.ts`：安装、读取、开关、删除、学到的技能发布和更新（模拟跨盘）、文件夹不在时的拒绝、普通机器人不变。
- [x] **5. 删除、检查点、导出。** `server/store-team-project.test.ts`、`server/checkpoints.test.ts`、`server/share-team-project.test.ts`。
- [x] **6. 能访问的文件夹。** `server/bot-box/plan.test.ts`、`server/own-file-reads.test.ts`、`server/drivers/acp/opencode-go.test.ts`、`server/cloud-send-files.test.ts`。
- [x] **7. 不干活时的表现。** `server/host/team-project-stops.test.ts`、`server/routines-team-project.test.ts`；语言文件的六句话；接进 `server/index.ts`。
- [x] **8. 备份和恢复。** `server/workspace-backup-team-project.test.ts`。
- [x] **9. 真服务器上的证明。** `server/team-project-workspace.e2e.test.ts`。
- [x] **10. 检查。** 类型检查、lint、i18n 检查、行数检查、改过的文件和相邻文件的测试。

## 怎么验证

- 单元测试（假的查询、临时文件夹）：上面“任务”里列的文件。其中导出模板时项目文件夹在检查之后、写的中途不见了：拒绝并说明原因，什么都不重建（`server/share-team-project.test.ts`、`server/workspace-team-project.test.ts`）。
- 真服务器：`server/team-project-workspace.e2e.test.ts`。它不改 `scripts/control-omb.ts`，也不加测试专用的接口：先起一个测试实例建机器人，停掉；在 `bots.json` 里写上 `teamProject` 和工作文件夹；再用同一个数据目录起真正的 `server/index.ts`，在服务器自己接好之后用一个读文件的假查询替换。它证明：
  - 用假 AI 跑一轮后，记忆落在项目文件夹里，数据目录里没有；交给 AI 的指令里带着那句话和记忆文件的路径；
  - 通过接口装的技能在项目文件夹里，下一轮的指令里写的是那里的路径；
  - 文件夹被移走后，这一轮被拒绝（409 和那一行话），群里只写一行，什么都没有重建，数据目录里也没有多出东西；项目已归档、查不到项目时同样被拒绝，各有各的话；
  - 删除机器人后，它的文件夹在 `.magic-team/bots/.deleted/` 下，记忆和技能都在，项目里别的文件没动；
  - 用户通过密钥卡片交给机器人的文件只在数据目录里，项目文件夹里没有任何文件含有那个值。
- 真的第二块盘：这台 Mac 上数据目录在内置盘、工作树在外接 SSD，我用一个用完即删的测试在真的跨盘条件下跑了一遍（从数据目录改名进项目文件夹确实报 EXDEV）：接管、读写记忆、搜索、学到的技能的更新、关闭和删除技能、删除机器人都通过。记录在 `.omb-scratch/verify-evidence/workspaces/second-volume.txt`。
- 机器人沙盒只在 Linux 上运行，这台 Mac 上只能验证生成的挂载方案，不能真的跑。

## 需要用户确认的决定

1. **项目文件夹在、但里面的 `.magic-team` 不见了怎么办？** 我选：照常运行，把 `.magic-team/bots/<role>` 这几层重新建出来（记忆从空开始）。原因：用户可能误删这个隐藏文件夹，项目文件夹本身还在，不该因此整个项目停摆；设计里说的“不会自己去新建”指的是项目文件夹。代价：如果别的程序在硬盘拔掉时在原路径上建了一个同名空文件夹，机器人会在那个空文件夹里干活。以后要改很容易：在判断里多要求 `.magic-team` 存在，一行。
2. **建项目时先写进数据目录的初始记忆和模板技能，自动搬进项目文件夹。** 我选：第一次准备文件夹时搬（细节第 6 条）。原因：导入器在 `teamProject` 写上之前就写了这些文件，不搬的话项目机器人一开始就是空记忆。代价：同步复制，文件夹很大时会卡一下（新机器人的文件夹很小）。要改不难，逻辑集中在一个函数里。
3. **密钥文件留在数据目录，不进项目文件夹。** 原因见第 8 条。以后要改：一行（`layerFolder` 换回 `workspaceDir`），但清扫过期密钥的代码也要跟着认项目文件夹。
4. **机器人留下的 MCP 程序（`tools/`）留在数据目录。** 原因见第 9 条。要改需要动 `mcp-bot-servers.ts` 的两处路径，并搬已有文件，中等。
5. **删除项目机器人时，项目里它的文件夹移到 `.magic-team/bots/.deleted/<role>-<时间>/`，不删。** 原因：任务要求删除机器人不能把项目文件夹里的文件永久删掉；改名留在原项目里，用户找得到，也能手动删。数据目录里它的部分（密钥文件、留下的工具、技能的开关状态）和原来一样删掉。代价：`.deleted` 里的文件夹会一直留着，没有界面清理。要改很容易（一个函数）。
6. **检查点排除 `.magic-team/`。** 原因见第 11 条。影响所有在含 `.magic-team` 的文件夹里干活的机器人（包括不属于项目、但工作文件夹指向某个项目文件夹的机器人）。要改：删一行。
7. **备份不包含项目文件夹里的记忆和技能；恢复旧备份也不会把它们退回去。** 原因：备份只收数据目录，项目文件夹是用户自己的文件夹，可能很大，也可能不在线；设计里记忆以项目文件夹为准。代价：只靠应用的备份换电脑，项目机器人的记忆不会跟着走（“在另一台电脑上打开已有项目”本来就不在这一版里）。以后要加进备份是一项单独的工作。
8. **搬到 Cloud 的项目机器人，在 Cloud 上是普通机器人。** `teamProject` 不随机器人上线（它是服务器私有字段），记忆和技能通过现有接口从项目文件夹读出、写进 Cloud 的数据目录。项目文件夹本身不搬，和任何工作文件夹一样。
9. **已归档项目的机器人，文件仍然可读可写**（比如用户在界面里改它的记忆），只是不接新工作。原因：设计说归档后“文件夹和数据都不动”，没说锁住。要改很容易。
10. **查不到项目时不运行，而不是退回数据目录。** 原因：退回数据目录会让机器人带着空记忆干活，并把新记忆写到错的地方。这时对用户说的是“MagicBot 里找不到它所属的项目，请从备份里恢复数据文件夹中的 projects.json”，和 `projects` 自己在项目清单读不出来时说的一致；原来写的“请重启”不对，因为重启修不好这个文件（`projects` 指出的）。
11. **群聊里只写一次原因。** 同一对话、同一机器人、同一原因，在它又能运行之前只写一行，避免每条消息都刷一行；重启后会再写一次（记在内存里）。
12. **项目文件夹的路径在这台电脑上不是绝对路径时，按“找不到文件夹”处理，并把那个路径原样告诉用户。** 典型情况是把 Windows 上的备份恢复到 Mac。原因：这时文件夹确实不在这台电脑上，“找不到文件夹”比“找不到项目”更接近实情；同时绝不拿这种路径去拼文件路径。
13. **项目文件夹不在时，技能的安装、学习、开启、删除一律拒绝并说明原因；关闭照常。** 原因：这时删除只会删掉清单里的记录而留下文件，开启则建不出链接；关闭不需要碰项目文件夹，而且是用户想让机器人少做事，没有理由拦。
14. **跨盘的两处补法只对项目机器人生效。** 其他机器人跨盘时仍和原来一样失败。原因：任务要求不属于项目的机器人一点不变。代价：把数据目录或机器人文件夹用链接放到别的盘上的人，原有的问题还在。要改很容易（去掉“是不是项目机器人”的判断）。
15. **项目的原因排在“被你暂停”前面。** 一个被用户暂停、项目又归档了的机器人，用户看到的是“项目已归档”。原因：恢复项目之前，解除暂停也没用。恢复项目以后，用户原来的暂停仍然有效。

## 已知的不足

- 项目文件夹在挂起的网络盘上时，检查它在不在的系统调用可能卡住几秒（同步调用）。
- exFAT 等没有权限控制的盘上，记忆文件对这台电脑的其他账户可读。
- 网盘同步产生的冲突副本不会被合并：`MEMORY (冲突副本).md` 不会被读；`memory/` 下名字合法的副本会被当成另一个主题。
- 同一个项目的机器人都在项目文件夹里干活，除了提示词里的那条规定，没有别的东西拦着它们改彼此的文件夹（设计里“已知的风险”，代码注释里也写了）。
- 一轮已经在跑的时候项目文件夹消失：这一轮不会被打断。记忆和技能的写入会被拒绝、不会重建文件夹；但引擎自己，以及这一轮里其他按工作文件夹写文件的代码（例如不支持工作区文件的引擎把过长的工具结果存到工作文件夹），不在这一块的保护之内。
- 机器人被删除时如果项目文件夹不在，它在项目里的文件夹留在原处；之后同一个 `role` 的新机器人会接着用这个文件夹。在 Windows 上，如果它文件夹里有文件正被别的程序打开，移到 `.deleted` 这一步会失败，而且不报错，结果也一样。
- 导出模板写到一半时项目文件夹不见了：已经写下的部分留在那块盘上，下次导出时整个重写。
- 机器人离开项目（去掉 `teamProject`）不在这一版里：文件不会搬回数据目录。
- 项目文件夹不在时，界面里这个机器人的记忆页是空的（读不到），不会显示原因；原因由项目界面显示。
- 备份不含项目文件夹里的记忆；在别的电脑上恢复时，数据目录里的旧路径会被改写，项目文件夹里记忆文件中的旧路径不会。恢复以后，项目的机器人一直停着，直到项目文件夹出现在记录的路径上。
- 沙盒：判断“每一层都是真文件夹”和真正挂载之间有时间差，这中间被换成链接的文件夹会被挂进去。
- 启动顺序：项目清单的查询是在 `server/index.ts` 创建项目服务的那一行接上的，在开始监听和启动例行任务之前。以后如果有人在这一行之前启动会让机器人干活的后台任务，项目机器人会被当成“找不到所属项目”。
- `.magic-team/bots/.deleted/` 没有清理的界面，也不会自动清理。
- Team Cloud 上同时用项目和记忆分层没有验证。
- 没有在浏览器里看过被拒绝时的那一行：界面归 `projects-ui`。接口返回 409 和那一行话；客户端对发送失败统一把服务器给的文字显示出来。
