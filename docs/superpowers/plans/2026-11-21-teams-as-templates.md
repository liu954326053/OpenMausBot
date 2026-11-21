# 团队即模板和主机器人：实现计划（第 1 块）

日期：2026-11-21 · 设计：`docs/superpowers/specs/2026-11-21-teams-flow-project-canvas-design.md` 第 1、2、6 节

**目标：** 建项目时直接选一支团队；项目里的机器人是团队成员的分身，跟着原机器人变；团队增减成员要用户确认；主机器人不属于任何部门，按需求提议建团队和项目；设置里的"模板"页和模板同步去掉。

**做法：** 建项目继续走"共享导出 → 导入"，只是导出的来源从模板库换成部门本身。跟随由服务器在机器人改动时同步，分身上的这几项在每条修改路径上都被拒绝。主机器人的迁移在服务器读机器人数据之前对文件做一次。

## 这一块定下的细节

### 哪些团队能用

- 团队就是部门（`section-contexts.json` 里登记的部门，加上机器人和群聊用到的部门名）。项目自己的部门不算团队，不在列表里出现（团队地图以后也不显示它们，见设计第 3 节）。
- 能用：至少一个没归档的机器人；有负责人；负责人不是主机器人。不能用的原因只有三种：`empty`（没有机器人）、`no_chief`（没有负责人）、`main_bot_chief`（负责人是主机器人，只在迁移还没成功时会出现）。
- 判断写在一处（`server/team-projects/teams.ts`），新建项目窗口、主机器人的列表工具、提议和建项目都用它。

### 建项目

1. 检查项目名、根目录、重名，规则不变。
2. 按名字找到团队；不能用时拒绝，原因同上。
3. 用 `share.host.document({ scope: "department", ... })` 导出团队：不带对话、记忆、密钥、连接、审批等级；例行任务导出为暂停。只带每个机器人自己装的技能（`listSkills`，和原来存模板时一样），技能库里的技能和 MCP 清单都不带。
4. 用 `importPackageDocument` 导入，部门名就是项目名。导入时按导出给的"机器人 id → 角色标识"记下每个分身的原机器人：`teamProject.source`。
5. 原团队负责人的分身成为项目负责人（导出的 `team.leader` 就是它）。
6. 导入后立刻按原机器人同步一遍跟随的各项（名字按项目内加序号、职责、说明、人设、外观、模型）。导入器给的默认模型因此换成原机器人当前的模型。
7. 记入项目清单：`team: { key, name }`。`key` 是部门的记忆键（`sectionMemoryKey`，改名不变，删除部门后作废），`name` 是最近一次看到的部门名。
8. 任何一步失败，按现有的撤销栈全部撤回。

### 分身跟随

- 跟随的项：`name`、`title`、`description`、`soul`、`color`、`mascotExpression`、`mascotBody`、`mascotFaceColor`、`avatarUrl`、`avatarCrop`、`avatarZoom`、`avatarFocusX`、`avatarFocusY`、`modelSelection`。头像图片共用原机器人的那个文件（附件清理按所有机器人的 `avatarUrl` 保留，所以不会被删）。
- 触发：服务器的 `store.onChange`。原机器人每次改动，就把它所有跟随中的分身逐项比较，有不同才写。启动时也全部对一遍。名字在项目里重名时用现有的 `takeImportName` 加序号。
- 正在跑的一轮不受影响：只改机器人记录，下一轮读新值。模型用 `applyModelDefault`，和设置页改模型同一条路。
- 背景说明：原团队的说明改了（`section-contexts.json` 每 2 秒轮询一次，已有），复制到每个跟随这支团队的项目部门。项目部门的说明不能直接改。
- 不跟随：审批等级、负责人标记、技能、MCP、记忆、团队记忆。

### 原机器人不在了

- 原机器人被删除、归档、移出团队，或团队本身被删除：分身记下 `sourceLeft: true`，立刻停止跟随、可以编辑，并在"团队有变化"里列出，等用户决定。
- 这是一次性的：原机器人之后回到团队，旧分身也不会自己恢复跟随；它在列表里算"新成员"，用户可以再加一个分身。这样不会悄悄覆盖用户在中间改过的东西。
- 部门改名不算离开：团队按记忆键认。

### 团队有变化

