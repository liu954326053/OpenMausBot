# 模板同步：实现计划（第 5 块）

日期：2026-11-20 · 设计：`docs/superpowers/specs/2026-11-20-projects-templates-skills-design.md` 第 6 节

**目标：** 给用户四个手动动作，在项目和它的团队模板之间搬动设定，每个都先列出会改什么、用户确认后才执行：

1. **从模板更新**：把团队模板的最新设定应用到一个已有项目。
2. **存回模板**：把项目当前的团队存成模板的新版本，或另存为新模板。
3. **沉淀到技能库**：把项目里机器人学到的一个技能加入全局技能库。
4. **沉淀到模板**：把机器人的一条记忆加入模板的初始记忆。

**核心：** “比较项目当前团队和模板”是纯函数，必须测全（人设/模型/技能/MCP 变了、角色新增、角色去掉、机器人改名、用户自己加的机器人、模板里被删掉的机器人）。四个动作共用一个小的“查看改动”复核组件。

## 这一块定下的细节

### 配对与方向

- 项目的机器人：`bot.teamProject.id === project.id` 的机器人。每个机器人带它的角色标识 `bot.teamProject.role`。
- 模板的角色：`readTeam(id)` 返回的 `document.package.agents`，角色标识是 `agent.key`，额外设定在 `extras[key]`。
- **按角色标识配对**（不是按名字）。所以改了名字的机器人仍然配对到它原来的角色，不会被当成“去掉一个、新增一个”。
- 模板有、项目没有这个角色标识 → **新增**（可能是模板新加的角色，也可能是这个角色的机器人被删过）。
- 项目有、模板没有这个角色标识 → **去掉**（用户自己给项目加的机器人，模板里没有）。

### 比较哪些设定（配对上的角色）

对配对上的角色，比较并在“从模板更新”里应用这四项，机器人的**记忆和名字都不动**：

| 项 | 模板这边取值 | 机器人这边取值 | 规则 |
|---|---|---|---|
| 人设 soul | `agent.soul ?? ""` | `bot.soul ?? ""` | 文本不同即变化；应用时写成模板的值 |
| 模型 model | `extras.model`（可为空） | `bot.modelSelection` | **仅当模板指定了模型**才比较和应用；模板没指定就不动机器人的模型 |
| 技能 librarySkills | `extras.librarySkills`（技能库里的技能名） | `bot.assignedSkills` | 集合不同即变化；应用时替换成模板的集合（不碰机器人自己学到的技能） |
| MCP mcpServers | `extras.mcpServers`（可为空=用所有已开启的） | `bot.mcpServers`（空=所有已开启的） | 两边都空视作相同；一边空一边有列表视作不同；都有列表按集合比较 |

名字只用于在界面上标识角色（“角色 X（机器人：Y）”），不参与“要应用的改动”，也不被应用改写。改名的机器人因此落在“配对上、无设定改动”里。

### 从模板更新（动作 1）

- 先 `GET …/update-preview` 得到比较结果（差异 + 版本号）。界面用复核组件列出：哪些角色的哪几项变了、哪些角色新增、哪些去掉。
- 用户确认后 `POST …/update`：
  - 只对**配对上且有设定改动**的角色应用（复用 `projects` 导出的“把一个角色的设定应用到机器人”的函数，不另写一份）。
  - **新增/去掉的角色这一版只列出、不自动建/删机器人**：建机器人属于 `projects` 的建项目流程，删机器人会动到记忆（规范里记忆绝不动，且“把机器人移入/移出项目”这一版不做）。见“需要用户确认的决定”。
  - **原子性**：应用前先读下每个要改的机器人的当前设定做回滚快照；逐个应用，任一步抛错就把已应用的回滚回去，并且**不记版本**。全部成功后才把项目的 `template.version` 记成模板当前版本。
  - 记忆不动：应用函数只写人设/模型/技能/MCP。

### 存回模板（动作 2）

- 两种模式：
  - `version`：把项目的部门（`project.section`）存成**它的模板的下一个版本**（`templateId = project.template.id`）。成功后把项目的 `template.version` 记成新版本（项目当前团队即这个版本）。
  - `new`：把项目的部门另存为**新模板**（用 `TemplateLibraryEditor.saveFromDepartment`，已发布）。项目的模板引用**不改**（项目仍指向原模板）。
- 复核组件显示：存成哪个模板、版本从几到几（version 模式），或新模板的名字（new 模式）。

