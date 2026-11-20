# 项目在界面里：左侧、新建项目、项目根目录、归档（第 3 块的界面部分）

日期：2026-11-20 · 设计：`docs/superpowers/specs/2026-11-20-projects-templates-skills-design.md` 第 4 节的“项目根目录”“建项目的步骤”“左侧”“归档”

**目标：** 左侧在主 bot 和收件箱下面列出项目，每个项目展开是它的团队；可以手动新建项目、归档项目；在“设置 → 数据”里设置项目根目录、恢复归档的项目。

**做法：** 只做界面，不加服务端代码。接口和类型定在 `shared/team-projects.ts`、`shared/template-library.ts` 和章程里，界面照着它们写，测试里用固定的应答。项目的团队沿用部门现有的画法（同一个标题组件、同一个机器人行、同一个群聊行），不另写一套列表。

## 这一块定下的细节

**左侧**

1. **位置。** 主 bot 和收件箱在最上面，不变。下面是项目，一个项目一行；项目列表末尾是“新建项目”；再下面是现有的部门，不变。
2. **项目的团队。** 负责人在最前（带皇冠），成员按服务端给的顺序排在后面，项目部门里的群聊排在最后。
3. **谁算项目的成员。** 服务端列在 `botIds` 里的机器人，加上部门名等于项目部门名的机器人和群聊。这样不会有哪个机器人两边都不出现。正在创建的项目，它的部门和机器人在服务端答复之前就先不算进部门里。
4. **项目的部门不再出现在部门里。** 部门列表、机器人菜单的“移到部门”、部门的“添加机器人”、“创建部门”里都不列出项目的部门和项目里的机器人。这一版不做“把已有的机器人移入或移出项目”。
5. **项目里的机器人不能拖动。** 不能在项目里拖动排序，也不能拖进拖出项目。
6. **置顶的项目机器人**照常出现在置顶的位置，同时仍然留在项目的团队里。
7. **展开和收起**用部门现有的那一套，按设备记住，默认展开。收起的项目和部门一样带“有新消息”的标记。
8. **找不到项目文件夹**（`folderState: "missing"`）：项目名下面多一行带图标的“找不到项目文件夹”，收起时这一行也在；团队变淡。对话仍然可以点开看。发消息时服务端会拒绝，对话上方出现服务端的那句话（`workspaces` 那一块的），消息留在输入框里。
9. **归档**在项目的“…”菜单里（右键也能打开）。不弹确认。归档后底部出现“已归档 … · 撤销”，6 秒。当时正开着这个项目里的对话，就切到主 bot；点“撤销”时如果还停在主 bot，就回到原来的对话。
10. **归档的项目**连同它的机器人、群聊、部门都不在左侧出现。
11. **窄的图标栏**里没有标题行：每个项目的团队是一组头像，组与组之间一条分隔线；找不到文件夹的那组前面有一个文件夹图标，整组变淡；“新建项目”是一个“+”按钮。图标栏里没有项目菜单。
12. **搜索时**：搜到项目名，显示它的整个团队；搜到机器人，显示它所在的项目和匹配的机器人。搜索时不显示“新建项目”。
13. **简单模式**下项目标题和部门标题是同一种细标题，鼠标移上去、键盘聚焦或触屏时显示“…”。一旦列出了项目，不属于任何部门的机器人上面会出现“机器人”这个标题，用来和项目分开。
14. **没有项目时**只有一行不显眼的“新建项目”。
15. **服务端没有项目接口**（旧的服务端答 404），或者这台设备无权读取（403）时，左侧什么都不多显示，也不再去问。
16. **这个 app 在操作另一台电脑时**（远程客户端），项目照常显示，但不能在这里新建和归档：项目建在那一台电脑上。

**新建项目的窗口**