- 新成员：团队里有、项目里没有跟随它的分身的机器人。
- 已离开：`sourceLeft` 的分身。
- 列在项目的 `teamChanges` 里，跟着项目列表发给界面。左侧项目行上有一个状态点，项目菜单里有"团队有变化…"，打开一个窗口逐项勾选：新成员默认勾选"加入"；已离开的成员选"移出项目"或"留下"（默认"留下"，不会误删）。
- 加入：单个机器人的共享导出（`scope: "bot"`）+ 不建部门的导入，导入时放进项目的部门并记下 `source`，然后同步一遍。
- 移出：现有的删除机器人（`store.deleteBot`），项目里的文件夹按现有做法移到 `.deleted`。
- 留下：去掉 `source` 和 `sourceLeft`，成为项目自己的成员。
- 提交时带上界面看到的那份变化；服务器只做仍然成立的项，其余跳过并说明。

### 以前按模板建的项目

- 记录里的 `template` 改为可选，照常读。没有 `team` 的项目没有原团队：成员都没有 `source`，不跟随，可以直接改，也没有"团队有变化"。
- 用旧记录起一次实例验证能打开。

### 分身只读

服务器拒绝对跟随中的分身改这几项（值和现在一样的不算改），话是"{bot} 跟随 {team} 的 {source}：去原团队改"：

- `PATCH /api/bots/:id`、`PATCH /api/bots/:id/profile`、`PATCH /api/bots/:id/model`、`POST /api/bots/:id/avatar/generate`、`PUT /api/bots/:id/soul`、`POST /api/bots/:id/soul/apply-file`、`POST /api/bots/:id/history/rollback`：在项目路由的拦截里（这一组路由要排到机器人设置路由前面）。
- 团队设定（`propose_team_setup`）：提议时和确认时都检查。
- `propose_profile`、`propose_model`：提议、确认、撤销时都检查。
- 项目部门的背景说明：`PUT /api/section-context` 对跟随团队的项目部门拒绝。

界面：分身的机器人面板顶部显示"跟随 {team} 的 {source}"和"打开 {source}"；名字、职责、说明、人设、外观、模型的编辑入口只读。

### 主机器人不进部门

- 拒绝的路径：`PATCH /api/bots/:id` 的 `section`、`POST`/`PUT /api/sidebar-sections`（团队地图拖动、团队成员窗口、新建部门）、团队设定（提议和确认）。都在项目服务的 `moveRefusal` 里加一条，话是"MagicBot 不属于任何部门"。界面上团队地图不让拖它进部门，设置页不给它选部门。
- 迁移：服务器启动、创建 `Store` 之前，读 `bots.json`。有主机器人（`defaultBot`、不在项目里）在部门里时：先把文件复制成 `bots.json.bak.<UTC 时间>`（0600），再原子地写回改好的列表，写一行日志。复制或写失败：不改任何东西，写一行日志，下次启动再试。没有要移的就什么都不做、不写日志。
- 负责人范围：主机器人移到一般区域（不属于部门）。如果它原来是那个部门的负责人，那个部门就没有负责人了。一般区域里没有别的负责人时，它保留负责人标记，成为一般区域的负责人；一般区域已经有另一位负责人时（用户选来代替 MagicBot 的），那位不动，主机器人去掉负责人标记和随之的"也负责"部门。这台电脑上主机器人的负责人能力（`chiefLevel`）本来就不靠这个标记，所以它能做的事不变。它管理的部门不扩大，也不把刚离开的部门加进去（否则可能变成"负责全部部门"，自动得到以后的新部门）。
- 团队设定里，主机器人可以任命负责人（原来只有带负责人标记的机器人可以），这样它能给新团队指定负责人。

### 主机器人的工具和提示词

- `list_team_templates` 改名 `list_project_teams`：列出能用的团队（名字、背景说明、负责人、每个成员的职责），不能用的也列出并写原因。内部路由改为 `/api/internal/project-teams`。
- `propose_team_project` 的参数改为 `name`、`team`（团队名）、`request`。卡片记下团队当时的样子（名字、负责人、成员和职责的指纹）；点"创建"时团队变了（成员、负责人、名字、职责）就拒绝，请它重新提议。旧的模板卡片点"创建"时拒绝，说明要重新提议。
- 提示词：没有合适的团队时，先用 `propose_team_setup` 提议建一支新团队，其中一位设为负责人；用户确认后再用 `propose_team_project`。主机器人不再看到 `create_bot`，服务器也拒绝它调用。
- 主机器人的团队设定（包括删除机器人）一律出确认卡片，不按"完全访问"直接执行（设计"已定的决定"：主机器人建团队、建项目都先出确认卡片）。
- 技能：主机器人始终列出技能库里启用的全部技能，不受 `FIT_MAX_SKILLS` 限制。

### 去掉的东西

