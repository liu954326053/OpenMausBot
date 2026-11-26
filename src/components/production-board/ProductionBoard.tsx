import "./styles/index.css";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentType } from "react";
import { CircleAlert, Waypoints, type LucideIcon } from "lucide-react";
import type { ProductionEpisodeStatus } from "../../../shared/production";
import { botNodeId, type CanvasFileRef, type CanvasPoint, type CanvasSnapshot } from "../../../shared/project-canvas";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { buildBoard } from "@/lib/production-board/board";
import { visibleEdges } from "@/lib/production-board/edges";
import { BOARD_STAGES, type BoardAnchor, type BoardOpened, type BoardOverlayProps, type BoardStage } from "@/lib/production-board/overlay";
import { botStatus, toneState } from "@/lib/production-board/status";
import type { Board, BoardCard, BoardTake, BoardVideoStatus, RetryTarget } from "@/lib/production-board/types";
import { canvasErrorText, type CanvasBackend } from "@/lib/project-canvas/backend";
import type { CanvasBotLook } from "@/lib/project-canvas/types";
import { Heights } from "./board/heights";
import { useBoardInput, type BoardDrag, type BoardInputLatest } from "./board/use-board-input";
import { World, type DrawnCard, type DrawnEdge } from "./board/World";
import { Caption } from "./chrome/Caption";
import { Minimap, type MinimapItem } from "./chrome/Minimap";
import { StageBar } from "./chrome/StageBar";
import { Toast, type ToastMessage } from "./chrome/Toast";
import { Toolbar } from "./chrome/Toolbar";
import { CameraStore, centreOn, FAR, fitRect, gridStep, intersects, lineScale, toScreen, visibleWorld, zoomAbout, type Cam, type Rect, type Size } from "./engine/camera";
import { edgePaths } from "./engine/edge-paths";
import { layoutBoard, stageAt, type BoardLayout } from "./engine/layout";
import type { NodeActions, NodeContext } from "./nodes/parts";
import { EpisodeMenu } from "./panels/EpisodeMenu";

/** What the board asks of the project; each may fail with an error the board shows. */
export interface BoardHost {
  fileUrl(file: CanvasFileRef): string;
  move(nodeId: string, position: CanvasPoint): void;
  generate(nodeId: string): Promise<void>;
  selectTake(nodeId: string): Promise<void>;
  retry(target: RetryTarget): Promise<void>;
  openDraft(): Promise<void>;
}

export interface ProductionBoardProps {
  projectId: string;
  snapshot: CanvasSnapshot;
  backend: CanvasBackend;
  looks: Record<string, CanvasBotLook>;
  host: BoardHost;
  opened: BoardOpened | null;
  onOpenedChange: (opened: BoardOpened | null) => void;
  overlay?: ComponentType<BoardOverlayProps>;
  /** The bot the board shows when it opens, and moves to when it changes. */
  focusBotId?: string;
}

interface Shown {
  cards: ReadonlySet<string>;
  edges: ReadonlySet<string>;
  far: boolean;
  stage?: BoardStage;
}

interface StackEpisode {
  episode: number;
  title: string;
  unfolded: boolean;
  status?: ProductionEpisodeStatus;
}

type PendingFocus = { nodeId: string } | { episode: number };

const remembered = new Map<string, { cam: Cam; opened: number[] }>();
const NOTHING_SHOWN: Shown = { cards: new Set(), edges: new Set(), far: false };
const NO_STAGES: ReadonlySet<BoardStage> = new Set();
const CULL_MARGIN = 480;
/** The room the overlay's side panel takes from the board's right edge until the board has measured it. */
const PANEL_ROOM_PX = 320;
const MINIMAP_FROM_WIDTH = 520;
const TOAST_MS = 2600;
const HINT_MS = 9000;
const FIT_MS = 800;
const STAGE_MS = 950;
const FOCUS_MS = 700;
const ZOOM_MS = 220;
const OPENING_MS = 1400;
const REVEAL_FIRST_MS = 200;
const REVEAL_STEP_MS = 240;
const OPENING_AFTER_MS = 700;
const BOT_ZOOM = 0.8;
const STACK_MENU = { width: 288, height: 320, gap: 8 };

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const sameSet = (set: ReadonlySet<string>, ids: readonly string[]) => set.size === ids.length && ids.every((id) => set.has(id));
const sameRect = (a: Rect, b: Rect) => a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;

function reducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches || document.documentElement.dataset.reducedMotion === "true";
}

/** The card a click opens: a bot's chat, or the details of what the card shows. */
function openedBy(card: BoardCard): BoardOpened | null {
  switch (card.kind) {
    case "bot":
      return { kind: "bot", botId: card.botId };
    case "result": {
      const take = card.takes.find((one) => one.selected) ?? card.takes.at(-1);
      const nodeId = take?.nodeId ?? card.creationId;
      return nodeId ? { kind: "asset", nodeId } : null;
    }
    case "final":
      if (card.film) return { kind: "asset", nodeId: card.film.nodeId };
      return card.postBotId ? { kind: "bot", botId: card.postBotId } : null;
    case "stack":
      return null;
    default:
      return card.nodeIds[0] ? { kind: "asset", nodeId: card.nodeIds[0] } : null;
  }
}

/** The brief's stage and the writer, left-aligned when they do not fit. */
function openingView(board: Board, layout: BoardLayout, size: Size): Cam {
  const first = layout.stages.brief ?? layout.bounds;
  const writer = board.cards.find((card) => card.kind === "bot" && !card.lead && card.job === "script" && card.episode === undefined);
  const writerRect = writer ? layout.rects.get(writer.id) : undefined;
  const rect = writerRect ? { ...first, w: writerRect.x + writerRect.w - first.x } : first;
  return fitRect(rect, size, { pad: 20, top: 76, minZ: size.height < 700 ? 0.5 : 0.6, maxZ: 0.95, anchorLeft: true });
}

const RESULT_STATE: Record<BoardVideoStatus, MinimapItem["state"]> = { idle: "waiting", generating: "working", failed: "failed", done: "done" };

function minimapState(card: BoardCard, snapshot: CanvasSnapshot): MinimapItem["state"] {
  if (card.kind === "bot") return toneState(botStatus(snapshot.bots[card.botId] ?? { status: card.status }, card.jobStatus).tone);
  if (card.kind === "result") return RESULT_STATE[card.status];
  return undefined;
}

/** The width the overlay marks on what it draws beside the board's right edge (`data-board-room`), else the panel's. */
function markedRoom(layer: HTMLElement): number {
  let width = 0;
  for (const room of layer.querySelectorAll<HTMLElement>("[data-board-room]")) width = Math.max(width, room.getBoundingClientRect().width);
  return width > 0 ? Math.round(width) : PANEL_ROOM_PX;
}

/** The project's production on the mockup's canvas: the bots and what each made, in stages from left to right, and the
 * lines of work between them. The camera writes to the DOM itself; React draws only the cards near the screen. */