17. **内容。** 项目名称；团队模板；将要新建的文件夹（`<项目根目录>/<项目名称>`，随输入变化）；“创建项目”。
18. **团队模板**是一个带边框的单选列表，每行是名称、题材、“负责人：X · 成员：A、B”，选中的一行右边有勾。只有一个模板时自动选中；有多个时不预选。上下方向键在模板之间移动并选中。
19. **什么时候能点“创建项目”。** 填了名称就能点。没选模板就点，模板列表下面出现“请先为这个项目选一个团队模板。”，键盘焦点落到列表上；这时不去问服务端。
20. **被拒绝时**按 `code` 显示一句话，放在出问题的那一项下面：名称的问题（`bad_name`、`name_taken`、`folder_exists`）在名称下面，模板的问题（`no_template`）在模板下面并重新读模板，根目录的问题（`no_root`、`root_missing`）在文件夹下面并带“打开设置”，`failed` 和没有 `code` 的拒绝在按钮上方，显示服务端自己的话（只有服务端知道有没有留下东西）。名称不能当文件夹名时在本地就拦下，不问服务端。
21. **建好之后**选中负责人的对话并关掉窗口。模板里提到、技能库里没有的技能不为空时，窗口不关，改成“… 已建好”，列出这些技能的名字，一个“完成”按钮。
22. **没有项目根目录**时窗口只说明这件事，给一个“打开设置”按钮去“设置 → 数据”。**没有团队模板**时同样，按钮去“设置 → 模板”（页面编号 `templates`，`templates` 那一块公布的）。读模板失败时说明并给“重试”。
23. **键盘。** 打开时焦点在名称里；Tab 不会跑出窗口；Esc 关闭；创建中不能关，也不能再点一次；关闭后焦点回到打开它的“新建项目”。

**设置 → 数据**

24. 最上面加一组“项目”：一行“项目根目录”。桌面版（并且不是在操作另一台电脑）用系统的选文件夹窗口，当前路径显示在按钮旁边；其他情况是一个输入框加“保存”，路径只在输入框里显示一次。还没有设置时写“还没有设置”。
25. 服务端拒绝时把它的话显示在这一行下面；用选文件夹窗口选的文件夹被拒绝时，连同被拒绝的路径一起显示，免得看成是当前的根目录有问题。
26. 下面一组“已归档的项目”，始终显示：每个项目一行，有名称、文件夹、找不到文件夹时的提示和“恢复”，最近归档的在前；没有归档的项目时是一行说明。恢复最后一个之后，键盘焦点落在这行说明上。
27. 设置里的搜索能搜到“项目根目录”和“已归档的项目”。

**什么时候重新读项目列表**

28. 机器人的集合或部门的集合变了；自己建、归档、恢复、改根目录之后；窗口重新得到焦点；打开新建项目的窗口和“设置 → 数据”时。第一次读取不等待。之后没有人要求的读取（机器人变了、窗口得到焦点）在页面不可见时等到页面可见再发，和这个 app 其他的后台请求一样；用户自己的改动引起的读取立刻发。旧的答复不会盖掉更新的改动。

## 约束

- `src/components/Sidebar.tsx`（上限 1674 行，现在 1666 行）和 `src/state/store.tsx` 一行都不能加（`scripts/testing/file-size-ratchet.test.ts`）。左侧的新内容都在新文件里；项目的状态是自己的小 store，不进 `store.tsx`。
- `Sidebar` 的测试是把组件当普通函数调用的，只替换了几个 hook。`Sidebar` 函数体里新加的 hook 只能是 `useSyncExternalStore`。
- 界面遵守 `DESIGN.md`：只用现有的颜色、字号、圆角和组件；所有文字走 `t()`；不新增确认弹窗，用“撤销”。
- 新文字都放在各语言文件里 `sidebar.nav.teamFiles` 后面的一块。设置页用到的 13 个键 16 个语言文件里都有；其余的键有英文、简体、繁体、葡萄牙语，一共 44 个键。
- 不改 `shared/team-projects.ts` 和 `shared/template-library.ts`，`server/index.ts` 加 0 行。
- 验证用独立的测试实例，不动用户正在用的数据。

## 文件

