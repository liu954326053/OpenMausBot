// The production board's overlay over pb-bench's drama, timed in the browser: served only by
// scripts/testing/board-panels-bench.ts, which builds it on React's profiling build and reads the numbers this page
// leaves in [data-bench-done].
import { commitListeners, type Fiber } from "./board-panels-bench-hook";
import { AlertCircle, ChevronRight, Crown, LoaderCircle, X } from "lucide-react";
import { Profiler, version } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import type { CanvasSnapshot } from "../../shared/project-canvas";
import { BotAvatar } from "../../src/components/Avatar";
import { ChatMarkdown } from "../../src/components/ChatMarkdown";
import { ProductionBoardOverlay } from "../../src/components/production-board/panels/ProductionBoardOverlay";
import { dramaScaleSnapshot, fakeBackend, SAMPLE_PROJECT_ID, workspaceLooks } from "../../src/components/production-board/panels/testing/board-sample";
import { cn } from "../../src/lib/cn";
import { loadLocale } from "../../src/lib/i18n";
import type { BoardAnchor, BoardOpened, BoardOverlayProps } from "../../src/lib/production-board/overlay";
import { applySkin } from "../../src/lib/skins";
import "../../src/styles.css";

/** What one commit drew under the overlay: React's time for it, the components' own time and how many drew. */
interface Drawn {
  ms: number;
  selfMs: number;
  components: number;
  byName: Record<string, number>;
  selfByName: Record<string, number>;
}

const COMPOSITE = new Set([0, 1, 11, 15]);
const PERFORMED_WORK = 1;
const PROFILER = 12;

const nameOf = (fiber: Fiber): string => {
  const type = fiber.type;
  const name = fiber.tag === 11 ? type?.displayName ?? type?.render?.displayName ?? type?.render?.name : type?.displayName || type?.name;
  return (name || "anonymous").replace(/(?<=\D)\d+$/, "");
};

function profilerOf(root: Fiber): Fiber | null {
  const stack = [root];
  while (stack.length) {
    const fiber = stack.pop()!;
    if (fiber.tag === PROFILER && fiber.memoizedProps?.id === "overlay") return fiber;
    for (let child = fiber.child; child; child = child.sibling) stack.push(child);
  }
  return null;
}

/** pb-bench's count: a component drew when React made it or ran it again; its own time leaves out its children's. */
function drawnUnder(profiler: Fiber): Drawn {
  const drawn: Drawn = { ms: profiler.actualDuration ?? 0, selfMs: 0, components: 0, byName: {}, selfByName: {} };
  const stack: Fiber[] = [];
  for (let child = profiler.child; child; child = child.sibling) stack.push(child);
  while (stack.length) {
    const fiber = stack.pop()!;
    const previous = fiber.alternate;
    if (COMPOSITE.has(fiber.tag) && (!previous || (fiber.flags & PERFORMED_WORK) !== 0)) {
      const name = nameOf(fiber);
      drawn.components += 1;
      drawn.byName[name] = (drawn.byName[name] ?? 0) + 1;
      let self = fiber.actualDuration ?? 0;
      for (let child = fiber.child; child; child = child.sibling) self -= child.actualDuration ?? 0;
      drawn.selfMs += Math.max(0, self);
      drawn.selfByName[name] = (drawn.selfByName[name] ?? 0) + Math.max(0, self);
    }
    if (previous && fiber.child === previous.child) continue;
    for (let child = fiber.child; child; child = child.sibling) stack.push(child);
  }
  return drawn;
}

let overlayRendered = false;
const commits: Drawn[] = [];
commitListeners.add((root) => {
  if (!overlayRendered) return;
  overlayRendered = false;
  const profiler = profilerOf(root.current);
  if (profiler) commits.push(drawnUnder(profiler));
});

const pageFrame = window.requestAnimationFrame.bind(window);
/** While the board's view listeners run: a frame asked for then is the overlay's answer to the move. */
let viewMoving = false;
let viewFrameMs = 0;
window.requestAnimationFrame = (callback) => {
  const forMove = viewMoving;
  return pageFrame((time) => {
    const started = performance.now();
    callback(time);
    if (forMove) viewFrameMs += performance.now() - started;
  });
};
const frame = () => new Promise<void>((resolve) => pageFrame(() => resolve()));
const settle = (ms = 40) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const drama = dramaScaleSnapshot();
const looks = workspaceLooks(drama, 301);
const fake = fakeBackend({ looks, fileUrl: (_projectId, file) => `/__board-panels/files/${encodeURIComponent(file.path)}` });
const viewListeners = new Set<() => void>();
let card: BoardAnchor = { x: 360, y: 160, width: 320, height: 240 };
/** The chat window asks for its card's place each time it lays itself out. */
let layouts = 0;
const container = document.getElementById("root")!;
let root: Root | null = null;
let props: BoardOverlayProps;

