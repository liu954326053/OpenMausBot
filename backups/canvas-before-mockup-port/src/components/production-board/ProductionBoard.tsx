import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentType, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import { X } from "lucide-react";
import { botNodeId, type CanvasFileRef, type CanvasPoint, type CanvasSnapshot } from "../../../shared/project-canvas";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { buildBoard } from "@/lib/production-board/board";
import { centreOn, FAR_ZOOM, fitRect, intersects, toScreen, visibleRect, wheelZoomFactor, zoomAt, type BoardView } from "@/lib/production-board/camera";
import { edgePaths } from "@/lib/production-board/edge-paths";
import { visibleEdges } from "@/lib/production-board/edges";
import { layoutBoard, stageNearest, unionRect, type BoardLayout, type BoardRect } from "@/lib/production-board/layout";
import { BOARD_STAGES, type BoardAnchor, type BoardOpened, type BoardOverlayProps, type BoardStage } from "@/lib/production-board/overlay";
import type { Board, BoardCard, RetryTarget } from "@/lib/production-board/types";
import { canvasErrorText, type CanvasBackend } from "@/lib/project-canvas/backend";
import type { CanvasBotLook } from "@/lib/project-canvas/types";
import { BoardEdges } from "./board/BoardEdges";
import { BoardCamera } from "./board/camera";
import { BoardCardView, cardSize, FarCard, type BoardCardActions } from "./board/card-view";
import { BoardMinimap, BoardStageBar, BoardToolbar, minimapBoxWidth, PANEL_ROOM_PX, StackMenu, type StackMenuEpisode } from "./board/chrome";

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
  zoom: number;
  stage?: BoardStage;
}

type Press =
  | { kind: "pan"; pointerId: number; start: CanvasPoint; origin: BoardView }
  | { kind: "card"; pointerId: number; start: CanvasPoint; origin: BoardView; card: BoardCard; dragging: boolean };

type PendingFocus = { nodeId: string } | { episode: number };

const remembered = new Map<string, { view: BoardView; opened: number[] }>();
const NOTHING_SHOWN: Shown = { cards: new Set(), edges: new Set(), far: false, zoom: 1 };
const CULL_MARGIN = 480;
const DRAG_THRESHOLD = 4;
const PAN_STEP = 80;
const KEY_ZOOM = 1.2;
const GRID = 28;
const FOCUS_ZOOM = 0.8;
const MINIMAP_UNFOLDS_FROM = 720;
const CHROME = "[data-board-chrome], [data-board-overlay]";

/** The room the overlay takes from the board's right edge: the width it marks on the element it draws beside that edge
 * (`data-board-room`, its panel or its folded button, the gap already counted in), else the panel's width. */
function markedRoom(layer: HTMLElement): number {
  let width = 0;
  for (const room of layer.querySelectorAll<HTMLElement>("[data-board-room]")) width = Math.max(width, room.getBoundingClientRect().width);
  return width > 0 ? Math.round(width) : PANEL_ROOM_PX;
}

/** Controls that use a pressed pointer's movement themselves: a field selects text, a player scrubs, a link starts the browser's own drag. */
const HOLDS_POINTER = "a[href], input, textarea, select, video[controls], audio[controls], [contenteditable]";
const TYPING = "input, textarea, select, [contenteditable], [role=dialog], [role=menu], [data-canvas-shortcuts-ignore]";

const sameSet = (set: ReadonlySet<string>, ids: readonly string[]) => set.size === ids.length && ids.every((id) => set.has(id));

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

function openingView(board: Board, layout: BoardLayout, size: { width: number; height: number }, focusBotId: string | undefined): BoardView {
  const bot = focusBotId ? layout.rects.get(botNodeId(focusBotId)) : undefined;
  if (bot) return centreOn(bot, size, FOCUS_ZOOM);
  const writer = board.cards.find((card) => card.kind === "bot" && card.stage === "script");
  const writerRect = writer ? layout.rects.get(writer.id) : undefined;
  const brief = layout.stages.brief;
  const rect = unionRect([brief, writerRect].filter((one): one is BoardRect => Boolean(one))) ?? layout.bounds;
  return fitRect(rect, size, { minZoom: 0.5, maxZoom: 0.95 });
}

function scrollsInside(target: Element, root: Element): boolean {
  for (let at: Element | null = target; at && at !== root; at = at.parentElement) {
    if (at.scrollHeight > at.clientHeight + 1 && /(auto|scroll)/.test(getComputedStyle(at).overflowY)) return true;
  }
  return false;
}