### 沉淀到技能库（动作 3）

- 现有能力：`server/skill-share.ts` 的 `shareLearnedSkill` 会把一个机器人学到（来源 `learn:`）的技能装进技能库并分享给同组同事；路由 `POST /api/bots/:id/skills/:name/share`（`shareFromBot`）已存在，但**受自动分享开关 `shareLearnedSkills` 门控，且界面上没有入口**。
- **缺的是用户自己的入口**：在“机器人学到的技能”列表（`src/components/bot-settings/SkillsSection.tsx`）里，给学到的技能加一个“沉淀到技能库”按钮，先用复核组件说明会发生什么，确认后调用。
- **最终复用现成路由**：客户端 `depositSkillToLibrary(botId, name)` 直接打现成的 `POST /api/bots/:id/skills/:name/share`（`shareFromBot`，装进技能库并分享给同组同事），**不新增** `…/skills/deposit` 路由，契合“只补缺的入口、不写第二份”。入口按钮据 `skillsLibraryEnabled` 且技能来源为私有（学到的）门控。

### 沉淀到模板（动作 4）

- 在机器人的记忆列表（`src/components/bot-settings/MemorySection.tsx`）里，给一条记忆（`MEMORY.md` 或 `memory/<主题>.md`）加“沉淀到模板”入口。
- `POST /api/template-sync/memory/deposit`，内容 `{ botId, path }`：服务端按 `bot.teamProject` 找到项目和角色标识，把这条记忆的内容加进**项目模板里这个角色的初始记忆**（复用 `templates` 提供的写入方法）。非项目机器人拒绝。

## 约束

- `server/index.ts` 最多 2 行（注册路由）。本分支的依赖（`projects` 的注册表与应用函数、`templates` 编辑器的新方法）发布前不接线，接线那 2 行在报告里写清，由集成步骤或依赖发布后补上。
- 新代码放新文件，每个文件不到 1000 行；不碰行数到顶的文件。
- 界面遵守 `DESIGN.md`：只用现有颜色、按钮、对话框样式（照 `SkillReviewDialog`/`ConflictNotice`）；文字走 `t()`；不新增 `window.confirm`，复核即确认。
- 新文字只加新键：应用键放在 `automations.back` 之后；`serverError.*` 放在 `serverError.pair.linkExpired` 之后（en/zh/zh-tw/pt-br 四个文件 + `server/user-errors.ts`）。组件在 `src/components/template-sync/` 和 `bot-settings` 下，不属于 `settings` 目录，所以不要求 15 种语言。
- 契约文件只读不改（`shared/team-projects.ts`、`shared/template-library.ts`）；需要别人的能力时按接口注入、用假实现测。

## 依赖与约定（发布前用假实现，发布后合标签）

```ts
// 来自 projects（未发布）：把一个角色的设定应用到一个已存在的机器人
export interface ApplyRoleToBot {
  (botId: string, settings: AppliedRoleSettings): void;   // 人设/模型/技能/MCP，不动记忆和名字
}
// 来自 projects（已约定 TeamProjectsApi.list）+ 记录项目用到的模板版本
export interface TemplateSyncProjects {
  find(projectId: string): ProjectForSync | undefined;    // 项目记录 + 它的机器人（含 role、当前设定）
  recordTemplateVersion(projectId: string, version: number): void;
  applyRole: ApplyRoleToBot;
  readRole(botId: string): AppliedRoleSettings;            // 回滚快照用
}
// 来自 templates：readTeam 已发布；存回新版本、写初始记忆未发布
export interface TemplateSyncTemplates {
  readTeam(id: string): TeamTemplateContent | null;
  saveDepartmentAsVersion(department: string, templateId: string): TeamTemplateSummary;  // 存成已有模板的下一版
  saveDepartmentAsNew(department: string): TeamTemplateSummary;                           // = saveFromDepartment
  addStarterMemory(templateId: string, roleKey: string, entry: string): TeamTemplateSummary;
}
// 来自 skills host（已存在）
export interface TemplateSyncSkills {
  depositLearned(botId: string, name: string): SkillShareRecord | { error: string };     // = shareFromBot
}
```

集成步骤把这些接到 `server/index.ts` 里现成的 `templateLibrary`、`projects` 注册表、`projects` 的应用函数、`skillsHost.shareFromBot`。

## 文件

