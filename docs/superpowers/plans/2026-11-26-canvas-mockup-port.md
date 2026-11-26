# 无限画布按 index-v5 效果图原样迁移 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用效果图 `docs/无限画布效果图/index-v5/` 的界面代码替换现有制作看板的界面代码，保住全部现有功能，并由服务端补齐效果图里有而程序没有的数据。

**Architecture:** 效果图的三个 CSS 文件原样拷入并限定在 `.mj-board` 下，颜色变量映射到皮肤令牌；`render.js` 的模板改写成输出相同 DOM 的 React 组件；`app.js`、`panels.js` 的算法逐段移植成 TS 模块。数据仍走 `CanvasSnapshot → buildBoard`，服务端增补四项数据（原著信息、机位数、版本号、草稿音轨）。

**Tech Stack:** React 19、TypeScript、Tailwind v4、Vite、vitest + happy-dom、lucide-react 0.539、zod（服务端）。

设计文档：`docs/superpowers/specs/2026-11-26-canvas-mockup-port-design.md`。读任何一个任务之前先读它。

## Global Constraints

- 在主工作目录（`main`）上做。**不 push，不打包，不换包。**
- 每次提交只暂存本任务的文件。工作区里有别人未提交的改动（设置页、插件、4 个语言文件等），不要带进提交，也不要改回去。
- 效果图目录 `docs/无限画布效果图/` 只读。
- 验证只在隔离夹具里做（`docs/verification/README.md`）。不读写 `~/.magicbot`、`~/Library/Application Support/MagicBot`、`~/Movies/JianyingPro`。
- 测试文件必须是 `*.test.ts`（vitest 只收 `src/**/*.test.ts`），用 `createElement`，不写 JSX；DOM 测试第一行是 `// @vitest-environment happy-dom`。
- 跑单个测试：`OMB_VITEST_WORKERS=2 node node_modules/vitest/vitest.mjs run <路径…>`。
- 类型检查：客户端 `pnpm exec tsc -b`，服务端 `pnpm exec tsc -p tsconfig.server.json`。Lint：`pnpm lint`。语言：`pnpm i18n:check`。对比度：`pnpm check:contrast`。
- 注释规则见 `AGENTS.md`：只写代码说不出来的东西；不写“做了什么”的叙述。
- 提交信息沿用仓库的写法：`范围: 一句英文说明改了什么`。
- 语言键：`en.json` 是源，扁平键。新增键要同时手写进 `zh.json`、`zh-tw.json`、`pt-br.json`，占位符一致；删除键要从四个文件都删。`server.*` 键还要进 `de.json`。
- 画布根 DOM 约定（测试、端到端脚本、对照工具都靠它）：
  - 最外层 `<section class="mj-board">`；里面是效果图的 `<main class="stage">` 和详情弹窗 `.dm`。
  - `.viewport` 带 `data-production-board`，`.world` 带 `data-board-world`。
  - 每个节点 `<article class="node k-<效果图类型>" data-id="<卡片 id>" data-board-card-id="<卡片 id>" data-board-card="<卡片类型>">`。
  - 对话窗 `.bchat` 带 `data-board-chat`，详情 `.dm-box` 带 `data-board-asset="<素材类型>"`，浮层容器带 `data-board-overlay`，右侧面板带 `data-board-side-panel`，占位宽度的元素带 `data-board-room`。
- 卡片类型到效果图类名：`bot→k-bot`、`brief→k-brief`、`plan→k-tasks`、`episode→k-ep`、`stack→k-epmore`、`character→k-char`、`scene→k-scene`、`shot→k-shot`、`result→k-result`、`final→k-final`、`other→k-other`。
- 引擎里的矩形用效果图的写法 `{ x, y, w, h }`；和现有 `BoardAnchor`（`width`、`height`）之间只在浮层接口处转换。

## 文件结构

```
backups/canvas-before-mockup-port/           任务 1：旧代码备份
shared/production.ts                         任务 4：ProductionSource
shared/project-canvas.ts                     任务 2、3：cameras、version
shared/project-draft.ts                      任务 5：tracks
server/…                                     任务 2–5
src/lib/production-board/
  board.ts edges.ts stages.ts types.ts overlay.ts   保留；任务 6 给 board.ts、types.ts 加字段
  status.ts                                  任务 6：状态的文字和色调（原 cards/tone.ts 的数据部分）
  board-index.ts details-view.ts panel-rows.ts asset-words.ts overlay-backend.ts view-follow.ts   任务 6：从 panels/ 移来
src/components/production-board/
  styles/{shell,nodes,panels,skin,additions,index}.css   任务 7
  engine/{camera,layout,edge-paths,minimap,script-page}.ts   任务 8–11
  nodes/{NodeFrame,BotNode,BriefNode,TasksNode,EpisodeNode,EpisodeStackNode,CharacterNode,SceneNode,ShotNode,ResultNode,FinalNode,OtherNode,parts,index}.tsx   任务 13、14
  chrome/{StageBar,Caption,Toolbar,Minimap,Toast}.tsx   任务 15
  board/{World,use-board-input,heights}.ts(x)           任务 16
  ProductionBoard.tsx                                    任务 16
  panels/{ChatWindow,DetailModal,SidePanel,EpisodeMenu,ProductionBoardOverlay}.tsx   任务 17–19
  testing/dom-kit.ts                                     任务 13
```

---

### Task 0: 基线

**Files:** 无改动。

- [ ] **Step 1: 确认工作区**

Run: `git status --short`
Expected: 只有别人未提交的改动，没有 `src/components/production-board/`、`src/lib/production-board/`、`server/production/`、`server/project-canvas/`、`server/project-draft/` 下的文件。4 个语言文件（`src/locales/{en,zh,zh-tw,pt-br}.json`）有别人未提交的改动：本计划每次改它们，提交时用 `git add -p <文件>` 只暂存自己加的块。

- [ ] **Step 2: 记下基线**

Run:
```bash
pnpm exec tsc -b; pnpm exec tsc -p tsconfig.server.json; pnpm lint
OMB_VITEST_WORKERS=2 node node_modules/vitest/vitest.mjs run src/lib/production-board src/lib/project-canvas src/components/production-board src/components/project-canvas server/production server/project-canvas server/project-draft
```
Expected: 记下每条命令的结果。已有的失败（如果有）写进 `.omb-scratch/canvas-port-baseline.txt`（该目录被 git 忽略），后面的任务只对“新增的失败”负责。

---

### Task 1: 备份旧画布

**Files:**
- Create: `backups/canvas-before-mockup-port/README.md` 及下面清单的拷贝
- Modify: `.oxlintrc.json`、`src/styles.css:1`

- [ ] **Step 1: 拷贝**

```bash
B=backups/canvas-before-mockup-port
mkdir -p $B/src/components $B/src/lib $B/src/locales $B/src/testing $B/scripts/testing
cp -R src/components/production-board src/components/project-canvas $B/src/components/
cp -R src/lib/production-board src/lib/project-canvas $B/src/lib/
git show HEAD:src/styles.css > $B/src/styles.css
for l in en zh zh-tw pt-br; do git show HEAD:src/locales/$l.json > $B/src/locales/$l.json; done
cp src/testing/production-board-sample.ts $B/src/testing/
cp scripts/board-visual-audit.ts scripts/board-visual-compare.ts $B/scripts/
cp scripts/testing/board-* scripts/testing/project-canvas-preview.tsx scripts/testing/project-canvas-ui.e2e.test.ts $B/scripts/testing/
```

`styles.css` 和语言文件取 `HEAD` 的版本（`git show`），不取工作区里带别人未提交改动的版本。

- [ ] **Step 2: 写说明**

`backups/canvas-before-mockup-port/README.md`：

```markdown
# 画布备份：按效果图迁移之前

来源提交：<填 `git rev-parse HEAD` 的结果>（2026-11-26）。

这是制作看板按 `docs/无限画布效果图/index-v5/` 原样迁移之前的界面代码和它用到的数据层、样式、文案、预览与对照脚本，保持原路径。

不参与编译、测试、lint 和打包。

还原：把本目录下的 `src/`、`scripts/` 拷回仓库根目录的同名路径，再按 git 记录还原服务端的四项增补（原著信息、机位数、版本号、草稿音轨）。
```

- [ ] **Step 3: 排除在工具之外**

`.oxlintrc.json` 的 `ignorePatterns` 里加一行 `"backups/**"`。

`src/styles.css` 第 1 行 `@import "tailwindcss";` 之后加：

```css
@source not "../backups";
```

- [ ] **Step 4: 验证**

Run: `pnpm lint && pnpm exec tsc -b && OMB_VITEST_WORKERS=2 node node_modules/vitest/vitest.mjs run src/components/project-canvas`
Expected: 与基线相同；vitest 的文件列表里没有 `backups/` 下的文件。

- [ ] **Step 5: Commit**

```bash
git add backups/canvas-before-mockup-port .oxlintrc.json
git add -p src/styles.css   # 只暂存 @source 那一行
git commit -m "Backups: the production board as it was before the mockup's canvas is moved in, outside the build"
```

---

### Task 2: 场景卡的机位数（服务端）

**Files:**
- Modify: `shared/project-canvas.ts:90-100`（`CanvasCardFacts`）
- Modify: `server/project-canvas/ops.ts:142-148`（`cardFacts`）
- Modify: `server/drivers/agents-project-canvas-tools.ts:43`（`canvas_apply_ops` 的说明）、`:71-82`（卡片 schema）
- Modify: `src/locales/{en,zh,zh-tw,pt-br,de}.json` 的 `server.production.task.scene`
- Test: `server/project-canvas/ops.test.ts`

**Interfaces:**
- Produces: `CanvasCardFacts.cameras?: number`（1–99 的整数）。

- [ ] **Step 1: 写失败的测试**

在 `server/project-canvas/ops.test.ts` 里，照该文件已有的 `add_node` 测试的写法（用它的 `apply` / `refused` 辅助函数），加：

```ts
describe("a scene's camera positions", () => {
  it("are kept on its card as a whole number from 1 to 99", () => {
    const { document } = apply([{ type: "add_node", id: "hall", nodeType: "text", title: "Hall", metadata: { content: "A hall.", card: { cameras: 3 } } }]);
    expect(document.nodes.find((node) => node.id === "hall")?.metadata?.card).toEqual({ cameras: 3 });
  });

  it("are refused as a fraction, as zero and past 99", () => {
    for (const cameras of [0, 1.5, 100]) {
      expect(refused([{ type: "add_node", id: "hall", nodeType: "text", title: "Hall", metadata: { card: { cameras } } }])).toMatchObject({ code: "invalid" });
    }
  });
});
```

`apply`、`refused` 的名字和拒绝码以该文件里现有的为准（先读文件开头的辅助函数，再把上面两段对上）。

- [ ] **Step 2: 确认失败**

Run: `OMB_VITEST_WORKERS=2 node node_modules/vitest/vitest.mjs run server/project-canvas/ops.test.ts -t "camera positions"`
Expected: 第一条失败（`cameras` 被 `.strict()` 的 `cardFacts` 拒绝）。

- [ ] **Step 3: 实现**

`shared/project-canvas.ts`，`CanvasCardFacts` 的 `palette` 之后：

```ts
  /** A scene's camera positions, 1 to 99. */
  cameras?: number;
```

`server/project-canvas/ops.ts`，`cardFacts` 的 `palette` 一行之后：

```ts
  cameras: z.number().int().min(1).max(99).optional(),
```

`server/drivers/agents-project-canvas-tools.ts`，卡片 schema 的 `palette` 之后：

```ts
                      cameras: { type: "integer", minimum: 1, maximum: 99, description: "A scene's number of camera positions." },
```

同文件第 43 行的说明里，把 `palette)` 改成 `palette, and a scene's cameras)`。

- [ ] **Step 4: 任务文案**

`src/locales/en.json` 的 `server.production.task.scene`：把 `rows (space, light, mood, props) and the palette.` 改成 `rows (space, light, mood, props), the palette and cameras (how many camera positions the scene has, a whole number).`

`zh.json`：把 `rows（空间、光线、氛围、道具）和 palette（配色）。` 改成 `rows（空间、光线、氛围、道具）、palette（配色）和 cameras（这个场景有几个机位，整数）。`

`zh-tw.json`、`pt-br.json`、`de.json`：同一处做对应语言的同样修改。

- [ ] **Step 5: 确认通过**

Run:
```bash
OMB_VITEST_WORKERS=2 node node_modules/vitest/vitest.mjs run server/project-canvas/ops.test.ts server/drivers/agents-project-canvas-tools.test.ts server/production/engine.test.ts src/locales/server-lines.test.ts
pnpm exec tsc -p tsconfig.server.json && pnpm exec tsc -b && pnpm i18n:check
```
Expected: 全过。

- [ ] **Step 6: Commit**

```bash
git add shared/project-canvas.ts server/project-canvas/ops.ts server/project-canvas/ops.test.ts server/drivers/agents-project-canvas-tools.ts
git add -p src/locales/en.json src/locales/zh.json src/locales/zh-tw.json src/locales/pt-br.json src/locales/de.json
git commit -m "Project canvas: a scene's card says how many camera positions it has, which the scene bot is asked for"
```

---

### Task 3: 单据的版本号（服务端）

**Files:**
- Modify: `shared/project-canvas.ts:121-154`（`CanvasNodeMetadata`）
- Modify: `server/project-canvas/ops.ts:151-173`（`METADATA_FIELDS`）、`:234-235`（`PIPELINE_KEYS`）、`:388`
- Modify: `server/project-canvas/pipeline.ts`（`settlePipeline` 末尾）
- Modify: `server/project-canvas/document-store.ts:21`、`:78-81`（`RemovedNode.pipeline`）
- Test: `server/project-canvas/pipeline.test.ts`、`server/project-canvas/ops.test.ts`

**Interfaces:**
- Produces: `CanvasNodeMetadata.version?: number`。角色是 `brief`、`plan`、`episode`、`character`、`scene` 的文字节点：加入时是 1；`content` 或 `card` 变了加 1；没有版本号的旧节点按 1 算。只有服务端能写。

- [ ] **Step 1: 写失败的测试**

`server/project-canvas/pipeline.test.ts`（用文件里已有的 `node`、`canvas`、`settle`、`by`）：

```ts
describe("a document's version", () => {
  const episode = (content: string, version?: number) => node("ep-1", "text", [0, 0], { role: "episode", episode: 1, content, ...(version === undefined ? {} : { version }) }, by("writer"));

  it("starts at 1 on a text node that has a role when it joins the canvas", () => {
    const { find, changed } = settle(canvas(), (document) => {
      document.nodes.push(episode("Scene 1"));
    });
    expect(find("ep-1")?.metadata?.version).toBe(1);
    expect(changed.nodes).toContain("ep-1");
  });

  it("goes up by one when its text or its card changes, counting a node stored without one as 1", () => {
    const text = settle(canvas([episode("Scene 1", 2)]), (document) => {
      document.nodes[0]!.metadata = { ...document.nodes[0]!.metadata, content: "Scene 1, rewritten" };
    });
    expect(text.find("ep-1")?.metadata?.version).toBe(3);
    const card = settle(canvas([episode("Scene 1")]), (document) => {
      document.nodes[0]!.metadata = { ...document.nodes[0]!.metadata, card: { subtitle: "A logline" } };
    });
    expect(card.find("ep-1")?.metadata?.version).toBe(2);
  });

  it("stays as it is when neither changed, and is not given to a node without a role", () => {
    const moved = settle(canvas([episode("Scene 1", 2), node("note", "text", [0, 400], { content: "A note" })]), (document) => {
      document.nodes[0]!.position = { x: 40, y: 0 };
      document.nodes[1]!.metadata = { content: "Another note" };
    });
    expect(moved.find("ep-1")?.metadata?.version).toBe(2);
    expect(moved.find("note")?.metadata?.version).toBeUndefined();
    expect(moved.changed.nodes).not.toContain("ep-1");
  });
});
```

`server/project-canvas/ops.test.ts`，在测“role、episode… 由服务端设置”的那组拒绝测试（约 270–312 行）里加一条：`update_node` 带 `metadata: { version: 9 }` 被拒绝，错误码与同组其他键相同；`add_node` 带 `version: 9` 时节点上没有 9。

- [ ] **Step 2: 确认失败**

Run: `OMB_VITEST_WORKERS=2 node node_modules/vitest/vitest.mjs run server/project-canvas/pipeline.test.ts -t "a document's version"`
Expected: FAIL，`version` 是 `undefined`。

- [ ] **Step 3: 实现**

`shared/project-canvas.ts`，`CanvasNodeMetadata` 的 `stale` 之后：

```ts
  /** On a `brief`, `plan`, `episode`, `character` or `scene`: 1 when it joined the canvas, one more each time its text
   * or its card changed. Set by the server. A node stored without one counts as 1. */
  version?: number;
```

`server/project-canvas/ops.ts`：
- `METADATA_FIELDS` 的 `stale` 之后加 `version: z.number().int().min(1),`。
- `PIPELINE_KEYS` 改为 `["role", "episode", "shotId", "selected", "stale", "version"]`，`PIPELINE_IS_THE_SERVERS` 改为 `"role, episode, shotId, selected, stale and version are set by the server"`。
- 第 388 行的解构加 `version: _version`。

`server/project-canvas/document-store.ts`：`RemovedNode.pipeline` 的类型和它在 78–81 行的构造里各加 `version`（撤销删除时带回）。

`server/project-canvas/pipeline.ts`，文件里加：

```ts
const VERSIONED: ReadonlySet<CanvasNodeRole> = new Set(["brief", "plan", "episode", "character", "scene"]);

const sameWords = (a: CanvasNode, b: CanvasNode) =>
  a.metadata?.content === b.metadata?.content && JSON.stringify(a.metadata?.card ?? null) === JSON.stringify(b.metadata?.card ?? null);

function countVersions(before: CanvasDocument, after: CanvasDocument): string[] {
  const was = new Map(before.nodes.map((node) => [node.id, node]));
  const counted: string[] = [];
  for (const node of after.nodes) {
    const role = node.metadata?.role;
    if (node.type !== "text" || !role || !VERSIONED.has(role)) continue;
    const old = was.get(node.id);
    if (old && sameWords(old, node)) continue;
    node.metadata = { ...node.metadata, version: old ? (old.metadata?.version ?? 1) + 1 : 1 };
    counted.push(node.id);
  }
  return counted;
}
```

`settlePipeline` 里，`markOutdatedTakes…settleGroups` 那一行改成：

```ts
  for (const id of [...markOutdatedTakes(before, after), ...keepOneSelected(before, after), ...settleGroups(before, after, context), ...countVersions(before, after)]) nodes.add(id);
```

`CanvasNodeRole` 从 `shared/project-canvas.ts` 引入（文件里若还没有）。

- [ ] **Step 4: 确认通过**

Run:
```bash
OMB_VITEST_WORKERS=2 node node_modules/vitest/vitest.mjs run server/project-canvas server/production
pnpm exec tsc -p tsconfig.server.json && pnpm exec tsc -b
```
Expected: 全过。已有测试里对整个 `metadata` 做 `toEqual` 的断言会因多出 `version: 1` 而失败：逐个把期望值补上 `version`，不改实现去迁就。

- [ ] **Step 5: Commit**

```bash
git add shared/project-canvas.ts server/project-canvas
git commit -m "Project canvas: a brief, a plan, an episode, a character and a scene count their versions, one more each time their text or card changes"
```

---

### Task 4: 计划里的原著信息（服务端）

**Files:**
- Modify: `shared/production.ts:46-51`、`:110-117`
- Modify: `server/production/engine.ts:180-204`（`plan`）、`:319-339`（`planInput`）、`:141-143`（`wire`）
- Modify: `server/production/store.ts:40-44`、`:59-61`
- Modify: `server/drivers/agents-project-canvas-tools.ts:122-144`
- Modify: `server/chief-of-staff.ts:35`
- Test: `server/production/engine.test.ts`、`server/production/store.test.ts`（若没有该文件就把存取的断言写进 `engine.test.ts`）、`server/peer-roster-leads.test.ts`

**Interfaces:**
- Produces（`shared/production.ts`）：

```ts
/** The source the drama is adapted from, as the lead told it when planning. */
export interface ProductionSource {
  title: string;
  author?: string;
  /** Such as the genre, how many chapters and how long it is; four at most. */
  tags?: string[];
  quote?: string;
  /** Where it came from, such as "the TXT you uploaded". */
  from?: string;
  /** Its cover, a picture in the project folder. */
  cover?: CanvasFileRef;
}
```

`ProductionPlanWire.source?: ProductionSource`。`ProductionPlanInput.source?: Omit<ProductionSource, "cover"> & { cover?: string }`（`cover` 是项目文件夹内的相对路径）。

- [ ] **Step 1: 写失败的测试**

`server/production/engine.test.ts`，`describe("the lead's plan", …)` 里加（`setup`、`BRIEF`、`canvasRefusalOf` 都是文件里已有的；开头补 `import { mkdtempSync, writeFileSync, rmSync } from "node:fs"`、`import { tmpdir } from "node:os"`、`import { join } from "node:path"`，已有的不重复引入）：

```ts
  it("keeps the source the lead names and sends it with the plan", async () => {
    const world = setup();
    const source = { title: "Lamps of the Fog Harbour", author: "Nan Du", tags: ["mystery", "46 chapters"], quote: "The lamps had been dark for ten years.", from: "the TXT you uploaded" };
    await world.plan({ brief: BRIEF, episodes: 3, source });
    expect(world.productions.wire("p1")?.plan.source).toEqual(source);
  });

  it("takes the source's cover as a picture in the project folder", async () => {
    const world = setup();
    const folder = mkdtempSync(join(tmpdir(), "omb-plan-cover-"));
    try {
      world.project.folder = folder;
      writeFileSync(join(folder, "cover.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
      writeFileSync(join(folder, "notes.txt"), "not a picture");
      await world.plan({ brief: BRIEF, source: { title: "Lamps", cover: "cover.png" } });
      expect(world.productions.wire("p1")?.plan.source?.cover).toMatchObject({ path: "cover.png", name: "cover.png" });
      const refused = async (cover: string) => canvasRefusalOf(await world.plan({ brief: BRIEF, source: { title: "Lamps", cover } }).catch((error: unknown) => error));
      expect(await refused("missing.png")).toMatchObject({ status: 404 });
      expect(await refused("notes.txt")).toMatchObject({ status: 400 });
      expect(await refused("../cover.png")).toMatchObject({ status: 400 });
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  });

  it("refuses a source without a title, with more than four tags or with a quote past 200 characters", async () => {
    const world = setup();
    const refused = async (source: unknown) => canvasRefusalOf(await world.plan({ brief: BRIEF, source }).catch((error: unknown) => error));
    expect(await refused({})).toMatchObject({ status: 400 });
    expect(await refused({ title: "Lamps", tags: ["a", "b", "c", "d", "e"] })).toMatchObject({ status: 400 });
    expect(await refused({ title: "Lamps", quote: "x".repeat(201) })).toMatchObject({ status: 400 });
  });

  it("keeps the source through a restart", async () => {
    const world = setup();
    await world.plan({ brief: BRIEF, source: { title: "Lamps" } });
    expect(world.reopened().wire("p1")?.plan.source).toEqual({ title: "Lamps" });
  });
```

最后一条里的 `world.reopened()`：先读 `setup`（约 60–205 行），用它现有的“重新读盘”的办法（文件里已有测试覆盖重启后的续跑；找 `new ProductionStore` 或同义的重建写法）替换成实际名字。不存在就在 `setup` 返回的对象上加一个用同一数据目录重建 `productions` 的函数。404 与 400 的状态码以 `pathRefusal`（`server/project-canvas/service.ts:68-73`）对 `not_found`、`invalid_path` 给出的为准，不一致就照它改期望值。

`server/peer-roster-leads.test.ts:117-125` 的期望里加一条：`rules` 包含 `"and the source's title"`。

- [ ] **Step 2: 确认失败**

Run: `OMB_VITEST_WORKERS=2 node node_modules/vitest/vitest.mjs run server/production/engine.test.ts -t "source"`
Expected: FAIL（`plan.source` 是 `undefined`）。

- [ ] **Step 3: 类型**

`shared/production.ts`：加上面的 `ProductionSource`（文件顶部 `import type { CanvasFileRef } from "./project-canvas.ts";`），`ProductionPlanWire` 加 `source?: ProductionSource;`，`ProductionPlanInput` 加：

```ts
  /** The source the drama is adapted from; `cover` is a picture's path in the project folder. */
  source?: Omit<ProductionSource, "cover"> & { cover?: string };
```

- [ ] **Step 4: 校验与存取**

`server/production/store.ts`：`StoredProduction.plan` 加 `source?: ProductionSource;`；`productionSchema` 的 `plan` 对象里加：

```ts
    source: z.object({
      title: z.string().min(1), author: z.string().optional(), tags: z.array(z.string()).optional(), quote: z.string().optional(), from: z.string().optional(),
      cover: z.object({ path: z.string(), mime: z.string(), bytes: z.number(), name: z.string() }).optional(),
    }).optional(),
```

`server/production/engine.ts`，`planInput` 的返回类型加 `source?: Omit<ProductionSource, "cover"> & { cover?: string }`，在 `episodes` 的校验之后加：

```ts
    const source = this.sourceInput(asked.source, invalid);
```

并在返回对象里加 `...(source ? { source } : {})`。同一个类里加：

```ts
  private sourceInput(asked: unknown, invalid: (error: string) => CanvasRefusal): (Omit<ProductionSource, "cover"> & { cover?: string }) | undefined {
    if (asked === undefined) return undefined;
    const given = asked && typeof asked === "object" && !Array.isArray(asked) ? asked as Record<string, unknown> : null;
    const text = (value: unknown, max: number) => (typeof value === "string" && value.trim().length > 0 && value.length <= max ? value.trim() : undefined);
    const title = text(given?.title, 200);
    if (!given || !title) throw invalid("source takes a title of at most 200 characters");
    const out: Omit<ProductionSource, "cover"> & { cover?: string } = { title };
    for (const key of ["author", "quote", "from"] as const) {
      if (given[key] === undefined) continue;
      const value = text(given[key], 200);
      if (!value) throw invalid(`source.${key} takes at most 200 characters`);
      out[key] = value;
    }
    if (given.tags !== undefined) {
      const tags = Array.isArray(given.tags) ? given.tags.map((tag) => text(tag, 40)) : [];
      if (!Array.isArray(given.tags) || tags.length > 4 || tags.some((tag) => !tag)) throw invalid("source.tags takes at most 4 tags of at most 40 characters each");
      out.tags = tags as string[];
    }
    if (given.cover !== undefined) {
      if (typeof given.cover !== "string" || given.cover.length > 500) throw invalid("source.cover takes a picture's path in the project folder");
      out.cover = given.cover;
    }
    return out;
  }

  private async coverOf(project: TeamProjectWire, path: string): Promise<CanvasFileRef> {
    try {
      const opened = await openProjectFile(project.folder, path, Number.POSITIVE_INFINITY);
      await opened.handle.close();
      if (!opened.mime.startsWith("image/")) throw new CanvasRefusal(400, { error: "source.cover takes a picture" });
      return { path: opened.path, mime: opened.mime, bytes: opened.bytes, name: opened.name };
    } catch (error) {
      throw isProjectPathError(error) ? pathRefusal(error, project.folder) : error;
    }
  }
```

`openProjectFile`、`isProjectPathError` 来自 `../project-canvas/paths.ts`，`pathRefusal` 来自 `../project-canvas/service.ts`，`CanvasFileRef` 来自 `shared/project-canvas.ts`。

`plan` 里，把取输入的那一行换成下面几行（封面的解析在 `setBrief` 之前，使被拒绝的计划不改画布）：