| 文件 | 内容 |
|---|---|
| `src/lib/team-projects-api.ts`（新） | 六个接口的带类型的调用；被拒绝时取出 `code` 和服务端的话 |
| `src/lib/team-projects.ts`（新） | 纯逻辑：哪些项目列出来、谁是成员、团队的顺序、从部门里去掉什么、文件夹路径怎么拼、拒绝的 `code` 对应哪句话和哪一项、模板的负责人和成员、什么变了要重读 |
| `src/state/team-projects.ts`（新） | 项目列表的小 store 和 hook：读取、重新读取、建项目、归档、恢复、设置根目录 |
| `src/components/team-projects/SidebarTeamProjects.tsx`（新） | 左侧的项目列表：项目行、团队、“新建项目”、菜单、撤销提示 |
| `src/components/team-projects/NewTeamProjectDialog.tsx`（新） | 新建项目的窗口 |
| `src/components/team-projects/where-in-settings.ts`（新） | 句子里怎么称呼设置的某一页（“设置 → 数据”“设置 → 模板”） |
| `src/components/settings/TeamProjectsSettings.tsx`（新） | “设置 → 数据”里的两组 |
| `src/components/Sidebar.tsx` | 分组前去掉项目的机器人、群聊和部门；主 bot 下面画项目列表。比原来少 8 行 |
| `src/components/SidebarSectionHeader.tsx` | 高级模式的标题也能带“…”菜单按钮；菜单按钮的名字可以由调用方给（`menuLabel`） |
| `src/components/bot-sections.ts`、`SidebarBotMenu.tsx`、`SidebarSectionPicker.tsx`、`TeamDialog.tsx` | 不把项目的部门和项目里的机器人列进“移到部门”“添加机器人”“创建部门” |
| `src/components/settings/pages/DataPages.tsx` | 接上“项目”两组 |
| `src/components/settings/settings-index.ts`、`shared/settings-places.ts`（生成的） | 设置搜索里的两行 |
| `src/locales/*.json` | 新文字 |
| 以上各文件旁边的 `*.test.ts` | 逻辑和组件的测试 |

## 接口

```ts
// src/lib/team-projects-api.ts
export const listTeamProjects: (init?: { background?: boolean; signal?: AbortSignal }) => Promise<TeamProjectsListWire>;
export type CreateTeamProjectOutcome =
  | { project: TeamProjectWire; missingSkills: string[] }
  | { refused: TeamProjectRefusal | null; error: string }; // null：服务端的拒绝没有带这个 app 认识的 code
export function createTeamProject(input: CreateTeamProjectInput): Promise<CreateTeamProjectOutcome>;
export const archiveTeamProject: (id: string) => Promise<TeamProjectWire>;
export const restoreTeamProject: (id: string) => Promise<TeamProjectWire>;
export function saveTeamProjectsRoot(path: string): Promise<{ root: string } | { error: string }>;
export const loadTemplateLibrary: () => Promise<TemplateLibraryWire>;

// src/lib/team-projects.ts
export function teamProjectSide(list: TeamProjectsListWire | null, creating?: string | null): TeamProjectSide;
export interface TeamProjectSide {
  shown: boolean;                                   // 列表已读到；服务端没有项目接口时一直是 false
  root: string | null;
  projects: TeamProjectWire[];                      // 左侧列出的：没有归档的，按服务端的顺序
  archived: TeamProjectWire[];                      // 最近归档的在前
  bots<T extends SideBot>(bots: T[]): T[];          // 部门那边还要画的机器人
  rooms<T extends SideRoom>(rooms: T[]): T[];       // 部门那边还要画的群聊
  department(name: string): boolean;                // 这个部门名是不是普通部门
  of(bot: SideBot): TeamProjectWire | undefined;    // 这个机器人属于哪个项目
  team<T extends SideBot>(project: TeamProjectWire, bots: T[]): T[];   // 负责人在前
  teamRooms<T extends SideRoom>(project: TeamProjectWire, rooms: T[]): T[];
}
export const teamProjectSectionId: (projectId: string) => string;   // 收起状态用的编号
export function teamProjectFolder(root: string, name: string): string;
export type RefusalPlace = "name" | "template" | "folder" | "form";
export const isTeamProjectRefusal: (code: unknown) => code is TeamProjectRefusal;
export const refusalPlace: (code: TeamProjectRefusal | null) => RefusalPlace;
export const refusalKey: (code: TeamProjectRefusal) => LocaleKey;
export function templateTeam(team: Pick<TeamTemplateSummary, "lead" | "roles">): { lead: TemplateRoleSummary | undefined; members: TemplateRoleSummary[] };
export function teamProjectsVersion(bots: ReadonlyArray<{ id: string; hidden?: boolean }>, sections: readonly string[] | undefined): string;

// src/state/team-projects.ts
export const useTeamProjectSide: () => TeamProjectSide;
export const currentTeamProjectSide: () => TeamProjectSide;
export function refreshTeamProjects(init?: { background?: boolean }): Promise<void>;
export function useTeamProjectsLoader(version: string): void;      // version 用 teamProjectsVersion 算
export function createProject(input: CreateTeamProjectInput): Promise<CreateTeamProjectOutcome>;
export const archiveProject: (id: string) => Promise<TeamProjectWire>;
export const restoreProject: (id: string) => Promise<TeamProjectWire>;
export function saveProjectsRoot(path: string): Promise<{ root: string } | { error: string }>;
export function setTeamProjects(next: TeamProjectsListWire | null): void;   // 测试和预览用

// src/components/bot-sections.ts
export function useMayMoveBot(bot: Pick<Bot, "id" | "section"> | undefined): boolean;   // 项目里的机器人没有“移到部门”
export function useOpenDepartments(state: Pick<AppState, "sections" | "bots" | "groups">): string[];   // 不含项目的部门

// src/components/team-projects/
export function SidebarTeamProjects(props: { side; all; found; query; sections; mode: SidebarTeamProjectsMode; botRow; roomRow; onError }): ReactNode;
export function NewTeamProjectDialog(props: { onClose: () => void }): ReactNode;
export const dataSettingsPlace: () => string;          // “设置 → 数据”
export const templatesSettingsPlace: () => string;     // “设置 → 模板”

// src/components/settings/TeamProjectsSettings.tsx
export function TeamProjectsSettings(): ReactNode;
```