function BenchBoard({ overlay }: { overlay: BoardOverlayProps }) {
  return (
    <div data-bench-board="" className="relative h-screen overflow-hidden bg-app text-ink">
      <Profiler id="overlay" onRender={() => { overlayRendered = true; }}>
        <ProductionBoardOverlay {...overlay} />
      </Profiler>
    </div>
  );
}

const draw = () => flushSync(() => root!.render(<BenchBoard overlay={props} />));
const later = (change: Partial<BoardOverlayProps>) => {
  props = { ...props, ...change };
  root!.render(<BenchBoard overlay={props} />);
};

function freshProps(snapshot: CanvasSnapshot = drama): BoardOverlayProps {
  return {
    projectId: SAMPLE_PROJECT_ID,
    snapshot,
    backend: fake.backend,
    opened: null,
    open: (what: BoardOpened) => later({ opened: what }),
    close: () => later({ opened: null }),
    anchorOf: (nodeId) => {
      layouts += 1;
      return nodeId === "bot:board-30" ? card : null;
    },
    subscribeView: (listener) => {
      viewListeners.add(listener);
      return () => {
        viewListeners.delete(listener);
      };
    },
    focusNode: () => undefined,
    focusEpisode: () => undefined,
    focusStage: () => undefined,
  };
}

const summed = (list: readonly Drawn[]): Drawn => list.reduce<Drawn>((sum, each) => {
  for (const [name, count] of Object.entries(each.byName)) sum.byName[name] = (sum.byName[name] ?? 0) + count;
  for (const [name, ms] of Object.entries(each.selfByName)) sum.selfByName[name] = (sum.selfByName[name] ?? 0) + ms;
  return { ...sum, ms: sum.ms + each.ms, selfMs: sum.selfMs + each.selfMs, components: sum.components + each.components };
}, { ms: 0, selfMs: 0, components: 0, byName: {}, selfByName: {} });

type Commits = Drawn & { commits: number; each: Array<Pick<Drawn, "ms" | "selfMs" | "components">> };

/** Every commit `act` led to, summed: the panel opens once the layer has its size, and the bots' looks come after. */
async function drawnBy(act: () => void, wait = 40): Promise<Commits> {
  commits.length = 0;
  act();
  await settle(wait);
  return { ...summed(commits), commits: commits.length, each: commits.map(({ ms, selfMs, components }) => ({ ms, selfMs, components })) };
}

function unmount() {
  root?.unmount();
  root = null;
}

async function mount(): Promise<Commits> {
  unmount();
  root = createRoot(container);
  props = freshProps(JSON.parse(JSON.stringify(drama)) as CanvasSnapshot);
  return drawnBy(draw);
}

const tabButton = (name: string) => [...document.querySelectorAll<HTMLButtonElement>("[role=tab]")].find((each) => each.textContent === name)!;
const rowsShown = () => document.querySelectorAll("[data-board-side-panel] [role=tabpanel] button").length;

type Shown = Commits & { rows: number };

/** Each tab's first drawing: the team's when the overlay mounts, the others' when the person opens them. */
async function firstRenders(runs: number) {
  const tabs = { team: [] as Shown[], assets: [] as Shown[], episodes: [] as Shown[] };
  for (let run = 0; run < runs; run += 1) {
    const mounted = await mount();
    tabs.team.push({ ...mounted, rows: rowsShown() });
    for (const [tab, name] of [["assets", "素材分类"], ["episodes", "分集"]] as const) {
      await mount();
      const switched = await drawnBy(() => tabButton(name).click());
      tabs[tab].push({ ...switched, rows: rowsShown() });
    }
  }
  return tabs;
}

/** `count` frames with a chat window open, the board's view moving `perFrame` times in each: React's commits, the
 * window's layouts, the time the view's listeners took with the microtasks they left, and that of the frames they
 * asked for. */