```ts
      const { brief, episodes, assignments, source: named } = this.planInput(project, input);
      let source: ProductionSource | undefined;
      if (named) {
        const { cover, ...words } = named;
        source = { ...words, ...(cover ? { cover: await this.coverOf(project, cover) } : {}) };
      }
```

后面构造计划的一行改成：

```ts
      const plan = { assignments, ...(episodes ? { episodes } : {}), ...(source ? { source } : {}), plannedAt: now };
```

`wire`（约 142 行）的 `plan:` 里加 `...(production.plan.source ? { source: production.plan.source } : {})`。

- [ ] **Step 5: 工具和提示词**

`server/drivers/agents-project-canvas-tools.ts`，`production_plan` 的 `properties` 里 `episodes` 之后加：

```ts
        source: {
          type: "object",
          additionalProperties: false,
          description: "The source the drama is adapted from, shown on your card.",
          properties: {
            title: cardText,
            author: cardText,
            tags: { type: "array", maxItems: 4, items: { type: "string", maxLength: 40 }, description: "Such as the genre, how many chapters, how long it is." },
            quote: { ...cardText, description: "One line from the source that carries its mood." },
            from: { ...cardText, description: "Where it came from, such as the TXT the person uploaded." },
            cover: { type: "string", maxLength: 500, description: "A cover picture's path in the project folder, if there is one." },
          },
          required: ["title"],
        },
```

`server/chief-of-staff.ts:35`：把 `then call production_plan once with it.` 改成 `then call production_plan once with it and the source's title, author and a line from it.`

- [ ] **Step 6: 确认通过**

Run:
```bash
OMB_VITEST_WORKERS=2 node node_modules/vitest/vitest.mjs run server/production server/drivers/agents-project-canvas-tools.test.ts server/peer-roster-leads.test.ts server/production.e2e.test.ts server/production-legacy-lines.e2e.test.ts
pnpm exec tsc -p tsconfig.server.json && pnpm exec tsc -b
```
Expected: 全过。

- [ ] **Step 7: Commit**

```bash
git add shared/production.ts server/production server/drivers/agents-project-canvas-tools.ts server/chief-of-staff.ts server/peer-roster-leads.test.ts
git commit -m "Production: the lead's plan names the source it adapts, its author, a line from it and its cover, and the plan carries them"
```

---

### Task 5: 草稿的配音、字幕、音乐轨（服务端）

仓库里没有带音轨的剪映草稿样本。下面的字段名来自剪映草稿格式的公开资料（轨道 `type` 是 `"audio"` 或 `"text"`；片段的 `target_timerange` 是微秒；`materials.audios[].type` 里 `"text_to_audio"`、`"record"` 是配音，其余如 `"extract_music"`、`"music"`、`"sound"` 归音乐）。**这是本计划里唯一没有真实样本佐证的部分**：任务 21 要拿一份真实的、在剪映里加过配音和字幕的草稿核对；对不上就改 `draftTracks` 里的判定并补一条用该样本的测试。

**Files:**
- Modify: `shared/project-draft.ts:38-47`
- Modify: `server/project-draft/draft-file.ts`（新增 `draftTracks`）
- Modify: `server/project-draft/drafts.ts`（缓存和后台刷新）
- Test: `server/project-draft/draft-file.test.ts`、`server/project-draft/drafts.test.ts`

**Interfaces:**
- Produces（`shared/project-draft.ts`）：

```ts
/** One kind of sound or words laid along an episode's film in JianYing. */
export interface DraftTrackWire {
  kind: "voice" | "subtitle" | "music";
  /** In the order they play. */
  segments: Array<{ startMs: number; durationMs: number }>;
}
```

`ProjectDraftWire.tracks?: DraftTrackWire[]`（只列有片段的种类，顺序 voice、subtitle、music）。
- Produces（`server/project-draft/draft-file.ts`）：`export function draftTracks(timeline: unknown): DraftTrackWire[]`。

- [ ] **Step 1: 写失败的测试**

`server/project-draft/draft-file.test.ts`：

```ts
describe("the tracks a person added in JianYing", () => {
  const range = (start: number, duration: number) => ({ target_timerange: { start, duration } });
  const timeline = {
    materials: {
      audios: [{ id: "voice-1", type: "text_to_audio" }, { id: "song-1", type: "extract_music" }, { id: "rec-1", type: "record" }],
      texts: [{ id: "line-1", type: "subtitle" }],
    },
    tracks: [
      { type: "video", segments: [{ material_id: "clip-1", ...range(0, 6_000_000) }] },
      { type: "audio", segments: [{ material_id: "voice-1", ...range(7_000_000, 4_000_000) }, { material_id: "song-1", ...range(0, 36_000_000) }] },
      { type: "audio", segments: [{ material_id: "rec-1", ...range(1_000_000, 2_500_000) }] },
      { type: "text", segments: [{ material_id: "line-1", ...range(7_500_000, 3_500_000) }] },
    ],
  };

  it("are its voice, its subtitles and its music, each segment in milliseconds in the order it plays", () => {
    expect(draftTracks(timeline)).toEqual([
      { kind: "voice", segments: [{ startMs: 1000, durationMs: 2500 }, { startMs: 7000, durationMs: 4000 }] },
      { kind: "subtitle", segments: [{ startMs: 7500, durationMs: 3500 }] },
      { kind: "music", segments: [{ startMs: 0, durationMs: 36000 }] },
    ]);
  });

  it("are none for a draft with pictures only, and for anything that is not a draft", () => {
    expect(draftTracks({ materials: { audios: [], texts: [] }, tracks: [timeline.tracks[0]] })).toEqual([]);
    for (const not of [null, 7, "draft", [], { tracks: "none" }, { tracks: [{ type: "audio", segments: [{ target_timerange: { start: "0", duration: -1 } }] }] }]) expect(draftTracks(not)).toEqual([]);
  });

  it("keep 200 segments of a kind at most", () => {
    const many = { materials: { audios: [], texts: [] }, tracks: [{ type: "text", segments: Array.from({ length: 300 }, (_, at) => range(at * 1_000_000, 500_000)) }] };
    expect(draftTracks(many)[0]?.segments).toHaveLength(200);
  });
});
```

`server/project-draft/drafts.test.ts`（用文件里的 `harness`、`OWNER`；写草稿的办法照“writes a draft named after the project…”那条测试）：

```ts
describe("a written draft's tracks", () => {
  it("reach the draft's wire once JianYing saved sound or words into it, and tell who listens", async () => {
    const { drafts, canvas, shot, draftFolders } = harness();
    canvas.set("p1", [shot("s1", { seconds: 4, width: 1920, height: 1080 })]);
    await drafts.writeDraftIfReady("p1");
    expect(drafts.draftWire("p1", OWNER).tracks).toBeUndefined();
    const file = join(draftFolders()[0]!, "draft_info.json");
    const saved = JSON.parse(readFileSync(file, "utf8"));
    saved.materials.texts.push({ id: "line-1", type: "subtitle" });
    saved.tracks.push({ type: "text", segments: [{ material_id: "line-1", target_timerange: { start: 500_000, duration: 2_000_000 } }] });
    writeFileSync(file, JSON.stringify(saved));
    const told: string[] = [];
    drafts.onDraftChange((projectId) => told.push(projectId));
    await drafts.refreshTracks("p1");
    expect(drafts.draftWire("p1", OWNER).tracks).toEqual([{ kind: "subtitle", segments: [{ startMs: 500, durationMs: 2000 }] }]);
    expect(told).toEqual(["p1"]);
    await drafts.refreshTracks("p1");
    expect(told).toEqual(["p1"]);
  });

  it("are left out when the draft's file cannot be read as a draft", async () => {
    const { drafts, canvas, shot, draftFolders } = harness();
    canvas.set("p1", [shot("s1", { seconds: 4, width: 1920, height: 1080 })]);
    await drafts.writeDraftIfReady("p1");
    writeFileSync(join(draftFolders()[0]!, "draft_info.json"), "not json");
    await drafts.refreshTracks("p1");
    expect(drafts.draftWire("p1", OWNER).tracks).toBeUndefined();
  });
});
```

`draftFolders()` 返回的是不是绝对路径，以 `server/project-draft/testing.ts` 为准；不是就用它返回的 `draftRoot` 拼。

- [ ] **Step 2: 确认失败**

Run: `OMB_VITEST_WORKERS=2 node node_modules/vitest/vitest.mjs run server/project-draft/draft-file.test.ts server/project-draft/drafts.test.ts -t "tracks"`
Expected: FAIL，`draftTracks`、`refreshTracks` 不存在。

- [ ] **Step 3: `draftTracks`**

`shared/project-draft.ts` 加上面的 `DraftTrackWire`，`ProjectDraftWire` 加：

```ts
  /** What the person or the post bot laid along the film in JianYing: voice, subtitles, music. Absent when there is none. */
  tracks?: DraftTrackWire[];
```

`server/project-draft/draft-file.ts`：

```ts
const TRACK_SEGMENTS_MAX = 200;
const VOICE_MATERIALS = new Set(["text_to_audio", "record"]);
const TRACK_KINDS = ["voice", "subtitle", "music"] as const;

const list = (value: unknown): Json[] => (Array.isArray(value) ? value.filter((one): one is Json => Boolean(one) && typeof one === "object" && !Array.isArray(one)) : []);

/** The voice, subtitle and music segments of a draft's timeline, as JianYing saved it. */
export function draftTracks(timeline: unknown): DraftTrackWire[] {
  if (!timeline || typeof timeline !== "object" || Array.isArray(timeline)) return [];
  const draft = timeline as Json;
  const materials = draft.materials && typeof draft.materials === "object" ? draft.materials as Json : {};
  const audioType = new Map(list(materials.audios).map((one) => [String(one.id), String(one.type)]));
  const found: Record<DraftTrackWire["kind"], DraftTrackWire["segments"]> = { voice: [], subtitle: [], music: [] };
  for (const track of list(draft.tracks)) {
    if (track.type !== "audio" && track.type !== "text") continue;
    for (const segment of list(track.segments)) {
      const range = segment.target_timerange as Json | undefined;
      const start = range?.start;
      const duration = range?.duration;
      if (typeof start !== "number" || typeof duration !== "number" || start < 0 || duration <= 0) continue;
      const kind = track.type === "text" ? "subtitle" : VOICE_MATERIALS.has(audioType.get(String(segment.material_id)) ?? "") ? "voice" : "music";
      found[kind].push({ startMs: Math.round(start / 1000), durationMs: Math.round(duration / 1000) });
    }
  }
  return TRACK_KINDS.flatMap((kind) => (found[kind].length ? [{ kind, segments: found[kind].sort((a, b) => a.startMs - b.startMs).slice(0, TRACK_SEGMENTS_MAX) }] : []));
}
```

`Json` 是该文件已有的类型别名；`DraftTrackWire` 从 `shared/project-draft.ts` 引入。

- [ ] **Step 4: 缓存和刷新**

`server/project-draft/drafts.ts`，`ProjectDrafts` 类里：

```ts
  private readonly tracks = new Map<string, { stamp: string; tracks: DraftTrackWire[] }>();
  private readonly trackLooks = new Map<string, number>();
```

```ts
  /** Reads again what JianYing saved into the project's drafts, and tells who listens when a draft's tracks changed. */
  async refreshTracks(projectId: string): Promise<void> {
    const project = this.project(projectId);
    if (!this.deps.onPersonsComputer || this.lookup?.state !== "ready") return;
    let changed = false;
    for (const episode of this.episodesOf(projectId)) {
      const key = timelineKey(projectId, episode);
      const draft = this.storedDraft(key);
      if (!draft) continue;
      const file = join(draft.folder, this.lookup.install.timelineFile);
      const info = await lstat(file).catch(() => null);
      const stamp = info?.isFile() && info.size <= TIMELINE_MAX_BYTES ? `${info.mtimeMs}:${info.size}` : "";
      if (this.tracks.get(key)?.stamp === stamp) continue;
      const bytes = stamp ? await readFile(file, "utf8").catch(() => null) : null;
      let read: DraftTrackWire[] = [];
      try {
        if (bytes) read = draftTracks(JSON.parse(bytes));
      } catch {
        read = [];
      }
      if (JSON.stringify(this.tracks.get(key)?.tracks ?? []) !== JSON.stringify(read)) changed = true;
      this.tracks.set(key, { stamp, tracks: read });
    }
    if (changed) for (const listener of this.draftListeners) listener(project.id);
  }
```

`wireOf` 的最后一行改成带上缓存里的轨道：

```ts
    const tracks = this.tracks.get(timelineKey(project.id, episode))?.tracks;
    return { state: draft.kept ? "kept" : "written", name: draft.name, writtenAt: draft.writtenAt, exportFolder, ...(tracks?.length ? { tracks } : {}) };
```

`draftWires`（读快照时调用）里，在返回之前触发后台刷新，每个项目最多 5 秒一次：

```ts
    const now = this.deps.now();
    if (here && now - (this.trackLooks.get(projectId) ?? 0) >= TRACK_LOOK_EVERY_MS) {
      this.trackLooks.set(projectId, now);
      void this.refreshTracks(projectId).catch(() => undefined);
    }
```

文件顶部加 `const TRACK_LOOK_EVERY_MS = 5000;`。`write` 写出新草稿后（`this.deps.store.write(key, …)` 之后）加 `this.tracks.delete(key);`。

- [ ] **Step 5: 确认通过**

Run:
```bash
OMB_VITEST_WORKERS=2 node node_modules/vitest/vitest.mjs run server/project-draft server/project-draft.e2e.test.ts server/production
pnpm exec tsc -p tsconfig.server.json && pnpm exec tsc -b
```
Expected: 全过。

- [ ] **Step 6: Commit**

```bash
git add shared/project-draft.ts server/project-draft
git commit -m "Project draft: the voice, subtitles and music a person lays along the film in JianYing reach the draft's wire"
```

---

### Task 6: 客户端数据层：搬家、状态模块、新字段

**Files:**
- Move（`git mv`）: `src/components/production-board/panels/{board-index.ts,board-index.test.ts,details-view.ts,panel-rows.ts,asset-words.ts,overlay-backend.ts,view-follow.ts}` → `src/lib/production-board/`
- Create: `src/lib/production-board/status.ts`、`src/lib/production-board/status.test.ts`
- Modify: `src/lib/production-board/types.ts`、`src/lib/production-board/board.ts:160`、`:237-242`、`:287-297`、`:395-404`
- Modify: `src/testing/production-board-sample.ts:30-41`、`:112`、`:140-157`、`:183`
- Test: `src/lib/production-board/board.test.ts`

**Interfaces:**
- Produces（`status.ts`）：

```ts
export type BoardTone = "idle" | "working" | "done" | "asking" | "failed";
export interface BoardStatus { tone: BoardTone; label: string }
export function botStatus(bot: Pick<CanvasBotState, "status" | "waiting">, task?: ProductionTaskStatus): BoardStatus;
export function taskStatus(task: ProductionTaskStatus | undefined): BoardStatus | null;
export function episodeStatus(status: ProductionEpisodeStatus | undefined): BoardStatus | null;
export function generationTone(status: CanvasGenerationStatus | undefined): BoardTone;
/** The mockup's `data-state` for a tone: `done`, `working`, `waiting`, plus `failed`. */
export const toneState = (tone: BoardTone): "done" | "working" | "waiting" | "failed" =>
  (tone === "done" ? "done" : tone === "failed" ? "failed" : tone === "idle" ? "waiting" : "working");
```

- Produces（`types.ts` 新字段）：
  - `BoardBotCard.source?: ProductionSource`、`BoardBotCard.episodes?: number`（只在负责人卡上）
  - `BoardBriefCard.version: number`、`BoardBriefCard.agreedAt?: number`
  - `BoardPlanCard.plannedAt?: number`
  - `BoardEpisodeCard.version: number`
  - `BoardProfileCard.version: number`、`BoardProfileCard.pictures: number`（组里有文件的图片张数）

- [ ] **Step 1: 搬家并改引用**

```bash
cd src/components/production-board/panels
git mv board-index.ts board-index.test.ts details-view.ts panel-rows.ts asset-words.ts overlay-backend.ts view-follow.ts ../../../lib/production-board/
```

然后：
- 搬过去的文件里，相对引用按新位置改（`../../../../shared/…` → `../../../shared/…`，`@/lib/production-board/overlay` → `./overlay`）。
- `details-view.ts` 的 `import { episodeStatus } from "../cards"` 改成 `from "./status"`。
- 旧界面（`src/components/production-board/panels/*.tsx`、`scripts/testing/board-panels-*.tsx`）里对这七个文件的引用改成 `@/lib/production-board/<名字>`。用 `rg -n "from \"\./(board-index|details-view|panel-rows|asset-words|overlay-backend|view-follow)\"" src scripts` 找全。

- [ ] **Step 2: 写失败的测试**

`src/lib/production-board/status.test.ts`：

```ts
import { beforeAll, describe, expect, it } from "vitest";
import { setLocale } from "@/lib/i18n";
import { botStatus, episodeStatus, generationTone, taskStatus, toneState } from "./status";

beforeAll(() => setLocale("en"));

describe("a bot's status", () => {
  it("puts a question for the person first, then a failure, then its work, then its task", () => {
    expect(botStatus({ status: "working", waiting: { threadId: "t", messageId: "m", card: {} as never } }).tone).toBe("asking");
    expect(botStatus({ status: "idle" }, "failed").tone).toBe("failed");
    expect(botStatus({ status: "error" }).tone).toBe("failed");
    expect(botStatus({ status: "working" }).tone).toBe("working");
    expect(botStatus({ status: "queued" }).tone).toBe("working");
    expect(botStatus({ status: "idle" }, "done").tone).toBe("done");
    expect(botStatus({ status: "idle" }).tone).toBe("idle");
  });
});

describe("the other statuses", () => {
  it("read a task, an episode and a generation", () => {
    expect(taskStatus(undefined)).toBeNull();
    expect(taskStatus("waiting")?.tone).toBe("idle");
    expect(episodeStatus("videos")?.tone).toBe("working");
    expect(episodeStatus("failed")?.tone).toBe("failed");
    expect(episodeStatus(undefined)).toBeNull();
    expect(generationTone("loading")).toBe("working");
    expect(generationTone(undefined)).toBe("idle");
  });

  it("name the mockup's state for each tone", () => {
    expect((["idle", "working", "done", "asking", "failed"] as const).map(toneState)).toEqual(["waiting", "working", "done", "working", "failed"]);
  });
});
```

`src/lib/production-board/board.test.ts` 里加（`productionBoardSample` 已在该文件引入；`buildBoard(snapshot)`）：

```ts
describe("what the mockup's cards show beyond the old board's", () => {
  const board = buildBoard(productionBoardSample({ episodes: 4 }));
  const one = <Kind extends BoardCard["kind"]>(kind: Kind) => board.cards.find((card): card is Extract<BoardCard, { kind: Kind }> => card.kind === kind)!;

  it("gives the lead's card the source and the number of episodes it is adapted into", () => {
    const lead = board.cards.find((card) => card.kind === "bot" && card.lead);
    expect(lead).toMatchObject({ source: { title: "雨城", author: "南渡" }, episodes: 4 });
    expect(board.cards.filter((card) => card.kind === "bot" && !card.lead).every((card) => !("source" in card))).toBe(true);
  });

  it("gives the brief its version and when it was agreed, and the plan when it was made", () => {
    expect(one("brief")).toMatchObject({ version: 2, agreedAt: expect.any(Number) });
    expect(one("plan").plannedAt).toEqual(expect.any(Number));
  });

  it("gives an episode and a scene their versions, a character the number of its pictures, and counts a node without a version as 1", () => {
    expect(one("episode").version).toBe(1);
    expect(one("scene")).toMatchObject({ version: 2, facts: { cameras: 3 } });
    expect(one("character")).toMatchObject({ version: 1, pictures: 1 });
  });

  it("carries the draft's tracks to the film's card", () => {
    expect(one("final").draft?.tracks).toEqual([{ kind: "voice", segments: [{ startMs: 1000, durationMs: 3000 }] }, { kind: "music", segments: [{ startMs: 0, durationMs: 20000 }] }]);
  });
});
```

- [ ] **Step 3: 确认失败**

Run: `OMB_VITEST_WORKERS=2 node node_modules/vitest/vitest.mjs run src/lib/production-board/status.test.ts src/lib/production-board/board.test.ts`
Expected: FAIL（`./status` 不存在；新字段是 `undefined`）。

- [ ] **Step 4: `status.ts`**

把 `src/components/production-board/cards/tone.ts` 里的 `BoardTone`、`BoardStatus`、`botStatus`、`taskStatus`、`episodeStatus`、`generationTone` 原样搬进 `src/lib/production-board/status.ts`（引用路径改成 `../../../shared/…`），不带 `TONE_DOT`、`TONE_TEXT`、`TONE_EDGE` 三张 Tailwind 类名表，再加上面的 `toneState`。`cards/tone.ts` 暂时不动（旧界面在任务 16 之前还在用）。

- [ ] **Step 5: 新字段**

`src/lib/production-board/types.ts`：按上面 Interfaces 加字段（`ProductionSource` 从 `shared/production` 引入）。

`src/lib/production-board/board.ts`：
- `profilesOf`（约 141–169 行）返回的每个角色、场景里加 `version: node.metadata?.version ?? 1` 和 `pictures`（同组里 `metadata.file` 存在的图片节点数）。
- 需求单（约 290–291 行）的卡片加 `version: brief.metadata?.version ?? 1` 和 `...(index.production ? { agreedAt: index.production.plan.plannedAt } : {})`。
- 任务拆分（约 293–297 行）的卡片加 `...(index.production ? { plannedAt: index.production.plan.plannedAt } : {})`。
- 分集（约 395–404 行）的卡片加 `version: node.metadata?.version ?? 1`（`node` 是该集的剧本节点）。
- `botCard`（约 237–242 行）在 `lead` 为真时加 `...(index.production?.plan.source ? { source: index.production.plan.source } : {})` 和 `...(index.production?.plan.episodes ? { episodes: index.production.plan.episodes } : {})`。

- [ ] **Step 6: 样例剧**

`src/testing/production-board-sample.ts`：
- `sampleProduction` 的 `plan`（约 112 行）加 `source: { title: "雨城", author: "南渡", tags: ["都市悬疑", "46 章", "38.6 万字"], quote: "雨城的灯，十年没亮过了。", from: "你上传的 TXT" }`。
- 需求单节点（约 140–143 行）的 `metadata` 加 `version: 2`；任务拆分节点加 `version: 1`；分集节点不加（测“没有就按 1”）。
- `SCENES` 表（约 36–41 行）每个场景加 `cameras`（第一个是 3，其余 2、4、2），构造场景节点处（约 152–156 行）把它写进 `metadata.card.cameras`，并给场景节点 `version: 2`；角色节点 `version: 1`。
- `drafts`（约 183 行）第 1 集加 `tracks: [{ kind: "voice", segments: [{ startMs: 1000, durationMs: 3000 }] }, { kind: "music", segments: [{ startMs: 0, durationMs: 20000 }] }]`。

- [ ] **Step 7: 确认通过**

Run:
```bash
OMB_VITEST_WORKERS=2 node node_modules/vitest/vitest.mjs run src/lib/production-board src/lib/project-canvas src/components/production-board src/components/project-canvas src/components/project-view
pnpm exec tsc -b
```
Expected: 全过。旧界面的测试若因样例多了字段而失败（对整个对象做 `toEqual` 的），补期望值。

- [ ] **Step 8: Commit**

```bash
git add src/lib/production-board src/components/production-board src/testing/production-board-sample.ts scripts/testing
git commit -m "Production board: its data modules sit apart from what draws them, and its cards know the source, the versions, the camera positions and the film's tracks"
```

---

### Task 7: 样式：原样拷入、皮肤映射

**Files:**
- Create: `src/components/production-board/styles/shell.css`、`nodes.css`、`panels.css`、`skin.css`、`additions.css`、`index.css`
- Test: `src/components/production-board/styles/styles.test.ts`

**Interfaces:**
- Produces: `import "@/components/production-board/styles/index.css"` 之后，`.mj-board` 下可用效果图的全部类名；变量 `--on-fill`、`--on-teal`、`--danger`、`--shadow-node`、`--shadow-node-drag`、`--shadow-node-sel`、`--shadow-float`、`--shadow-panel`；动画名都带 `mj-` 前缀。

- [ ] **Step 1: 写失败的测试**

`src/components/production-board/styles/styles.test.ts`：

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (name: string) => readFileSync(new URL(`./${name}.css`, import.meta.url), "utf8");
const COPIED = ["shell", "nodes", "panels"] as const;
const all = () => [...COPIED, "skin", "additions"].map(read).join("\n");