## 和其他几块怎么接

- **`projects`（服务端）**：六个接口照章程。合并 `lab-contract-projects-9` 之后，这条分支上跑的就是真的接口。
- **`templates`**：新建项目的窗口读 `GET /api/template-library`；没有团队模板时打开设置的 `templates` 页，页面名字用它自己的 `settings.page.templates`。
- **`workspaces`**：文件夹找不到或项目已归档时，给项目里的机器人发消息会被服务端拒绝，那句话由对话现有的错误条显示，界面这边没有加东西。
- **`lead-bot`**：主 bot 建好项目后，机器人和部门的集合变了，左侧会自己重读项目列表，不需要另外通知。
- **`template-sync` / `integration`**：`integration` 在它的分支上往项目菜单里“归档”的上面加了一行 `<TemplateSyncMenuItems …/>`，并改了 `SidebarTeamProjects.dom.test.ts` 里两处菜单项的列表。这条分支没有再动菜单那几行。
- **合并时**：`shared/settings-places.ts` 是生成的，有冲突就重新跑 `node --experimental-strip-types scripts/gen-settings-places.ts`，不要手改。

## 任务

每个任务先写测试，看它失败，再实现，再跑通。

- [x] **1. 接口调用。** 六个调用；建项目被拒绝时把 `code` 和服务端的话取出来。
- [x] **2. 纯逻辑。** 列出和归档的划分、成员、顺序、从部门里去掉的东西、文件夹路径、拒绝对应的话。
- [x] **3. store。** 读取和“再读一次”、服务端没有接口时不再问、自己的改动立刻反映、焦点和版本变化时重读、第一次读取不等待。
- [x] **4. 左侧。** `Sidebar.tsx` 不加行的接入；项目行、团队、找不到文件夹、图标栏、搜索、没有项目；“移到部门”“添加机器人”“创建部门”不再列出项目。
- [x] **5. 菜单、归档和撤销。**
- [x] **6. 新建项目的窗口。** 可以创建、名称被拒绝、没选模板、没有根目录、没有模板、读模板失败、建好后缺技能、键盘。
- [x] **7. 设置 → 数据。** 根目录（选文件夹和输入路径两种）、服务端的拒绝、归档的项目和恢复；设置搜索。
- [x] **8. 文字。** 英文、简体、繁体、葡萄牙语；设置页用到的键 16 个语言文件都有。
- [x] **9. 验证。** 见下。

## 怎么验证