- 去掉：设置里的"模板"页；机器人模板和团队模板的编辑窗口；"存为模板""从模板更新""存回模板""沉淀到模板"；模板库和模板同步的服务器代码、路由、共享类型、界面状态和它们的测试；建项目时按角色分配技能和 MCP（`template-role.ts`）；相关的语言键（所有语言一起删）。
- 保留："沉淀到技能库"按钮（从 `template-sync/deposit.tsx` 移到机器人设置的技能页旁，仍然打现有的 `POST /api/bots/:id/skills/:name/share`）；共享导出和团队文件导入；Team Cloud 的模板列表（`share-card.ts`、`server/team-templates.ts`、`cloud-team-templates`、`TemplateCard`、`ImportDialog`）。
- 数据目录里已有的模板文件（`<data>/templates/`）不动，也不再读。

## 约束

- `server/index.ts` 净增不超过 2 行；`server/store.ts`、`src/state/store.tsx`、`server/skills.ts` 不能变长；新文件不超过 1000 行；路由写法的计数不能增加（见 `scripts/testing/file-size-ratchet.test.ts`）。
- `store.ts` 不改：迁移在读文件之前做；跟随用现有的 `patchBot`、`patchBotProfile`、`applyModelDefault`。
- 注释只写代码说不出来的东西（`AGENTS.md`）。界面按 `DESIGN.md`：令牌颜色、`ui-modal` + `useModalDialog`、`t()`、句首大写。
- 新的英文句子要有简体和繁体中文；繁体用"發布"。

## 文件

| 文件 | 改动 |
|---|---|
| `shared/team-projects.ts` | 记录的 `team`、可选的 `template`；成员的 `source`、`sourceLeft`；`follows`、`teamChanges`；`ProjectTeamWire`；建项目参数 `team`；拒绝原因；角色标识的两个函数从 `shared/template-library.ts` 搬来 |
| `server/team-projects/registry.ts` | 读写新字段，旧记录照读 |
| `server/team-projects/teams.ts`（新） | 哪些部门能当团队、为什么不能；团队的指纹 |
| `server/team-projects/follow.ts`（新） | 跟随的项、要同步的改动、对分身的直接修改是否被拒 |
| `server/team-projects/team-changes.ts`（新） | 团队有变化：算出来、按用户的决定执行 |
| `server/team-projects/create.ts` | 从团队建项目 |
| `server/team-projects/service.ts`、`host.ts` | 接上跟随、离开、背景说明、拒绝、团队列表 |
| `server/routes/team-projects.ts` | `GET /api/team-projects/teams`、`POST /api/team-projects/:id/team-changes`；拦截分身和主机器人的修改 |
| `server/main-bot-department.ts`（新） | 启动时的迁移 |
| `server/team-setup-requests.ts`、`profile-requests.ts`、`model-requests.ts` | 一个"这项改动能不能做"的钩子；主机器人能任命负责人 |
| `server/team-project-proposal*.ts`、`server/drivers/agents-team-project-tools.ts`、`packages/phone-protocol/src/team-project-proposal.ts` | 面向团队的两个工具 |
| `server/chief-of-staff.ts`、`server/drivers/agents-catalog.ts`、`server/host/skills-library.ts` | 主机器人的提示词、不给 `create_bot`、全部技能 |
| `server/index.ts` | 接线；去掉模板库和模板同步；迁移；主机器人的团队设定不直接执行 |
| `src/components/team-projects/*` | 新建项目窗口列团队；"团队有变化"窗口；项目行的状态点和菜单项 |
| `src/components/bot-panel/*`、`src/components/bot-settings/*` | 分身的"跟随"提示和只读；"沉淀到技能库"按钮搬家 |
| 删除 | 模板库、模板同步的服务器和界面文件及测试；`server/team-projects/template-role.ts` |
| `src/locales/*.json`、`server/user-errors.ts` | 新句子；删掉的键从所有语言里删 |

## 接口

```ts
// shared/team-projects.ts
export interface TeamProjectRecord { /* … */ team?: { key: string; name: string }; template?: { id: string; name: string; version: number } }
export interface TeamProjectMembership { id: string; role: string; source?: string; sourceLeft?: true }
export interface TeamProjectWire extends TeamProjectRecord {
  folderState: "ready" | "missing"; botIds: string[];
  follows: Record<string, string>;          // 分身 id → 原机器人 id，只含跟随中的
  teamChanges?: TeamProjectChanges;          // 有变化时才有
}
export interface TeamProjectChanges { joined: TeamMemberWire[]; left: TeamMemberWire[] }
export type ProjectTeamUnusable = "empty" | "no_chief" | "main_bot_chief";
export interface ProjectTeamWire { name: string; context: string; chief: TeamMemberWire | null; members: TeamMemberWire[]; unusable?: ProjectTeamUnusable }
export interface CreateTeamProjectInput { name: string; team: string }
export interface TeamChangesInput { add: string[]; remove: string[]; keep: string[] }

// GET  /api/team-projects/teams              → { teams: ProjectTeamWire[] }
// POST /api/team-projects/:id/team-changes   → { project: TeamProjectWire; skipped: string[] }
```