| 文件 | 改动 |
|---|---|
| `shared/template-sync.ts`（新） | 线路类型：比较结果、改动字段、各动作的请求/响应体 |
| `server/template-sync.ts`（新） | 纯比较与快照转换；差异计算 |
| `server/template-sync-service.ts`（新） | 依赖接口 + 更新/存回/两个沉淀的编排（原子、回滚、记版本） |
| `server/routes/template-sync.ts`（新） | HTTP 路由（owner/admin） |
| `server/index.ts` | 集成接线 2 行（报告里给出，依赖就绪后加） |
| `server/user-errors.ts` | 拒绝用的 `serverError.templateSync.*` |
| `src/lib/template-sync.ts`（新） | 客户端请求 + 把差异格式化成复核用的文字 |
| `src/components/template-sync/**`（新） | 复核组件、两个项目屏幕、两个沉淀入口、打开函数 |
| `src/components/bot-settings/SkillsSection.tsx` | 一行：插入“沉淀到技能库”入口 |
| `src/components/bot-settings/MemorySection.tsx` | 一行：插入“沉淀到模板”入口 |
| `src/locales/{en,zh,zh-tw,pt-br}.json` | 新文字 |

## 任务（每个先写测试）

- [x] 1. 线路类型与纯比较：`compareTeam` 全方向；取用设定转换（15 测）。
- [x] 2. 编排：更新（复用 `applyTemplateRole`、失败不记版本、记忆不传）、存回（两模式）、沉淀记忆——用假依赖（12 测）。
- [x] 3. 路由：`template-sync.ts` 路由，小 http 服务 + 假依赖测（5 测）。
- [x] 4. 客户端库与复核组件：请求封装、差异格式化（`summarizeDiff`）逻辑（5 测）。
- [x] 5. 四个入口与两个屏幕；插入 Skills/Memory 两个列表页。
- [x] 6. 文字（en/zh/zh-tw/pt-br）。
- [x] 7. 验证：类型、lint、i18n、相关测试（37）、文件行数全绿；独立实例证据见“怎么验证”。

## 怎么验证

- 纯比较与编排：单元测试覆盖全方向与原子性。
- 路由：集成测试（真起一个小 http 服务，注入假依赖）。
- 复核组件/屏幕：逻辑测试。
- 独立实例：能证的部分（如已存在的技能分享路径）。`projects` 发布建项目与应用函数后，合并并走通整条路：建项目→改模板→从模板更新→看人设变、记忆不变→改机器人→存回新版本→看版本号变化。分支内证不了的清楚写明。

## 需要用户确认的决定

1. **“从模板更新”不自动建/删机器人。** 问题：模板新增/去掉了角色时要不要在项目里自动建或删机器人？选择：只列出、不自动建/删。原因：删机器人会动到记忆（规范：记忆绝不动），“把机器人移入/移出项目”这一版不做；建机器人属于 `projects` 的建项目流程。改动成本：低（以后在编排里加一步调用 `projects` 的建/删即可）。
2. **人设、模型、技能、MCP 是“替换”语义。** 问题：应用更新时是并入还是替换？选择：人设直接写成模板的值；技能/MCP 用模板的集合替换；模型仅当模板指定时替换。原因：“把模板的最新设定应用到项目”最自然的理解是让它与模板一致。改动成本：中（若要改成并入，改比较与应用两处）。
3. **模板没指定模型时不动机器人的模型。** 问题：模板 `extras.model` 为空算不算“要改成默认模型”？选择：不算，模型不参与比较也不应用。原因：模板没有这项设定可应用；建项目时“没指定就用默认”只发生在新建那一刻。改动成本：低。
4. **“存回为新模板”不改项目的模板引用。** 问题：另存为新模板后，项目是否改指向新模板？选择：不改，项目仍指向原模板；只有“存回为新版本”才记版本。原因：另存是复制一份备用，不是迁移项目。改动成本：低。
5. **“沉淀到技能库”复用现成 `/share` 路由，不新增路由。** 最终决定：服务端能力（装库 + 分享给同事，含“可见范围更广的同事不会拿到”的安全不变量）已存在，缺的只是用户入口。按钮门控在 `skillsLibraryEnabled` 且技能来源私有（学到的）。原因：契约“只补缺的入口，不写第二份”。改动成本：低。
6. **沉淀到模板会让模板版本+1（由 `templates` 的写入决定），不改项目记录的版本。** 原因：这是对模板的编辑，项目直到下次“从模板更新”才受影响。改动成本：低。

## 集成接线（最终实现，供集成步骤）