async function cameraTicks(count: number, perFrame: number) {
  await mount();
  await drawnBy(() => later({ opened: { kind: "bot", botId: "board-30" } }), 200);
  commits.length = 0;
  viewFrameMs = 0;
  layouts = 0;
  let listenerMs = 0;
  for (let tick = 0; tick < count; tick += 1) {
    card = { ...card, x: 360 + (tick % 40) * 4 };
    const started = performance.now();
    viewMoving = true;
    for (let move = 0; move < perFrame; move += 1) for (const listener of viewListeners) listener();
    viewMoving = false;
    await Promise.resolve();
    listenerMs += performance.now() - started;
    await frame();
  }
  await frame();
  return { frames: count, movesPerFrame: perFrame, commits: commits.length, components: commits.reduce((sum, each) => sum + each.components, 0), layouts, listenerMs, frameMs: viewFrameMs, listeners: viewListeners.size, transform: document.querySelector<HTMLElement>("[data-board-chat]")?.style.transform };
}

async function snapshotUpdates(where: "team" | "assets" | "episodes" | "details", touch: "bot" | "episode", runs: number) {
  await mount();
  if (where === "assets") await drawnBy(() => tabButton("素材分类").click());
  if (where === "episodes") await drawnBy(() => tabButton("分集").click());
  if (where === "details") await drawnBy(() => later({ opened: { kind: "asset", nodeId: "group-qingwu" } }), 100);
  const drawn: Drawn[] = [];
  for (let run = 0; run < runs; run += 1) {
    const next = JSON.parse(JSON.stringify(props.snapshot)) as CanvasSnapshot;
    if (touch === "bot") next.bots["board-30"]!.status = run % 2 ? "idle" : "working";
    else next.production!.episodes[29]!.ready = run % 2 ? 5 : 4;
    drawn.push(await drawnBy(() => later({ snapshot: next })));
  }
  return drawn;
}

async function boardRedraws(runs: number) {
  await mount();
  await drawnBy(() => later({ opened: { kind: "bot", botId: "board-30" } }), 200);
  const drawn: Drawn[] = [];
  for (let run = 0; run < runs; run += 1) {
    const kept = props;
    drawn.push(await drawnBy(() => later({
      open: (what) => kept.open(what),
      close: () => kept.close(),
      anchorOf: (nodeId) => kept.anchorOf(nodeId),
      subscribeView: (listener) => kept.subscribeView(listener),
      focusNode: (nodeId) => kept.focusNode(nodeId),
      focusEpisode: (episode) => kept.focusEpisode(episode),
      focusStage: (stage) => kept.focusStage(stage),
    })));
  }
  return drawn;
}

async function opening() {
  await mount();
  const chat = await drawnBy(() => later({ opened: { kind: "bot", botId: "board-30" } }), 200);
  await mount();
  const details = await drawnBy(() => later({ opened: { kind: "asset", nodeId: "group-qingwu" } }), 200);
  return { chat, details };
}

/** What the app has drawn before its board opens, with ?warm: the sidebar's avatars and icons, a chat's markdown. */
function drawWhatTheAppDrew() {
  const host = document.createElement("div");
  document.body.append(host);
  const warm = createRoot(host);
  flushSync(() => warm.render(
    <div className={cn("flex flex-col", "gap-1")}>
      {Object.entries(looks).slice(0, 60).map(([botId, look]) => <BotAvatar key={botId} bot={{ name: botId, ...look }} size={28} />)}
      <AlertCircle size={14} />
      <ChevronRight size={14} />
      <Crown size={14} />
      <LoaderCircle size={14} />
      <X size={14} />
      <ChatMarkdown text={"**灯塔** 在雾里 [又亮起](https://example.com) 一盏灯。\n\n- 第一场\n- 第二场"} />
    </div>,
  ));
  warm.unmount();
  host.remove();
}

applySkin("midnight");
await loadLocale("zh");
if (new URLSearchParams(location.search).has("warm")) drawWhatTheAppDrew();
const results = {
  react: version,
  userAgent: navigator.userAgent,
  scale: { episodes: drama.production!.episodes.length, projectBots: Object.keys(drama.bots).length, workspaceBots: Object.keys(looks).length, nodes: drama.nodes.length, shots: drama.nodes.filter((node) => node.type === "shot").length },
  firstRender: await firstRenders(12),
  opening: await opening(),
  idleFrames: await cameraTicks(120, 0),
  cameraTicks: await cameraTicks(120, 1),
  cameraTicksBurst: await cameraTicks(120, 4),
  snapshots: {
    team: await snapshotUpdates("team", "bot", 10),
    assets: await snapshotUpdates("assets", "bot", 10),
    episodesBot: await snapshotUpdates("episodes", "bot", 10),
    episodesEpisode: await snapshotUpdates("episodes", "episode", 10),
    details: await snapshotUpdates("details", "bot", 10),
  },
  boardRedraws: await boardRedraws(10),
};
unmount();
const done = document.createElement("pre");
done.dataset.benchDone = "";
done.textContent = JSON.stringify(results);
document.body.append(done);