export function ProductionBoard({ projectId, snapshot, backend, looks, host, opened, onOpenedChange, overlay: Overlay, focusBotId }: ProductionBoardProps) {
  const memory = remembered.get(projectId);
  const readOnly = Boolean(snapshot.readOnly);
  const [camera] = useState(() => new CameraStore(memory?.cam ?? { x: 0, y: 0, z: 1 }));
  const [heights] = useState(() => new Heights());
  const [heightsVersion, setHeightsVersion] = useState(0);
  const [openedEpisodes, setOpenedEpisodes] = useState<ReadonlySet<number>>(() => new Set(memory?.opened ?? []));
  const [drag, setDrag] = useState<BoardDrag | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [showRefs, setShowRefs] = useState(false);
  const [touched, setTouched] = useState(false);
  const [caption, setCaption] = useState<BoardStage | null>(null);
  const [stageVisits, setStageVisits] = useState(0);
  const [entering, setEntering] = useState<ReadonlySet<BoardStage>>(NO_STAGES);
  const [minimapChoice, setMinimapChoice] = useState<boolean | null>(null);
  const [boardWidth, setBoardWidth] = useState(0);
  const [stackMenu, setStackMenu] = useState<CanvasPoint | null>(null);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [reserve, setReserve] = useState(PANEL_ROOM_PX);
  const [shown, setShown] = useState<Shown>(NOTHING_SHOWN);
  const rootRef = useRef<HTMLElement>(null);
  const stageRef = useRef<HTMLElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const placed = useRef(Boolean(memory));
  const userMoved = useRef(false);
  const pendingFocus = useRef<PendingFocus | null>(null);
  const pendingStage = useRef<BoardStage | null>(null);
  const viewListeners = useRef(new Set<() => void>());
  const toastKey = useRef(0);
  const lastRects = useRef<ReadonlyMap<string, Rect>>(new Map());

  const board = useMemo(() => buildBoard(snapshot, { opened: openedEpisodes }), [snapshot, openedEpisodes]);
  const layout = useMemo(() => {
    void heightsVersion;
    const next = layoutBoard(board, heights.of);
    for (const [id, rect] of next.rects) {
      const before = lastRects.current.get(id);
      if (before && sameRect(before, rect)) next.rects.set(id, before);
    }
    lastRects.current = next.rects;
    return next;
  }, [board, heights, heightsVersion]);
  const cards = useMemo(() => new Map(board.cards.map((card) => [card.id, card])), [board]);
  const kinds = useMemo(() => new Map(board.cards.map((card) => [card.id, card.kind])), [board]);
  const stageOf = useMemo(() => new Map(board.cards.map((card) => [card.id, card.stage])), [board]);
  const refOrder = useMemo(() => new Map(board.edges.filter((edge) => edge.kind === "ref").map((edge, at) => [edge.id, at])), [board]);
  const rects = useMemo(() => {
    const rect = drag ? layout.rects.get(drag.cardId) : undefined;
    if (!drag || !rect) return layout.rects;
    return new Map(layout.rects).set(drag.cardId, { ...rect, x: rect.x + drag.dx, y: rect.y + drag.dy });
  }, [layout, drag]);

  const openedCard = opened ? (opened.kind === "bot" ? botNodeId(opened.botId) : board.cardOfNode.get(opened.nodeId)) : undefined;
  const selected = openedCard && cards.has(openedCard) ? openedCard : undefined;
  const { related, lit } = useMemo(() => {
    const near = new Set<string>();
    const on = new Set<string>();
    if (selected) {
      for (const edge of board.edges) {
        if (edge.from !== selected && edge.to !== selected) continue;
        on.add(edge.id);
        near.add(edge.from === selected ? edge.to : edge.from);
      }
    }
    return { related: near, lit: on };
  }, [board, selected]);
  const focus = hovered ?? selected ?? null;
  const edges = useMemo(() => visibleEdges(board.edges, { showRefs, focus }), [board, showRefs, focus]);
  const paths = useMemo(() => edgePaths(edges, rects, kinds), [edges, rects, kinds]);

  const latest = useRef({ board, layout, rects, paths, opened, openedEpisodes, onOpenedChange, host, focusBotId, cards });
  latest.current = { board, layout, rects, paths, opened, openedEpisodes, onOpenedChange, host, focusBotId, cards };

  const cull = useCallback(() => {
    const { cam, size } = camera;
    if (!size.width) return;
    const area = visibleWorld(cam, size, CULL_MARGIN);
    const { rects: drawn, paths: lines, layout: placedLayout } = latest.current;
    const cardIds: string[] = [];
    for (const [id, rect] of drawn) if (intersects(rect, area)) cardIds.push(id);
    const edgeIds: string[] = [];
    for (const [id, path] of lines) if (intersects(path.bounds, area)) edgeIds.push(id);
    const far = cam.z < FAR;
    const stage = stageAt(placedLayout.stages, { x: (size.width / 2 - cam.x) / cam.z, y: (size.height / 2 - cam.y) / cam.z }, cam.z);
    setShown((last) => (last.far === far && last.stage === stage && sameSet(last.cards, cardIds) && sameSet(last.edges, edgeIds) ? last : { cards: new Set(cardIds), edges: new Set(edgeIds), far, ...(stage ? { stage } : {}) }));
  }, [camera]);

  const notifyView = useCallback(() => {
    for (const listener of viewListeners.current) listener();
  }, []);

  useEffect(() => {
    const paint = () => {
      const { x, y, z } = camera.cam;
      const world = worldRef.current;
      if (world) world.style.transform = `translate(${x}px, ${y}px) scale(${z})`;
      const stage = stageRef.current;
      if (stage) {
        const step = gridStep(z);
        const { ew, ls } = lineScale(z);
        stage.style.setProperty("--gs", `${step}px`);
        stage.style.setProperty("--gx", `${x % step}px`);
        stage.style.setProperty("--gy", `${y % step}px`);
        stage.style.setProperty("--ew", String(ew));
        stage.style.setProperty("--ls", String(ls));
      }
      remembered.set(projectId, { cam: camera.cam, opened: [...latest.current.openedEpisodes] });
      cull();
      notifyView();
    };
    paint();
    const stop = camera.subscribe(paint);
    return () => {
      stop();
      camera.stop();
    };
  }, [camera, cull, notifyView, projectId]);

  useEffect(() => {
    remembered.set(projectId, { cam: camera.cam, opened: [...openedEpisodes] });
  }, [camera, openedEpisodes, projectId]);

  const say = useCallback((text: string, icon?: LucideIcon) => {
    toastKey.current += 1;
    setToast({ text, key: toastKey.current, ...(icon ? { icon } : {}) });
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), TOAST_MS);
    return () => clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    const timer = setTimeout(() => setTouched(true), HINT_MS);
    return () => clearTimeout(timer);
  }, []);

  const userActed = useCallback(() => {
    camera.stop();
    userMoved.current = true;
    setTouched(true);
    setCaption(null);
  }, [camera]);

  const focusRect = useCallback((rect: Rect) => {
    if (camera.size.width) camera.glide(centreOn(rect, camera.size, clamp(camera.cam.z, 0.72, 1.05)), FOCUS_MS);
  }, [camera]);

  const focusBlock = useCallback((episode: number) => {
    const { layout: placedLayout, board: shownBoard, rects: drawn } = latest.current;
    const block = placedLayout.blocks.get(episode);
    if (block && camera.size.width) return camera.glide(fitRect(block, camera.size, { minZ: 0.3, maxZ: 0.9 }), FIT_MS);
    const card = shownBoard.cards.find((one) => one.kind === "episode" && one.episode === episode);
    const rect = card ? drawn.get(card.id) : undefined;
    if (rect) focusRect(rect);
  }, [camera, focusRect]);

  const unfold = useCallback((episode: number, then: PendingFocus) => {
    pendingFocus.current = then;
    setOpenedEpisodes((current) => (current.has(episode) ? current : new Set([...current, episode])));
  }, []);

  const focusNode = useCallback((nodeId: string) => {
    const { board: shownBoard, rects: drawn } = latest.current;
    const episode = shownBoard.episodeOfNode.get(nodeId);
    if (episode !== undefined && shownBoard.folded.includes(episode)) return unfold(episode, { nodeId });
    const cardId = shownBoard.cardOfNode.get(nodeId);
    const rect = cardId ? drawn.get(cardId) : undefined;
    if (rect) focusRect(rect);
  }, [focusRect, unfold]);

  const focusEpisode = useCallback((episode: number) => {
    if (latest.current.board.folded.includes(episode)) unfold(episode, { episode });
    else focusBlock(episode);
  }, [focusBlock, unfold]);

  const goToStage = useCallback((stage: BoardStage) => {
    pendingStage.current = stage;
    setCaption(stage);
    setStageVisits((count) => count + 1);
  }, []);

  useLayoutEffect(() => {
    const stage = pendingStage.current;
    pendingStage.current = null;
    const rect = stage ? latest.current.layout.stages[stage] : undefined;
    if (!rect || !camera.size.width) return;
    const note = stageRef.current?.querySelector<HTMLElement>(".caption");
    camera.glide(fitRect(rect, camera.size, { pad: 28, minZ: 0.18, maxZ: 0.9, top: 62 + (note?.offsetHeight ?? 0) + 20 }), STAGE_MS);
  }, [camera, stageVisits]);

  const fitAll = useCallback(() => {
    if (camera.size.width) camera.glide(fitRect(latest.current.layout.bounds, camera.size, { pad: 24, maxZ: 0.7 }), FIT_MS);
  }, [camera]);

  useLayoutEffect(() => {
    cull();
    notifyView();
    const pending = pendingFocus.current;
    if (!pending) return;
    pendingFocus.current = null;
    if ("episode" in pending) focusBlock(pending.episode);
    else focusNode(pending.nodeId);
  }, [cull, notifyView, rects, paths, focusBlock, focusNode]);

  const openingTimers = useRef<number[]>([]);
  useEffect(() => () => {
    for (const timer of openingTimers.current) clearTimeout(timer);
  }, []);

  const open = useCallback(() => {
    const arrival = (): Cam => {
      const { board: shownBoard, layout: placedLayout, focusBotId: bot } = latest.current;
      const rect = bot ? placedLayout.rects.get(botNodeId(bot)) : undefined;
      return rect ? centreOn(rect, camera.size, BOT_ZOOM) : openingView(shownBoard, placedLayout, camera.size);
    };
    if (reducedMotion()) return camera.set(arrival());
    camera.set(fitRect(latest.current.layout.bounds, camera.size, { pad: 24, maxZ: 0.7 }));
    setEntering(new Set(BOARD_STAGES));
    const timers = BOARD_STAGES.map((stage, at) => window.setTimeout(() => {
      setEntering((current) => new Set([...current].filter((one) => one !== stage)));
    }, REVEAL_FIRST_MS + at * REVEAL_STEP_MS));
    timers.push(window.setTimeout(() => {
      if (!userMoved.current) camera.glide(arrival(), OPENING_MS);
    }, REVEAL_FIRST_MS + BOARD_STAGES.length * REVEAL_STEP_MS + OPENING_AFTER_MS));
    openingTimers.current = timers;
  }, [camera]);

  useLayoutEffect(() => {
    const element = viewportRef.current;
    if (!element) return;
    let last: Size | null = null;
    const resize = (width: number, height: number) => {
      if (!width || !height || (last && last.width === width && last.height === height)) return;
      const before = last;
      last = { width, height };
      camera.size = last;
      setBoardWidth(width);
      if (!placed.current) {
        placed.current = true;
        open();
      } else if (before && !camera.animating) {
        camera.set({ ...camera.cam, x: camera.cam.x + (width - before.width) / 2, y: camera.cam.y + (height - before.height) / 2 });
      } else camera.set(camera.cam);
    };
    resize(element.clientWidth, element.clientHeight);
    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (box) resize(box.width, box.height);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [camera, open]);

  const focusedBot = useRef(focusBotId);
  useEffect(() => {
    if (!focusBotId || focusedBot.current === focusBotId) return;
    focusedBot.current = focusBotId;
    focusNode(botNodeId(focusBotId));
  }, [focusBotId, focusNode]);

  useLayoutEffect(() => {
    const layer = layerRef.current;
    if (!layer) return;
    let rooms: HTMLElement[] = [];
    const measure = () => setReserve(markedRoom(layer));
    const sizes = new ResizeObserver(measure);
    const watch = () => {
      const marked = [...layer.querySelectorAll<HTMLElement>("[data-board-room]")];
      if (marked.length !== rooms.length || marked.some((room, at) => room !== rooms[at])) {
        for (const room of rooms) sizes.unobserve(room);
        rooms = marked;
        for (const room of rooms) sizes.observe(room);
      }
      measure();
    };
    const mutations = new MutationObserver(watch);
    mutations.observe(layer, { childList: true, subtree: true, attributes: true });
    watch();
    return () => {
      mutations.disconnect();
      sizes.disconnect();
    };
  }, []);

  const attempt = useCallback((work: () => Promise<void>) => {
    work().catch((error: unknown) => say(t("productionBoard.actionFailed", { reason: canvasErrorText(error) }), CircleAlert));
  }, [say]);

  const openStack = useCallback(() => {
    const { board: shownBoard, rects: drawn } = latest.current;
    const stack = shownBoard.cards.find((card) => card.kind === "stack");
    const rect = stack ? drawn.get(stack.id) : undefined;
    if (!rect) return;
    const screen = toScreen(rect, camera.cam);
    const { width, height } = camera.size;
    setStackMenu({
      x: clamp(screen.x + screen.w + STACK_MENU.gap, STACK_MENU.gap, Math.max(STACK_MENU.gap, width - STACK_MENU.width - STACK_MENU.gap)),
      y: clamp(screen.y, STACK_MENU.gap, Math.max(STACK_MENU.gap, height - STACK_MENU.height - STACK_MENU.gap)),
    });
  }, [camera]);

  const actions = useMemo<NodeActions>(() => ({
    focusCard: (cardId) => {
      const { cards: byId, rects: drawn, onOpenedChange: openWith } = latest.current;
      const card = byId.get(cardId);
      if (card?.kind === "bot") openWith({ kind: "bot", botId: card.botId });
      const rect = drawn.get(cardId);
      if (rect) focusRect(rect);
    },
    openChat: (botId) => latest.current.onOpenedChange({ kind: "bot", botId }),
    openStack,
    ...(readOnly ? {} : {
      generate: (nodeId: string) => attempt(() => latest.current.host.generate(nodeId)),
      selectTake: (nodeId: string) => attempt(() => latest.current.host.selectTake(nodeId)),
      retry: (target: RetryTarget) => attempt(() => latest.current.host.retry(target)),
    }),
    openDraft: () => attempt(() => latest.current.host.openDraft()),
  }), [attempt, focusRect, openStack, readOnly]);

  const takeOf = useMemo(() => {
    const takes = new Map<string, BoardTake | undefined>();
    for (const card of board.cards) if (card.kind === "result") takes.set(card.shotId, card.takes.find((take) => take.selected) ?? card.takes.at(-1));
    return (shotId: string) => takes.get(shotId);
  }, [board]);

  const ctx = useMemo<NodeContext>(() => ({
    snapshot,
    looks,
    fileUrl: (file) => latest.current.host.fileUrl(file),
    takeOf,
    actions,
  }), [snapshot, looks, takeOf, actions]);

  const onHeight = useCallback((cardId: string, height: number) => {
    const card = latest.current.cards.get(cardId);
    if (card && heights.set(cardId, card.kind, height)) setHeightsVersion((version) => version + 1);
  }, [heights]);

  const inputNow: BoardInputLatest = {
    cards,
    rects: layout.rects,
    readOnly,
    onActivate: (card) => {
      if (card.kind === "stack") return openStack();
      const next = openedBy(card);
      if (next) onOpenedChange(next);
    },
    onBlank: () => onOpenedChange(null),
    onMove: (card, position) => {
      if (card.dragNodeId) host.move(card.dragNodeId, position);
    },
    onDrag: setDrag,
    onUserActed: userActed,
    onStage: goToStage,
    onFitAll: fitAll,
    onEscape: () => {
      if (opened) onOpenedChange(null);
    },
  };
  const inputLatest = useRef(inputNow);
  inputLatest.current = inputNow;
  const input = useBoardInput(camera, viewportRef, rootRef, inputLatest);

  const subscribeView = useCallback((listener: () => void) => {
    viewListeners.current.add(listener);
    return () => {
      viewListeners.current.delete(listener);
    };
  }, []);

  const overlayProps = useMemo<BoardOverlayProps>(() => ({
    projectId,
    snapshot,
    backend,
    opened,
    board,
    open: (what) => latest.current.onOpenedChange(what),
    close: () => latest.current.onOpenedChange(null),
    anchorOf: (nodeId): BoardAnchor | null => {
      const { board: shownBoard, rects: drawn } = latest.current;
      const episode = shownBoard.episodeOfNode.get(nodeId);
      if (episode !== undefined && shownBoard.folded.includes(episode)) return null;
      const cardId = shownBoard.cardOfNode.get(nodeId);
      const rect = cardId ? drawn.get(cardId) : undefined;
      const { width, height } = camera.size;
      if (!rect || !width) return null;
      const screen = toScreen(rect, camera.cam);
      return intersects(screen, { x: 0, y: 0, w: width, h: height }) ? { x: screen.x, y: screen.y, width: screen.w, height: screen.h } : null;
    },
    subscribeView,
    focusNode,
    focusEpisode,
    focusStage: goToStage,
    zoom: () => camera.cam.z,
  }), [projectId, snapshot, backend, opened, board, camera, subscribeView, focusNode, focusEpisode, goToStage]);

  const stackEpisodes = useMemo((): StackEpisode[] => {
    const inWork = new Set(board.unfolded.filter((episode) => !openedEpisodes.has(episode)));
    const titles = new Map<number, StackEpisode>();
    for (const card of board.cards) {
      if (card.kind === "stack") for (const one of card.episodes) titles.set(one.episode, { episode: one.episode, title: one.title, unfolded: false, ...(one.status ? { status: one.status } : {}) });
      if (card.kind === "episode" && !inWork.has(card.episode)) titles.set(card.episode, { episode: card.episode, title: card.title, unfolded: true, ...(card.status ? { status: card.status } : {}) });
    }
    return [...titles.values()].sort((a, b) => a.episode - b.episode);
  }, [board, openedEpisodes]);

  const chooseEpisode = (episode: number) => {
    setStackMenu(null);
    if (openedEpisodes.has(episode)) setOpenedEpisodes((current) => new Set([...current].filter((one) => one !== episode)));
    else unfold(episode, { episode });
  };

  const drawnCards = useMemo(() => board.cards.flatMap((card): DrawnCard[] => {
    const rect = rects.get(card.id);
    return rect && shown.cards.has(card.id) ? [{ card, rect }] : [];
  }), [board, rects, shown.cards]);
  const drawnEdges = useMemo(() => edges.flatMap((edge): DrawnEdge[] => {
    const path = shown.edges.has(edge.id) ? paths.get(edge.id) : undefined;
    return path ? [{ edge, path, ...(edge.kind === "ref" ? { refIndex: refOrder.get(edge.id) ?? 0 } : {}) }] : [];
  }), [edges, paths, refOrder, shown.edges]);
  const minimapItems = useMemo(() => board.cards.flatMap((card): MinimapItem[] => {
    const rect = layout.rects.get(card.id);
    const state = minimapState(card, snapshot);
    return rect ? [{ id: card.id, rect, kind: card.kind, ...(state ? { state } : {}) }] : [];
  }), [board, layout, snapshot]);

  const lead = board.empty ? rects.get(board.cards.find((card) => card.kind === "bot")?.id ?? "") : undefined;
  const emptyHintAt = useMemo(() => (lead ? { x: lead.x + lead.w / 2 - 160, y: lead.y + lead.h + 24 } : undefined), [lead]);
  const insetEnd = Overlay ? reserve : 0;
  const minimap = minimapChoice ?? boardWidth >= MINIMAP_FROM_WIDTH;
  const zoomBy = (factor: number) => {
    userActed();
    camera.glide(zoomAbout(camera.cam, camera.size, factor), ZOOM_MS);
  };

  return (
    <section ref={rootRef} className="mj-board" aria-label={t("productionBoard.label")}>
      <main ref={stageRef} className={cn("stage", shown.far && "lod-far", selected && "has-sel", showRefs && "show-refs")}>
        <div
          ref={viewportRef}
          className={cn("viewport", input.panning && "is-panning")}
          data-production-board=""
          tabIndex={0}
          role="application"
          aria-label={t("productionBoard.canvas.label")}
          {...input.handlers}
        >
          <div className="grid" aria-hidden="true" />
          <div ref={worldRef} className="world" data-board-world="" dir="ltr">
            <World
              cards={drawnCards}
              edges={drawnEdges}
              selectedId={selected}
              related={related}
              lit={lit}
              hoveredId={hovered ?? undefined}
              draggingId={drag?.cardId}
              entering={entering}
              stageOf={stageOf}
              ctx={ctx}
              emptyHintAt={emptyHintAt}
              onHeight={onHeight}
              onHover={setHovered}
            />
          </div>
        </div>
        <div data-board-chrome="">
          <StageBar stages={board.stages} current={shown.stage} insetEnd={insetEnd} onStage={(stage) => {
            userActed();
            goToStage(stage);
          }} />
          <Caption stage={caption} />
          <Toolbar
            camera={camera}
            showRefs={showRefs}
            minimap={minimap}
            onZoom={zoomBy}
            onZoomReset={() => zoomBy(1 / camera.cam.z)}
            onFit={() => {
              userActed();
              fitAll();
            }}
            onRefs={() => {
              say(t(showRefs ? "productionBoard.toast.refsOff" : "productionBoard.toast.refsOn"), Waypoints);
              setShowRefs(!showRefs);
            }}
            onMinimap={() => setMinimapChoice(!minimap)}
          />
          <p className={cn("hint", touched && "is-gone")}>{t("productionBoard.hint")}</p>
          {minimap ? (
            <Minimap
              world={layout.bounds}
              items={minimapItems}
              camera={camera}
              insetEnd={insetEnd}
              onJump={(point) => {
                camera.stop();
                const { cam, size } = camera;
                camera.set({ ...cam, x: size.width / 2 - point.x * cam.z, y: size.height / 2 - point.y * cam.z });
              }}
            />
          ) : null}
          <Toast message={toast} />
        </div>
        {stackMenu ? <EpisodeMenu episodes={stackEpisodes} at={stackMenu} onChoose={chooseEpisode} onClose={() => setStackMenu(null)} /> : null}
        {Overlay ? (
          <div ref={layerRef} data-board-overlay="" className="pointer-events-none absolute inset-0 z-[90]">
            <Overlay {...overlayProps} />
          </div>
        ) : null}
      </main>
    </section>
  );
}