真实依赖都已在 `server/index.ts` 作用域内（`templateLibrary`、`teamProjects`、`store`、角色应用 host）。接线分两头。

### 服务端：2 行进 `server/index.ts`

把适配器放在单独文件（如 `server/template-sync-host.ts`），让 `server/index.ts` 只加 2 行：

```ts
const templateSyncRoutes = createTemplateSyncRoutes(buildTemplateSyncDeps({
  teamProjects, templateLibrary, store, roleHost, workspace,
}));
// 再把 templateSyncRoutes 放进 dispatchRoutes 的路由数组
```

`buildTemplateSyncDeps`（适配器）把 `TemplateSyncDeps`（`server/template-sync-service.ts`）每一项接到现成能力：

| dep | 接到 |
|---|---|
| `project(id)` | `teamProjects.api.list()` 按 id 找记录；`bots` 由该项目的 **`botIds`**（集成 22:23：读 `TeamProjectWire.botIds`，别读 `bot.teamProject`）经 `store.getBot` 映射成 `BotSettingsSource {id,name,soul,modelSelection,assignedSkills,mcpServers,teamProject}` |
| `readTemplate(id)` | `templateLibrary.readTeam(id)` |
| `applyRole(botId, role)` | `applyTemplateRole(botId, role, roleHost)`，`roleHost = { store, skills:{ setEnabled }, librarySkillNames }`（projects-1 导出） |
| `setTemplate(projectId, { id, name, version })` | `teamProjects.api.setTemplate`（lab-contract-projects-4，**已合入本分支**）。更新后传 `content` 的 `{ id, name, version }`，存回新版本后传 saved 的 `{ id, name, version }`；“另存新模板”不调用（不改项目的模板引用）。`projects.json` 单写者由此满足 |
| `saveDepartmentAsVersion(dept, id)` | `templateLibrary.saveFromDepartment(dept, id)` |
| `saveDepartmentAsNew(dept)` | `templateLibrary.saveFromDepartment(dept)` |
| `addStarterMemory(id, role, entry)` | `templateLibrary.addStarterMemory("team", id, role, entry)`（返回 void），随后 `templateLibrary.teamTemplate(id)` 读新版本，拼成 `SavedTemplate` 返回 |
| `projectBot(botId)` | `teamProjects.api.list()` 找 `botIds` 含该 bot 的项目，角色取该 bot 的 `teamProject.role` |
| `readMemory(botId, path)` | `server/workspace.ts` 读该 bot 工作区内 `path` 的记忆文件（项目机器人的文件在 `<project>/.magic-team/bots/<role>/`，见 workspaces 公告） |

路由（都在 `server/routes/template-sync.ts`，POST，owner/admin 门控，拒绝走 `serverError.templateSync.*`）：
`POST /api/template-sync/projects/:id/update/preview` → `TemplateUpdatePreview`；`…/update` → `TemplateUpdateResult`；`…/save-back`（`{ mode }`）→ `SaveBackResult`；`POST /api/template-sync/memory/deposit`（`{ botId, path }`）→ `{ id, name, version }`。动作 3 无新路由。

### 客户端：挂一次 host + 菜单接两个打开函数

- 在应用树挂一次 `<TemplateSyncHost/>`（和其它命令式弹窗一起，如 `BotLimitModal` 的挂点）。
- 在项目（部门）菜单接：
  - 「从模板更新」→ `openUpdateFromTemplate(project.id, project.name)`
  - 「存回模板」→ `openSaveBackToTemplate(project.id, { projectName: project.name, templateName: project.template.name })`
- 两个「沉淀」入口已就位、无需接线：`SkillsSection` 技能行（`skillsLibraryEnabled` 且技能私有/学到的时显示）、`MemorySection` 打开文件的标题栏（非只读文件时显示）。

### 与计划的差异（已决定）

1. 动作 3 复用现成 `/share` 路由，不新增路由。
2. 不做快照+回滚：`applyTemplateRole` 改的字段多于本块比较的四项，忠实回滚要复制它的映射，故改为逐个机器人应用、任一抛错即 `applyFailed` 且**不记版本**（测试断言失败不记版本）。跨机器人“全有或全无”需在 `applyTemplateRole` 外包事务，超出本块，作为集成注记。
3. 版本记录已接 projects-4 的 `teamProjects.api.setTemplate`（本分支已合 lab-contract-projects-4），无剩余接线阻塞点；集成只剩 `server/index.ts` 的 2 行 + 客户端挂 host、接菜单。
