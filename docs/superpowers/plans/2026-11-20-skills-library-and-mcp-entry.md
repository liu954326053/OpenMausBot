# 技能库和 MCP 入口：实现计划（第 1 块）

日期：2026-11-20 · 设计：`docs/superpowers/specs/2026-11-20-projects-templates-skills-design.md` 第 2 节

**目标：** 在底部“工具”里打开技能库，上传技能包，启用后所有机器人都能按需使用；从“工具”里打开 MCP 页面。

**做法：** 技能库功能已经存在，默认关闭。这一块把它默认打开，补上上传、删除和“对所有机器人开放”，再加两个入口。

## 这一块定下的细节

1. **技能库默认打开**，但不再把机器人自己的技能自动搬进技能库。机器人自己的技能留在原处。
2. **用户放进技能库的技能，启用后对所有机器人开放。**
   - 技能不超过 15 个时，每个机器人的提示词里都列出全部。
   - 超过 15 个时，只列出和这个机器人职责最相关的 15 个，其余的它用 `skills_list` 搜索。
   - 机器人学到后分享出来的技能（来源以 `learn:` 开头）不在此列，仍然只给被分配到的机器人。
3. **“分配给机器人”和“所有机器人”的含义变成固定列出**：不受 15 个的限制，始终列在提示词里。
4. **上传**接受压缩包（`.zip`、`.skill`）或文件夹，里面可以有一个或多个技能。新技能先停用。
5. **同名技能**：内容相同就不动；内容不同时要用户点“替换”。替换后的技能也先停用，原来的“所有机器人”设置保留。
6. **删除**不弹确认，删除后可以“撤销”。删掉的内容移进技能库的归档目录，不真正删除。
7. **中文匹配**：技能和职责的匹配原来按空格分词，中文匹配不上。改为中文按相邻两个字匹配。
8. **上传的大小**：一次最多 5000 个文件、32 MB；单个文件超过 2 MB 的不上传，在结果里说明被留下。压缩包解压后最多 64 MB。
9. **“应用”和“MCP 服务器”是同一个面板的两个入口**：各自打开自己那一面，各自只在自己那一面打开时高亮。

## 约束

- `server/index.ts`、`src/state/store.tsx`、`electron/main.mjs`、`server/skills.ts`、`server/config.ts` 的行数不能增加（`scripts/testing/file-size-ratchet.test.ts`）。
- 界面遵守 `DESIGN.md`：只用现有的颜色、按钮和组件；所有文字走 `t()`；不新增确认弹窗。
- 新文字加新的键。改已有键的英文会让其他语言的翻译过期。这一块改了三句（技能库的说明、空列表、“所有机器人”的说明），因为原话已经不对；简体、繁体、葡萄牙语重新翻译，其他语言去掉旧翻译，显示英文。
- 验证用独立的测试实例（`scripts/control-omb.ts launch`），不动用户正在用的数据。

## 文件

| 文件 | 改动 |
|---|---|
| `shared/skill-fit.ts` | 中文按相邻两个字分词 |
| `server/skill-library.ts` | 默认打开；`librarySkillsOnOffer`；`removeLibrarySkill`；`restoreLibrarySkill` |
| `server/skills-library-migration.ts` | 启动时的整理可以跳过搬迁，只补做未完成的分配 |
| `server/skill-library-offer.ts`（新） | 对所有机器人开放的技能：挑哪些列出、提示词怎么写 |
| `server/host/skills-library.ts` | 提示词、`/名称` 命令、`skills_list` 的列表里带上开放的技能 |
| `server/index.ts` | 启动整理不搬迁；`skills_list` 用新的列表 |
| `server/skill-archive.ts`（新） | 用现有的 `server/zip-archive.ts` 把上传的压缩包读进内存 |
| `server/skill-upload.ts`（新） | 从上传的文件里找出技能文件夹，装进技能库 |
| `server/user-errors.ts` | 上传被拒绝时的四句话（`serverError.skillUpload.*`），界面按语言显示 |
| `server/routes/bot-skills.ts` | 上传、删除、撤销三个接口；列表里带 `onOffer` |
| `shared/skill-import.ts` | 上传的大小限制和结果的类型，服务端和界面共用 |
| `packages/phone-protocol/src/wire.ts` | 技能库列表多一个 `onOffer` |
| `src/lib/feature-flags.ts` | 默认打开 |
| `src/state/store.tsx` | 新页面 `skills-library` |
| `src/components/SkillsLibraryPage.tsx`（新） | 技能库页面 |
| `src/components/SkillPackageUpload.tsx`（新） | 上传卡片 |
| `src/lib/skill-upload.ts`（新） | 把选中的文件读成上传内容，发送，把结果写成文字 |
| `src/components/SkillsSection.tsx` | 上传卡片、删除和撤销、文字 |
| `src/components/bot-access/ShareBotButton.tsx` | “撤销”提示条可以自带撤销失败时的文字 |
| `src/components/SidebarFooterNav.tsx`、`SidebarPhoneBar.tsx`、`SidebarProfileMenu.tsx` | “技能库”和“MCP 服务器”两项 |
| `src/App.tsx`、`src/components/lazy-screens.tsx` | 接上新页面 |
| `src/locales/en.json`、`zh.json`、`zh-tw.json`、`pt-br.json` | 新文字（`pt-br` 有测试要求它保持完整） |
| `src/locales/de.json`、`fr.json`、`hi.json`、`uk.json` | 补上“技能库”这个名字，账户菜单里用到 |