describe("the mockup's styles in the app", () => {
  it("are kept under the board's root: no rule reaches the page, the body or the document", () => {
    for (const name of COPIED) {
      const css = read(name);
      expect(css, name).not.toMatch(/(^|[\s,}])(:root|html|body)\s*[,{]/m);
      expect(css, name).toMatch(/^\.mj-board\s*\{/m);
    }
  });

  it("name every animation mj-, so none meets one of the app's", () => {
    const names = [...all().matchAll(/@keyframes\s+([\w-]+)/g)].map((match) => match[1]);
    expect(names.length).toBeGreaterThanOrEqual(15);
    expect(names.filter((name) => !name!.startsWith("mj-"))).toEqual([]);
    const used = [...all().matchAll(/animation(?:-name)?\s*:\s*([\w-]+)/g)].map((match) => match[1]!).filter((name) => name !== "none");
    expect(used.filter((name) => !name.startsWith("mj-"))).toEqual([]);
  });

  it("take every colour from the skin, but for the monitors and what lies over a picture", () => {
    for (const name of COPIED) {
      const css = read(name);
      expect(css, name).not.toMatch(/rgba\(26, ?30, ?35/);
      expect(css, name).not.toMatch(/rgba\((69, ?191, ?174|242, ?165, ?60|236, ?235, ?229)/);
      expect(css, name).not.toMatch(/#ffb650/i);
    }
    const skin = read("skin");
    for (const token of ["--bg: var(--color-app)", "--paper: var(--color-menu)", "--amber: var(--color-warning)", "--teal: var(--color-success)", "--on-fill: var(--color-app)"]) expect(skin).toContain(token);
  });

  it("drop the mockup's top bar and web font", () => {
    expect(read("shell")).not.toMatch(/\.topbar|\.brand|\.top-actions|word-spacing|Noto Sans SC/);
  });

  it("stop every animation when the person or the app asks for less motion", () => {
    expect(read("additions")).toMatch(/\[data-reduced-motion="true"\] \.mj-board/);
  });
});
```

- [ ] **Step 2: 确认失败**

Run: `OMB_VITEST_WORKERS=2 node node_modules/vitest/vitest.mjs run src/components/production-board/styles/styles.test.ts`
Expected: FAIL（文件不存在）。

- [ ] **Step 3: 拷入三个文件并做机械改动**

```bash
mkdir -p src/components/production-board/styles
for f in shell nodes panels; do cp "docs/无限画布效果图/index-v5/$f.css" src/components/production-board/styles/$f.css; done
```

对三个文件做下面的改动，规则本身不改：

1. `@keyframes` 留在文件顶层并改名加 `mj-` 前缀（`spin`、`pulse`、`flow`、`ref-tail`、`ref-head`、`lg-ref`、`blink`、`scrub`、`mv-push`、`mv-pull`、`mv-pan`、`mv-static`、`sweep`、`bc-in`、`dm-in`），所有 `animation`、`animation-name` 的引用同步改名。
2. 其余全部规则包进一个 `.mj-board { … }`（CSS 嵌套）。`@media` 块留在 `.mj-board` 里面。
3. `shell.css`：
   - 删 `:root { … }`（2–30 行，变量移到 `skin.css`）、`html, body`（35 行）、`body`（36–42 行）；34 行的 `word-spacing` 删掉，`box-sizing` 留下。
   - 34、43–48 行的元素重置改写成放在 `base` 层里，文件顶层：

     ```css
     @layer base {
       .mj-board, .mj-board *, .mj-board *::before, .mj-board *::after { box-sizing: border-box; }
       .mj-board :is(h1, h2, h3, p, ul, ol, dl, dd, blockquote, figure) { margin: 0; padding: 0; }
       .mj-board :is(ul, ol) { list-style: none; }
       .mj-board button { font: inherit; color: inherit; background: none; border: 0; padding: 0; cursor: pointer; }
       .mj-board button:disabled { cursor: not-allowed; }
       .mj-board img { display: block; max-width: 100%; }
     }
     ```
   - 48 行的 `:focus-visible` 留在 `.mj-board` 里，`outline` 的颜色改成 `var(--color-focus)`。
   - 删 70–87 行（`.app`、`.topbar`、`.brand*`、`.run*`、`.top-actions`）、98 行（`.work`）、225–227 行（`.roster` 的定位）、271 行（`.scrim`）、274–281 行两个 `@media` 里的 `.roster`、`.scrim`、`.run` 规则、283–285 行（`.btn span` 等顶栏按钮的窄屏规则）、295 行（`.brand-txt span`）、301 行里的 `.roster`。
   - `#labels, #nodes`（111 行）改成 `.labels, .nodes`。
4. 写死的颜色按下表换（没列到的留原样）：

| 位置 | 原值 | 换成 |
|---|---|---|
| shell 58、59 | `rgba(242, 165, 60, a)` | `color-mix(in srgb, var(--amber) <a×100>%, transparent)` |
| shell 66、107 | `rgba(255, 255, 255, .1)` | `color-mix(in srgb, var(--text) 10%, transparent)`（107 用 16%） |
| shell 95；nodes 220；panels 74 | `#ffb650` | `color-mix(in srgb, var(--amber) 86%, var(--text))` |
| shell 119、157 | `rgba(69, 191, 174, .62)` | `color-mix(in srgb, var(--teal) 62%, transparent)` |
| shell 123 | `rgba(242, 165, 60, .45)` | `color-mix(in srgb, var(--amber) 45%, transparent)` |
| shell 139–149 | `rgba(236, 235, 229, a)` | `color-mix(in srgb, var(--text) <a×100>%, transparent)` |
| shell 146 | `#fff` | `var(--text)` |
| shell 176、197、211 | `rgba(26, 30, 35, .94)` | `color-mix(in srgb, var(--panel) 94%, transparent)` |
| shell 189、219；nodes 70 | 整个 `box-shadow` | `var(--shadow-float)` |
| nodes 4、135 的第一层、187 的第二层 | `0 12px 32px rgba(0, 0, 0, .4)` | `var(--shadow-node)` |
| nodes 8 | 整个 `box-shadow` | `var(--shadow-node-drag)` |
| nodes 9、29 | 第二层 `0 18px 48px rgba(0, 0, 0, .55)` | `var(--shadow-node-sel)` |
| nodes 28、252 | `rgba(242, 165, 60, a)`、`rgba(0, 0, 0, .4)` 那一层 | `color-mix(in srgb, var(--amber) <a×100>%, transparent)`、`var(--shadow-node)` |
| nodes 63 | `rgba(69, 191, 174, .45)` | `color-mix(in srgb, var(--teal) 45%, transparent)` |
| nodes 142 | `rgba(0, 0, 0, .7)` | `color-mix(in srgb, var(--text) 30%, transparent)` |
| nodes 193 | `#fff` | `var(--bg)` |
| nodes 253、287 | `rgba(242, 165, 60, a)` | `color-mix(in srgb, var(--amber) <a×100>%, transparent)` |
| panels 7 | 整个 `box-shadow` | `var(--shadow-panel)` |
| panels 107 | 整个 `box-shadow` | `var(--shadow-panel)` |

   监视器和图片上的字（nodes 20、84–87、174、223–234、246、266–286；panels 50、104）保留原来的写死值。

- [ ] **Step 4: `skin.css`**

```css
.mj-board {
  --bg: var(--color-app);
  --panel: var(--color-panel);
  --card: var(--color-card);
  --card-2: var(--color-control);
  --mon: #0d0f12;
  --line: var(--color-edge);
  --line-2: var(--color-hairline);
  --text: var(--color-ink);
  --text-2: var(--color-ink-secondary);
  --text-3: var(--color-ink-tertiary);
  --paper: var(--color-menu);
  --paper-2: var(--color-panel);
  --paper-line: var(--color-hairline);
  --ink: var(--color-ink);
  --ink-2: var(--color-ink-secondary);
  --ink-3: var(--color-ink-tertiary);
  --amber: var(--color-warning);
  --amber-ink: var(--color-warning);
  --teal: var(--color-success);
  --teal-ink: var(--color-success);
  --on-fill: var(--color-app);
  --on-teal: var(--color-success-ink);
  --danger: var(--color-danger);
  --r: 10px;
  --r-sm: 6px;
  --sans: var(--font-sans);
  --mono: var(--font-mono);
  --ew: 1;
  --ls: 1;
  --shadow-node: 0 8px 24px color-mix(in srgb, var(--color-ink) 10%, transparent), 0 1px 3px color-mix(in srgb, var(--color-ink) 8%, transparent);
  --shadow-node-drag: 0 20px 48px color-mix(in srgb, var(--color-ink) 22%, transparent);
  --shadow-node-sel: 0 14px 36px color-mix(in srgb, var(--color-ink) 18%, transparent);
  --shadow-float: 0 10px 30px color-mix(in srgb, var(--color-ink) 16%, transparent);
  --shadow-panel: 0 24px 70px color-mix(in srgb, var(--color-ink) 22%, transparent);
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: var(--bg);
  color: var(--text);
  font: 14px/1.5 var(--sans);
  -webkit-font-smoothing: antialiased;
}

@container style(--code-color-scheme: dark) {
  .mj-board {
    --shadow-node: 0 12px 32px rgba(0, 0, 0, .4);
    --shadow-node-drag: 0 26px 60px rgba(0, 0, 0, .65);
    --shadow-node-sel: 0 18px 48px rgba(0, 0, 0, .55);
    --shadow-float: 0 10px 30px rgba(0, 0, 0, .5);
    --shadow-panel: 0 24px 70px rgba(0, 0, 0, .62);
  }
}

.mj-board :is(.elabel.t-dispatch, .schip[data-state='done'] .fno) { color: var(--on-teal); }
.mj-board :is(
  .schip[data-state='active'] .fno, .rrow[data-state='working'] .ava, .k-bot[data-state='working'] .bot-ava, .bot-talk, .bot-ep,
  .k-bot[data-state='working'] .pin, .tag, .tk li[data-s='run'] .tk-ic, .role, .refined, .btn-gen, .rs-play:hover,
  .bchat[data-state='working'] .bc-ava, .rt-x, .bc-send, .btn-primary
) { color: var(--on-fill); }
.mj-board .k-bot[data-state='working'] .pin .led { background: var(--on-fill); }

.mj-board :is(.k-result, .k-final, .sn-cap, .code, .rs-tag, .rs-ver, .rt-tag) {
  --text: #e9ebed;
  --text-2: #b6bdc4;
  --text-3: #8d969f;
  --line: #333a42;
  --line-2: #4d5660;
  --amber: #f2a53c;
  --teal: #45bfae;
  --bg: #13161a;
  --card: #22272d;
  --card-2: #2b3138;
  --on-fill: #1c2125;
  color: var(--text);
}
.mj-board .k-result[data-state='todo'] .rs-foot {
  --text: var(--color-ink);
  --text-3: var(--color-ink-tertiary);
}
```

- [ ] **Step 5: `additions.css` 和 `index.css`**

`additions.css`（后面的任务往里加；现在只有这些）：

```css
.mj-board .dm { position: absolute; }

@media (prefers-reduced-motion: reduce) {
  .mj-board *, .mj-board *::before, .mj-board *::after { animation: none !important; transition: none !important; }
}
:root[data-reduced-motion="true"] .mj-board *,
:root[data-reduced-motion="true"] .mj-board *::before,
:root[data-reduced-motion="true"] .mj-board *::after { animation: none !important; transition: none !important; }
```

`index.css`：

```css
@import "./shell.css";
@import "./nodes.css";
@import "./panels.css";
@import "./skin.css";
@import "./additions.css";
```

- [ ] **Step 6: 确认通过**

Run: `OMB_VITEST_WORKERS=2 node node_modules/vitest/vitest.mjs run src/components/production-board/styles/styles.test.ts && pnpm lint`
Expected: PASS。

- [ ] **Step 7: Commit**

```bash
git add src/components/production-board/styles
git commit -m "Production board: the mockup's three stylesheets, kept under the board's root, on the skin's colours"
```

---

### Task 8: 引擎：相机

**Files:**
- Create: `src/components/production-board/engine/camera.ts`
- Test: `src/components/production-board/engine/camera.test.ts`

移植 `app.js`：常量 30–34 行、`applyCam` 277–290、`animateTo` 297–317、`fitRect` 319–333、`zoomAt` 335–343、`zoomBy` 344–349、滚轮 626–633。

**Interfaces:**
- Produces:

```ts
export interface Cam { x: number; y: number; z: number }
export interface Size { width: number; height: number }
export interface Rect { x: number; y: number; w: number; h: number }
export const ZMIN = 0.07;
export const ZMAX = 2;
export const FAR = 0.32;
export const GRID = 28;
export const clampZoom: (z: number) => number;
export function zoomAt(cam: Cam, sx: number, sy: number, nz: number): Cam;
/** The camera after zooming by `k` about the viewport's centre. */
export function zoomAbout(cam: Cam, size: Size, k: number): Cam;
export interface FitOptions { pad?: number; top?: number; minZ?: number; maxZ?: number; anchorLeft?: boolean }
export function fitRect(r: Rect, size: Size, o?: FitOptions): Cam;
export function centreOn(r: Rect, size: Size, z: number): Cam;
/** The camera `k` of the way from `from` to `to`, `k` from 0 to 1 before easing. */
export function tween(from: Cam, to: Cam, size: Size, k: number): Cam;
export function wheelFactor(deltaY: number, deltaMode: number, pinch: boolean): number;
export function gridStep(z: number): number;
export function lineScale(z: number): { ew: number; ls: number };
export function visibleWorld(cam: Cam, size: Size, margin?: number): Rect;
export const intersects: (a: Rect, b: Rect) => boolean;
export const toScreen: (r: Rect, cam: Cam) => Rect;
export class CameraStore {
  constructor(cam?: Cam, options?: { reduced?: () => boolean });
  cam: Cam;
  size: Size;
  readonly animating: boolean;
  set(cam: Cam): void;
  glide(to: Cam, ms: number): void;
  stop(): void;
  subscribe(listener: () => void): () => void;
}
```

- [ ] **Step 1: 写失败的测试**

```ts
import { describe, expect, it, vi } from "vitest";
import { CameraStore, centreOn, fitRect, gridStep, intersects, lineScale, toScreen, tween, visibleWorld, wheelFactor, zoomAbout, zoomAt } from "./camera";

const SIZE = { width: 1200, height: 800 };

describe("the board's camera", () => {
  it("zooms about a point of the screen, between 7% and 200%", () => {
    expect(zoomAt({ x: 0, y: 0, z: 1 }, 100, 50, 2)).toEqual({ x: -100, y: -50, z: 2 });
    expect(zoomAt({ x: 0, y: 0, z: 1 }, 0, 0, 5).z).toBe(2);
    expect(zoomAt({ x: 0, y: 0, z: 1 }, 0, 0, 0.01).z).toBe(0.07);
    expect(zoomAbout({ x: 0, y: 0, z: 1 }, SIZE, 2)).toEqual({ x: -600, y: -400, z: 2 });
  });

  it("fits a rect between the stage bar above and the toolbar below", () => {
    expect(fitRect({ x: 0, y: 0, w: 1000, h: 500 }, SIZE)).toEqual({ x: 100, y: 152, z: 1 });
    const wide = fitRect({ x: 0, y: 0, w: 4000, h: 500 }, SIZE);
    expect(wide.z).toBeCloseTo(0.276, 5);
    expect(wide.x).toBeCloseTo(48, 5);
    expect(wide.y).toBeCloseTo(333, 5);
    expect(fitRect({ x: 0, y: 0, w: 4000, h: 500 }, SIZE, { minZ: 0.6, anchorLeft: true })).toMatchObject({ x: 48, z: 0.6 });
  });

  it("centres a rect at a zoom", () => {
    expect(centreOn({ x: 100, y: 100, w: 200, h: 100 }, SIZE, 0.5)).toEqual({ x: 500, y: 325, z: 0.5 });
  });

  it("moves between two views with the zoom changing by ratio", () => {
    const from = { x: 0, y: 0, z: 1 };
    const to = { x: 0, y: 0, z: 4 };
    const size = { width: 800, height: 600 };
    expect(tween(from, to, size, 0)).toEqual(from);
    expect(tween(from, to, size, 1)).toEqual(to);
    const half = tween(from, to, size, 0.5);
    expect(half.z).toBeCloseTo(2, 9);
    expect(half.x).toBeCloseTo(-100, 9);
    expect(half.y).toBeCloseTo(-75, 9);
  });

  it("reads a wheel: a pinch is stronger, a line is sixteen pixels", () => {
    expect(wheelFactor(100, 0, false)).toBeCloseTo(Math.exp(-0.16), 12);
    expect(wheelFactor(10, 0, true)).toBeCloseTo(Math.exp(-0.12), 12);
    expect(wheelFactor(3, 1, false)).toBeCloseTo(Math.exp(-0.0768), 12);
  });

  it("coarsens the grid and thickens the lines as it zooms out", () => {
    expect([1, 0.5, 0.3, 0.1].map(gridStep).map((step) => Math.round(step * 10) / 10)).toEqual([28, 28, 33.6, 22.4]);
    expect(lineScale(1)).toEqual({ ew: 1, ls: 1 });
    expect(lineScale(0.25)).toEqual({ ew: 3, ls: 4 });
    expect(lineScale(0.05)).toEqual({ ew: 10, ls: 13 });
  });

  it("says what of the world is in view", () => {
    expect(visibleWorld({ x: -100, y: -50, z: 2 }, SIZE, 0)).toEqual({ x: 50, y: 25, w: 600, h: 400 });
    expect(toScreen({ x: 50, y: 25, w: 600, h: 400 }, { x: -100, y: -50, z: 2 })).toEqual({ x: 0, y: 0, w: 1200, h: 800 });
    expect(intersects({ x: 0, y: 0, w: 10, h: 10 }, { x: 9, y: 9, w: 5, h: 5 })).toBe(true);
    expect(intersects({ x: 0, y: 0, w: 10, h: 10 }, { x: 10, y: 0, w: 5, h: 5 })).toBe(false);
  });
});

describe("the camera's store", () => {
  it("tells who listens of each view, and goes straight to a view when motion is reduced or no time is given", () => {
    const store = new CameraStore({ x: 0, y: 0, z: 1 }, { reduced: () => true });
    store.size = SIZE;
    const told = vi.fn();
    const stop = store.subscribe(told);
    store.set({ x: 5, y: 5, z: 1 });
    store.glide({ x: 9, y: 9, z: 2 }, 700);
    expect(store.cam).toEqual({ x: 9, y: 9, z: 2 });
    expect(store.animating).toBe(false);
    expect(told).toHaveBeenCalledTimes(2);
    stop();
    store.set({ x: 0, y: 0, z: 1 });
    expect(told).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: 确认失败**

Run: `OMB_VITEST_WORKERS=2 node node_modules/vitest/vitest.mjs run src/components/production-board/engine/camera.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现**

逐个移植上面列出的 `app.js` 行段：
- `zoomAt`：`app.js:335-343`，改成返回新对象，不调 `applyCam`。
- `zoomAbout`：`app.js:344-349` 里算目标相机的那一行。
- `fitRect`：`app.js:319-333` 原样，`W`、`H` 取 `size`；`insetBottom = 56`，`insetTop = o.top ?? 60`，`pad = o.pad ?? 48`。
- `tween`：`app.js:300-312` 的循环体，`k` 先过 `k < 0.5 ? 4*k*k*k : 1 - Math.pow(-2*k + 2, 3) / 2`；`k <= 0` 直接返回 `from`，`k >= 1` 直接返回 `to`。
- `wheelFactor`：`app.js:630-631`。
- `gridStep`、`lineScale`：`app.js:279`、`:283-284`。
- `CameraStore.glide`：`app.js:297-317`，用 `requestAnimationFrame` 逐帧 `set(tween(...))`；`options.reduced?.()` 为真或 `ms` 为 0 时直接 `set(to)`。`stop` 取消动画帧。`animating` 在动画期间为真。

- [ ] **Step 4: 确认通过并提交**

Run: `OMB_VITEST_WORKERS=2 node node_modules/vitest/vitest.mjs run src/components/production-board/engine/camera.test.ts && pnpm exec tsc -b`
Expected: PASS。

```bash
git add src/components/production-board/engine/camera.ts src/components/production-board/engine/camera.test.ts
git commit -m "Production board: the mockup's camera, its zoom about a point, its fit and its eased move"
```

---

### Task 9: 引擎：布局

**Files:**
- Create: `src/components/production-board/engine/layout.ts`
- Test: `src/components/production-board/engine/layout.test.ts`

移植 `app.js` `layout` 66–124、`bbox` 131–139、`worldRect` 140–143、`updateStageRects` 147–152、`markStage` 474–485，按设计 8.3 推广到任意集数。

**Interfaces:**
- Consumes: `Board`、`BoardCard`（`@/lib/production-board/types`）、`BoardStage`、`BOARD_STAGES`（`@/lib/production-board/overlay`）、`Rect`（`./camera`）。
- Produces:

```ts
export const CARD_WIDTH: Record<BoardCard["kind"], number>; // bot 320, brief 330, plan 330, episode 400, stack 400, character 400, scene 340, shot 470, result 320, final 620, other 320
export const LEAD_WIDTH = 380;
export const ESTIMATED_HEIGHT: Record<BoardCard["kind"], number>; // bot 380, brief 339, plan 299, episode 281, stack 255, character 210, scene 264, shot 270, result 218, final 600, other 220
export const cardWidth: (card: BoardCard) => number;
export interface BoardLayout {
  rects: Map<string, Rect>;
  /** Each stage's cards, grown by 48. */
  stages: Partial<Record<BoardStage, Rect>>;
  /** Each unfolded episode's shots, post bot and film. */
  blocks: Map<number, Rect>;
  /** Every card, grown by 60. */
  bounds: Rect;
}
export function bbox(rects: Iterable<Rect>): Rect | undefined;
export function layoutBoard(board: Board, heightOf: (card: BoardCard) => number): BoardLayout;
/** The stage the view's centre is in, as the stage bar marks it; none when zoomed out past 20% or outside them all. */
export function stageAt(stages: Partial<Record<BoardStage, Rect>>, centre: { x: number; y: number }, zoom: number): BoardStage | undefined;
```

- [ ] **Step 1: 写失败的测试**

```ts
import { describe, expect, it } from "vitest";
import type { Board, BoardCard } from "@/lib/production-board/types";
import { bbox, cardWidth, layoutBoard, stageAt } from "./layout";

const HEIGHT: Record<string, number> = { bot: 300, brief: 340, plan: 300, episode: 280, stack: 250, character: 210, scene: 264, shot: 270, result: 218, final: 600, other: 220 };
const heightOf = (card: BoardCard) => (card.kind === "bot" && card.lead ? 500 : HEIGHT[card.kind]!);
const card = (kind: BoardCard["kind"], id: string, more: Record<string, unknown> = {}) => ({ kind, id, nodeIds: [id], ...more }) as unknown as BoardCard;
const bot = (id: string, job: string | undefined, more: Record<string, unknown> = {}) => card("bot", id, { botId: id, lead: false, job, ...more });

const CARDS: BoardCard[] = [
  bot("lead", undefined, { lead: true, stage: "brief" }),
  card("brief", "brief", { stage: "brief" }), card("plan", "plan", { stage: "brief" }),
  bot("writer", "script", { stage: "script" }),
  card("episode", "ep1", { episode: 1, stage: "script" }), card("episode", "ep2", { episode: 2, stage: "script" }), card("stack", "stack", { stage: "script" }),
  bot("faces", "character", { stage: "library" }), bot("sets", "scene", { stage: "library" }),
  card("character", "c1", { stage: "library" }), card("character", "c2", { stage: "library" }), card("scene", "s1", { stage: "library" }),
  bot("b1", "storyboard", { episode: 1, stage: "storyboard" }), bot("b2", "storyboard", { episode: 2, stage: "storyboard" }),
  card("shot", "sh1", { episode: 1, stage: "storyboard" }), card("result", "v1", { episode: 1, shotId: "sh1", stage: "storyboard" }),
  card("shot", "sh2", { episode: 1, stage: "storyboard" }), card("result", "v2", { episode: 1, shotId: "sh2", stage: "storyboard" }),
  card("shot", "sh3", { episode: 2, stage: "storyboard" }),
  bot("p1", "post", { episode: 1, stage: "post" }), card("final", "f1", { episode: 1, stage: "post" }),
];
const board = (cards: BoardCard[] = CARDS) => ({ empty: false, cards, edges: [], stages: {}, unfolded: [1, 2], folded: [3], cardOfNode: new Map(), episodeOfNode: new Map() }) as unknown as Board;
const at = (cards?: BoardCard[]) => {
  const { rects } = layoutBoard(board(cards), heightOf);
  return (id: string) => { const r = rects.get(id)!; return [r.x, r.y]; };
};

describe("the board's layout", () => {
  it("gives each card its kind's width, the lead's wider", () => {
    expect(CARDS.map(cardWidth)).toEqual([380, 330, 330, 320, 400, 400, 400, 320, 320, 400, 400, 340, 320, 320, 470, 320, 470, 320, 470, 320, 620]);
  });

  it("stands the lead, the brief and the plan, and the script bot on the mockup's first columns", () => {
    const xy = at();
    expect(xy("lead")).toEqual([0, -250]);
    expect(xy("brief")).toEqual([500, -344]);
    expect(xy("plan")).toEqual([500, 44]);
    expect(xy("writer")).toEqual([960, -150]);
  });

  it("stacks the episodes with the stack under them, the character bot above and the scene bot below", () => {
    const xy = at();
    expect([xy("ep1"), xy("ep2"), xy("stack")]).toEqual([[1640, -433], [1640, -125], [1640, 183]]);
    expect(xy("faces")).toEqual([1640, -903]);
    expect(xy("sets")).toEqual([1640, 511]);
  });

  it("stacks the storyboard bots between the characters above and the scenes below", () => {
    const xy = at();
    expect([xy("b1"), xy("b2")]).toEqual([[2260, -322], [2260, 22]]);
    expect([xy("c1"), xy("c2")]).toEqual([[2260, -977], [2260, -739]]);
    expect(xy("s1")).toEqual([2260, 529]);
  });

  it("gives each unfolded episode a block of its shots and their videos, the first about its storyboard bot, the next 120 below", () => {
    const xy = at();
    expect([xy("sh1"), xy("v1")]).toEqual([[2960, -459], [3550, -433]]);
    expect([xy("sh2"), xy("v2")]).toEqual([[2960, -155], [3550, -129]]);
    expect([xy("p1"), xy("f1")]).toEqual([[4110, -322], [4580, -472]]);
    expect(xy("sh3")).toEqual([2960, 248]);
    const { blocks } = layoutBoard(board(), heightOf);
    expect(blocks.get(1)).toEqual({ x: 2960, y: -472, w: 2240, h: 600 });
    expect(blocks.get(2)).toEqual({ x: 2960, y: 248, w: 470, h: 270 });
  });

  it("puts a scene a storyboard bot refined above its episode's shots", () => {
    const xy = at([...CARDS, card("scene", "s1a", { episode: 1, refinedBy: "b1", stage: "storyboard" })]);
    expect(xy("s1a")).toEqual([2960, -459 - 34 - 264]);
    expect(xy("s1")).toEqual([2260, 529]);
  });

  it("leaves a card the person moved where they put it, and rows what is outside the production under the rest", () => {
    const xy = at([...CARDS, card("other", "note"), card("brief", "brief", { stage: "brief", moved: { x: 7, y: 9 } })].filter((one, index, list) => one.id !== "brief" || index === list.length - 1));
    expect(xy("brief")).toEqual([7, 9]);
    expect(xy("note")[0]).toBe(0);
    expect(xy("note")[1]).toBeGreaterThan(529 + 264);
  });

  it("spans each stage by its cards grown by 48, and the world by all of them grown by 60", () => {
    const { stages, bounds, rects } = layoutBoard(board(), heightOf);
    expect(stages.brief).toEqual({ x: -48, y: -392, w: 926, h: 784 });
    const all = bbox(rects.values())!;
    expect(bounds).toEqual({ x: all.x - 60, y: all.y - 60, w: all.w + 120, h: all.h + 120 });
  });

  it("names the stage the view's centre is in, with 200 to spare above and below, and none when zoomed out past 20%", () => {
    const { stages } = layoutBoard(board(), heightOf);
    expect(stageAt(stages, { x: 200, y: 0 }, 1)).toBe("brief");
    expect(stageAt(stages, { x: 200, y: 560 }, 1)).toBe("brief");
    expect(stageAt(stages, { x: 200, y: 700 }, 1)).toBeUndefined();
    expect(stageAt(stages, { x: 200, y: 0 }, 0.19)).toBeUndefined();
  });
});
```

- [ ] **Step 2: 确认失败**

Run: `OMB_VITEST_WORKERS=2 node node_modules/vitest/vitest.mjs run src/components/production-board/engine/layout.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现**

常量照 `app.js:73-81`：`G = 28`、`RG = 34`、`SPLIT = 96`、`XA = 1640`、`XB = 2260`、`XS = 2960`、`XV = XS + 470 + 120`、`XP = XV + 320 + 240`、`XF = XP + 320 + 150`，另 `OUTS_X = 500`、`OUTS_GAP = 48`、`WRITER_X = 960`、`BOARDERS_GAP = 44`、`BLOCK_GAP = 120`、`OTHERS_PER_ROW = 8`、`OTHERS_GAP = 240`。辅助函数 `at`、`mid`、`stackH`、`stack` 照 `app.js:68-71`（`y` 取整）。

把卡片分到位：
- 负责人：`kind === "bot" && lead`；没有岗位又不是负责人的 bot（`job === undefined && !lead`）在负责人下方依次堆叠，间隔 `G`。
- `brief`、`plan`：`OUTS_X`，整体关于 0 居中，间隔 48。
- 编剧（`job === "script"`）：`mid(WRITER_X, 0)`。
- `XA`：`episode` 卡按集数排，后面是 `stack`，整体关于 0 居中，间隔 `G`。
- `XB` 中段：`job === "storyboard"` 的 bot 按集数排，关于 0 居中，间隔 44。
- `band = max(epH, dsH) / 2 + SPLIT`。没有细化标记（`refinedBy` 为空）的角色卡从 `-band - chH` 起堆，场景卡从 `band` 起堆，间隔 `G`；角色设计师 `mid(XA, -band - chH / 2)`，场景设计师 `mid(XA, band + snH / 2)`。
- 镜头块：对 `board.unfolded` 里的每一集，按顺序：
  - `shots` = 该集的 `shot` 卡；`refined` = 该集带 `refinedBy` 的场景卡；`post` = 该集 `job === "post"` 的 bot；`final` = 该集的 `final` 卡。四者都没有就跳过。
  - `rowH = max(该集所有 shot 和 result 的高) + RG`；`rowsH = shots.length ? rowH * shots.length - RG : 0`；`blockH = max(rowsH, post 的高, final 的高)`。
  - 第一块：`centre` = 第一位分镜师的中点（没有分镜师取 0），`blockTop = centre - blockH / 2`。其后每块：`blockTop = 上一块的底 + BLOCK_GAP`，`centre = blockTop + blockH / 2`。
  - 行：`top = centre - rowsH / 2`；第 `i` 行 `cy = top + i * rowH + (rowH - RG) / 2`，`mid(shot, XS, cy)`，对应的 `result`（`shotId === shot.id`）`mid(XV, cy)`。
  - 细化的场景从 `top - RG - 它的高` 向上依次堆，间隔 `RG`。
  - `post`：`mid(XP, centre)`；`final`：`mid(XF, centre)`。
  - `blocks.set(episode, bbox(该块的 shot、result、post、final))`。
- 其余没放的卡片（`other`）：排在已放卡片的外接框下方 `OTHERS_GAP` 处，每行 8 个，格宽、格高取它们的最大宽、高加 `RG`，从 `x = 0` 起。
- 最后：`card.moved` 存在的，矩形改到 `moved`。
- `stages`：每个阶段的卡片 `bbox` 外扩 48。`bounds`：全部卡片 `bbox` 外扩 60；没有卡片时 `{ x: 0, y: 0, w: 0, h: 0 }`。
- `stageAt`：照 `app.js:474-485`，`zoom < 0.2` 返回 `undefined`；按 `BOARD_STAGES` 顺序，后面的阶段覆盖前面的。

- [ ] **Step 4: 确认通过并提交**

Run: `OMB_VITEST_WORKERS=2 node node_modules/vitest/vitest.mjs run src/components/production-board/engine/layout.test.ts && pnpm exec tsc -b`
Expected: PASS。

```bash
git add src/components/production-board/engine/layout.ts src/components/production-board/engine/layout.test.ts
git commit -m "Production board: the mockup's columns and gaps, with a block of shots for each unfolded episode"
```

---

### Task 10: 引擎：连线路径

**Files:**
- Create: `src/components/production-board/engine/edge-paths.ts`
- Test: `src/components/production-board/engine/edge-paths.test.ts`

移植 `app.js` `assignPorts` 187–229、`port` 231–236、`drawEdge` 238–268。

**Interfaces:**
- Consumes: `BoardEdge`、`BoardCard`（`@/lib/production-board/types`）、`Rect`（`./camera`）。
- Produces:

```ts
export interface EdgePath {
  d: string;
  arrow: string;
  /** Where the line leaves its card: the small circle. */
  start: { x: number; y: number };
  label: { x: number; y: number };
  bounds: Rect;
}
export function edgePaths(edges: readonly BoardEdge[], rects: ReadonlyMap<string, Rect>, kinds: ReadonlyMap<string, BoardCard["kind"]>): Map<string, EdgePath>;
```

每条线从起点卡片的右边出、进终点卡片的左边（效果图的数据没有别的方向）。数字保留一位小数。

- [ ] **Step 1: 写失败的测试**

```ts
import { describe, expect, it } from "vitest";
import type { BoardCard, BoardEdge } from "@/lib/production-board/types";
import type { Rect } from "./camera";
import { edgePaths } from "./edge-paths";

const edge = (id: string, from: string, to: string, kind: BoardEdge["kind"] = "output"): BoardEdge => ({ id, kind, state: "done", from, to });
const box = (x: number, y: number, w = 100, h = 100): Rect => ({ x, y, w, h });
const kinds = (entries: Array<[string, BoardCard["kind"]]> = []) => new Map(entries);

describe("a line between two cards", () => {
  it("leaves by the right, enters by the left 7 short of the edge, with an arrowhead and its label halfway", () => {
    const path = edgePaths([edge("e", "a", "b")], new Map([["a", box(0, 0)], ["b", box(300, 0)]]), kinds()).get("e")!;
    expect(path.d).toBe("M100,50 C196.5,50 196.5,50 293,50");
    expect(path.arrow).toBe("M300,50 L291,45.5 L291,54.5 Z");
    expect(path.start).toEqual({ x: 100, y: 50 });
    expect(path.label).toEqual({ x: 196.5, y: 50 });
    expect(path.bounds).toEqual({ x: 100, y: 50, w: 200, h: 0 });
  });

  it("is not drawn when a card of it has no place", () => {
    expect(edgePaths([edge("e", "a", "gone")], new Map([["a", box(0, 0)]]), kinds()).size).toBe(0);
  });
});

describe("lines that share a side of a card", () => {
  it("spread along it in the order of the cards at their other ends", () => {
    const rects = new Map([["a", box(0, 100)], ["up", box(300, 0)], ["down", box(300, 200)]]);
    const paths = edgePaths([edge("to-down", "a", "down"), edge("to-up", "a", "up")], rects, kinds());
    expect(paths.get("to-up")!.start).toEqual({ x: 100, y: 139 });
    expect(paths.get("to-down")!.start).toEqual({ x: 100, y: 161 });
  });
});

describe("a reference line", () => {
  it("leaves its card by one port toward the shots, a character's entering a shot above the middle and a scene's below", () => {
    const rects = new Map([["face", box(0, 0, 100, 200)], ["place", box(0, 400, 100, 200)], ["shot", box(400, 200, 100, 100)]]);
    const paths = edgePaths([edge("c", "face", "shot", "ref"), edge("s", "place", "shot", "ref")], rects, kinds([["face", "character"], ["place", "scene"], ["shot", "shot"]]));
    expect(paths.get("c")!.start).toEqual({ x: 100, y: 154 });
    expect(paths.get("s")!.start).toEqual({ x: 100, y: 446 });
    expect(paths.get("c")!.arrow.startsWith("M400,214 ")).toBe(true);
    expect(paths.get("s")!.arrow.startsWith("M400,280 ")).toBe(true);
  });
});
```

（引用线的数：角色卡高 200，出口偏移 `+200 × 0.27 = 54`，所以 `100 + 54 = 154`；场景卡的中心 500、镜头中心 250 在它上方，偏移 `-54`，所以 `446`。镜头高 100：角色线进 `250 - 100 × 0.36 = 214`，场景线进 `250 + 100 × 0.3 = 280`。）

- [ ] **Step 2: 确认失败**

Run: `OMB_VITEST_WORKERS=2 node node_modules/vitest/vitest.mjs run src/components/production-board/engine/edge-paths.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现**

照 `app.js:187-268`：
- 非引用线按 `起点卡:r`、`终点卡:l` 分组，组内按另一端卡片的中心 `y` 排序，`step = min(24, (高 - 56) / max(1, 条数))`，第 `i` 条偏移 `(i - (n - 1) / 2) * step`。
- 引用线：同一素材的所有引用线共用一个出口，偏移 `±高 × 0.27`，正负取决于它们终点的平均中心 `y` 在素材中心的下方还是上方；进镜头时角色线按起点卡的 `y` 排序，第 `i` 条偏移 `-高 × (0.36 - 0.12 × i)`，其余（场景）偏移 `+高 × 0.3`。
- 曲线：`p1` = 出口，`tip` = 入口，`p2 = tip` 往外退 7；控制点距离 `clamp(|dx| × 0.5, 40, 300)`；箭头长 9、半宽 4.5；标签点是 `t = 0.5` 处的贝塞尔点。
- `bounds` 是 `p1`、两个控制点、`p2`、`tip` 的外接框。

- [ ] **Step 4: 确认通过并提交**

Run: `OMB_VITEST_WORKERS=2 node node_modules/vitest/vitest.mjs run src/components/production-board/engine/edge-paths.test.ts && pnpm exec tsc -b`
Expected: PASS。

```bash
git add src/components/production-board/engine/edge-paths.ts src/components/production-board/engine/edge-paths.test.ts
git commit -m "Production board: the mockup's lines, their ports spread along a card's side and their references fanned"
```

---

### Task 11: 引擎：小地图和剧本分行

**Files:**
- Create: `src/components/production-board/engine/minimap.ts`、`script-page.ts`
- Test: `src/components/production-board/engine/minimap.test.ts`、`script-page.test.ts`

小地图移植 `app.js` `setupMinimap` 417–428、`drawMinimap` 429–453、`miniJump` 454–462。

**Interfaces:**
- Produces（`minimap.ts`）：

```ts
export interface MinimapFrame { world: Rect; scale: number; width: number; height: number }
export function minimapFrame(world: Rect, cssWidth: number): MinimapFrame;
export function minimapPoint(frame: MinimapFrame, px: number, py: number): { x: number; y: number };
export interface MinimapColors { bg: string; plain: string; working: string; done: string; idle: string; sheet: string; view: string; viewFill: string }
/** A card's colour on the map: a bot by its state, a sheet of paper, a video by its state, else plain. */
export function minimapColor(kind: BoardCard["kind"], state: "done" | "working" | "waiting" | "failed" | undefined, colors: MinimapColors): string;
export function drawMinimap(ctx: CanvasRenderingContext2D, frame: MinimapFrame, dpr: number, items: ReadonlyArray<{ rect: Rect; color: string }>, cam: Cam, size: Size, colors: MinimapColors): void;
```

- Produces（`script-page.ts`）：

```ts
export type ScriptLine = { k: "slug" | "act" | "who" | "dlg"; t: string };
/** An episode's script as the lines of a script page: scene headings, action, who speaks and what they say. */
export function scriptPage(text: string, max?: number): ScriptLine[];
```

- [ ] **Step 1: 写失败的测试**

`minimap.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { minimapColor, minimapFrame, minimapPoint, type MinimapColors } from "./minimap";

const COLORS: MinimapColors = { bg: "bg", plain: "plain", working: "working", done: "done", idle: "idle", sheet: "sheet", view: "view", viewFill: "fill" };

describe("the minimap", () => {
  it("is as wide as its box and as tall as the world's shape", () => {
    expect(minimapFrame({ x: -60, y: -60, w: 2000, h: 1000 }, 208)).toEqual({ world: { x: -60, y: -60, w: 2000, h: 1000 }, scale: 0.104, width: 208, height: 104 });
  });

  it("turns a point of it into a point of the world", () => {
    const frame = minimapFrame({ x: -60, y: -60, w: 2000, h: 1000 }, 208);
    const at = minimapPoint(frame, 104, 52);
    expect(at.x).toBeCloseTo(940, 6);
    expect(at.y).toBeCloseTo(440, 6);
  });

  it("colours a bot by its state, paper as paper and a video by its state", () => {
    expect(minimapColor("bot", "working", COLORS)).toBe("working");
    expect(minimapColor("bot", "done", COLORS)).toBe("done");
    expect(minimapColor("bot", "waiting", COLORS)).toBe("idle");
    expect((["brief", "plan", "episode", "stack", "shot"] as const).map((kind) => minimapColor(kind, undefined, COLORS))).toEqual(["sheet", "sheet", "sheet", "sheet", "sheet"]);
    expect(minimapColor("result", "done", COLORS)).toBe("done");
    expect(minimapColor("result", "working", COLORS)).toBe("working");
    expect(minimapColor("result", "waiting", COLORS)).toBe("plain");
    expect(minimapColor("character", undefined, COLORS)).toBe("plain");
  });
});
```

`script-page.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { scriptPage } from "./script-page";

describe("an episode's script as a script page", () => {
  it("reads headings as scene lines, a name and a colon as who speaks and what they say, and the rest as action", () => {
    const text = "## 场 1　外景　码头 — 夜\n\n浓雾里，一排灯柱一路熄到尽头。\n\n阿满（画外）：十年了，没人敢点这盏灯。\n\n**内景 灯铺**\n青梧擦亮一盏旧灯。";
    expect(scriptPage(text)).toEqual([
      { k: "slug", t: "场 1　外景　码头 — 夜" },
      { k: "act", t: "浓雾里，一排灯柱一路熄到尽头。" },
      { k: "who", t: "阿满（画外）" },
      { k: "dlg", t: "十年了，没人敢点这盏灯。" },
      { k: "slug", t: "内景 灯铺" },
      { k: "act", t: "青梧擦亮一盏旧灯。" },
    ]);
  });

  it("reads English headings and names, and does not take a long sentence with a colon for a line of dialogue", () => {
    expect(scriptPage("INT. LAMP SHOP - NIGHT\nMEI: Ten years.\nShe remembers what the keeper said: never light it again, whatever happens.")).toEqual([
      { k: "slug", t: "INT. LAMP SHOP - NIGHT" },
      { k: "who", t: "MEI" },
      { k: "dlg", t: "Ten years." },
      { k: "act", t: "She remembers what the keeper said: never light it again, whatever happens." },
    ]);
  });

  it("keeps the first lines only", () => {
    expect(scriptPage(Array.from({ length: 40 }, (_, at) => `Line ${at}`).join("\n"), 14)).toHaveLength(14);
    expect(scriptPage("")).toEqual([]);
  });
});
```

- [ ] **Step 2: 确认失败**

Run: `OMB_VITEST_WORKERS=2 node node_modules/vitest/vitest.mjs run src/components/production-board/engine/minimap.test.ts src/components/production-board/engine/script-page.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现**

`minimap.ts`：
- `minimapFrame`：`scale = cssWidth / world.w`，`height = Math.round(world.h * scale)`（`app.js:419-421`）。
- `minimapPoint`：`app.js:456-457`。
- `minimapColor`：`app.js:437-440`，用 `colors` 里的名字代替写死的颜色（`#5d6771 → plain`、`#cfcdc5 → sheet`、`#2f8176 → done`、`#3a424a → plain`）。
- `drawMinimap`：`app.js:431-452`，`ctx.setTransform(dpr, …)`，清空、填底、逐个画矩形（最小 2×2）、画视口框（填充 `viewFill`，描边 `view`，线宽 1.25）。

`script-page.ts`：

```ts
export type ScriptLine = { k: "slug" | "act" | "who" | "dlg"; t: string };

const HEADING = /^(#{1,6}\s+|场\s*\d|第.{1,4}场|内景|外景|int\.|ext\.|scene\s+\d)/i;
const SPOKEN = /^([^：:]{1,16})[：:]\s*(\S.*)$/;
const plain = (line: string) => line.replace(/^#{1,6}\s+/, "").replace(/\*\*(.+?)\*\*/g, "$1").replace(/^[-*]\s+/, "").trim();

/** An episode's script as the lines of a script page: scene headings, action, who speaks and what they say. */
export function scriptPage(text: string, max = 14): ScriptLine[] {
  const lines: ScriptLine[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const bold = /^\*\*(.+)\*\*$/.exec(raw.trim());
    const line = plain(raw);
    if (!line) continue;
    const spoken = SPOKEN.exec(line);
    if (HEADING.test(raw.trim()) || (bold && HEADING.test(bold[1]!))) lines.push({ k: "slug", t: line });
    else if (spoken) lines.push({ k: "who", t: spoken[1]!.trim() }, { k: "dlg", t: spoken[2]!.trim() });
    else lines.push({ k: "act", t: line });
    if (lines.length >= max) break;
  }
  return lines.slice(0, max);
}
```

- [ ] **Step 4: 确认通过并提交**

Run: `OMB_VITEST_WORKERS=2 node node_modules/vitest/vitest.mjs run src/components/production-board/engine && pnpm exec tsc -b`
Expected: PASS。测试里“长句带冒号不算台词”一条若失败，说明 `SPOKEN` 的 16 字上限对那句英文不够严：把判定改成“冒号前不含空格以外的标点且不超过 16 个字符、且整行不超过 60 个字符”，再跑。

```bash
git add src/components/production-board/engine
git commit -m "Production board: the mockup's minimap, and an episode's script read as the lines of a script page"
```

---

### Task 12: 新增的文案

**Files:**
- Modify: `src/locales/en.json`、`zh.json`、`zh-tw.json`、`pt-br.json`

新键加在各文件现有的 `productionBoard.*`、`boardCards.*`、`boardPanels.*` 键的旁边。`zh-tw` 用下表中文的繁体，`pt-br` 按英文翻译，占位符原样保留。

| 键 | en | zh |
|---|---|---|
| `productionBoard.caption.title` | `Stage {number} · {name}` | `阶段 {number} · {name}` |
| `productionBoard.caption.brief` | `You talk to the lead alone. The lead agrees the platform, the style and the number of episodes with you, writes the brief and splits the work.` | `你只和负责人沟通。负责人和你确认平台、风格和集数，写出需求单并拆成任务。` |
| `productionBoard.caption.script` | `The script bot adapts the source into episodes, and hands the character list and the scene list to the two designers.` | `编剧把原著改编成分集剧本，同时把角色表和场景表派给两位设计师。` |
| `productionBoard.caption.library` | `Characters, scenes and episodes run side by side. Storyboards start once all three are done.` | `角色、场景、分集三条线平级，三项都完成后才往下派发分镜。` |
| `productionBoard.caption.storyboard` | `Each episode has a storyboard bot of its own: it designs the shots, and each shot's video is generated.` | `一集配一位分镜师：逐镜设计分镜，并生成每个镜头的视频。` |
| `productionBoard.caption.post` | `Once an episode's videos are all in, its post bot cuts the episode and writes its JianYing draft.` | `一集的分镜视频到齐后，该集的后期剪辑成片并写出剪映草稿。` |
| `productionBoard.canvas.label` | `Production canvas. Drag to pan, scroll to zoom, arrow keys to move, 1 to 5 for a stage, 0 for the whole board. Click a bot to talk to it, any other card for its details.` | `制作画布。拖动平移，滚轮缩放，方向键移动，数字键 1 到 5 跳转阶段，0 查看全局。点击智能体与它对话，点击其他卡片看详情。` |
| `productionBoard.toolbar.zoomReset` | `Zoom {percent}%, click for 100%` | `当前缩放 {percent}%，点击恢复 100%` |
| `productionBoard.toast.refsOn` | `Showing the lines from characters and scenes to the shots that use them` | `已显示角色、场景被各个镜头引用的连线` |
| `productionBoard.toast.refsOff` | `Reference lines hidden` | `已隐藏角色、场景引用线` |
| `productionBoard.legend.title` | `Lines` | `连线图例` |
| `productionBoard.legend.done` | `Output and hand-off, done` | `产出 / 交付 · 已完成` |
| `productionBoard.legend.active` | `Under way` | `进行中` |
| `productionBoard.legend.wait` | `Waiting` | `等待中` |
| `productionBoard.legend.ref` | `Character and scene references, hidden until switched on` | `角色、场景引用线 · 默认隐藏` |
| `productionBoard.skills.lead.1` / `.2` / `.3` | `Brief` / `Source picking` / `Task split` | `需求澄清` / `找书选题` / `任务拆分` |
| `productionBoard.skills.script.1` / `.2` / `.3` | `Adaptation` / `Episode scripts` / `Character notes` | `小说改编` / `分集剧本` / `人物小传` |
| `productionBoard.skills.character.1` / `.2` / `.3` | `Character look` / `Palette` / `Consistency anchors` | `角色定妆` / `色板` / `一致性锚点` |
| `productionBoard.skills.scene.1` / `.2` / `.3` | `Mood picture` / `Lighting` / `Camera positions` | `气氛图` / `光影设定` / `机位建议` |
| `productionBoard.skills.storyboard.1` / `.2` / `.3` | `Shot design` / `Scene refinement` / `Image to video` | `镜头设计` / `场景细化` / `图生视频` |
| `productionBoard.skills.post.1` / `.2` / `.3` | `Editing` / `Voice and music` / `Subtitles and grade` | `剪辑合成` / `配音配乐` / `字幕调色` |
| `boardCards.bot.source.kicker` | `The drama · source novel` | `要做的剧 · 原著小说` |
| `boardCards.bot.source.plan` | `Adapted into {count} episodes` | `改编为 {count} 集` |
| `boardCards.bot.source.cover` | `Cover of “{title}”` | `《{title}》封面` |
| `boardCards.bot.pin.episode` | `{job} · {episode}` | `{job} · {episode}` |
| `boardCards.version` | `v{version}` | `v{version}` |
| `boardCards.plan.foot` | `Storyboards start once the parallel tasks are done` | `平级的任务齐备后开始分镜` |
| `boardCards.plan.parallel` | `Parallel` | `平级` |
| `boardCards.scene.cameras` | `{count} camera positions` | `{count} 机位` |
| `boardCards.character.look` | `Look v{count}` | `定妆 v{count}` |
| `boardCards.shot.noPicture` | `No picture yet` | `尚无画面` |
| `boardCards.final.track.picture` | `Picture` | `画面` |
| `boardCards.final.track.voice` | `Voice` | `配音` |
| `boardCards.final.track.subtitle` | `Subtitles` | `字幕` |
| `boardCards.final.track.music` | `Music` | `音乐` |
| `boardPanels.chat.quick.lead.1` / `.2` | `How is it going?` / `What is still missing?` | `现在进度如何？` / `还差什么？` |
| `boardPanels.chat.quick.script.1` / `.2` | `Which episodes are written?` / `Sum up the story so far` | `哪些集写完了？` / `概括一下目前的剧情` |
| `boardPanels.chat.quick.character.1` / `.2` | `Which characters have their look?` / `Check the characters stay consistent` | `哪些角色定妆了？` / `检查角色的一致性` |
| `boardPanels.chat.quick.scene.1` / `.2` | `Which scenes are done?` / `Which scenes need refining?` | `哪些场景完成了？` / `哪些场景需要细化？` |
| `boardPanels.chat.quick.storyboard.1` / `.2` | `How far is this episode?` / `Which shots have no video yet?` | `这一集进行到哪了？` / `哪些镜头还没有视频？` |
| `boardPanels.chat.quick.post.1` / `.2` | `What is the film waiting for?` / `Is the draft written?` | `成片还在等什么？` / `剪映草稿写好了吗？` |
| `boardPanels.chat.thread` | `Conversation` | `对话` |
| `boardPanels.chat.threadToggle` | `Show or hide the conversation` | `展开或收起对话记录` |
| `boardPanels.details.upstream` | `Upstream · {count}` | `上游 · {count}` |
| `boardPanels.details.downstream` | `Downstream · {count}` | `下游 · {count}` |
| `boardPanels.details.edge.dispatch` / `.output` / `.handoff` / `.gen` / `.derive` / `.ref` | `Task` / `Output` / `Hand-off` / `Video` / `Refined` / `Reference` | `任务派发` / `产出` / `交付` / `生成视频` / `细化衍生` / `引用` |

- [ ] **Step 1: 加键**

按上表把键加进四个文件（斜杠分隔的一行是多个键，各占一条）。

- [ ] **Step 2: 验证并提交**

Run: `pnpm i18n:check && pnpm exec tsc -b`
Expected: PASS。

```bash
git add -p src/locales/en.json src/locales/zh.json src/locales/zh-tw.json src/locales/pt-br.json
git commit -m "Production board: the words the mockup's canvas needs: its stage notes, each job's skills and quick questions, the legend and the film's tracks"
```

---

### Task 13: 节点（一）：框架、Bot、需求单、任务拆分、分集、分集摞

**Files:**
- Create: `src/components/production-board/testing/dom-kit.ts`、`testing/board-fixture.ts`
- Create: `src/components/production-board/nodes/parts.tsx`、`NodeFrame.tsx`、`BotNode.tsx`、`BriefNode.tsx`、`TasksNode.tsx`、`EpisodeNode.tsx`、`EpisodeStackNode.tsx`
- Modify: `src/components/production-board/styles/additions.css`
- Test: `src/components/production-board/nodes/documents.dom.test.ts`、`BotNode.dom.test.ts`

模板来源：`render.js` `bookBlock` 21–31、`gateBlock` 34–38、`tpl.bot` 41–58、`tpl.brief` 61–64、`tpl.tasks` 67–80、`tpl.ep` 83–91、`tpl.epmore` 94–98；节点外壳 `app.js` `buildNodes` 49–64。

**Interfaces:**
- Consumes: `BoardCard` 各类型（任务 6）、`botStatus`、`taskStatus`、`episodeStatus`、`toneState`（`@/lib/production-board/status`）、`Rect`（`../engine/camera`）、`cardWidth`（`../engine/layout`）、`scriptPage`（`../engine/script-page`）、`BotAvatar`（`@/components/Avatar`）。
- Produces（`nodes/parts.tsx`）：

```ts
export interface NodeActions {
  /** Brings a card into view; a bot's also opens its chat. */
  focusCard(cardId: string): void;
  openChat(botId: string): void;
  openStack(): void;
  generate?(nodeId: string): void;
  selectTake?(nodeId: string): void;
  retry?(target: RetryTarget): void;
  openDraft?(): void;
}
export interface NodeContext {
  snapshot: CanvasSnapshot;
  looks: Readonly<Record<string, CanvasBotLook>>;
  fileUrl(file: CanvasFileRef): string;
  /** The take of a shot the film uses, else its newest; none while it has no video. */
  takeOf(shotId: string): BoardTake | undefined;
  actions: NodeActions;
}
export type JobKey = ProductionJob | "lead" | "other";
export const JOB_ICON: Record<JobKey, LucideIcon>; // lead Megaphone, script PenLine, character Drama, scene Mountain, storyboard Clapperboard, post Scissors, other Bot
export const jobKey: (card: Pick<BoardBotCard, "lead" | "job">) => JobKey;
export function Ic(props: { icon: LucideIcon; className?: string }): JSX.Element; // <Icon className="ic …" aria-hidden="true" />
export function Chips(props: { items: readonly string[] }): JSX.Element;          // .chips > .chip
export function Pal(props: { colors: readonly string[]; label: string }): JSX.Element; // span.pal[role=img] > i
export function Meter(props: { percent: number; label: string }): JSX.Element;    // .meter[role=progressbar] > i
export function BotFace(props: { botId: string; ctx: NodeContext; size: number; fallback: JobKey }): JSX.Element; // BotAvatar when the bot has a look, else the job's icon
export function BotButton(props: { botId: string; ctx: NodeContext; suffix?: string; label?: string }): JSX.Element | null; // button.tk-who → actions.focusCard(botNodeId(botId))
export const clock: (ms: number) => string;      // 6000 → "00:06"
export const timeOfDay: (at: number) => string;  // "10:12" in the app's locale
```

- Produces（`nodes/NodeFrame.tsx`）：

```ts
export interface NodeFrameProps {
  card: BoardCard;
  rect: Rect;
  kind: string;            // the mockup's class: "k-bot", "k-brief", …
  label: string;           // aria-label
  state?: string;          // data-state
  vstate?: string;         // data-vstate
  selected?: boolean;
  related?: boolean;
  dragging?: boolean;
  entering?: boolean;      // class "pre"
  onHeight(cardId: string, height: number): void;
  children: ReactNode;
}
export const NodeFrame: (props: NodeFrameProps) => JSX.Element;
```

`NodeFrame` 输出 `<article class="node <kind> [is-sel] [is-rel] [is-drag] [pre]" data-id data-board-card-id data-board-card={card.kind} data-state data-vstate tabindex="0" aria-label style="left; top; width">`，挂载后和每次 `ResizeObserver` 回调时调用 `onHeight(card.id, element.offsetHeight)`（高度没变或量到 0 不调；量到 0 说明环境不排版，比如测试里）。

- Produces：`BotNode`、`BriefNode`、`TasksNode`、`EpisodeNode`、`EpisodeStackNode`，每个是 `(props: { card: <对应的卡片类型>; ctx: NodeContext }) => JSX.Element`，只输出 `NodeFrame` 里面的内容。

- [ ] **Step 1: 测试工具**

`testing/dom-kit.ts`：把备份里的 `backups/canvas-before-mockup-port/src/components/production-board/cards/dom-test-kit.ts` 的内容原样写进来，`useCardPage` 改名 `useBoardPage`，并在 `beforeEach` 里加：

```ts
    vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("reduce"), media: query, addEventListener() {}, removeEventListener() {} }));
```

`afterEach` 里加 `vi.unstubAllGlobals();`（`vi` 从 `vitest` 引入）。

`testing/board-fixture.ts`：

```ts
import { vi } from "vitest";
import { buildBoard } from "@/lib/production-board/board";
import type { BoardCard } from "@/lib/production-board/types";
import { PRODUCTION_BOARD_LOOKS, productionBoardSample, type ProductionBoardSampleOptions } from "@/testing/production-board-sample";
import type { NodeActions, NodeContext } from "../nodes/parts";

/** The sample drama's board with every episode in work unfolded, and a context whose actions record their calls. */
export function boardFixture(options: ProductionBoardSampleOptions = { episodes: 4 }) {
  const snapshot = productionBoardSample(options);
  const board = buildBoard(snapshot);
  const actions = { focusCard: vi.fn(), openChat: vi.fn(), openStack: vi.fn(), generate: vi.fn(), selectTake: vi.fn(), retry: vi.fn(), openDraft: vi.fn() } satisfies NodeActions;
  const takeOf: NodeContext["takeOf"] = (shotId) => {
    const result = board.cards.find((card) => card.kind === "result" && card.shotId === shotId);
    return result?.kind === "result" ? result.takes.find((take) => take.selected) ?? result.takes.at(-1) : undefined;
  };
  const ctx: NodeContext = { snapshot, looks: PRODUCTION_BOARD_LOOKS, fileUrl: (file) => `/files/${file.path}`, takeOf, actions };
  const cardOf = <Kind extends BoardCard["kind"]>(kind: Kind, where: (card: Extract<BoardCard, { kind: Kind }>) => boolean = () => true) =>
    board.cards.find((card): card is Extract<BoardCard, { kind: Kind }> => card.kind === kind && where(card as Extract<BoardCard, { kind: Kind }>))!;
  return { snapshot, board, ctx, actions, cardOf };
}
```

- [ ] **Step 2: 写失败的测试**

`nodes/BotNode.dom.test.ts`：

```ts
// @vitest-environment happy-dom
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { BOARD_BOTS, boarderOf } from "@/testing/production-board-sample";
import { boardFixture } from "../testing/board-fixture";
import { buttonNamed, click, render, textOf, useBoardPage } from "../testing/dom-kit";
import { BotNode } from "./BotNode";

useBoardPage();

const draw = (botId: string, fixture = boardFixture()) => {
  const card = fixture.cardOf("bot", (one) => one.botId === botId);
  return { root: render(createElement("div", null, createElement(BotNode, { card, ctx: fixture.ctx }))), ...fixture, card };
};

describe("a bot's card", () => {
  it("is the mockup's console: a pin for the far view, its head, its task with a meter, its steps and its skills", () => {
    const { root, snapshot } = draw(BOARD_BOTS.lead);
    expect(root.querySelector(".pin")?.getAttribute("aria-hidden")).toBe("true");
    expect(textOf(root.querySelector(".bot-head .bot-id strong"))).toBe(snapshot.bots[BOARD_BOTS.lead]!.name);
    expect(root.querySelector(".bot-head .bot-ava")?.childElementCount).toBe(1);
    expect(root.querySelector(".bot-head .bot-status .led")).not.toBeNull();
    expect(root.querySelector(".bot-task .meter")?.getAttribute("role")).toBe("progressbar");
    expect([...root.querySelectorAll(".bot-foot .chip")].map(textOf)).toEqual(["Brief", "Source picking", "Task split"]);
  });

  it("carries the source on the lead's card alone: its title, who wrote it, a line from it and what it becomes", () => {
    const { root } = draw(BOARD_BOTS.lead);
    expect(textOf(root.querySelector(".bot-book h3"))).toBe("雨城");
    expect(textOf(root.querySelector(".bot-book .nv-meta"))).toBe("南渡 · 都市悬疑 · 46 章 · 38.6 万字");
    expect(textOf(root.querySelector(".bot-book blockquote"))).toBe("雨城的灯，十年没亮过了。");
    expect(textOf(root.querySelector(".bot-book .tag"))).toBe("Adapted into 4 episodes");
    expect(textOf(root.querySelector(".bot-book .nv-cover .nv-title"))).toBe("雨城");
    expect(draw(BOARD_BOTS.writer).root.querySelector(".bot-book")).toBeNull();
  });

  it("marks an episode's storyboard bot with its episode and what it waits for", () => {
    const { root } = draw(boarderOf(1));
    expect(textOf(root.querySelector(".bot-ep"))).toBe("EP01");
    expect(root.querySelectorAll(".bot-gate .gt")).toHaveLength(3);
    expect(textOf(root.querySelector(".pin"))).toContain("EP01");
  });

  it("opens its chat from its button, and offers Retry where its job failed", () => {
    const { root, actions } = draw(BOARD_BOTS.lead);
    click(root.querySelector(".bot-talk"));
    expect(actions.openChat).toHaveBeenCalledWith(BOARD_BOTS.lead);
    const fixture = boardFixture();
    const stopped = fixture.cardOf("bot", (one) => Boolean(one.retry));
    const failed = draw(stopped.botId, fixture);
    click(buttonNamed(failed.root, "Retry"));
    expect(fixture.actions.retry).toHaveBeenCalledWith(stopped.retry);
  });
});
```

`nodes/documents.dom.test.ts`：

```ts
// @vitest-environment happy-dom
import { createElement, type ReactElement } from "react";
import { describe, expect, it } from "vitest";
import { boardFixture } from "../testing/board-fixture";
import { click, render, textOf, useBoardPage } from "../testing/dom-kit";
import { BriefNode } from "./BriefNode";
import { EpisodeNode } from "./EpisodeNode";
import { EpisodeStackNode } from "./EpisodeStackNode";
import { TasksNode } from "./TasksNode";

useBoardPage();
const draw = (element: ReactElement) => render(createElement("div", null, element));

describe("the brief", () => {
  it("is a sheet headed by its code and version, ruled into label and value, stamped once the plan is agreed", () => {
    const { cardOf, ctx } = boardFixture();
    const root = draw(createElement(BriefNode, { card: cardOf("brief"), ctx }));
    expect([...root.querySelectorAll(".pp-head .mono")].map(textOf)).toEqual(["REQ", "v2"]);
    expect(root.querySelectorAll(".spec > div").length).toBe(cardOf("brief").rows.length);
    expect(textOf(root.querySelector(".spec > div dt"))).toBe(cardOf("brief").rows[0]![0]);
    expect(root.querySelector(".pp-foot .stamp")).not.toBeNull();
  });
});

describe("the task split", () => {
  it("lists each task with its state, its number, whether it runs beside others, and the bot it goes to", () => {
    const { cardOf, ctx, actions } = boardFixture();
    const root = draw(createElement(TasksNode, { card: cardOf("plan"), ctx }));
    const rows = [...root.querySelectorAll(".tk > li")];
    expect(rows).toHaveLength(cardOf("plan").tasks.length);
    expect(textOf(rows[0]!.querySelector(".mono"))).toBe("T1");
    expect(["done", "run", "wait", "failed"]).toContain(rows[0]!.getAttribute("data-s"));
    expect(root.querySelectorAll(".tk-t em").length).toBeGreaterThan(0);
    click(rows[0]!.querySelector(".tk-who"));
    expect(actions.focusCard).toHaveBeenCalledWith(`bot:${cardOf("plan").tasks[0]!.botId}`);
  });
});

describe("an episode", () => {
  it("is a punched script page: its number, title and version, its script in lines, and the storyboard bot it went to", () => {
    const { cardOf, ctx } = boardFixture();
    const card = cardOf("episode", (one) => one.episode === 1);
    const root = draw(createElement(EpisodeNode, { card, ctx }));
    expect(root.querySelectorAll(".sc-holes i")).toHaveLength(3);
    expect(textOf(root.querySelector(".pp-head .ep-no"))).toBe("EP01");
    expect(textOf(root.querySelector(".pp-head h3"))).toBe(card.title);
    expect(root.querySelector(".sc-page")?.children.length).toBeGreaterThan(0);
    expect(root.querySelector(".pp-foot .tk-who")).not.toBeNull();
  });
});

describe("the stack of episodes", () => {
  it("names its range and how many it holds, lists its first titles and its last, and opens the list of episodes", () => {
    const fixture = boardFixture({ episodes: 12 });
    const card = fixture.cardOf("stack");
    const root = draw(createElement(EpisodeStackNode, { card, ctx: fixture.ctx }));
    expect(textOf(root.querySelector(".pp-head .ep-no"))).toMatch(/^EP\d+ – EP12$/);
    expect(root.querySelector(".epm .epm-gap")).not.toBeNull();
    click(root.querySelector(".pp-head"));
    expect(fixture.actions.openStack).toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: 确认失败**

Run: `OMB_VITEST_WORKERS=2 node node_modules/vitest/vitest.mjs run src/components/production-board/nodes`
Expected: FAIL（模块不存在）。

- [ ] **Step 4: 实现**

逐个把模板改写成 JSX，类名、元素、层级照 `render.js` 的对应行，文字改成语言键（先在 `en.json` 里找 `boardCards.<类型>.` 开头的现有键，文案对得上就用；任务 12 的表是新增的）。数据对应：

- **BotNode**（`render.js:41-58`）
  - `.pin`：`JOB_ICON[jobKey(card)]` + 岗位名（每集的用 `boardCards.bot.pin.episode`）+ `i.led`。
  - `.bot-ava`：`<BotFace size={40}>`。`.bot-id strong`：名字 + 每集的 `em.bot-ep.mono`（`episodeCode(card.episode)`）。`.bot-id span`：`bot.title`。
  - `.bot-status`：`i.led` + `botStatus(bot, card.jobStatus).label`。
  - `card.source` 存在时画 `.bot-book`（`render.js:21-31`）：有 `cover` 用 `<img src={ctx.fileUrl(cover)}>`，没有只画 `.nv-cover` 和里面的 `.nv-title`；`.nv-meta` 是 `[author, ...tags].join(" · ")`；`.tag` 是 `boardCards.bot.source.plan`（`card.episodes` 存在时）；`.src` 是 `source.from`。
  - `card.gate` 存在时画 `.bot-gate`（`render.js:34-38`）。
  - `.bot-task`：`bot.doing` 或当前任务的文案（沿用现有键）；`card.progress` 存在时画 `<Meter>` 和 `.meter-meta`。
  - `.bot-log`：`bot.steps`，每条 `li[data-s]`（最后一条且 bot 在工作是 `run`，其余 `done`），图标 `Check` / `LoaderCircle`（带 `spin` 类），`time` 用 `timeOfDay(step.at)`。
  - `.bot-foot`：`jobKey(card) !== "other"` 时三个技能标签（`productionBoard.skills.<job>.<1-3>`）；`button.bot-talk` → `actions.openChat(card.botId)`；`card.retry && actions.retry` 时在它前面加 `button.btn-ink`“重试”。
- **BriefNode**（`render.js:61-64`）：`REQ`、标题、`boardCards.version`；`dl.spec`；页脚左边“整理：名字 · 时间”（`card.by`、`card.agreedAt`），`card.agreedAt` 存在时右边 `span.stamp`。
- **TasksNode**（`render.js:67-80`）：`TASKS`、标题、`完成数 / 总数`；`ol.tk > li[data-s]`（`done`、`working → run`、`waiting → wait`、`failed`）；`span.tk-ic`；`T<序号>`；`.tk-t` 是任务名，`script`、`character`、`scene` 三项带 `<em>`（`boardCards.plan.parallel`）；有 `botId` 时 `<BotButton>`。页脚“拆分：名字 · 时间”和 `boardCards.plan.foot`。
- **EpisodeNode**（`render.js:83-91`）：`.sc-holes`；`span.mono.ep-no`；标题；版本；`card.logline` 存在时 `p.ep-log`；`.sc-page` 里是 `scriptPage(card.text)` 的每一行 `p.sc-<k>`；页脚左边“N 镜 · 时长”，右边 `<BotButton botId={card.storyboardBotId} suffix={episodeCode}>`；`card.status === "failed" && actions.retry` 时加“重试”。
- **EpisodeStackNode**（`render.js:94-98`）：范围 `EPxx – EPyy`；“其余 N 集”；`ol.epm` 列前三集，多于四集时在最后一集前插 `li.epm-gap`；整张卡的头部和列表点了调 `actions.openStack()`。

`additions.css` 追加（效果图没有的状态，用它的词汇）：

```css
.mj-board .k-bot[data-state='failed'] { border-top-color: var(--danger); }
.mj-board [data-state='failed'] .led { background: var(--danger); }
.mj-board .tk li[data-s='failed'] .tk-ic { background: var(--danger); border-color: var(--danger); color: var(--on-fill); }
.mj-board .bot-foot .btn-ink { border-color: var(--line-2); color: var(--text); }
.mj-board .bot-foot .btn-ink:hover { background: var(--text); border-color: var(--text); color: var(--bg); }
.mj-board .k-epmore .pp-head, .mj-board .k-epmore .epm { cursor: pointer; }
```

- [ ] **Step 5: 确认通过并提交**

Run: `OMB_VITEST_WORKERS=2 node node_modules/vitest/vitest.mjs run src/components/production-board/nodes && pnpm exec tsc -b && pnpm lint`
Expected: PASS。

```bash
git add src/components/production-board/nodes src/components/production-board/testing src/components/production-board/styles/additions.css
git commit -m "Production board: the mockup's bot console, brief, task split, episode page and stack of episodes, from the project's own data"
```

---

### Task 14: 节点（二）：角色、场景、镜头、分镜视频、成片、其他

**Files:**
- Create: `src/components/production-board/nodes/CharacterNode.tsx`、`SceneNode.tsx`、`ShotNode.tsx`、`ResultNode.tsx`、`FinalNode.tsx`、`OtherNode.tsx`、`index.tsx`
- Modify: `src/components/production-board/styles/additions.css`
- Test: `src/components/production-board/nodes/assets.dom.test.ts`

模板来源：`render.js` `tpl.char` 101–118、`tpl.scene` 121–130、`refChip` 133–138、`MJ.shotFoot` 140–160、`tpl.shot` 162–179、`MJ.resultBody` 182–204、`tpl.final` 208–234；播放 `app.js` `play`、`stopPlay` 721–751。

**Interfaces:**
- Consumes: 任务 13 的 `NodeContext`、`NodeFrame`、`parts`。
- Produces（`nodes/index.tsx`）：

```ts
export const NODE_CLASS: Record<BoardCard["kind"], string>; // bot "k-bot", plan "k-tasks", episode "k-ep", stack "k-epmore", character "k-char", other "k-other", …
/** The mockup's `data-state` / `data-vstate` of a card, and what a screen reader calls it. */
export function nodeFacts(card: BoardCard, snapshot: CanvasSnapshot): { state?: string; vstate?: string; label: string };
export const VIDEO_STATE: Record<BoardVideoStatus, "todo" | "gen" | "failed" | "done">; // idle todo, generating gen, failed failed, done done
/** The inside of a card, by its kind. */
export const NodeBody: (props: { card: BoardCard; ctx: NodeContext }) => JSX.Element | null;
```

- [ ] **Step 1: 写失败的测试**

`nodes/assets.dom.test.ts`：

```ts
// @vitest-environment happy-dom
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { SAMPLE_GENERATING_SHOT } from "@/testing/production-board-sample";
import type { BoardCard } from "@/lib/production-board/types";
import { boardFixture } from "../testing/board-fixture";
import { buttonNamed, click, render, textOf, useBoardPage } from "../testing/dom-kit";
import { NODE_CLASS, NodeBody, nodeFacts } from "./index";

useBoardPage();
const draw = (card: BoardCard, fixture: ReturnType<typeof boardFixture>) => render(createElement("div", null, createElement(NodeBody, { card, ctx: fixture.ctx })));

describe("a character's card", () => {
  it("shows its picture beside its part, its name, its tags, its look and voice, its palette and the shots it is in", () => {
    const fixture = boardFixture();
    const card = fixture.cardOf("character");
    const root = draw(card, fixture);
    expect(root.querySelector(".ch .ch-art img")?.getAttribute("src")).toMatch(/^\/files\//);
    expect(textOf(root.querySelector(".ch-body h3"))).toBe(card.name);
    expect(textOf(root.querySelector(".ch-top .mono"))).toBe("Look v1");
    expect(root.querySelectorAll(".ch-foot .pal i").length).toBe(card.facts.palette?.length ?? 0);
  });
});

describe("a scene's card", () => {
  it("shows its picture under its name, its mood, its camera positions and its palette as a strip", () => {
    const fixture = boardFixture();
    const card = fixture.cardOf("scene", (one) => !one.refinedBy);
    const root = draw(card, fixture);
    expect(textOf(root.querySelector(".sn-art .sn-cap h3"))).toBe(card.name);
    expect(textOf(root.querySelector(".sn-meta .cams"))).toBe("3 camera positions");
    expect(textOf(root.querySelector(".sn-uses .mono"))).toBe("v2");
    expect(root.querySelector(".sn-pal")?.getAttribute("role")).toBe("img");
  });
});

describe("a shot's card", () => {
  it("is a storyboard sheet: its number, its size, move and length, what it shows and what is heard, and what it uses", () => {
    const fixture = boardFixture();
    const card = fixture.cardOf("shot", (one) => one.status === "done");
    const root = draw(card, fixture);
    expect(textOf(root.querySelector(".sh-head .sh-no"))).toMatch(/^SH\d\d$/);
    expect(root.querySelectorAll(".sh-dl > div")).toHaveLength(3);
    expect(root.querySelector(".sh-frame video, .sh-frame.is-wip")).not.toBeNull();
    expect(root.querySelectorAll(".sh-refs .ref").length).toBe(card.references.length);
    expect(root.querySelector(".sh-foot .st.done")).not.toBeNull();
  });

  it("offers to generate its video while it has none, and shows it generating", () => {
    const fixture = boardFixture();
    const idle = fixture.cardOf("shot", (one) => one.status === "idle" && Boolean(one.creationId));
    click(draw(idle, fixture).querySelector(".sh-foot .btn-gen"));
    expect(fixture.actions.generate).toHaveBeenCalledWith(idle.creationId);
    const busy = fixture.cardOf("shot", (one) => one.id === SAMPLE_GENERATING_SHOT);
    expect(nodeFacts(busy, fixture.snapshot).vstate).toBe("gen");
    expect(draw(busy, fixture).querySelector(".sh-foot .st.run")).not.toBeNull();
  });
});

describe("a shot's video", () => {
  it("is a monitor: the take the film uses, its number and versions, a play button, and its length and name below", () => {
    const fixture = boardFixture();
    const card = fixture.cardOf("result", (one) => one.status === "done");
    const root = draw(card, fixture);
    expect(root.querySelector(".rs-screen video")?.getAttribute("src")).toMatch(/^\/files\/.*#t=0\.1$/);
    expect(textOf(root.querySelector(".rs-tag"))).toMatch(/^SH\d\d$/);
    expect(root.querySelector(".rs-play")).not.toBeNull();
    expect(root.querySelector(".rs-foot .rs-ok")).not.toBeNull();
    expect(nodeFacts(card, fixture.snapshot).state).toBe("done");
  });

  it("lets the person switch to another take and use it", () => {
    const fixture = boardFixture();
    const card = fixture.cardOf("result", (one) => one.takes.length > 1);
    const root = draw(card, fixture);
    const other = card.takes.find((take) => !take.selected)!;
    click(root.querySelectorAll(".rs-takes .take")[card.takes.indexOf(other)]);
    click(buttonNamed(root, "Use this take"));
    expect(fixture.actions.selectTake).toHaveBeenCalledWith(other.nodeId);
  });
});

describe("an episode's film", () => {
  it("is a monitor over a timeline: a clip for each shot by its state, and the tracks the draft has", () => {
    const fixture = boardFixture();
    const card = fixture.cardOf("final", (one) => one.episode === 1);
    const root = draw(card, fixture);
    expect(root.querySelectorAll(".fn-video .clip")).toHaveLength(card.clips.length);
    expect([...root.querySelectorAll(".fn-tl .fn-row .fn-lbl")].map(textOf).filter(Boolean)).toEqual(["Picture", "Voice", "Music"]);
    expect(root.querySelectorAll(".fn-lane .seg")).toHaveLength(2);
    click(buttonNamed(root, "Open in JianYing"));
    expect(fixture.actions.openDraft).toHaveBeenCalled();
  });
});

describe("every kind of card", () => {
  it("has the mockup's class", () => {
    expect(NODE_CLASS).toEqual({ bot: "k-bot", brief: "k-brief", plan: "k-tasks", episode: "k-ep", stack: "k-epmore", character: "k-char", scene: "k-scene", shot: "k-shot", result: "k-result", final: "k-final", other: "k-other" });
  });
});
```

按钮的英文名（`Use this take`、`Open in JianYing`、`Retry`）以 `en.json` 里现有 `boardCards.*` 键的文案为准；不同就改测试里的名字。样例里若没有“多个版本的结果”或“没有视频、有生成节点的镜头”，在 `src/testing/production-board-sample.ts` 里给第 1 集补一个有两个版本的镜头和一个未生成的镜头。

- [ ] **Step 2: 确认失败**

Run: `OMB_VITEST_WORKERS=2 node node_modules/vitest/vitest.mjs run src/components/production-board/nodes/assets.dom.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现**

类名、元素、层级照 `render.js` 的对应行。数据对应：

- **CharacterNode**（`101-118`）：`.ch-art` 里是 `card.picture?.file` 的图（没有图时空着，并在 `.ch-foot` 里给“生成图片”的 `button.btn-ink`，调 `actions.generate(card.newest.nodeId)`，只在 `card.newest?.prompt` 存在且不在生成中时出现）；`span.code.mono` 是 `C<两位序号>`（按它在全部角色卡里的位置）；`.role` 是 `facts.badge`；右上 `boardCards.character.look`（`card.pictures`，0 张时不显示）；`h3` 名字；`.ch-sub` 是 `facts.subtitle`；`<Chips items={facts.tags}>`；`dl.ch-dl` 是 `facts.rows` 的前两行；`<Pal>`；`.uses` 列出场镜头（`card.appearsIn`，同一集的只写镜号，跨集的带集数）。
- **SceneNode**（`121-130`）：`.sn-art` 图、`span.code.mono`（`S<两位序号>`）、`card.refinedBy` 时 `span.refined`（`GitBranch` + 细化它的 bot 名）、`.sn-cap`；`.sn-meta` 是 `<Chips items={facts.tags}>` 和 `facts.cameras` 存在时的 `span.cams`；`.sn-uses` 左边用于哪些镜头，右边版本；`.sn-pal`。没有图时同角色卡给“生成图片”。
- **ShotNode**（`162-179`、页脚 `140-160`）：`.sh-frame`：有选用版本（同一镜头的 `result` 卡里 `selected` 的那个；通过 `ctx.snapshot` 找不到就由 `NodeBody` 从 `board` 传进来——在 `NodeContext` 里加 `takeOf(shotId): BoardTake | undefined`，任务 16 填它，这里的测试夹具用 `board.cards` 实现）时是 `<video preload="metadata" muted src={url + "#t=0.1"}>`，否则 `.sh-frame.is-wip` 里是 `PenLine` 和 `boardCards.shot.noPicture`。`dl.sh-dl` 三项；`.sh-desc` 是 `card.prompt`；`.sh-audio` 是 `card.design?.audio`；`.sh-refs` 每个引用一个 `button.ref`（角色带小图，场景带 `Mountain`），点了 `actions.focusCard(cardId)`。页脚按状态：`done` → `.st.done` + “查看结果”（`focusCard` 到它的结果卡）+ “重新生成”；`generating` → `.st.run`（`LoaderCircle.spin`）；`failed` → `.st` 用失败原因 + “重新生成”；`idle` → `button.btn-gen`（`Sparkles`）。`card.stale` 时在状态文字后加“已过期”。
- **ResultNode**（`182-204`）：`.rs-screen` 里是当前看的版本的 `<video>`（默认选用的那个，没有选用取最新）；`span.rs-tag.mono`；`span.rs-ver.mono`（`V<n> · 共 n 版`）；`done` 时 `button.rs-play` 和 `.rs-scrub`；`gen` 时 `.rs-over`（“生成中”，没有百分比）；`failed` 时 `.rs-over` 用失败原因；`todo` 时 `.rs-over`“尚未生成”。页脚 `.rs-tc`、`.rs-name`、状态（`.rs-ok` / `.rs-run` / `.rs-idle`）。多于一个版本时加一行 `.rs-takes`（用 `.take` 胶囊，当前的带 `data-cur`），当前看的不是选用的那个时给“选用”按钮。播放：点 `.rs-play` 调 `video.play()` / `pause()`，根元素切 `is-playing`；`timeupdate` 时把 `.rs-scrub i` 的宽度设成进度、更新 `.rs-tc`；播完复位（代替 `app.js:733-751` 的计时器）。
- **FinalNode**（`208-234`）：标题行和状态（沿用现有的状态文案）；`.fn-mon`：成片 `<video controls>`，没有时取第一个 `ready` 片段的首帧，叠 `.fn-title`；`.fn-tl`：刻度（按总时长均分 6 段）、画面轨 `.fn-video > .clip[data-s]`（`ready → done`、`generating → gen`、`failed`、`missing → todo`，宽度按时长占比，没有时长的均分）、`card.draft?.tracks` 每条一行（图标 `Mic`、`Captions`、`Music`，`.seg` 的 `left`、`width` 按 `startMs`、`durationMs` 占总时长的比例）；页脚 `<Chips>`（分辨率取成片或第一个片段的宽高，“N 段”）和 `button.btn-ghost`“打开剪映草稿”（草稿是 `written` 或 `kept` 且有 `actions.openDraft` 时可点）。
- **OtherNode**：`.k-other`，按节点类型画文字（`metadata.content` 的前几行）、图片或视频，标题在上；生成失败时给“重新生成”。
- **`nodeFacts`**：bot → `state: toneState(botStatus(...).tone)`；`result` → `state: VIDEO_STATE[card.status]`；`shot` → `vstate: VIDEO_STATE[card.status]`；`label` 是“类型：标题”（类型名沿用 `boardPanels.kind.*`）。

`additions.css` 追加：

```css
.mj-board .k-other { padding: 12px 14px; display: flex; flex-direction: column; gap: 8px; }
.mj-board .k-other img, .mj-board .k-other video { border-radius: 6px; }
.mj-board .sh-frame video { width: 100%; height: 100%; object-fit: cover; display: block; }
.mj-board .rs-screen video, .mj-board .fn-mon video { width: 100%; height: 100%; object-fit: cover; display: block; }
.mj-board .k-result[data-state='failed'] { border-color: var(--danger); }
.mj-board .k-result[data-state='failed'] .rs-over > span { color: var(--danger); }
.mj-board .k-shot[data-vstate='failed'] .st { color: var(--danger); font-weight: 600; }
.mj-board .rs-takes { display: flex; align-items: center; gap: 6px; padding: 0 6px 8px; }
.mj-board .rs-takes .take { cursor: pointer; }
.mj-board .clip[data-s='failed'] { border: 1px dashed var(--danger); background: transparent; }
```

- [ ] **Step 4: 确认通过并提交**

Run: `OMB_VITEST_WORKERS=2 node node_modules/vitest/vitest.mjs run src/components/production-board/nodes src/lib/production-board && pnpm exec tsc -b && pnpm lint`
Expected: PASS。

```bash
git add src/components/production-board/nodes src/components/production-board/styles/additions.css src/testing/production-board-sample.ts
git commit -m "Production board: the mockup's character and scene cards, storyboard sheet, monitors and film timeline, playing the real videos"
```

---

### Task 15: 阶段条、说明、工具栏、小地图、提示条

**Files:**
- Create: `src/components/production-board/chrome/StageBar.tsx`、`Caption.tsx`、`Toolbar.tsx`、`Minimap.tsx`、`Toast.tsx`
- Modify: `src/components/production-board/styles/additions.css`
- Test: `src/components/production-board/chrome/chrome.dom.test.ts`

来源：`index.html:66-80`；`app.js` `buildStagebar` 468–473、`showCaption` 486–489、小地图 413–465、`toast` 753–760。

**Interfaces:**
- Consumes: `CameraStore`、`Rect`（`../engine/camera`）、`minimapFrame`、`minimapPoint`、`minimapColor`、`drawMinimap`、`MinimapColors`（`../engine/minimap`）、`BoardStage`、`BOARD_STAGES`、`BoardStageState`。
- Produces:

```ts
export function StageBar(props: { stages: Record<BoardStage, BoardStageState>; current?: BoardStage; insetEnd: number; onStage(stage: BoardStage): void }): JSX.Element;
export function Caption(props: { stage: BoardStage | null }): JSX.Element; // p.caption[role=status], hidden when null
export function Toolbar(props: { camera: CameraStore; showRefs: boolean; minimap: boolean; onZoom(factor: number): void; onZoomReset(): void; onFit(): void; onRefs(): void; onMinimap(): void }): JSX.Element;
export function Minimap(props: { world: Rect; items: ReadonlyArray<{ id: string; rect: Rect; kind: BoardCard["kind"]; state?: "done" | "working" | "waiting" | "failed" }>; camera: CameraStore; insetEnd: number; onJump(world: { x: number; y: number }): void }): JSX.Element;
export interface ToastMessage { text: string; icon?: LucideIcon; key: number }
export function Toast(props: { message: ToastMessage | null }): JSX.Element; // div.toast[role=status][aria-live=polite], .is-on while there is one
export const stageState: (state: BoardStageState) => "done" | "active" | "failed" | undefined; // wait → undefined
```

- [ ] **Step 1: 写失败的测试**

```ts
// @vitest-environment happy-dom
import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { CameraStore } from "../engine/camera";
import { click, render, textOf, useBoardPage } from "../testing/dom-kit";
import { Caption } from "./Caption";
import { StageBar } from "./StageBar";
import { Toast } from "./Toast";
import { Toolbar } from "./Toolbar";

useBoardPage();
const STAGES = { brief: "done", script: "done", library: "active", storyboard: "wait", post: "failed" } as const;

describe("the stage bar", () => {
  it("is the mockup's five chips, each with its number, name and state, the one in view marked", () => {
    const onStage = vi.fn();
    const bar = render(createElement(StageBar, { stages: STAGES, current: "library", insetEnd: 0, onStage }));
    expect(bar.tagName).toBe("NAV");
    expect(bar.className).toBe("stagebar");
    const chips = [...bar.querySelectorAll("button.schip")];
    expect(chips.map((chip) => textOf(chip.querySelector(".fno")))).toEqual(["1", "2", "3", "4", "5"]);
    expect(chips.map((chip) => chip.getAttribute("data-state"))).toEqual(["done", "done", "active", null, "failed"]);
    expect(chips.map((chip) => chip.getAttribute("aria-current"))).toEqual(["false", "false", "true", "false", "false"]);
    expect(bar.querySelectorAll(".schip-sep")).toHaveLength(4);
    click(chips[3]);
    expect(onStage).toHaveBeenCalledWith("storyboard");
  });
});

describe("the stage's note", () => {
  it("says which stage and what happens in it, and is hidden without one", () => {
    const note = render(createElement(Caption, { stage: "script" }));
    expect(note.className).toBe("caption");
    expect(textOf(note.querySelector("b"))).toBe("Stage 2 · Episodes");
    expect(textOf(note)).toContain("adapts the source into episodes");
    expect(render(createElement(Caption, { stage: null })).hidden).toBe(true);
  });
});

describe("the toolbar", () => {
  it("is the mockup's: out, the zoom that resets, in, the whole board, the reference lines and the minimap", () => {
    const camera = new CameraStore({ x: 0, y: 0, z: 0.55 });
    const calls = { onZoom: vi.fn(), onZoomReset: vi.fn(), onFit: vi.fn(), onRefs: vi.fn(), onMinimap: vi.fn() };
    const bar = render(createElement(Toolbar, { camera, showRefs: false, minimap: true, ...calls }));
    expect(bar.getAttribute("role")).toBe("toolbar");
    const buttons = [...bar.querySelectorAll("button")];
    expect(buttons.map((button) => button.className)).toEqual(["tbtn", "tzoom", "tbtn", "tbtn wide", "tbtn wide keep", "tbtn"]);
    expect(textOf(buttons[1])).toBe("55%");
    expect(buttons.slice(4).map((button) => button.getAttribute("aria-pressed"))).toEqual(["false", "true"]);
    buttons.forEach((button) => click(button));
    expect(calls.onZoom.mock.calls).toEqual([[0.8], [1.25]]);
    expect(calls.onZoomReset).toHaveBeenCalledTimes(1);
    expect(calls.onFit).toHaveBeenCalledTimes(1);
    expect(calls.onRefs).toHaveBeenCalledTimes(1);
    expect(calls.onMinimap).toHaveBeenCalledTimes(1);
  });
});

describe("the toast", () => {
  it("shows while it has something to say", () => {
    expect(render(createElement(Toast, { message: { text: "Reference lines hidden", key: 1 } })).className).toBe("toast is-on");
    expect(render(createElement(Toast, { message: null })).className).toBe("toast");
  });
});
```

（小地图在 happy-dom 里没有 canvas 的 2D 上下文，它的换算已在任务 11 测过；组件本身在任务 16 的画布测试和任务 21 的截图里验。）

- [ ] **Step 2: 确认失败**

Run: `OMB_VITEST_WORKERS=2 node node_modules/vitest/vitest.mjs run src/components/production-board/chrome`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现**

- `StageBar`：`<nav class="stagebar" aria-label style={{ maxWidth: calc(100% - 24px - insetEnd), ... }}>`，照 `app.js:469-472`；阶段名用现有的 `productionBoard.stage.<stage>`；`insetEnd > 0` 时用 `left: calc((100% - insetEnd) / 2)` 让它在面板左边的空间里居中。放不下时照效果图横向滚动。
- `Caption`：`<p class="caption" role="status" hidden={!stage}>`，`<b>` 是 `productionBoard.caption.title`（`number` 是阶段序号，`name` 是阶段名），后面是 `productionBoard.caption.<stage>`。
- `Toolbar`：照 `index.html:69-77`。百分比用 `useSyncExternalStore(camera.subscribe, () => Math.round(camera.cam.z * 100))`。图标：`Minus`、`Plus`、`Maximize`、`Waypoints`、`Map as MapIcon`。缩小 `onZoom(0.8)`，放大 `onZoom(1.25)`。
- `Minimap`：`<div class="minimap" role="img" aria-label style={{ right: 12 + insetEnd }}><canvas/></div>`。挂载、`world` 或 `items` 变、相机变、皮肤变（`MutationObserver` 看 `document.documentElement` 的 `data-skin`）时重画。颜色从 `getComputedStyle(canvas.closest(".mj-board"))` 读：`bg ← --bg`、`working ← --amber`、`done ← --teal`、`idle ← --text-3`、`sheet ← --line-2`、`plain ← --card-2`、`view ← --text`、`viewFill` 是 `--text` 的 8%。指针按下并拖动时 `onJump(minimapPoint(...))`（`app.js:463-465`）。
- `Toast`：`<div class="toast [is-on]" role="status" aria-live="polite">` 里是图标（默认 `Info`）和文字。

`additions.css` 追加：

```css
.mj-board .schip[data-state='failed'] .fno { background: var(--danger); color: var(--on-fill); }
```

- [ ] **Step 4: 确认通过并提交**

Run: `OMB_VITEST_WORKERS=2 node node_modules/vitest/vitest.mjs run src/components/production-board/chrome && pnpm exec tsc -b && pnpm lint`
Expected: PASS。

```bash
git add src/components/production-board/chrome src/components/production-board/styles/additions.css
git commit -m "Production board: the mockup's stage bar with its notes, toolbar, minimap and toast"
```

---

### Task 16: 画布本体

**Files:**
- Rewrite: `src/components/production-board/ProductionBoard.tsx`
- Create: `src/components/production-board/board/World.tsx`、`board/heights.ts`、`board/use-board-input.ts`、`src/components/production-board/panels/EpisodeMenu.tsx`
- Delete: `src/components/production-board/board/{BoardEdges.tsx,camera.ts,card-view.tsx,chrome.tsx}`、`src/components/production-board/ProductionBoard.dom.test.ts`（旧的）、`src/lib/production-board/{layout.ts,layout.test.ts,edge-paths.ts,edge-paths.test.ts,camera.ts,camera.test.ts}`
- Modify: `src/lib/production-board/overlay.ts`（`BoardOverlayProps.board`）、`src/components/project-canvas/ProjectCanvas.tsx:5`、`:151`、`src/components/project-canvas/ProjectCanvas.dom.test.ts`
- Test: `src/components/production-board/ProductionBoard.dom.test.ts`（新写）、`board/heights.test.ts`

来源：`index.html:55-80`；`app.js` `buildEdges` 155–185、`applyCam` 277–290、`select` 361–376、`activate` 379–390、`hoverRefs` 392–396、指针 547–624、滚轮 626–633、键盘 639–659、`reveal` 802–808、`openingView` 809–814、`relayout` 817–828、`start` 830–875。

**Interfaces:**
- Consumes: 任务 8–11 的引擎、任务 13–15 的组件、`buildBoard`、`visibleEdges`（`@/lib/production-board/edges`）。
- Produces:
  - `ProductionBoardProps`、`BoardHost`：与旧的同名同形（见备份里的 `ProductionBoard.tsx:20-41`），`ProjectCanvas.tsx` 的用法不变。
  - `BoardOverlayProps` 新增 `board: Board`（画布已经算好的那一个）和 `zoom(): number`（相机当前的缩放）。
  - `panels/EpisodeMenu.tsx`：`EpisodeMenu(props: { episodes: ReadonlyArray<{ episode: number; title: string; unfolded: boolean; status?: ProductionEpisodeStatus }>; at: { x: number; y: number }; onChoose(episode: number): void; onClose(): void })`。
  - `board/heights.ts`：

```ts
/** The heights the board measured: a card's own once it was drawn, else the last one of its kind, else the mockup's. */
export class Heights {
  set(cardId: string, kind: BoardCard["kind"], height: number): boolean; // true when it changed
  of(card: BoardCard): number;
}
```

- [ ] **Step 1: 写失败的测试**

`board/heights.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import type { BoardCard } from "@/lib/production-board/types";
import { ESTIMATED_HEIGHT } from "../engine/layout";
import { Heights } from "./heights";

const card = (id: string, kind: BoardCard["kind"]) => ({ id, kind, nodeIds: [id] }) as unknown as BoardCard;

describe("the heights the board measured", () => {
  it("are a card's own, else the last of its kind, else the mockup's", () => {
    const heights = new Heights();
    expect(heights.of(card("a", "shot"))).toBe(ESTIMATED_HEIGHT.shot);
    expect(heights.set("a", "shot", 301)).toBe(true);
    expect(heights.set("a", "shot", 301)).toBe(false);
    expect(heights.of(card("a", "shot"))).toBe(301);
    expect(heights.of(card("b", "shot"))).toBe(301);
    expect(heights.of(card("c", "scene"))).toBe(ESTIMATED_HEIGHT.scene);
  });
});
```

`ProductionBoard.dom.test.ts`：

```ts
// @vitest-environment happy-dom
import { act, createElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { botNodeId } from "../../../shared/project-canvas";
import type { BoardOpened, BoardOverlayProps } from "@/lib/production-board/overlay";
import { BOARD_BOTS, PRODUCTION_BOARD_LOOKS, productionBoardBackend, productionBoardSample } from "@/testing/production-board-sample";
import { ProductionBoard, type BoardHost } from "./ProductionBoard";
import { click, press, render, textOf, useBoardPage } from "./testing/dom-kit";

useBoardPage();

class SizedObserver {
  constructor(private readonly run: (entries: Array<{ target: Element; contentRect: { width: number; height: number } }>) => void) {}
  observe(target: Element) { this.run([{ target, contentRect: { width: 1440, height: 900 } }]); }
  unobserve() {}
  disconnect() {}
}

function mount(patch: { opened?: BoardOpened | null; readOnly?: boolean } = {}) {
  vi.stubGlobal("ResizeObserver", SizedObserver);
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 1440 });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 900 });
  const snapshot = { ...productionBoardSample({ episodes: 4 }), ...(patch.readOnly ? { readOnly: "archived" as const } : {}) };
  const host: BoardHost = { fileUrl: (file) => `/files/${file.path}`, move: vi.fn(), generate: vi.fn(async () => {}), selectTake: vi.fn(async () => {}), retry: vi.fn(async () => {}), openDraft: vi.fn(async () => {}) };
  const onOpenedChange = vi.fn();
  const overlay = vi.fn((_props: BoardOverlayProps) => null);
  const root = render(createElement("div", { style: { height: "900px" } }, createElement(ProductionBoard, {
    projectId: snapshot.project.id, snapshot, backend: productionBoardBackend(), looks: PRODUCTION_BOARD_LOOKS, host,
    opened: patch.opened ?? null, onOpenedChange, overlay,
  })));
  const board = root.querySelector<HTMLElement>(".mj-board")!;
  return { board, stage: board.querySelector<HTMLElement>("main.stage")!, viewport: board.querySelector<HTMLElement>("[data-production-board]")!, host, onOpenedChange, overlay, snapshot };
}
const node = (board: HTMLElement, id: string) => board.querySelector<HTMLElement>(`[data-board-card-id="${id}"]`);
const point = (type: string, x: number, y: number, more: PointerEventInit = {}) => new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 1, button: 0, ...more });

describe("the board", () => {
  it("is the mockup's stage: a viewport with the grid and the world, the lines under the labels under the nodes", () => {
    const { board, viewport } = mount();
    expect(viewport.className).toContain("viewport");
    expect(viewport.getAttribute("role")).toBe("application");
    const world = board.querySelector("[data-board-world]")!;
    expect([...world.children].map((child) => child.getAttribute("class"))).toEqual(["edges", "edges", "labels", "nodes"]);
    expect(node(board, botNodeId(BOARD_BOTS.lead))?.className).toContain("node k-bot");
    expect(board.querySelector(".stagebar")).not.toBeNull();
    expect(board.querySelector(".toolbar")).not.toBeNull();
    expect(board.querySelector(".minimap")).not.toBeNull();
  });

  it("draws only what is in view, and real cards at every zoom: far out the bots wear a pin", () => {
    const { board, stage, viewport } = mount();
    const drawn = board.querySelectorAll(".node").length;
    expect(drawn).toBeGreaterThan(0);
    press(viewport, "0");
    expect(stage.className).toContain("lod-far");
    expect(board.querySelectorAll(".node").length).toBeGreaterThan(drawn);
    expect(board.querySelector(".node.k-shot .sh-head")).not.toBeNull();
    expect(board.querySelector("[data-far-pill]")).toBeNull();
  });

  it("opens a bot's chat or a card's details on a click, and closes them on a click of the empty board", () => {
    const { board, viewport, onOpenedChange } = mount();
    const lead = node(board, botNodeId(BOARD_BOTS.lead))!;
    act(() => { lead.dispatchEvent(point("pointerdown", 10, 10)); viewport.dispatchEvent(point("pointerup", 10, 10)); });
    expect(onOpenedChange).toHaveBeenLastCalledWith({ kind: "bot", botId: BOARD_BOTS.lead });
    const brief = node(board, "brief")!;
    act(() => { brief.dispatchEvent(point("pointerdown", 10, 10)); viewport.dispatchEvent(point("pointerup", 10, 10)); });
    expect(onOpenedChange).toHaveBeenLastCalledWith({ kind: "asset", nodeId: "brief" });
    act(() => { viewport.dispatchEvent(point("pointerdown", 5, 5)); viewport.dispatchEvent(point("pointerup", 5, 5)); });
    expect(onOpenedChange).toHaveBeenLastCalledWith(null);
  });

  it("dims the rest about the card that is open, and brings out its lines and what they lead to", () => {
    const { board, stage } = mount({ opened: { kind: "bot", botId: BOARD_BOTS.lead } });
    expect(stage.className).toContain("has-sel");
    expect(node(board, botNodeId(BOARD_BOTS.lead))!.className).toContain("is-sel");
    expect(node(board, "brief")!.className).toContain("is-rel");
    expect(board.querySelectorAll(".edge.is-on").length).toBeGreaterThan(0);
  });

  it("moves a card with the pointer and stores where it was left, without opening it", () => {
    const { board, viewport, host, onOpenedChange } = mount();
    const brief = node(board, "brief")!;
    const before = { x: Number.parseFloat(brief.style.left), y: Number.parseFloat(brief.style.top) };
    const zoom = Number(/scale\(([\d.]+)\)/.exec(board.querySelector<HTMLElement>("[data-board-world]")!.style.transform)![1]);
    act(() => { brief.dispatchEvent(point("pointerdown", 100, 100)); viewport.dispatchEvent(point("pointermove", 160, 130)); viewport.dispatchEvent(point("pointerup", 160, 130)); });
    expect(host.move).toHaveBeenCalledWith("brief", { x: Math.round(before.x + 60 / zoom), y: Math.round(before.y + 30 / zoom) });
    expect(onOpenedChange).not.toHaveBeenCalled();
  });

  it("shows the lines from characters and scenes to their shots when asked, and says so", () => {
    const { board, stage } = mount();
    click(board.querySelector('.toolbar button[aria-pressed="false"]'));
    expect(stage.className).toContain("show-refs");
    expect(textOf(board.querySelector(".toast.is-on"))).toContain("Showing the lines");
    expect(board.querySelectorAll(".edge.t-ref").length).toBeGreaterThan(0);
  });

  it("goes to a stage on its number key and notes what the stage is, until the person moves the board", () => {
    const { board, viewport } = mount();
    press(viewport, "2");
    expect(board.querySelector<HTMLElement>(".caption")!.hidden).toBe(false);
    act(() => { viewport.dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: -40, clientX: 700, clientY: 400 })); });
    expect(board.querySelector<HTMLElement>(".caption")!.hidden).toBe(true);
  });

  it("offers nothing that changes an archived project", () => {
    const { board } = mount({ readOnly: true });
    expect(board.querySelector(".btn-gen")).toBeNull();
    expect([...board.querySelectorAll("button")].some((button) => button.textContent?.trim() === "Retry")).toBe(false);
  });

  it("hands the layer over it the board it built", () => {
    const { overlay } = mount();
    expect(overlay.mock.calls.at(-1)![0]).toMatchObject({ board: { cards: expect.any(Array), edges: expect.any(Array) } });
  });
});
```

- [ ] **Step 2: 确认失败**

Run: `OMB_VITEST_WORKERS=2 node node_modules/vitest/vitest.mjs run src/components/production-board/ProductionBoard.dom.test.ts src/components/production-board/board/heights.test.ts`
Expected: FAIL。

- [ ] **Step 3: `Heights` 和 `World`**

`board/heights.ts`：两张表（按卡片 id、按类型的最近一次），`of` 的顺序是自己的、同类型最近的、`ESTIMATED_HEIGHT[kind]`。

`board/World.tsx`（`memo`）：属性是要画的卡片及矩形、要画的连线及路径、选中的卡片 id、与它相连的卡片 id 集合、高亮的连线 id 集合、悬停的卡片 id、拖动中的卡片 id、还没入场的阶段集合、`NodeContext`、`onHeight`、`onHover`。输出 `.world` 的四个子元素：
- 两个 `<svg class="edges" aria-hidden="true">`：第一个放非引用线，第二个放引用线。每条线照 `app.js:163-175`：`<g class="edge t-<kind> s-<state> [is-on] [is-hov] [pre]" data-board-edge style="--i: <引用线的序号>">` 里是 `path.ln`、（引用线另有 `path.tl`、`path.gl`）、`path.fl`、`path.ah`、`circle.pt[r=3.5]`。
- `<div class="labels" aria-hidden="true">`：每个有标签的线一个 `div.elabel t-<kind> s-<state> [is-on] [pre]`，`left`、`top` 是标签点；文字用旧的 `edgeLabelText` 的那套语言键（`productionBoard.edge.*`），在本文件里重写这个函数。
- `<div class="nodes">`：每张卡一个 `<NodeFrame>`，里面是 `<NodeBody>`；`onPointerEnter` / `onPointerLeave` / `onFocus` 调 `onHover`。

- [ ] **Step 4: `use-board-input.ts`**

一个 hook，接 `CameraStore`、取最新状态的 `ref`、回调（`onActivate(card)`、`onBlank()`、`onMove(card, position)`、`onDrag(drag | null)`、`onUserActed()`、`onStage(stage)`、`onFitAll()`、`onEscape()`），返回要挂在 `.viewport` 上的指针处理函数，并在内部挂滚轮（`passive: false`）和窗口键盘监听。逻辑照 `app.js:547-659`，外加这几条现有行为：
- 指针落在 `button, a[href], input, textarea, select, video[controls], [contenteditable]` 上不开始拖动或平移。
- 落在 `[data-board-chrome], [data-board-overlay]` 里的指针和滚轮不归画布。
- 卡片里可滚动的区域内，不带 Ctrl / Meta 的滚轮滚内容，不缩放。
- 只读或卡片没有 `dragNodeId` 时，拖卡片等同平移。
- 拖动结束调 `onMove(card, { x: Math.round(…), y: Math.round(…) })`；没移动（小于 4px）调 `onActivate(card)`；空白处没移动调 `onBlank()`。
- 键盘：焦点在 `input, textarea, select, [contenteditable], [role=dialog], [role=menu]` 或浮层里时不响应；`Enter` / 空格在节点上等同点击；方向键平移 80；`+`、`=` 缩放 1.25，`-`、`_` 缩放 0.8；`0` 全局；`1`–`5` 到阶段；`Escape` 调 `onEscape()`。

- [ ] **Step 5: `ProductionBoard.tsx`**

结构（类名照 `index.html:55-80`）：

```tsx
<section className="mj-board">
  <main className={cn("stage", far && "lod-far", selected && "has-sel", showRefs && "show-refs")} ref={stageRef}>
    <div className={cn("viewport", panning && "is-panning")} data-production-board="" tabIndex={0} role="application" aria-label={t("productionBoard.canvas.label")} {...input.handlers}>
      <div className="grid" aria-hidden="true" />
      <div className="world" data-board-world="" dir="ltr" ref={worldRef}><World … /></div>
    </div>
    <div data-board-chrome="">
      <StageBar … /><Caption … /><Toolbar … />
      <p className={cn("hint", touched && "is-gone")}>{t("productionBoard.hint")}</p>
      {minimap ? <Minimap … /> : null}
      <Toast … />
    </div>
    {stackMenu ? <EpisodeMenu … /> : null}
    {Overlay ? <div data-board-overlay="" ref={layerRef}><Overlay {...overlayProps} /></div> : null}
  </main>
</section>
```

并在文件顶部 `import "./styles/index.css";`。

状态与流程（保留旧 `ProductionBoard.tsx` 的这些行为，见备份）：
- `buildBoard(snapshot, { opened: openedEpisodes })` → `layoutBoard(board, heights.of)`（依赖里带一个高度版本号，`onHeight` 改了高度就加 1）→ `edgePaths(visibleEdges(board.edges, { showRefs, focus }), rects, kinds)`。
- 相机变化时直接写 DOM（不走 React）：`.world` 的 `transform`；`.stage` 上的 `--gs`、`--gx`、`--gy`、`--ew`、`--ls`（`app.js:277-285`）；然后在同一次回调里算裁剪（视口外扩 480px 内的卡片和连线）、`far`（`z < FAR`）和当前阶段（`stageAt`），与上一次的集合不同才 `setState`（不排到下一帧：几百个矩形的相交判断很便宜，测试也因此不用等帧）。
- 分集列表 `EpisodeMenu`：`<div class="ep-menu" role="menu" data-board-chrome="" style={{ left, top }}>`，头部 `.pk-head`，每集一个 `button.pk[role=menuitemcheckbox][aria-checked]`（`span.pk-th` 里是集数，后面标题）；点外面或 `Escape` 关闭（`usePopoverDismiss`）。列出收起的集和人手动展开的集；选一集展开或收回（逻辑照备份 `ProductionBoard.tsx` 的 `stackEpisodes`、`chooseEpisode`）。`additions.css` 加：

  ```css
  .mj-board .ep-menu { position: absolute; z-index: 40; width: 288px; max-height: 320px; overflow-y: auto; padding: 8px; border-radius: 12px; background: var(--panel); border: 1px solid var(--line-2); box-shadow: var(--shadow-float); }
  ```
- `setPointerCapture`、`releasePointerCapture`、`hasPointerCapture` 都用 `?.` 调（测试环境里没有）。
- 每个项目记住相机和展开的集（模块级 `Map`）。第一次有尺寸时：有记忆用记忆；没有就照 `app.js:853-864`，先 `fitRect(bounds, { pad: 24, maxZ: 0.7 })`，逐阶段去掉 `pre`（`200 + i × 240` ms），然后 1400ms 移到开场视图（`openingView`：阶段 1 加编剧，`pad 20`、`top 76`、`minZ` 高度小于 700 时 0.5 否则 0.6、`maxZ 0.95`、`anchorLeft`），人动过就不移；减少动效时直接到开场视图。
- `focusBotId` 变化时定位到该 bot；`focusNode`、`focusEpisode`、`focusStage`、`anchorOf`、`subscribeView` 照旧的实现提供给浮层，`overlayProps` 里加 `board`。
- 选中的卡片 = `opened` 对应的卡片；相连的卡片和高亮的连线照 `app.js:361-376`。
- `NodeContext.actions`：`focusCard(id)` → bot 卡就 `onOpenedChange({ kind: "bot", botId })` 并定位，其他卡只定位；`openChat(botId)` → `onOpenedChange({ kind: "bot", botId })`；`generate`、`selectTake`、`retry`、`openDraft` 调 `host`，失败时用提示条显示 `productionBoard.actionFailed`；只读时不提供 `generate`、`selectTake`、`retry`。`takeOf(shotId)` 从 `board.cards` 里找该镜头的结果卡的选用版本。
- 点卡片（`onActivate`）：bot → `{ kind: "bot", botId }`；`result` → 选用版本或最新版本或生成节点的 `{ kind: "asset", nodeId }`；`final` → 有成片开它，否则开该集后期的对话；`stack` → 打开分集列表；其余 → `nodeIds[0]`。
- 阶段条点一个阶段或按数字键：`camera.glide(fitRect(stageRect, { pad: 28, minZ: 0.18, maxZ: 0.9, top: 62 + 说明的高度 + 20 }), 950)` 并显示说明；`onUserActed` 收起说明、淡出提示。
- 引用线开关：切 `showRefs` 并出提示条（`productionBoard.toast.refsOn` / `refsOff`，图标 `Waypoints`）；提示条 2600ms 后收起。
- 小地图：宽度小于 520 默认不显示，人点过以人的为准。
- 空状态：`board.empty` 时在负责人卡下方画一句 `productionBoard.emptyHint`（`additions.css` 加 `.mj-board .empty-hint { position: absolute; width: 320px; text-align: center; font-size: 13px; color: var(--text-2); }`）。

`src/lib/production-board/overlay.ts`：`BoardOverlayProps` 加：

```ts
  /** The board as the canvas draws it now. */
  board: Board;
  /** The camera's zoom now. */
  zoom(): number;
```

`src/components/project-canvas/ProjectCanvas.tsx`：删掉第 5 行对 `PANEL_ROOM` 的引用，第 151 行的 `overlay && PANEL_ROOM` 换成 `overlay && "pe-[20rem]"`。

- [ ] **Step 6: 删旧引擎和旧画布外壳，改外层测试**

```bash
git rm src/components/production-board/board/BoardEdges.tsx src/components/production-board/board/camera.ts src/components/production-board/board/card-view.tsx src/components/production-board/board/chrome.tsx
git rm src/lib/production-board/layout.ts src/lib/production-board/layout.test.ts src/lib/production-board/edge-paths.ts src/lib/production-board/edge-paths.test.ts src/lib/production-board/camera.ts src/lib/production-board/camera.test.ts
```

旧的浮层（`panels/*.tsx`，任务 19 才换）若引用了被删的文件（`../board/chrome` 的 `PANEL_ROOM_PX`、`@/lib/production-board/camera` 等），把它用到的常量就地写成字面量，使它在任务 19 之前还能编译。

`src/components/project-canvas/ProjectCanvas.dom.test.ts`：
- 第 8、11、62 行对 `layoutBoard`、`cardSize` 的用法换成 `../production-board/engine/layout` 的 `layoutBoard(buildBoard(...), (card) => ESTIMATED_HEIGHT[card.kind])`，读 `bounds`（注意矩形是 `w`、`h`）。
- 第 80–83 行的拖动：`pointerdown` 直接发在 `[data-board-card-id]` 的 `article` 上（现在节点本身就是 `article`）。
- 其余选择器（`[data-board-card-id]`、`[data-production-board]`、`[data-board-world]`、`[data-result-take]`）：`[data-result-take]` 换成 `.rs-takes .take`；别的不变。

- [ ] **Step 7: 确认通过并提交**

Run:
```bash
OMB_VITEST_WORKERS=2 node node_modules/vitest/vitest.mjs run src/components/production-board src/components/project-canvas src/lib/production-board src/lib/project-canvas
pnpm exec tsc -b && pnpm lint
```
Expected: 新测试全过。`src/components/project-view/ProjectView.board.dom.test.ts` 在任务 19 才改，这一步若失败记下来，不在这里改。

```bash
git add -A src/components/production-board src/lib/production-board src/components/project-canvas
git commit -m "Production board: the mockup's canvas in place of the old one: its world, its lines, its far view of real cards, its selection and its opening"
```

---

### Task 17: 对话窗

**Files:**
- Create: `src/components/production-board/panels/chat-place.ts`、`ChatWindow.tsx`、`ChatWaiting.tsx`（重写）
- Modify: `src/components/production-board/styles/additions.css`
- Test: `src/components/production-board/panels/chat-place.test.ts`、`ChatWindow.dom.test.ts`

来源：`index.html:82-104`；`panels.js` 常量 24–28、`session` 31–40、`msgEl` 42–56、`renderRefs` 65–75、`renderPicker` 77–91、`setPicker` 93–100、`renderChat` 102–122、`measure` 124–129、`place` 132–155、`showThread` 219–224、输入和 Escape 255–263。真实行为照备份里的 `panels/BotChatWindow.tsx`（不照它的界面）。

**Interfaces:**
- Consumes: `BoardIndex`、`BoardAsset`（`@/lib/production-board/board-index`）、`OverlayBackend`、`useViewFollow`、`BoardAnchor`、`BotFace`（任务 13）、`botStatus`、`toneState`；程序自己的组件 `ChatMarkdown`、`PendingApprovalPanel`、`PendingApprovalActions`（`@/components/PendingApproval`）。
- Produces（`chat-place.ts`）：

```ts
export const CHAT_GAP = 16;
export const CHAT_SHEET_BELOW = 720;
export type ChatPlace =
  | { sheet: true }
  | { sheet: false; left: number; top: number; arrowY: number; side: "r" | "l" | "none" };
/** Where a bot's chat stands beside its card: to its right, to its left when there is no room, clamped to the stage. */
export function placeChat(anchor: BoardAnchor | null, size: { width: number; height: number }, stage: { width: number; height: number }, reserved: number, zoom: number): ChatPlace;
```

- Produces（`ChatWindow.tsx`）：`ChatWindow`，属性与旧 `BotChatWindowProps` 相同（备份 `BotChatWindow.tsx:29-47`），另加 `zoom(): number`；`ChatSession` 类型同旧的。

- [ ] **Step 1: 写失败的测试**

`chat-place.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { placeChat } from "./chat-place";

const STAGE = { width: 1200, height: 800 };
const SIZE = { width: 420, height: 480 };

describe("where a bot's chat stands", () => {
  it("is to the right of its card, level with it, its arrow at the card's head", () => {
    expect(placeChat({ x: 100, y: 100, width: 320, height: 400 }, SIZE, STAGE, 0, 1)).toEqual({ sheet: false, left: 436, top: 100, arrowY: 36, side: "r" });
  });

  it("goes to the left when the right has no room, and keeps clear of the side panel", () => {
    expect(placeChat({ x: 800, y: 100, width: 320, height: 400 }, SIZE, STAGE, 0, 1)).toMatchObject({ left: 364, side: "l" });
    expect(placeChat({ x: 500, y: 100, width: 320, height: 400 }, SIZE, STAGE, 320, 1)).toMatchObject({ left: 64, side: "l" });
  });

  it("stays on the stage, without an arrow once it is no longer beside the card", () => {
    expect(placeChat({ x: 100, y: 760, width: 320, height: 400 }, SIZE, STAGE, 0, 1)).toMatchObject({ top: 308, side: "none" });
    expect(placeChat({ x: 100, y: 20, width: 320, height: 400 }, SIZE, STAGE, 0, 1)).toMatchObject({ top: 60 });
  });

  it("is a sheet at the bottom of a narrow stage, and docks at the right without a card in view", () => {
    expect(placeChat({ x: 0, y: 0, width: 320, height: 400 }, SIZE, { width: 700, height: 800 }, 0, 1)).toEqual({ sheet: true });
    expect(placeChat(null, SIZE, STAGE, 0, 1)).toEqual({ sheet: false, left: 768, top: 60, arrowY: 0, side: "none" });
  });
});
```

`ChatWindow.dom.test.ts`（样例与后端来自 `productionBoardBackend`；写法照备份里的 `BotChatWindow.dom.test.ts` 的搭建部分，把选择器换成效果图的类）：

```ts
// @vitest-environment happy-dom
import { act, createElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { boardIndex } from "@/lib/production-board/board-index";
import { BOARD_BOTS, boarderOf, PRODUCTION_BOARD_LOOKS, productionBoardBackend, productionBoardSample } from "@/testing/production-board-sample";
import { buttonNamed, click, press, render, textOf, useBoardPage } from "../testing/dom-kit";
import { ChatWindow, type ChatSession } from "./ChatWindow";

useBoardPage();

async function open(botId: string, patch: { readOnly?: boolean; references?: string[]; stageWidth?: number } = {}) {
  const snapshot = productionBoardSample({ episodes: 4 });
  const backend = productionBoardBackend();
  const sendTask = vi.spyOn(backend, "sendTask");
  const stopBot = vi.spyOn(backend, "stopBot");
  const onClose = vi.fn();
  const sessions = new Map<string, ChatSession>();
  const root = render(createElement("div", { className: "mj-board" }, createElement(ChatWindow, {
    projectId: snapshot.project.id, bot: snapshot.bots[botId]!, look: PRODUCTION_BOARD_LOOKS[botId] ?? { color: "silver" }, index: boardIndex(snapshot), backend,
    readOnly: Boolean(patch.readOnly), references: patch.references, sessions, pictureUrl: (file) => `/files/${file.path}`,
    layer: { width: patch.stageWidth ?? 1200, height: 800 }, reserved: 0, anchorOf: () => ({ x: 100, y: 100, width: 320, height: 400 }), subscribeView: () => () => {}, zoom: () => 1, onClose, locale: "en",
  })));
  await act(async () => { await Promise.resolve(); });
  return { box: root.querySelector<HTMLElement>(".bchat")!, sendTask, stopBot, onClose, snapshot, sessions };
}

describe("a bot's chat on the board", () => {
  it("is the mockup's window: its head, the exchange, the references and the composer", async () => {
    const { box, snapshot } = await open(BOARD_BOTS.lead);
    expect(box.getAttribute("role")).toBe("dialog");
    expect(box.hasAttribute("data-board-chat")).toBe(true);
    expect(textOf(box.querySelector(".bc-head .bc-who b"))).toBe(snapshot.bots[BOARD_BOTS.lead]!.name);
    expect(box.querySelector(".bc-thread .chat-log")?.getAttribute("role")).toBe("log");
    expect(box.querySelectorAll(".chat-log .msg").length).toBeGreaterThan(0);
    expect(box.querySelectorAll(".bc-thread .quick .qbtn")).toHaveLength(2);
    expect(box.querySelector(".bc-compose textarea.bc-input")).not.toBeNull();
    expect(box.querySelector<HTMLButtonElement>(".bc-send")!.disabled).toBe(true);
    expect(box.dataset.side).toBe("r");
  });

  it("sends what is written with the references in the tray, and a quick question as it stands", async () => {
    const { box, sendTask, snapshot } = await open(boarderOf(1));
    const tiles = box.querySelectorAll(".bc-refs .rt").length;
    expect(tiles).toBeGreaterThan(0);
    const input = box.querySelector<HTMLTextAreaElement>(".bc-input")!;
    act(() => { input.value = "Tighten shot 2"; input.dispatchEvent(new Event("input", { bubbles: true })); });
    await act(async () => { click(box.querySelector(".bc-send")); await Promise.resolve(); });
    expect(sendTask).toHaveBeenLastCalledWith(snapshot.project.id, expect.objectContaining({ botId: boarderOf(1), text: "Tighten shot 2", references: expect.any(Array) }));
    expect(sendTask.mock.lastCall![1].references).toHaveLength(tiles);
    await act(async () => { click(box.querySelector(".quick .qbtn")); await Promise.resolve(); });
    expect(sendTask).toHaveBeenLastCalledWith(snapshot.project.id, expect.objectContaining({ text: "How far is this episode?" }));
  });

  it("takes a reference out of the tray and adds one from the picker", async () => {
    const { box } = await open(boarderOf(1));
    const before = box.querySelectorAll(".bc-refs .rt").length;
    click(box.querySelector(".bc-refs .rt .rt-x"));
    expect(box.querySelectorAll(".bc-refs .rt")).toHaveLength(before - 1);
    click(box.querySelector(".bc-refs .rt-add"));
    expect(box.querySelector<HTMLElement>(".bc-picker")!.hidden).toBe(false);
    click(box.querySelector(".bc-picker .pk"));
    expect(box.querySelectorAll(".bc-refs .rt")).toHaveLength(before);
  });

  it("closes its picker on Escape, then itself", async () => {
    const { box, onClose } = await open(BOARD_BOTS.lead);
    click(box.querySelector(".bc-refs .rt-add"));
    press(box, "Escape");
    expect(box.querySelector<HTMLElement>(".bc-picker")!.hidden).toBe(true);
    expect(onClose).not.toHaveBeenCalled();
    press(box, "Escape");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("offers Stop while the bot works, and only reading in an archived project", async () => {
    const working = await open(boarderOf(2));
    await act(async () => { click(buttonNamed(working.box, "Stop")); await Promise.resolve(); });
    expect(working.stopBot).toHaveBeenCalledWith(working.snapshot.project.id, boarderOf(2));
    const archived = await open(BOARD_BOTS.lead, { readOnly: true });
    expect(archived.box.querySelector<HTMLTextAreaElement>(".bc-input")!.disabled).toBe(true);
    expect(archived.box.querySelector(".quick .qbtn")).toBeNull();
  });

  it("is a sheet on a narrow stage", async () => {
    expect((await open(BOARD_BOTS.lead, { stageWidth: 700 })).box.className).toContain("is-sheet");
  });
});
```

样例里哪位分镜师在工作以 `production-board-sample.ts` 为准（`SAMPLE_IN_WORK`、bot 的 `status`）；不是第 2 集就换成在工作的那位。“Stop”等按钮名以 `en.json` 的现有键为准。

- [ ] **Step 2: 确认失败**

Run: `OMB_VITEST_WORKERS=2 node node_modules/vitest/vitest.mjs run src/components/production-board/panels/chat-place.test.ts src/components/production-board/panels/ChatWindow.dom.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: `chat-place.ts`**

照 `panels.js:132-155`：`anchor` 是卡片在屏幕上的矩形，`room = stage.width - reserved`。
- `stage.width < 720` → `{ sheet: true }`。
- `anchor` 为空 → `{ sheet: false, left: max(12, room - size.width - 12), top: 60, arrowY: 0, side: "none" }`。
- 否则 `want = anchor.x + anchor.width + 16`，`side = "r"`；`want + size.width > room - 12` 且 `anchor.x - 16 - size.width >= 12` 时 `want = anchor.x - 16 - size.width`，`side = "l"`。`left = clamp(want, 12, max(12, room - size.width - 12))`，`top = clamp(anchor.y, 60, max(60, stage.height - size.height - 12))`，`arrowY = anchor.y + 36 * zoom - top`；`|left - want| < 1 && arrowY > 14 && arrowY < size.height - 26` 才保留 `side`，否则 `"none"`。数值取整。

- [ ] **Step 4: `ChatWindow.tsx`**

DOM 照 `index.html:82-104`：`<section class="bchat [is-sheet] [is-picking] [no-thread]" role="dialog" aria-label data-board-chat="" data-state data-side style={{ transform, "--ty" }}>`。
- 头部：`.bc-ava` 里 `<BotFace size={34}>`；`.bc-who`：名字，岗位和集数；`.bc-st`：`i.led` + 状态文字；`button.tbtn` 关闭。
- `.bc-thread`：`.chat-log[role=log][aria-live=polite]`，每条消息 `div.msg.me`（人）或 `div.msg.bot`（bot，内容用 `ChatMarkdown`）；等人回答时在最后放 `<ChatWaiting>`；读取失败时一条 `p.msg.sys`。`.quick`：该 bot 岗位的两个 `button.qbtn`（`boardPanels.chat.quick.<job>.<1|2>`），没有岗位或只读时不画，点了直接发送。
- `.bc-picker`（照 `renderPicker`）：分组列出还不在托盘里的素材，来自 `index` 的 `scripts`、`characters`、`scenes`、`shotsByEpisode`、`results`、`documents` 和 `finals`；头部一个“完成”。
- `.bc-compose`：`.bc-lbl`（“参考”+ 数量说明）；`.bc-refs`（照 `renderRefs`）：连入它的素材（锁定，不带删除）和托盘里的素材（`.rt.rt-<类型>` 里 `button.rt-main` 缩略图加标签，点了 `focusNode`；`button.rt-x` 删除），最后 `button.rt-add`；`textarea.bc-input`；`.bc-actions`：`button.bc-pill`（展开或收起对话记录）、bot 在工作或排队时的“停止”（`button.bc-pill`）、“在聊天里打开”（`button.bc-pill`）、`button.bc-send`。
- 行为（照备份 `BotChatWindow.tsx`，见设计 10.1）：挂载、发送成功后、`bot.status | output.messageId | output.at | waiting.messageId` 变化时 `readExchange`；`look.unread` 时 `readConversation`；发送 `sendTask(projectId, { botId, text, references, language: activeLocale() })`，成功清空草稿，排队时提示，失败保留草稿并提示；参考超过 50 个不发并提示；`stopBot`；`openChat`；`sessions` 里按 bot 记草稿、加的和去掉的参考；打开时带来的 `references` 每次到来加进托盘一次。
- 回车发送（遵循程序的发送键设置，同旧实现的 `sendsMessage`），输入法组合中不发。`Escape`：先关选择器，再 `onClose()`。
- 位置：`placeChat(anchorOf(botNodeId(bot.botId)), 自己量到的尺寸, layer, reserved, zoom())`，在 `subscribeView` 回调和自身 `ResizeObserver` 回调里直接写 `style.transform`、`--ty`、`dataset.side` 和 `is-sheet` 类。
- 流式更新时只追加或替换最后一条，不整窗重画；贴底时跟随滚动（`@/lib/bottom-follow`）。

`ChatWaiting.tsx`：逻辑照备份里的同名文件（`pendingApprovals`、`PendingApprovalPanel`、`PendingApprovalActions`、`isQuestionCard`、`approvalDetailText`、没有 `StoreContext` 时的“在聊天里回答”），外层换成 `div.bc-wait`。

`additions.css` 追加：

```css
.mj-board .bc-wait { align-self: stretch; padding: 10px 12px; border-radius: 12px; border: 1px dashed var(--line-2); background: var(--card); font-size: 13px; }
.mj-board .bc-actions .bc-pill + .bc-pill { margin-left: 6px; }
.mj-board .rt.is-locked .rt-x { display: none; }
```

- [ ] **Step 5: 确认通过并提交**

Run: `OMB_VITEST_WORKERS=2 node node_modules/vitest/vitest.mjs run src/components/production-board/panels/chat-place.test.ts src/components/production-board/panels/ChatWindow.dom.test.ts && pnpm exec tsc -b && pnpm lint`
Expected: PASS。

```bash
git add src/components/production-board/panels/chat-place.ts src/components/production-board/panels/chat-place.test.ts src/components/production-board/panels/ChatWindow.tsx src/components/production-board/panels/ChatWindow.dom.test.ts src/components/production-board/panels/ChatWaiting.tsx src/components/production-board/styles/additions.css
git commit -m "Production board: the mockup's chat window beside a bot's card, with the bot's real exchange, its references and Stop"
```

---

### Task 18: 素材详情弹窗

**Files:**
- Create: `src/components/production-board/panels/DetailModal.tsx`
- Modify: `src/lib/production-board/details-view.ts`（上游、下游）、`src/components/production-board/styles/additions.css`
- Test: `src/components/production-board/panels/DetailModal.dom.test.ts`、`src/lib/production-board/details-view.test.ts`

来源：`index.html:111-114`；`panels.js` `media` 275–300、`uses` 303–310、`renderModal` 312–345、`openModal` 347–357、`closeModal` 359–366、键盘 368–377。

**Interfaces:**
- Consumes: `DetailsView`、`detailsView`（`@/lib/production-board/details-view`）、`Board`、`NodeBody`（任务 14，用来画单据的静态纸张卡）。
- Produces:
  - `details-view.ts` 新增：

```ts
export interface DetailsLink { cardId: string; nodeId: string | undefined; botId: string | undefined; title: string; kind: BoardEdgeKind }
/** The cards whose lines lead into a card and out of it, references apart. */
export function detailsLinks(cardId: string, board: Board, titleOf: (cardId: string) => string): { upstream: DetailsLink[]; downstream: DetailsLink[] };
```

  - `DetailModal`：`(props: { view: DetailsView; links: { upstream: DetailsLink[]; downstream: DetailsLink[] }; card: BoardCard | undefined; ctx: NodeContext; readOnly: boolean; onClose(): void; onLocate(): void; onAsk(): void; onOpenCard(link: DetailsLink): void; onSelectTake?(nodeId: string): void }) => JSX.Element`。

- [ ] **Step 1: 写失败的测试**

`details-view.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { buildBoard } from "./board";
import { detailsLinks } from "./details-view";
import { productionBoardSample } from "@/testing/production-board-sample";

describe("what leads into a card and out of it", () => {
  it("are the cards at the other ends of its lines, a reference counted on the way in only", () => {
    const board = buildBoard(productionBoardSample({ episodes: 4 }));
    const titleOf = (cardId: string) => cardId;
    const brief = detailsLinks("brief", board, titleOf);
    expect(brief.upstream.map((link) => link.kind)).toEqual(["output"]);
    expect(brief.downstream.map((link) => link.kind)).toEqual(["handoff"]);
    const shot = board.cards.find((card) => card.kind === "shot" && card.references.length > 0)!;
    const links = detailsLinks(shot.id, board, titleOf);
    expect(links.upstream.some((link) => link.kind === "ref")).toBe(true);
    expect(links.downstream.every((link) => link.kind !== "ref")).toBe(true);
  });
});
```

`DetailModal.dom.test.ts`：

```ts
// @vitest-environment happy-dom
import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { boardIndex } from "@/lib/production-board/board-index";
import { detailsLinks, detailsView } from "@/lib/production-board/details-view";
import { boardFixture } from "../testing/board-fixture";
import { buttonNamed, click, press, render, textOf, useBoardPage } from "../testing/dom-kit";
import { DetailModal } from "./DetailModal";

useBoardPage();

function open(kind: "character" | "brief" | "result") {
  const fixture = boardFixture();
  const card = fixture.cardOf(kind);
  const index = boardIndex(fixture.snapshot);
  const asset = index.assetOf(card.nodeIds[0]!)!;
  const view = detailsView(asset, index, fixture.snapshot.bots[index.ownerOf(asset)], fixture.snapshot.drafts, fixture.ctx.fileUrl);
  const calls = { onClose: vi.fn(), onLocate: vi.fn(), onAsk: vi.fn(), onOpenCard: vi.fn(), onSelectTake: vi.fn() };
  const root = render(createElement("div", { className: "mj-board" }, createElement(DetailModal, { view, links: detailsLinks(card.id, fixture.board, (id) => id), card, ctx: fixture.ctx, readOnly: false, ...calls })));
  return { box: root.querySelector<HTMLElement>(".dm-box")!, scrim: root.querySelector<HTMLElement>(".dm-scrim")!, view, calls };
}

describe("a card's details", () => {
  it("are the mockup's modal: what it is and its title, its picture on the left, what is known of it on the right", () => {
    const { box, view } = open("character");
    expect(box.getAttribute("role")).toBe("dialog");
    expect(box.getAttribute("aria-modal")).toBe("true");
    expect(box.dataset.boardAsset).toBe("character");
    expect(box.dataset.kind).toBe("char");
    expect(textOf(box.querySelector(".dm-head h2"))).toBe(view.title);
    expect(box.querySelector(".dm-body .dm-media .dm-art img")).not.toBeNull();
    expect(box.querySelectorAll(".dm-info .dm-sec").length).toBeGreaterThan(0);
    expect(box.querySelector(".dm-uses, .dm-none")).not.toBeNull();
  });

  it("shows a document as the sheet the board shows, standing still", () => {
    const { box } = open("brief");
    expect(box.querySelector(".dm-media .node.k-brief.dm-card")).not.toBeNull();
  });

  it("lists a video's takes, the one the film uses marked", () => {
    const { box, view } = open("result");
    expect(box.querySelectorAll(".dm-takes .take")).toHaveLength(view.takes.length);
    expect(box.querySelector(".dm-takes .take[data-cur]")).not.toBeNull();
  });

  it("locates the card, asks the bot it belongs to, and closes on its button, its scrim and Escape", () => {
    const { box, scrim, calls, view } = open("character");
    click(buttonNamed(box, "Find on the board"));
    expect(calls.onLocate).toHaveBeenCalledTimes(1);
    click(box.querySelector(".dm-foot .btn-primary"));
    expect(calls.onAsk).toHaveBeenCalledTimes(1);
    expect(textOf(box.querySelector(".dm-foot .btn-primary"))).toContain(view.owner!.name);
    click(box.querySelector(".dm-head .dm-close"));
    click(scrim);
    press(box, "Escape");
    expect(calls.onClose).toHaveBeenCalledTimes(3);
  });
});
```

- [ ] **Step 2: 确认失败**

Run: `OMB_VITEST_WORKERS=2 node node_modules/vitest/vitest.mjs run src/lib/production-board/details-view.test.ts src/components/production-board/panels/DetailModal.dom.test.ts`
Expected: FAIL。

- [ ] **Step 3: 实现**

`detailsLinks`：`board.edges` 里 `to === cardId` 的是上游（含引用线），`from === cardId && kind !== "ref"` 的是下游；每条给出另一端卡片的 `cardId`、它的第一个 `nodeIds`、它是 bot 时的 `botId`、`titleOf(cardId)`、线的类型。

`DetailModal`（照 `panels.js:321-344`）：

```tsx
<div className="dm">
  <button type="button" className="dm-scrim" tabIndex={-1} aria-label={…} onClick={onClose} />
  <section className="dm-box" role="dialog" aria-modal="true" aria-labelledby={titleId} data-board-asset={view.kind} data-kind={MOCKUP_KIND[view.kind]}>…</section>
</div>
```

- `MOCKUP_KIND`：`character → char`、`episode → ep`、`plan → tasks`，其余同名。
- `.dm-head`：`span.dm-kind`（图标 + 类型名）、`b.mono`（`view.code`）、`h2#titleId`、`button.tbtn.dm-close`。
- `.dm-media`：图片 `figure.dm-art`；视频 `.node.k-result.dm-card` 里的 `<video controls>` 加 `.dm-takes`（`span.take[data-cur]`，可点；不是当前的点了调 `onSelectTake`，只读时不可点）；单据（`brief`、`plan`、`episode`、`shot`）`<article class="node k-… dm-card">` 里放 `<NodeBody card ctx>`（`ctx.actions` 换成全空的，纸张卡不响应操作）；其余 `.dm-sheet`。
- `.dm-info`：`p.dm-about`（`view.subtitle` 或正文的头一段）；属性 `dl.dm-dl`（`view.facts`）；提示词 `p.dm-prompt`；`view.appearances` 不为 `null` 时 `.dm-uses`（`button.use`，点了 `onOpenCard`）或 `p.dm-none`；上游、下游各一节 `.rels > button.rel`（图标按另一端卡片的类型，`em` 是 `boardPanels.details.edge.<kind>`）。
- `.dm-foot`：`button.btn`（`LocateFixed`，“在画布中定位”）→ `onLocate`；`view.owner` 存在且不只读时 `button.btn.btn-primary`（`MessageSquare`，“让 名字 调整”）→ `onAsk`。
- 打开时焦点进 `.dm-close`，`Tab` 在弹窗内循环，关闭时焦点回到打开前的元素（`panels.js:347-377`）；`Escape` 关闭。

`additions.css` 追加：

```css
.mj-board .dm { inset: 0; z-index: 60; }
.mj-board .dm-takes .take { cursor: pointer; }
.mj-board .dm-card { position: static; cursor: default; }
```

- [ ] **Step 4: 确认通过并提交**

Run: `OMB_VITEST_WORKERS=2 node node_modules/vitest/vitest.mjs run src/lib/production-board/details-view.test.ts src/components/production-board/panels/DetailModal.dom.test.ts && pnpm exec tsc -b && pnpm lint`
Expected: PASS。按钮名以 `en.json` 现有的 `boardPanels.*` 键为准。

```bash
git add src/lib/production-board/details-view.ts src/lib/production-board/details-view.test.ts src/components/production-board/panels/DetailModal.tsx src/components/production-board/panels/DetailModal.dom.test.ts src/components/production-board/styles/additions.css
git commit -m "Production board: the mockup's details of a card, with what leads into it and out of it, and asking the bot it belongs to"
```

---

### Task 19: 右侧面板、分集列表、浮层，删掉旧界面

**Files:**
- Rewrite: `src/components/production-board/panels/SidePanel.tsx`、`ProductionBoardOverlay.tsx`
- Delete: `src/components/production-board/panels/{AssetDetails.tsx,AssetDetails.dom.test.ts,BotChatWindow.tsx,BotChatWindow.dom.test.ts,ChatExchange.tsx,ReferenceTray.tsx,SidePanel.dom.test.ts,ProductionBoardOverlay.dom.test.ts,overlay-renders.dom.test.ts,panel-parts.tsx,chat-placement.ts,chat-placement.test.ts,testing/}`、`src/components/production-board/cards/`（整个目录）、`scripts/testing/board-cards-preview.tsx`、`board-cards-shots.ts`、`board-panels-preview.tsx`、`board-panels-shots.ts`、`board-panels-bench.ts`、`board-panels-bench-page.tsx`
- Modify: `src/components/production-board/styles/additions.css`、`src/components/project-view/ProjectView.board.dom.test.ts`、`src/lib/production-board/overlay-backend.ts`（`Pick` 里加 `"selectTake"`）
- Test: `src/components/production-board/panels/SidePanel.dom.test.ts`、`ProductionBoardOverlay.dom.test.ts`（都新写）

来源：`shell.css` 的 `.pane-head`、`.pane-scroll`、`.sec-lbl`、`.rrow*`、`.legend*`、`.lg-*`；`app.js` `buildRoster` 670–696；选择器的列表样式 `panels.css` `.pk*`。

**Interfaces:**
- Consumes: `panelRows`、`PanelRows`（`@/lib/production-board/panel-rows`）、任务 17、18 的组件、`detailsView`、`detailsLinks`、`boardIndex`。
- Produces:
  - `SIDE_PANEL_ROOM = { open: 304, folded: 56 }`；`SidePanel(props: { rows: PanelRows; looks: Readonly<Record<string, CanvasBotLook>>; open: boolean; onOpenChange(open: boolean): void; chatBotId?: string; onBot(botId: string): void; onAsset(cardId: string): void; onEpisode(episode: number): void })`。
  - `ProductionBoardOverlay(props: BoardOverlayProps)`：同旧的导出名和路径，`ProjectView.tsx` 不用改。

- [ ] **Step 1: 写失败的测试**

`SidePanel.dom.test.ts`：

```ts
// @vitest-environment happy-dom
import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { boardIndex } from "@/lib/production-board/board-index";
import { panelRows } from "@/lib/production-board/panel-rows";
import { BOARD_BOTS, PRODUCTION_BOARD_LOOKS, productionBoardSample } from "@/testing/production-board-sample";
import { buttonNamed, click, render, textOf, useBoardPage } from "../testing/dom-kit";
import { SidePanel } from "./SidePanel";

useBoardPage();

function draw(open = true) {
  const snapshot = productionBoardSample({ episodes: 4 });
  const rows = panelRows(boardIndex(snapshot), (file) => `/files/${file.path}`, null);
  const calls = { onOpenChange: vi.fn(), onBot: vi.fn(), onAsset: vi.fn(), onEpisode: vi.fn() };
  const root = render(createElement("div", { className: "mj-board" }, createElement(SidePanel, { rows, looks: PRODUCTION_BOARD_LOOKS, open, ...calls })));
  return { panel: root.querySelector<HTMLElement>("[data-board-side-panel]")!, root, calls, rows };
}

describe("the panel at the board's right", () => {
  it("lists the team in the mockup's rows, the lead first, and ends with the legend of the lines", () => {
    const { panel, calls, rows } = draw();
    expect(panel.tagName).toBe("ASIDE");
    expect(panel.querySelector(".pane-head")).not.toBeNull();
    const team = [...panel.querySelectorAll(".pane-scroll button.rrow[data-bot]")];
    expect(team).toHaveLength(rows.team.drama.length + rows.team.episodes.length);
    expect(team[0]!.getAttribute("data-bot")).toBe(BOARD_BOTS.lead);
    expect(team[0]!.querySelector(".ava")).not.toBeNull();
    expect(team[0]!.querySelector(".st .led")).not.toBeNull();
    expect(panel.querySelectorAll(".legend li")).toHaveLength(4);
    click(team[0]);
    expect(calls.onBot).toHaveBeenCalledWith(BOARD_BOTS.lead);
  });

  it("has a tab for the assets by kind and one for the episodes", () => {
    const { panel, calls, rows } = draw();
    click(buttonNamed(panel, "Assets"));
    expect(panel.querySelectorAll(".pane-scroll .sec-lbl").length).toBeGreaterThanOrEqual(3);
    click(panel.querySelector(".pane-scroll button.rrow[data-card]"));
    expect(calls.onAsset).toHaveBeenCalledTimes(1);
    click(buttonNamed(panel, "Episodes"));
    const episodes = [...panel.querySelectorAll(".pane-scroll button.rrow[data-episode]")];
    expect(episodes).toHaveLength(rows.episodes.length);
    expect(textOf(episodes[0]!.querySelector(".mono"))).toBe("EP01");
    click(episodes[1]);
    expect(calls.onEpisode).toHaveBeenCalledWith(2);
  });

  it("folds to one button, and tells the board the room it takes", () => {
    const opened = draw(true);
    expect(opened.root.querySelector<HTMLElement>("[data-board-room]")!.style.width).toBe("304px");
    click(opened.panel.querySelector(".pane-head .tbtn"));
    expect(opened.calls.onOpenChange).toHaveBeenCalledWith(false);
    const folded = draw(false);
    expect(folded.root.querySelector<HTMLElement>("[data-board-room]")!.style.width).toBe("56px");
    expect(folded.root.querySelector("[data-board-side-panel]")).toBeNull();
  });
});
```

标签页的英文名（`Team`、`Assets`、`Episodes`）以 `en.json` 现有的 `boardPanels.*` 键为准。

`ProductionBoardOverlay.dom.test.ts`：

```ts
// @vitest-environment happy-dom
import { act, createElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { buildBoard } from "@/lib/production-board/board";
import type { BoardOpened, BoardOverlayProps } from "@/lib/production-board/overlay";
import { BOARD_BOTS, productionBoardBackend, productionBoardSample } from "@/testing/production-board-sample";
import { click, render, useBoardPage } from "../testing/dom-kit";
import { ProductionBoardOverlay } from "./ProductionBoardOverlay";

useBoardPage();

async function draw(opened: BoardOpened | null) {
  const snapshot = productionBoardSample({ episodes: 4 });
  const props: BoardOverlayProps = {
    projectId: snapshot.project.id, snapshot, backend: productionBoardBackend(), board: buildBoard(snapshot), opened,
    open: vi.fn(), close: vi.fn(), anchorOf: () => ({ x: 100, y: 100, width: 320, height: 400 }), subscribeView: () => () => {}, zoom: () => 1,
    focusNode: vi.fn(), focusEpisode: vi.fn(), focusStage: vi.fn(),
  };
  const root = render(createElement("div", { className: "mj-board", style: { width: "1200px", height: "800px" } }, createElement(ProductionBoardOverlay, props)));
  await act(async () => { await Promise.resolve(); });
  return { root, props };
}

describe("what is drawn over the board", () => {
  it("is the side panel alone while nothing is open", async () => {
    const { root } = await draw(null);
    expect(root.querySelector("[data-board-room]")).not.toBeNull();
    expect(root.querySelector(".bchat")).toBeNull();
    expect(root.querySelector(".dm")).toBeNull();
  });

  it("is a bot's chat when a bot is open, and a card's details when a card is", async () => {
    expect((await draw({ kind: "bot", botId: BOARD_BOTS.lead })).root.querySelector(".bchat[data-board-chat]")).not.toBeNull();
    const details = await draw({ kind: "asset", nodeId: "brief" });
    expect(details.root.querySelector(".dm-box[data-board-asset='brief']")).not.toBeNull();
  });

  it("opens the chat of the bot a card belongs to, with the card as a reference, from the card's details", async () => {
    const snapshot = productionBoardSample({ episodes: 4 });
    const character = buildBoard(snapshot).cards.find((card) => card.kind === "character")!;
    const { root, props } = await draw({ kind: "asset", nodeId: character.nodeIds[0]! });
    click(root.querySelector(".dm-foot .btn-primary"));
    expect(props.open).toHaveBeenCalledWith({ kind: "bot", botId: expect.any(String), references: [character.nodeIds[0]] });
  });

  it("closes what is open when the bot or the card it shows is no longer there", async () => {
    const { props } = await draw({ kind: "bot", botId: "nobody" });
    expect(props.close).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 确认失败**

Run: `OMB_VITEST_WORKERS=2 node node_modules/vitest/vitest.mjs run src/components/production-board/panels/SidePanel.dom.test.ts src/components/production-board/panels/ProductionBoardOverlay.dom.test.ts`
Expected: FAIL。

- [ ] **Step 3: 实现**

- `SidePanel`：展开时 `<aside class="side" data-board-side-panel="" aria-label>`：
  - `.pane-head`：三栏切换（三个 `button.schip`，当前的 `aria-current="true"`）和收起按钮 `button.tbtn`。
  - `.pane-scroll`：
    - 团队：`p.sec-lbl`“全剧”，下面每个 bot 一行 `button.rrow[data-bot][data-state]`（`span.ava` 里 `<BotAvatar size={32}>`、`span.who > b + span`、`span.st > i.led + 状态`），当前开着对话的行加 `is-cur`；`p.sec-lbl`“每集”，同样的行；最后 `p.sec-lbl`“连线图例”和 `ul.legend`（四行，照 `app.js:689-695`，文案是 `productionBoard.legend.*`）。
    - 素材：角色、场景、镜头（按集）、成片各一节，行是 `button.rrow[data-card]`（`span.ava.sm` 里是缩略图或类型图标，`span.who`，`span.cnt`）。
    - 分集：每集 `button.rrow[data-episode]`（`span.mono` 集数、标题、状态、`已选用 / 镜头数`）。
  - 收起时只画一个 `button.tbtn`（展开）。
  - 无论展开收起都画一个占位元素 `div[data-board-room]`，宽度是 `SIDE_PANEL_ROOM.open` 或 `.folded`（画布靠它让开阶段条和小地图）。
- `ProductionBoardOverlay`：照备份里同名文件的流程（`boardIndex`、`panelRows`、读头像、量浮层尺寸、宽度不足 900 默认收起面板、`sessions`、打开的 bot 或素材不在了就 `close()`、挡住指针和滚轮不让画布收到），画 `SidePanel`、`ChatWindow`、`DetailModal`：
  - `DetailModal` 的 `links` 是 `detailsLinks(cardId, props.board, …)`；`card` 是 `props.board.cards` 里对应的卡；`onLocate` → `close()` 再 `focusNode`；`onAsk` → `open({ kind: "bot", botId: view.owner.botId, references: [view.nodeId] })`；`onOpenCard(link)` → bot 就 `open({ kind: "bot", botId })`，否则 `open({ kind: "asset", nodeId })`；`onSelectTake` → `backend.selectTake(projectId, nodeId)`（`OverlayBackend` 的 `Pick` 里加 `"selectTake"`）。
  - `ChatWindow` 的 `zoom` 用 `props.zoom`（任务 16 加进 `BoardOverlayProps` 的）。

`additions.css` 追加：

```css
.mj-board .side { position: absolute; top: 12px; right: 12px; bottom: 68px; width: 292px; z-index: 30; display: flex; flex-direction: column; min-height: 0; border-radius: 12px; background: color-mix(in srgb, var(--panel) 94%, transparent); border: 1px solid var(--line); box-shadow: var(--shadow-float); pointer-events: auto; }
.mj-board .side .pane-head { gap: 2px; padding: 0 6px; }
.mj-board .side .pane-head .schip { height: 28px; padding: 0 10px; }
.mj-board .side-fold { position: absolute; top: 12px; right: 12px; z-index: 30; background: color-mix(in srgb, var(--panel) 94%, transparent); border: 1px solid var(--line); border-radius: 12px; pointer-events: auto; }
.mj-board [data-board-room] { position: absolute; top: 0; right: 0; height: 0; pointer-events: none; }
.mj-board [data-board-overlay] { position: absolute; inset: 0; z-index: 25; pointer-events: none; overflow: hidden; }
.mj-board [data-board-overlay] :is(.bchat, .dm) { pointer-events: auto; }
```

- [ ] **Step 4: 删旧界面**

```bash
git rm -r src/components/production-board/cards src/components/production-board/panels/testing
git rm src/components/production-board/panels/AssetDetails.tsx src/components/production-board/panels/AssetDetails.dom.test.ts src/components/production-board/panels/BotChatWindow.tsx src/components/production-board/panels/BotChatWindow.dom.test.ts src/components/production-board/panels/ChatExchange.tsx src/components/production-board/panels/ReferenceTray.tsx src/components/production-board/panels/overlay-renders.dom.test.ts src/components/production-board/panels/panel-parts.tsx src/components/production-board/panels/chat-placement.ts src/components/production-board/panels/chat-placement.test.ts
git rm scripts/testing/board-cards-preview.tsx scripts/testing/board-cards-shots.ts scripts/testing/board-panels-preview.tsx scripts/testing/board-panels-shots.ts scripts/testing/board-panels-bench.ts scripts/testing/board-panels-bench-page.tsx
rg -n "production-board/(cards|board/chrome|board/card-view|panels/(AssetDetails|BotChatWindow|ChatExchange|ReferenceTray|panel-parts|chat-placement|testing))" src scripts package.json docs/verification
```

最后一条的输出里，`src`、`scripts`、`package.json` 的每一处都要处理掉（删掉引用它的脚本入口，或改到新文件）；`docs/verification` 的留到任务 20。

`src/components/project-view/ProjectView.board.dom.test.ts` 按新 DOM 改：
- `:94-103`：`[data-production-board]` 是 `.viewport`；浮层是 `.stage > [data-board-overlay]`；面板是 `aside[data-board-side-panel]`；`[data-board-room]` 一个，宽 `304px`；阶段条是 `nav.stagebar`，它的 `max-width` 里减去了 304 + 24。
- `:109-113`：`[data-board-chat]` 的 `aria-label` 不变；位置断言换成 `dataset.side === "r"` 和 `style.transform` 是 `translate(<卡片右边 + 16>px, <max(60, 卡片顶)>px)`。
- `:119-124`：不变（`[role='dialog'][aria-modal='true']`、`dataset.boardAsset`、`h2`、关闭按钮）。

- [ ] **Step 5: 确认通过并提交**

Run:
```bash
OMB_VITEST_WORKERS=2 node node_modules/vitest/vitest.mjs run src/components/production-board src/components/project-canvas src/components/project-view src/lib/production-board src/lib/project-canvas
pnpm exec tsc -b && pnpm lint
```
Expected: 全过。

```bash
git add -A src/components/production-board src/components/project-view src/lib/production-board scripts/testing package.json
git commit -m "Production board: the side panel in the mockup's rows with the legend, the list of episodes, and the old cards and panels gone"
```

---

### Task 20: 收尾：旧令牌、对比度、文案、预览、对照工具、文档

**Files:**
- Modify: `src/styles.css:201-251`、`scripts/check-skin-contrast.mjs:168-179`
- Modify: `src/locales/{en,zh,zh-tw,pt-br}.json`（删不再用到的键）
- Modify: `scripts/testing/project-canvas-preview.tsx`、`scripts/testing/project-canvas-ui.e2e.test.ts`、`scripts/testing/board-visual-map.json`、`scripts/board-visual-audit.ts`、`scripts/testing/board-visual-audit.test.ts`、`scripts/board-visual-compare.ts`、`scripts/testing/control-omb-ui.e2e.test.ts`、`scripts/verify-data.ts`
- Modify: `DESIGN.md`、`docs/verification/visual-audit.md`、`docs/verification/production-board.md`、`docs/superpowers/specs/2026-11-24-production-board-design.md`（开头加一行“界面已由 2026-11-26 的迁移替换”）

- [ ] **Step 1: 旧令牌和对比度**

`src/styles.css`：删 201–218 行的 `--color-board-*`、`--shadow-board*` 和 226–251 行的 `.board-*` 类。先 `rg -n "board-(paper|ink|teal|amber|monitor|line|card-shadow|type|bot-glow|paper-stack|panel-shadow|modal-shadow)|shadow-board" src scripts` 确认除 `styles.css` 和 `check-skin-contrast.mjs` 外没有引用。

`scripts/check-skin-contrast.mjs`：把 168–179 行的十对换成新画布用到的配对：

```js
  // The production board draws on the skin: ink on its sheets of paper, and the page's colour on its amber and green fills.
  ["--color-ink", "--color-menu", 4.5],
  ["--color-ink-secondary", "--color-menu", 4.5],
  ["--color-ink-tertiary", "--color-menu", 4.5],
  ["--color-warning", "--color-menu", 4.5],
  ["--color-success", "--color-menu", 4.5],
  ["--color-app", "--color-warning", 4.5],
  ["--color-success-ink", "--color-success", 4.5],
  ["--color-app", "--color-ink", 4.5],
```

Run: `pnpm check:contrast`
Expected: PASS。某套皮肤的某一对不过时：不改皮肤的令牌；在 `skin.css` 里给那套皮肤单独换 `--on-fill` 或 `--paper`（例如 `[data-skin="<名字>"] .mj-board { --on-fill: var(--color-ink); }`），把对应的一对从上表改成实际用的那一对，并把这件事写进任务结果里。

- [ ] **Step 2: 删不再用到的文案键**

```bash
node -e '
const fs = require("fs"); const { execSync } = require("child_process");
const en = JSON.parse(fs.readFileSync("src/locales/en.json", "utf8"));
const dynamic = execSync("rg -o --no-filename \"t\\\\(`[A-Za-z.]+\\\\$\" src/components/production-board src/lib/production-board || true").toString().split("\n").filter(Boolean).map((hit) => hit.slice(3, -1));
for (const key of Object.keys(en)) {
  if (!/^(productionBoard|boardCards|boardPanels)\./.test(key)) continue;
  if (dynamic.some((prefix) => key.startsWith(prefix))) continue;
  try { execSync(`rg -q -F "\\"${key}\\"" src scripts --glob "!src/locales/**"`); } catch { console.log(key); }
}'
```

对输出的每个键：确认它确实没有被模板字符串拼出来（看它的前缀在 `src/components/production-board`、`src/lib/production-board` 里有没有 `` t(`前缀${…}`) ``），然后从 `en.json`、`zh.json`、`zh-tw.json`、`pt-br.json` 四个文件里删掉。

Run: `pnpm i18n:check && pnpm exec tsc -b`
Expected: PASS。

- [ ] **Step 3: 预览、端到端、对照工具**

- `scripts/testing/project-canvas-preview.tsx`：不用改引用路径（`ProductionBoardOverlay` 的路径没变）；确认它等的 `[data-board-card-id]` 还在。
- `scripts/testing/board-visual-map.json` 的 `app` 选择器：`[data-stage-surface] → .stagebar`；`[data-board-minimap] → .minimap`，它的 `appReveal` 改成 `.toolbar button[aria-pressed="false"]:last-of-type`；`[data-board-card="episodeStack"] → [data-board-card="stack"]`；`[data-board-chat] > div → [data-board-chat]`；其余不变。
- `scripts/board-visual-audit.ts`：
  - `:477-483` 的类型名 `episodeStack → stack`、`generic → other`。
  - `:485-507` 的 `CARD_LAYOUT` 不再引入 `layout.ts`、`cards/sizes.ts`：改成在页面里读 `document.querySelector('[data-board-card="<kind>"]')` 的 `style.left`、`style.top`、`offsetWidth`、`offsetHeight`。
  - `:517-535` 假定的缩放系数 `1.2` 改成 `1.25`（`=`）和 `0.8`（`-`）。
  - `:717` 关于“32% 以下只画标签”的说明删掉。
- `scripts/testing/board-visual-audit.test.ts`、`scripts/board-visual-compare.ts`、`scripts/testing/project-canvas-ui.e2e.test.ts`、`scripts/testing/control-omb-ui.e2e.test.ts`、`scripts/verify-data.ts`：`rg -n "data-board-|data-stage-|data-result-|data-brief-|data-far-" <文件>` 找出每个旧选择器，换成新 DOM 的（根 DOM 约定见 Global Constraints；卡片内部用效果图的类，如 `.rs-takes .take`、`.pp-head`、`.bot-talk`、`.bchat .bc-input`、`.bc-send`、`.dm-box`）。

Run: `OMB_VITEST_WORKERS=2 node node_modules/vitest/vitest.mjs run scripts/testing/board-visual-audit.test.ts scripts/testing/file-size-ratchet.test.ts`
Expected: PASS。端到端文件（`*.e2e.test.ts`）在任务 21 里跑。

- [ ] **Step 4: 文档**

`DESIGN.md` 第 10 节末尾加一段：

```markdown
**The production board is its mockup.** The board of a project (`src/components/production-board/`) is drawn from
`docs/无限画布效果图/index-v5/`: its radii, type sizes, shadows and motion, loops included, are the mockup's, and its
colours are the skin's. Reduced motion still stops all of it.
```

`docs/verification/visual-audit.md`：把“实现缩放 32% 以下只画标签”“颜色用程序现有皮肤、不照搬效果图配色”等描述按现状改（远景画真卡片；颜色取皮肤令牌，监视器固定深色）。`docs/verification/production-board.md`：选择器和文件路径按新结构改。

- [ ] **Step 5: 全量检查并提交**

Run:
```bash
pnpm exec tsc -b && pnpm exec tsc -p tsconfig.server.json && pnpm lint && pnpm i18n:check && pnpm check:contrast
OMB_VITEST_WORKERS=2 node node_modules/vitest/vitest.mjs run src/components/production-board src/components/project-canvas src/components/project-view src/lib/production-board src/lib/project-canvas server/production server/project-canvas server/project-draft scripts/testing/board-visual-audit.test.ts scripts/testing/file-size-ratchet.test.ts src/locales
```
Expected: 全过（与任务 0 的基线比，没有新增的失败）。

```bash
git add src/styles.css scripts DESIGN.md docs/verification docs/superpowers/specs/2026-11-24-production-board-design.md
git add -p src/locales/en.json src/locales/zh.json src/locales/zh-tw.json src/locales/pt-br.json
git commit -m "Production board: the old board's tokens, words and tools follow the canvas that replaced it"
```

---

### Task 21: 验证

先读 `.claude/skills/verify-omb/SKILL.md` 和 `docs/verification/README.md`，按它们起隔离夹具。不碰正在用的程序和数据。

**Files:**
- Create: `.omb-scratch/canvas-port-report.md`（被 git 忽略；给人看的结果）

- [ ] **Step 1: 端到端测试**

Run: `OMB_VITEST_WORKERS=2 node node_modules/vitest/vitest.mjs run scripts/testing/project-canvas-ui.e2e.test.ts server/production.e2e.test.ts server/project-draft.e2e.test.ts server/project-canvas-generation.e2e.test.ts server/project-canvas-privacy.e2e.test.ts`
Expected: PASS。

- [ ] **Step 2: 功能逐项走一遍（隔离夹具 + 预览页）**

用 `scripts/testing/project-canvas-preview.tsx`（`/__production-board.html?episodes=4&skin=daylight&lang=zh`）和无头 Chrome（`scripts/testing/headless-chrome.ts`），逐项确认并截图存到 `/tmp/omb-canvas-port/`：

1. 打开：入场后停在开场视图；阶段条、工具栏、提示、小地图都在。
2. 拖动一张卡片；重新载入后它还在原处。
3. 滚轮缩到 20%：卡片仍是真卡片，bot 上有名牌；`0` 回全局；`1`–`5` 到各阶段并出说明。
4. 点负责人：对话窗贴在卡片右边；发一条消息，看到回复流式出现；停止可用；关掉。
5. 点分镜师：托盘里默认有全剧的角色和场景；删一个、从选择器加一个；发送。
6. 点一张角色卡：详情弹窗；“让某人调整”打开角色设计师的对话窗并带着这张卡。
7. 镜头卡“生成分镜视频”；结果卡出现生成中，再到完成；播放；切到另一个版本并选用。
8. 失败的集：卡上“重试”。
9. 分集摞：打开列表，展开一集，镜头区多出一块；再收回。
10. 右侧面板三栏各点一行；收起、展开。
11. 引用线开关：打开有流光，悬停一张角色卡时它的引用线变亮。
12. 归档项目（`readOnly`）：没有生成、选用、重试、发送。
13. 负责人卡有原著块；场景卡有机位数；需求单有版本和印章；成片卡有配音和音乐轨。

- [ ] **Step 3: 真实链路上的数据（隔离夹具 + 假引擎）**

照 `server/testing/production-fixture.ts` 的写法让假引擎的负责人调用 `production_plan` 并带 `source`，场景设计师写卡片带 `cameras`，再改写一张场景卡。确认快照里：`production.plan.source` 在；场景节点 `metadata.card.cameras` 在；改写后 `metadata.version` 是 2。

- [ ] **Step 4: 草稿音轨对照真实样本**

任务 5 的字段名没有真实样本佐证。向用户要一份在剪映里加过配音、字幕、音乐的草稿的 `draft_info.json`（拷到 `/tmp` 下，不直接读 `~/Movies/JianyingPro`）。拿到后：

```bash
node --experimental-strip-types -e 'import("./server/project-draft/draft-file.ts").then(async ({ draftTracks }) => { const fs = await import("node:fs"); console.log(JSON.stringify(draftTracks(JSON.parse(fs.readFileSync(process.argv[1], "utf8"))), null, 2)); })' /tmp/<样本>.json
```

Expected: 输出里有 `voice`、`subtitle`、`music` 三种里样本实际有的那些，片段数和起止时间与剪映里看到的一致。对不上就改 `draftTracks` 的判定，并把样本脱敏、裁到只剩 `tracks` 和 `materials.audios`、`materials.texts` 的必要字段后加成 `server/project-draft/fixtures/` 下的一个夹具和一条测试。拿不到样本就在报告里写明“音轨未经真实草稿验证”。

- [ ] **Step 5: 视觉对照**

Run: `pnpm vis:audit --viewport 1440x900` 和 `pnpm vis:audit --viewport 760x520`
Expected: 15 个元素两边都找到；尺寸、圆角、内边距、字号行高的差接近 0（卡片高度随内容不同可以有差）；背景、边框的差来自皮肤颜色。

另外截 Midnight 和 Daylight 两套皮肤、两种窗口的：打开时、阶段 4、全局、对话窗、详情弹窗，存到 `/tmp/omb-canvas-port/`。

- [ ] **Step 6: 报告**

`.omb-scratch/canvas-port-report.md`：每一步的结果、截图路径、对照报告里最大的十项差、没验证到的东西（至少写明草稿音轨有没有真实样本验证）。把报告内容和截图给用户看。不 push，不打包。

---

## 自查记录

- 设计 §3 范围 → 任务 6（搬数据模块）、16（删旧引擎和旧画布）、19（删旧卡片和浮层）、20（删旧令牌）。
- §4 备份 → 任务 1。§5 目录 → 文件结构一节。
- §6 样式 → 任务 7（6.1–6.5）、13–19 各自往 `additions.css` 加（6.6）。§7 动效 → 任务 7（减少动效）、16（入场）、20（`DESIGN.md`）。
- §8 引擎 → 任务 8（8.1）、9（8.3）、10（8.4）、11（8.7 的换算）、15（8.7–8.9 的组件）、16（8.2、8.5、8.6、8.10、8.11）。
- §9 节点 → 任务 13、14。§10 浮层 → 任务 17（10.1）、18（10.2）、19（10.3、10.4）。
- §11 数据 → 任务 2（11.3）、3（11.4）、4（11.1）、5（11.5）、12 和 13（11.2）、6（11.6）。
- §12 文案 → 任务 12、20。§13 可达性 → 任务 13–19 的 DOM 测试里的 `role`、`aria-*` 断言。§14 边界状态 → 任务 16（空状态、只读）、17（只读）、19（素材不在了就关）。
- §15 测试 → 每个任务的测试。§16 验证 → 任务 21。§17 不做 → 没有对应任务。
- 名字一致性：`Rect` 用 `w`、`h`（任务 8 起）；`NodeContext.takeOf` 在任务 13 定义、任务 14 使用、任务 16 提供；`BoardOverlayProps` 的 `board` 和 `zoom` 在任务 16 加入，任务 17–19 使用；`EpisodeMenu` 在任务 16 创建；`placeChat` 的新签名只在任务 17 的 `chat-place.ts`，旧的 `chat-placement.ts` 在任务 19 删除；`OverlayBackend` 的 `selectTake` 在任务 19 加入。