/** The project's production on one board: the bots and what each made, in stages from left to right, and the lines of
 * work between them. Its camera pans and zooms; it draws only the cards in view, and labels in their place zoomed out. */
export function ProductionBoard({ projectId, snapshot, backend, looks, host, opened, onOpenedChange, overlay: Overlay, focusBotId }: ProductionBoardProps) {
  const memory = remembered.get(projectId);
  const readOnly = Boolean(snapshot.readOnly);
  const [camera] = useState(() => new BoardCamera(memory?.view ?? { x: 0, y: 0, k: 1 }));
  const [openedEpisodes, setOpenedEpisodes] = useState<ReadonlySet<number>>(() => new Set(memory?.opened ?? []));
  const [drag, setDrag] = useState<{ cardId: string; dx: number; dy: number } | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [showRefs, setShowRefs] = useState(false);
  const [wide, setWide] = useState(false);
  const [touched, setTouched] = useState(false);
  const [minimapChoice, setMinimapChoice] = useState<boolean | null>(null);
  const minimap = minimapChoice ?? wide;
  const [boardWidth, setBoardWidth] = useState(0);
  const [toolbarWidth, setToolbarWidth] = useState(0);
  const [stackMenu, setStackMenu] = useState<CanvasPoint | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reserve, setReserve] = useState(PANEL_ROOM_PX);
  const [shown, setShown] = useState<Shown>(NOTHING_SHOWN);
  const rootRef = useRef<HTMLElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const press = useRef<Press | null>(null);
  const pressMovedCard = useRef(false);
  const placed = useRef(Boolean(memory));
  const pendingFocus = useRef<PendingFocus | null>(null);
  const viewListeners = useRef(new Set<() => void>());
  const cullFrame = useRef(0);

  const board = useMemo(() => buildBoard(snapshot, { opened: openedEpisodes }), [snapshot, openedEpisodes]);
  const layout = useMemo(() => layoutBoard(board, cardSize), [board]);
  const cards = useMemo(() => new Map(board.cards.map((card) => [card.id, card])), [board]);
  const kinds = useMemo(() => new Map(board.cards.map((card) => [card.id, card.kind])), [board]);
  const rects = useMemo(() => {
    const rect = drag ? layout.rects.get(drag.cardId) : undefined;
    if (!drag || !rect) return layout.rects;
    return new Map(layout.rects).set(drag.cardId, { ...rect, x: rect.x + drag.dx, y: rect.y + drag.dy });
  }, [layout, drag]);
  const openedCard = opened ? (opened.kind === "bot" ? botNodeId(opened.botId) : board.cardOfNode.get(opened.nodeId)) : undefined;
  const focus = hovered ?? openedCard;
  const edges = useMemo(() => visibleEdges(board.edges, { showRefs, focus: focus ?? null }), [board, showRefs, focus]);
  const paths = useMemo(() => edgePaths(edges, rects, cards), [edges, rects, cards]);

  const edgeItems = useMemo(() => edges.flatMap((edge) => {
    const path = shown.edges.has(edge.id) ? paths.get(edge.id) : undefined;
    return path ? [{ edge, path }] : [];
  }), [edges, paths, shown.edges]);

  const latest = useRef({ board, layout, rects, paths, opened, openedEpisodes, onOpenedChange, host, focusBotId });
  latest.current = { board, layout, rects, paths, opened, openedEpisodes, onOpenedChange, host, focusBotId };

  const cull = useCallback(() => {
    cullFrame.current = 0;
    const view = camera.view;
    const area = visibleRect(view, camera.size, CULL_MARGIN);
    const { rects: drawn, paths: lines } = latest.current;
    const cardIds: string[] = [];
    for (const [id, rect] of drawn) if (intersects(rect, area)) cardIds.push(id);
    const edgeIds: string[] = [];
    for (const [id, path] of lines) if (intersects(path.bounds, area)) edgeIds.push(id);
    const far = view.k <= FAR_ZOOM;
    const zoom = far ? Math.round(view.k * 100) / 100 : 1;
    const stage = stageNearest(latest.current.layout.stages, { x: -view.x / view.k + camera.size.width / 2 / view.k, y: -view.y / view.k + camera.size.height / 2 / view.k });
    setShown((last) => (last.far === far && last.zoom === zoom && last.stage === stage && sameSet(last.cards, cardIds) && sameSet(last.edges, edgeIds) ? last : { cards: new Set(cardIds), edges: new Set(edgeIds), far, zoom, stage }));
  }, [camera]);

  const notifyView = useCallback(() => {
    for (const listener of viewListeners.current) listener();
  }, []);

  useEffect(() => {
    const paint = () => {
      const { x, y, k } = camera.view;
      const world = worldRef.current;
      if (world) {
        world.style.transform = `translate(${x}px, ${y}px) scale(${k})`;
        world.style.setProperty("--board-zoom", String(k));
      }
      const root = rootRef.current;
      if (root) {
        const step = GRID * k * (GRID * k < 10 ? 5 : 1);
        root.style.backgroundSize = `${step}px ${step}px`;
        root.style.backgroundPosition = `${x}px ${y}px`;
      }
      remembered.set(projectId, { view: camera.view, opened: [...latest.current.openedEpisodes] });
      if (!cullFrame.current) cullFrame.current = requestAnimationFrame(cull);
      notifyView();
    };
    paint();
    const stop = camera.subscribe(paint);
    return () => {
      stop();
      camera.stop();
      if (cullFrame.current) cancelAnimationFrame(cullFrame.current);
      cullFrame.current = 0;
    };
  }, [camera, cull, notifyView, projectId]);

  useEffect(() => {
    remembered.set(projectId, { view: camera.view, opened: [...openedEpisodes] });
  }, [camera, openedEpisodes, projectId]);

  const focusRect = useCallback((rect: BoardRect, zoom?: number) => {
    if (!camera.size.width) return;
    const k = zoom ?? (camera.view.k >= 0.5 && camera.view.k <= 1.25 ? camera.view.k : FOCUS_ZOOM);
    camera.glide(centreOn(rect, camera.size, k));
  }, [camera]);

  const focusLane = useCallback((episode: number) => {
    const lane = latest.current.layout.lanes.get(episode);
    if (lane && camera.size.width) camera.glide(fitRect(lane, camera.size, { minZoom: 0.3, maxZoom: 0.9 }));
  }, [camera]);

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
    else focusLane(episode);
  }, [focusLane, unfold]);

  const focusStage = useCallback((stage: BoardStage) => {
    const rect = latest.current.layout.stages[stage];
    if (rect && camera.size.width) camera.glide(fitRect(rect, camera.size, { minZoom: 0.12, maxZoom: 1 }));
  }, [camera]);

  const fitAll = useCallback(() => {
    if (camera.size.width) camera.glide(fitRect(latest.current.layout.bounds, camera.size, { maxZoom: 1 }));
  }, [camera]);

  useLayoutEffect(() => {
    cull();
    notifyView();
    const pending = pendingFocus.current;
    if (!pending) return;
    pendingFocus.current = null;
    if ("episode" in pending) focusLane(pending.episode);
    else focusNode(pending.nodeId);
  }, [cull, notifyView, rects, paths, focusLane, focusNode]);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const resize = (width: number, height: number) => {
      if (!width || !height) return;
      setBoardWidth(width);
      setWide(width >= MINIMAP_UNFOLDS_FROM);
      camera.size = { width, height };
      if (!placed.current) {
        placed.current = true;
        const { board: shownBoard, layout: shownLayout, focusBotId: bot } = latest.current;
        camera.set(openingView(shownBoard, shownLayout, camera.size, bot));
      } else camera.notify();
    };
    resize(root.clientWidth, root.clientHeight);
    if (typeof ResizeObserver !== "function") return;
    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (box) resize(box.width, box.height);
    });
    observer.observe(root);
    return () => observer.disconnect();
  }, [camera]);

  useLayoutEffect(() => {
    const bar = toolbarRef.current;
    if (!bar) return;
    const measure = () => setToolbarWidth(Number(bar.offsetWidth) || 0);
    measure();
    if (typeof ResizeObserver !== "function") return;
    const observer = new ResizeObserver(measure);
    observer.observe(bar);
    return () => observer.disconnect();
  }, []);

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
    const sizes = typeof ResizeObserver === "function" ? new ResizeObserver(measure) : undefined;
    const watch = () => {
      const marked = [...layer.querySelectorAll<HTMLElement>("[data-board-room]")];
      if (marked.length !== rooms.length || marked.some((room, at) => room !== rooms[at])) {
        for (const room of rooms) sizes?.unobserve(room);
        rooms = marked;
        for (const room of rooms) sizes?.observe(room);
      }
      measure();
    };
    const mutations = typeof MutationObserver === "function" ? new MutationObserver(watch) : undefined;
    mutations?.observe(layer, { childList: true, subtree: true, attributes: true });
    watch();
    return () => {
      mutations?.disconnect();
      sizes?.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(timer);
  }, [notice]);

  const attempt = useCallback((work: () => Promise<void>) => {
    work().catch((error: unknown) => setNotice(t("productionBoard.actionFailed", { reason: canvasErrorText(error) })));
  }, []);

  const openStack = useCallback(() => {
    const stack = latest.current.rects.get("stack");
    if (!stack) return;
    const screen = toScreen(stack, camera.view);
    const x = Math.min(Math.max(8, screen.x + screen.width + 8), Math.max(8, camera.size.width - 296));
    const y = Math.min(Math.max(8, screen.y), Math.max(8, camera.size.height - 340));
    setStackMenu({ x, y });
  }, [camera]);

  const actions = useMemo<BoardCardActions>(() => ({
    open: (card) => {
      const next = openedBy(card);
      if (next) latest.current.onOpenedChange(next);
    },
    fileUrl: (file) => latest.current.host.fileUrl(file),
    openStack,
    ...(readOnly ? {} : {
      generate: (nodeId: string) => attempt(() => latest.current.host.generate(nodeId)),
      selectTake: (nodeId: string) => attempt(() => latest.current.host.selectTake(nodeId)),
      retry: (target: RetryTarget) => attempt(() => latest.current.host.retry(target)),
    }),
    openDraft: () => attempt(() => latest.current.host.openDraft()),
  }), [attempt, openStack, readOnly]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const onWheel = (event: WheelEvent) => {
      const target = event.target as Element;
      if (target.closest(CHROME)) return;
      const pinch = event.ctrlKey || event.metaKey;
      if (!pinch && target.closest("[data-board-card-id]") && scrollsInside(target, root)) return;
      event.preventDefault();
      setTouched(true);
      const box = root.getBoundingClientRect();
      camera.set(zoomAt(camera.view, wheelZoomFactor(event.deltaY, pinch), { x: event.clientX - box.left, y: event.clientY - box.top }));
    };
    root.addEventListener("wheel", onWheel, { passive: false });
    return () => root.removeEventListener("wheel", onWheel);
  }, [camera]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const root = rootRef.current;
      const active = document.activeElement;
      if (!root || event.defaultPrevented || event.isComposing || event.metaKey || event.ctrlKey || event.altKey) return;
      if (active && active !== document.body && !root.contains(active)) return;
      if (active instanceof Element && (active.closest(TYPING) || active.closest("[data-board-overlay]"))) return;
      const centre = { x: camera.size.width / 2, y: camera.size.height / 2 };
      const view = camera.view;
      const pans: Record<string, [number, number]> = { ArrowLeft: [PAN_STEP, 0], ArrowRight: [-PAN_STEP, 0], ArrowUp: [0, PAN_STEP], ArrowDown: [0, -PAN_STEP] };
      const stage = /^[1-5]$/.test(event.key) ? BOARD_STAGES[Number(event.key) - 1] : undefined;
      if (pans[event.key]) camera.set({ ...view, x: view.x + pans[event.key]![0], y: view.y + pans[event.key]![1] });
      else if (event.key === "+" || event.key === "=") camera.glide(zoomAt(view, KEY_ZOOM, centre));
      else if (event.key === "-") camera.glide(zoomAt(view, 1 / KEY_ZOOM, centre));
      else if (event.key === "0") fitAll();
      else if (stage) focusStage(stage);
      else if (event.key === "Escape" && latest.current.opened) latest.current.onOpenedChange(null);
      else return;
      event.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [camera, fitAll, focusStage]);

  const onPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    if (press.current || (event.button !== 0 && event.button !== 1)) return;
    pressMovedCard.current = false;
    const target = event.target as Element;
    if (target.closest(CHROME)) return;
    setTouched(true);
    const start = { x: event.clientX, y: event.clientY };
    const cardElement = event.button === 0 ? target.closest<HTMLElement>("[data-board-card-id]") : null;
    if (cardElement) {
      const card = cards.get(cardElement.dataset.boardCardId ?? "");
      if (card && !target.closest(HOLDS_POINTER)) press.current = { kind: "card", pointerId: event.pointerId, start, origin: camera.view, card, dragging: false };
      return;
    }
    event.preventDefault();
    rootRef.current?.focus({ preventScroll: true });
    camera.stop();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    press.current = { kind: "pan", pointerId: event.pointerId, start, origin: camera.view };
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    const current = press.current;
    if (!current || current.pointerId !== event.pointerId) return;
    const dx = event.clientX - current.start.x;
    const dy = event.clientY - current.start.y;
    if (current.kind === "card" && !current.dragging) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      pressMovedCard.current = true;
      event.currentTarget.setPointerCapture?.(event.pointerId);
      if (!current.card.dragNodeId || readOnly) {
        press.current = { kind: "pan", pointerId: current.pointerId, start: current.start, origin: current.origin };
      } else current.dragging = true;
    }
    const now = press.current!;
    if (now.kind === "pan") camera.set({ ...now.origin, x: now.origin.x + dx, y: now.origin.y + dy });
    else setDrag({ cardId: now.card.id, dx: dx / camera.view.k, dy: dy / camera.view.k });
  };

  const onPointerEnd = (event: ReactPointerEvent<HTMLElement>) => {
    const current = press.current;
    if (!current || current.pointerId !== event.pointerId) return;
    press.current = null;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (current.kind !== "card" || !current.dragging) return;
    const rect = layout.rects.get(current.card.id);
    const k = camera.view.k;
    const dx = (event.clientX - current.start.x) / k;
    const dy = (event.clientY - current.start.y) / k;
    if (rect && current.card.dragNodeId && event.type === "pointerup") host.move(current.card.dragNodeId, { x: Math.round(rect.x + dx), y: Math.round(rect.y + dy) });
    setDrag(null);
  };

  const onClickCapture = (event: ReactMouseEvent<HTMLElement>) => {
    if (!pressMovedCard.current) return;
    pressMovedCard.current = false;
    event.stopPropagation();
    event.preventDefault();
  };

  const overlayProps = useMemo<BoardOverlayProps>(() => ({
    projectId,
    snapshot,
    backend,
    opened,
    open: (what) => latest.current.onOpenedChange(what),
    close: () => latest.current.onOpenedChange(null),
    anchorOf: (nodeId): BoardAnchor | null => {
      const { board: shownBoard, rects: drawn } = latest.current;
      const episode = shownBoard.episodeOfNode.get(nodeId);
      if (episode !== undefined && shownBoard.folded.includes(episode)) return null;
      const cardId = shownBoard.cardOfNode.get(nodeId);
      const rect = cardId ? drawn.get(cardId) : undefined;
      if (!rect || !camera.size.width) return null;
      const screen = toScreen(rect, camera.view);
      return intersects(screen, { x: 0, y: 0, width: camera.size.width, height: camera.size.height }) ? screen : null;
    },
    subscribeView: (listener) => {
      viewListeners.current.add(listener);
      return () => {
        viewListeners.current.delete(listener);
      };
    },
    focusNode,
    focusEpisode,
    focusStage,
  }), [projectId, snapshot, backend, opened, camera, focusNode, focusEpisode, focusStage]);

  const stackEpisodes = useMemo((): StackMenuEpisode[] => {
    const inWork = new Set(board.unfolded.filter((episode) => !openedEpisodes.has(episode)));
    const titles = new Map<number, StackMenuEpisode>();
    for (const card of board.cards) {
      if (card.kind === "stack") for (const one of card.episodes) titles.set(one.episode, { episode: one.episode, title: one.title, ...(one.status ? { status: one.status } : {}), unfolded: false });
      if (card.kind === "episode" && !inWork.has(card.episode)) titles.set(card.episode, { episode: card.episode, title: card.title, ...(card.status ? { status: card.status } : {}), unfolded: true });
    }
    return [...titles.values()].sort((a, b) => a.episode - b.episode);
  }, [board, openedEpisodes]);

  const chooseEpisode = (episode: number) => {
    setStackMenu(null);
    if (openedEpisodes.has(episode)) {
      setOpenedEpisodes((current) => new Set([...current].filter((one) => one !== episode)));
      return;
    }
    unfold(episode, { episode });
  };

  const lead = board.empty ? rects.get(board.cards.find((card) => card.kind === "bot")?.id ?? "") : undefined;
  const minimapEnd = 12 + (Overlay ? reserve : 0);
  const minimapMeetsToolbar = boardWidth > 0 && toolbarWidth > 0
    && boardWidth - minimapEnd - minimapBoxWidth(!wide) < 12 + toolbarWidth + 8;
  const minimapBottom = minimapMeetsToolbar ? (wide ? 86 : 62) : undefined;

  return (
    <section
      ref={rootRef}
      tabIndex={0}
      aria-label={t("productionBoard.label")}
      data-production-board=""
      data-project-canvas-stage=""
      className="relative h-full w-full touch-none select-none overflow-hidden bg-app outline-none"
      style={{ backgroundImage: "radial-gradient(circle, color-mix(in srgb, var(--color-ink) 10%, transparent) 1px, transparent 1.5px)" }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      onClickCapture={onClickCapture}
    >
      <div ref={worldRef} dir="ltr" data-board-world="" className="absolute top-0 origin-top-left" style={{ left: 0 }}>
        <BoardEdges items={edgeItems} far={shown.far} />
        {board.cards.map((card) => {
          const rect = rects.get(card.id);
          if (!rect || !shown.cards.has(card.id)) return null;
          const isOpened = card.id === openedCard;
          return (
            <div
              key={card.id}
              data-board-card-id={card.id}
              data-canvas-node={card.nodeIds[0] ?? card.id}
              data-opened={isOpened ? "" : undefined}
              className={cn("absolute rounded-xl", isOpened && "ring-2 ring-accent", drag?.cardId === card.id && "z-10")}
              style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }}
              onPointerEnter={() => {
                if (!press.current) setHovered(card.id);
              }}
              onPointerLeave={() => setHovered((current) => (current === card.id ? null : current))}
            >
              {shown.far ? <FarCard card={card} snapshot={snapshot} zoom={shown.zoom} /> : <BoardCardView card={card} snapshot={snapshot} looks={looks} actions={actions} />}
            </div>
          );
        })}
        {lead ? (
          <p data-board-empty-hint="" className="absolute w-80 text-center text-[13px] leading-[18px] text-ink-secondary" style={{ left: lead.x + lead.width / 2 - 160, top: lead.y + lead.height + 24 }}>
            {t("productionBoard.emptyHint")}
          </p>
        ) : null}
      </div>
      <BoardStageBar stages={board.stages} viewStage={shown.stage} insetEnd={Overlay ? reserve : 0} onFocus={focusStage} />
      <div data-board-chrome="" className="pointer-events-none absolute bottom-3 start-3 z-[80] flex flex-col items-start gap-2">
        {wide ? (
          <p
            data-board-hint=""
            data-board-hint-gone={touched ? "" : undefined}
            className={cn(
              "pointer-events-none text-[12px] leading-4 text-ink-tertiary transition-opacity duration-300 motion-reduce:transition-none",
              touched && "opacity-0",
            )}
          >
            {t("productionBoard.hint")}
          </p>
        ) : null}
        <BoardToolbar
          camera={camera}
          showRefs={showRefs}
          minimap={minimap}
          compact={!wide}
          domRef={toolbarRef}
          onRefs={() => setShowRefs((on) => !on)}
          onMinimap={() => setMinimapChoice(!minimap)}
          onZoom={(factor) => camera.glide(zoomAt(camera.view, factor, { x: camera.size.width / 2, y: camera.size.height / 2 }))}
          onFit={fitAll}
        />
      </div>
      {minimap ? (
        <BoardMinimap
          layout={layout}
          kinds={kinds}
          camera={camera}
          insetEnd={Overlay ? reserve : 0}
          compact={!wide}
          {...(minimapBottom === undefined ? {} : { bottom: minimapBottom })}
          onCentre={(point) => camera.set({ ...camera.view, x: camera.size.width / 2 - point.x * camera.view.k, y: camera.size.height / 2 - point.y * camera.view.k })}
        />
      ) : null}
      {stackMenu ? <StackMenu episodes={stackEpisodes} at={stackMenu} onChoose={chooseEpisode} onClose={() => setStackMenu(null)} /> : null}
      {notice ? (
        <div data-board-chrome="" className="pointer-events-none absolute inset-x-0 top-14 z-[95] flex justify-center px-3" style={Overlay ? { paddingInlineEnd: 12 + reserve } : undefined}>
          <div role="status" className="popover-surface pointer-events-auto flex max-w-md items-center gap-2 rounded-xl border border-hairline/50 bg-menu py-1.5 pe-1.5 ps-3 text-[13px] leading-[18px] text-ink">
            <span className="min-w-0 flex-1">{notice}</span>
            <button type="button" className="ui-icon-button" aria-label={t("productionBoard.dismiss")} onClick={() => setNotice(null)}>
              <X size={14} aria-hidden="true" />
            </button>
          </div>
        </div>
      ) : null}
      {Overlay ? (
        <div ref={layerRef} data-board-overlay="" className="pointer-events-none absolute inset-0 z-[90]">
          <Overlay {...overlayProps} />
        </div>
      ) : null}
    </section>
  );
}