- `pnpm -s typecheck`、`pnpm -s lint`、`pnpm -s i18n:check`、行数检查、改过的文件和它们旁边的测试、`src/locales` 的测试。
- 在独立的测试实例上（`scripts/control-omb.ts ui launch`）。原来的打算是把 `/api/team-projects*` 和 `/api/template-library` 的 `fetch` 换成固定的应答；合并了 `projects` 和 `templates` 发布的版本之后，分支里就有真的接口，所以实际是用真的接口、真的模板、真的项目和磁盘上真的文件夹做的。截图逐张看过：
  - 左侧有两个项目，展开和收起，其中一个的文件夹被挪走（显示“找不到项目文件夹”）；
  - 项目的菜单、归档、“撤销”提示、撤销；
  - 新建项目的窗口：可以创建、没选模板、名称重名、名称不能当文件夹名、文件夹已存在、没有根目录、没有模板、建好后缺技能；
  - 设置 → 数据：路径被拒绝、保存成功、归档的项目和恢复；
  - 中文；简单模式和高级模式；图标栏；最小的窗口（760×520）；深色和浅色；很长的项目名；搜索；只用键盘。
- 证明不了的：系统的选文件夹窗口（测试实例是浏览器，只能用假的 `window.ogb.pickFolder` 看这一种界面）；归档后例行任务暂停（服务端的事）。

## 需要用户确认的决定

1. **项目默认展开还是收起？**
   选了：默认展开，和部门一样；收起了哪些按设备记住。
   原因：和部门一致，新建的项目一眼能看到团队。
   以后改：很容易，一处判断。

2. **项目在左侧怎么排序？**
   选了：按服务端清单的顺序，也就是创建的先后，新项目在最后，挨着“新建项目”。不能拖动。
   原因：规格没有要求排序，最简单的做法最不容易出错。
   以后改：加拖动排序要另做一块，顺序还得存到服务端。

3. **置顶了项目里的机器人，它出现在哪里？**
   选了：置顶的位置照常出现，同时仍然留在项目的团队里。
   原因：部门现在的做法是置顶后从部门里消失；项目的团队如果缺了负责人，容易以为它不见了。
   以后改：很容易，一处判断。

4. **找不到项目文件夹时，还能不能点开团队的对话？**
   选了：能。项目名下面写“找不到项目文件夹”，团队变淡，但可以点开看以前的对话；发消息时服务端拒绝，并说明原因。
   原因：硬盘没接上时，用户多半还想翻以前说过什么。
   以后改：很容易，改成点不动只是加一个属性。

5. **归档后正开着的对话怎么办？**
   选了：正开着这个项目里的对话时，切到主 bot；点“撤销”时如果还停在主 bot，就回到原来的对话。
   原因：归档后这个项目在左侧已经没有了，留在一个左侧找不到的对话里会让人糊涂。
   以后改：很容易。

6. **“设置 → 数据”是高级模式才有的页面。**
   选了：照规格把项目根目录放在“数据”页。简单模式下从新建项目的窗口点“打开设置”，会像现有的其他入口一样自动切到高级模式。
   原因：规格写明在“数据”页。
   以后改：很容易，把这一组挪到简单模式也有的页面只是换一处。

7. **有多个团队模板时，新建项目的窗口不替用户预选。**
   选了：只有一个模板时自动选中；多个时不选。填了名称就能点“创建项目”，没选模板时在模板列表下面提示，不把按钮变灰。
   原因：这一版建了项目不能删除，选错模板的代价比多点一下大；变灰的按钮不说原因，提示放在出问题的地方更清楚。
   以后改：很容易。

8. **没有项目根目录时，新建项目的窗口里不能直接选文件夹。**
   选了：窗口只说明，并带用户去“设置 → 数据”。
   原因：规格和任务都是这么写的；设置的地方只有一处。
   以后改：容易，在窗口里加一个“选择文件夹”按钮即可。

9. **项目的部门从“移到部门”“添加机器人”“创建部门”里去掉。**
   选了：机器人菜单的“移到部门”不列出项目的部门；项目里的机器人没有“移到部门”；部门的“添加机器人”和“创建部门”不列出项目里的机器人。
   原因：这一版不做移入移出；留着这些入口，点了也不会生效，只会让人以为出了错。
   以后改：做“移入移出”时把这几处判断去掉。