## 任务

- [ ] **1. 去掉模板同步。** 菜单项、窗口、"沉淀到模板"、路由和服务器代码、语言键；"沉淀到技能库"搬家，测试跟着搬。
- [ ] **2. 从团队建项目。** 共享类型、项目清单、`teams.ts`、`create.ts`、新建项目窗口、主机器人的两个工具和卡片。测试：能用/不能用的团队、建出来的分身记着原机器人、负责人、模型、技能只带自己的、例行任务暂停、失败全部撤回、旧记录照读。
- [ ] **3. 去掉模板库。** 设置页、编辑窗口、"存为模板"、路由、服务器代码、`template-role.ts`、语言键。
- [ ] **4. 分身跟随。** `follow.ts` 和服务里的接线、背景说明。测试：改原机器人各项后所有分身同步、项目内重名加序号、原机器人删除/归档/移出/部门删除后停止跟随、部门改名照常跟随、启动时补齐。
- [ ] **5. 分身只读。** 路由拦截、团队设定、`propose_profile`、`propose_model`、背景说明；界面的提示和只读。
- [ ] **6. 团队有变化。** 算出、执行、窗口、菜单和状态点。
- [ ] **7. 主机器人不进部门。** 每条路径的拒绝、界面、启动迁移和它的测试（备份、日志、失败不改、负责人规则）。
- [ ] **8. 主机器人的提示词和能力。** 提议新团队的提示词、不给 `create_bot`、团队设定一律出卡片、能任命负责人、全部技能；工具清单的基准文件。
- [ ] **9. 文档和检查。** `docs/verification/team-access.md` 等提到模板的地方；类型检查、lint、i18n、行数检查、相关测试。
- [ ] **10. 测试实例验证和打包。**

## 怎么验证

- 单元测试：上面每个任务里列的。服务器测试用 `server/team-projects/testing.ts` 的整套安装和临时目录。
- 真服务器：改写 `server/team-project-wall-real-projects.e2e.test.ts`，从团队直接建两个项目，原来证明的隔离照样成立；`server/team-project-proposal.e2e.test.ts` 改成从团队提议。
- 测试实例（`scripts/control-omb.ts ui launch`，截图放 `/tmp/omb-block1-fixture/`）：同一团队的两个项目和记忆隔离；改原机器人的人设和模型、两个分身都变、直接改分身被拒；原团队加人后两个项目都提示、确认后才加；负责人是主机器人的团队和没有负责人的团队都不能选并写明原因；主机器人在部门里的数据目录启动后被移出、有备份和日志、其余不变；主机器人提议建项目、确认前什么都没建；"模板"页没了、旧记录的项目照常打开。

## 需要用户确认的决定

1. **项目的团队不出现在新建项目窗口里**（不是列出来再标"不能用"）。原因：项目可能很多，列出来只是噪音；设计第 3 节也说项目的团队不显示在团队地图里。服务器照样拒绝用项目的团队建项目。
2. **团队按部门的记忆键认，不按名字。** 原因：部门改名后项目仍然跟随；删除部门后再建一个同名部门，是另一支团队。
3. **原机器人离开后不自动恢复跟随。** 原因见上；回来的成员按"新成员"处理。
4. **"已离开的成员"默认"留下"。** 原因：移出会删机器人（文件夹移到 `.deleted`），不该是默认动作。
5. **主机器人和一般区域已有的负责人冲突时，已有的那位优先，主机器人去掉负责人标记。** 原因：那位是用户特意选来代替 MagicBot 的；主机器人的能力不靠这个标记。
6. **主机器人的团队设定和删除提议一律出卡片。** 原因：设计要求主机器人建团队先出确认卡片；删除比新建更不可逆，一并处理最简单。
7. **点"创建"时团队有任何变化（成员、负责人、名字、职责）都拒绝重提，人设和外观的变化不拒绝。** 原因：卡片上只显示前面这些；人设变了分身本来就会跟着变。

## 已知的不足

- 回到旧版本的应用时，新格式的项目记录（没有 `template`）读不出来，旧版本会不列项目、但不改文件。
- 背景说明的跟随最多晚 2 秒（沿用现有的轮询）。
- 原机器人的头像换了以后，旧图片文件只要还有分身在用就留着。
- 加入新成员时，原机器人所在的群聊不会带进项目（建项目时会）。