## 接口

```ts
// shared/skill-fit.ts
export function fitWords(text: string): string[]; // 中文连续两个字算一个词

// server/skill-library.ts
export function skillsLibraryEnabled(cfg: AppConfig): boolean; // features.skillsLibrary !== false
export function librarySkillsOnOffer(botId: string, assigned: ReadonlySet<string>, owned: ReadonlySet<string>): LibrarySkillListing[];
export function removeLibrarySkill(name: string, root?: string): { removed: true; undo: string } | { error: string };
export function restoreLibrarySkill(undo: string, root?: string): LibrarySkillListing | { error: string };

// server/skill-library-offer.ts
export function offeredSkillViews(botId: string, assigned: readonly string[], owned: ReadonlySet<string>): ImportedSkillView[];
export function listedOffers<T extends { name: string; description: string }>(offered: readonly T[], about: string): T[];
export function libraryOfferPrompt(listed: readonly ImportedSkillView[], unlisted: number): string;

// shared/skill-import.ts
export const SKILL_UPLOAD_LIMITS: { files: 5000; bytes: 33554432; fileBytes: 2097152 };
export interface SkillUploadResult { installed: UploadedSkill[]; unchanged: string[]; conflicts: string[]; errors: string[] }

// server/skill-archive.ts
export function readSkillArchive(bytes: Uint8Array): Promise<{ files: UploadedFile[]; oversize: string[] } | UserError>;

// server/skill-upload.ts
export interface UploadedFile { path: string; content: Uint8Array; executable?: boolean }
export function skillFoldersIn<T extends { path: string }>(files: readonly T[]): Array<{ folder: string; files: T[] }>;
export function installUploadedSkills(files: readonly UploadedFile[],
  options: { source: string; replace?: ReadonlySet<string>; oversize?: readonly string[]; root?: string }): SkillUploadResult;
```

HTTP：

- `POST /api/skills-library/upload`，内容 `{ archive?: base64, files?: [{ path, content: base64 }], oversize?: string[], label?: string, replace?: string[] }`。有技能装进去是 201；全部同名且内容不同是 409；全部没变是 200；一个也读不出来是 422。
- `DELETE /api/skills-library/:name`，返回 `{ ok: true, undo }`。
- `POST /api/skills-library/restore`，内容 `{ undo }`。

## 任务

每个任务先写测试，看它失败，再实现，再跑通。

- [x] **1. 中文匹配。** `shared/skill-fit.test.ts`：中文职责能匹配到中文说明的技能；英文结果不变。
- [x] **2. 默认打开，不搬迁。** 服务端和界面的开关判断；启动整理加 `migrate: false`。改掉依赖旧默认值的测试。
- [x] **3. 对所有机器人开放。**
  - `librarySkillsOnOffer`：已启用、不是 `learn:` 来源、没被这个机器人拥有、分配或关掉。
  - `listedOffers`：不超过 15 个全列，超过按职责匹配取 15 个。
  - 提示词多一段“技能库里的技能”；`skills_list` 的列表和 `/名称` 命令带上它们。
- [x] **4. 删除和撤销。** `removeLibrarySkill`、`restoreLibrarySkill` 和两个接口。
- [x] **5. 读压缩包。** 只认不加密、存储或 deflate 压缩的条目；限制条目数和大小；丢掉 `__MACOSX`。
- [x] **6. 上传。** `skillFoldersIn`、`installUploadedSkills`、上传接口；同名替换。
- [x] **7. 页面和入口。** 新页面、状态、两个导航项。
- [x] **8. 上传卡片、删除和撤销、文字。** 英文、简体、繁体。
- [x] **9. 验证。** 类型检查、lint、i18n 检查、相关测试；在独立测试实例上走一遍：上传、启用、机器人提示词里出现、删除、撤销；在浏览器里看页面。