10. **高级模式的“团队地图”页面仍然把项目的部门当作部门显示。**
    选了：这一块不动它。
    原因：任务只要求左侧；团队地图是另一处界面。
    以后改：需要时在团队地图里同样去掉或标出项目的部门。

11. **按项目名搜索时显示什么？**
    选了：显示这个项目的整个团队；按机器人名搜到时只显示匹配的机器人和它所在的项目。
    原因：搜项目名多半是想找到这个项目，再看它的团队。
    以后改：很容易。

12. **项目的菜单里有什么？**
    选了：这一块只有“归档”一项。（`integration` 已经在它上面加了模板同步的两项：Update from template…、Save back to template…。）
    原因：规格只要求归档；删除不在这一版里。
    以后改：加菜单项各一行。

13. **“新建项目”放在哪里？**
    选了：只放在项目列表的末尾，用“+”图标；左上角的“+”菜单里没有。
    原因：规格写的是“列表末尾是‘新建项目’”；往“+”菜单里加要动已经没有余量的文件。“文件夹加号”图标已经表示“在机器人下面加文件夹”，一个图标只表示一个意思。
    以后改：容易，在“+”菜单里加一项。

14. **图标栏里怎么表示项目？**
    选了：每个项目一组头像，组之间一条分隔线；找不到文件夹的那组前面一个文件夹图标并变淡。图标栏里不能打开项目菜单，也就不能归档。
    原因：图标栏本来就没有标题和菜单，部门也是这样。
    以后改：加一个右键菜单即可。

15. **简单模式下，有了项目之后，不属于部门的机器人上面多一个“机器人”标题。**
    选了：加。
    原因：不加的话，这些机器人紧跟在最后一个项目的团队后面，看起来像是那个项目的成员。
    以后改：很容易。

16. **“已归档的项目”这一组在没有归档的项目时也显示。**
    选了：显示，写一行“没有已归档的项目。要归档一个项目，请在侧边栏里打开它的菜单。”
    原因：用户来这一页找“恢复”时能确认找对了地方，也顺便知道在哪里归档。
    以后改：很容易。

17. **项目根目录的路径怎么显示？**
    选了：输入路径的那种界面里，路径只在输入框里显示一次；选文件夹的那种界面里显示在按钮旁边。选的文件夹被拒绝时，把被拒绝的路径和服务端的话一起显示。
    原因：同一个路径显示两遍是多余的；只显示“找不到这个文件夹”会被看成当前的根目录出了问题。
    以后改：很容易。

18. **这个 app 在操作另一台电脑时，能不能新建和归档项目？**
    选了：不能，只能看。选文件夹的窗口这时也不用（它选的是这一台电脑上的文件夹），改成输入路径。
    原因：项目建在那一台电脑上。
    以后改：需要时放开，一处判断。

19. **不是管理员的成员看到什么？**
    选了：服务端不让读项目列表（403）时，左侧不显示项目这一段，项目的部门照旧显示成普通部门。
    原因：这是服务端的权限决定的，界面跟着它走。
    以后改：服务端放开读取后界面不用改。

20. **建项目失败（`failed`）时显示谁的话？**
    选了：显示服务端自己的那句话。
    原因：只有服务端知道有没有留下文件夹或机器人。
    以后改：不建议改。

21. **新建项目的窗口用自己的外框，标题 20px。**
    选了：用 `.ui-modal` 和 `useModalDialog`，照 `DESIGN.md` 的字号表。
    原因：现有的几个窗口各有各的外框，没有一个共用的能直接套。
    以后改：以后有了共用的窗口组件再换。

22. **“撤销”提示出现在哪里？**
    选了：沿用现有的 `UndoToast`，在窗口底部正中，6 秒。它在这 6 秒里会盖住输入框的一部分。
    原因：任务指定用这个组件；它的位置是所有用到它的地方共有的。
    以后改：要挪位置得改那个共用组件。

23. **页面不可见时还读不读项目列表？**
    选了：第一次照读。之后没有人要求的读取等到页面可见再发。
    原因：这个 app 的规矩是不可见的页面不自己去打扰（尤其是云端的家）；但第一次不读，项目的部门会被当成普通部门画出来。
    以后改：一处判断。
