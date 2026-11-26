import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import type { CanvasPoint } from "../../../../shared/project-canvas";
import { BOARD_STAGES, type BoardStage } from "@/lib/production-board/overlay";
import type { BoardCard } from "@/lib/production-board/types";
import { clampZoom, wheelFactor, zoomAbout, zoomAt, type CameraStore, type Cam, type Rect } from "../engine/camera";

export interface BoardDrag {
  cardId: string;
  dx: number;
  dy: number;
}

/** What the board's input reads at the moment of each event. */
export interface BoardInputLatest {
  cards: ReadonlyMap<string, BoardCard>;
  /** Where the cards are laid out, before a drag. */
  rects: ReadonlyMap<string, Rect>;
  readOnly: boolean;
  onActivate(card: BoardCard): void;
  onBlank(): void;
  onMove(card: BoardCard, position: CanvasPoint): void;
  onDrag(drag: BoardDrag | null): void;
  onUserActed(): void;
  onStage(stage: BoardStage): void;
  onFitAll(): void;
  onEscape(): void;
}

type Press =
  | { kind: "pan"; pointerId: number; sx: number; sy: number; origin: Cam; moved: boolean }
  | { kind: "card"; pointerId: number; sx: number; sy: number; origin: Cam; card: BoardCard; moved: boolean; dragging: boolean }
  | { kind: "pinch"; dist: number; z: number; wx: number; wy: number };

const DRAG_THRESHOLD = 4;
const PAN_STEP = 80;
const KEY_ZOOM_IN = 1.25;
const KEY_ZOOM_OUT = 0.8;
const KEY_ZOOM_MS = 220;
const NOT_THE_BOARDS = "[data-board-chrome], [data-board-overlay]";
/** Controls that use a pressed pointer themselves: a button clicks, a field selects text, a player scrubs. */
const HOLDS_POINTER = "button, a[href], input, textarea, select, video[controls], [contenteditable]";
const TAKES_KEYS = "input, textarea, select, [contenteditable], [role=dialog], [role=menu]";

function scrollsInside(target: Element, root: Element): boolean {
  for (let at: Element | null = target; at && at !== root; at = at.parentElement) {
    if (at.scrollHeight > at.clientHeight + 1 && /(auto|scroll)/.test(getComputedStyle(at).overflowY)) return true;
  }
  return false;
}

/** The board's pointer, wheel and keys: pan, pinch, zoom about the pointer, drag a card, click a card or the empty board. */
export function useBoardInput(camera: CameraStore, viewport: RefObject<HTMLElement | null>, root: RefObject<HTMLElement | null>, latest: RefObject<BoardInputLatest>) {
  const [panning, setPanning] = useState(false);
  const press = useRef<Press | null>(null);
  const pointers = useRef(new Map<number, CanvasPoint>());

  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      const target = event.target as Element;
      if (target.closest(NOT_THE_BOARDS)) return;
      const pinch = event.ctrlKey || event.metaKey;
      if (!pinch && target.closest("[data-board-card-id]") && scrollsInside(target, element)) return;
      event.preventDefault();
      latest.current.onUserActed();
      const box = element.getBoundingClientRect();
      const cam = camera.cam;
      camera.set(zoomAt(cam, event.clientX - box.left, event.clientY - box.top, cam.z * wheelFactor(event.deltaY, event.deltaMode, pinch)));
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, [camera, viewport, latest]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const board = root.current;
      const active = document.activeElement;
      if (!board || event.defaultPrevented || event.isComposing || event.metaKey || event.ctrlKey || event.altKey) return;
      if (active && active !== document.body && !board.contains(active)) return;
      if (active?.closest(TAKES_KEYS) || active?.closest("[data-board-overlay]")) return;
      const now = latest.current;
      const key = event.key;
      const target = event.target instanceof Element ? event.target : null;
      if (key === "Enter" || key === " ") {
        const card = target?.matches("[data-board-card-id]") ? now.cards.get((target as HTMLElement).dataset.boardCardId ?? "") : undefined;
        if (!card) return;
        event.preventDefault();
        now.onUserActed();
        now.onActivate(card);
        return;
      }
      if (key === "Escape") {
        now.onEscape();
        return;
      }
      const cam = camera.cam;
      const pans: Record<string, [number, number]> = { ArrowLeft: [PAN_STEP, 0], ArrowRight: [-PAN_STEP, 0], ArrowUp: [0, PAN_STEP], ArrowDown: [0, -PAN_STEP] };
      const pan = pans[key];
      if (pan) {
        now.onUserActed();
        camera.set({ ...cam, x: cam.x + pan[0], y: cam.y + pan[1] });
      } else if (key === "+" || key === "=") camera.glide(zoomAbout(cam, camera.size, KEY_ZOOM_IN), KEY_ZOOM_MS);
      else if (key === "-" || key === "_") camera.glide(zoomAbout(cam, camera.size, KEY_ZOOM_OUT), KEY_ZOOM_MS);
      else if (key === "0") {
        now.onUserActed();
        now.onFitAll();
      } else if (key >= "1" && key <= "5" && key.length === 1) {
        now.onUserActed();
        now.onStage(BOARD_STAGES[Number(key) - 1]!);
      } else return;
      event.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [camera, root, latest]);

  const onPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button > 1) return;
    const target = event.target as Element;
    if (target.closest(NOT_THE_BOARDS) || target.closest(HOLDS_POINTER)) return;
    latest.current.onUserActed();
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    event.currentTarget.setPointerCapture?.(event.pointerId);
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()] as [CanvasPoint, CanvasPoint];
      const box = event.currentTarget.getBoundingClientRect();
      const mx = (a.x + b.x) / 2 - box.left;
      const my = (a.y + b.y) / 2 - box.top;
      if (press.current?.kind === "card" && press.current.dragging) latest.current.onDrag(null);
      const cam = camera.cam;
      press.current = { kind: "pinch", dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, z: cam.z, wx: (mx - cam.x) / cam.z, wy: (my - cam.y) / cam.z };
      return;
    }
    const cardElement = event.button === 0 ? target.closest<HTMLElement>("[data-board-card-id]") : null;
    const card = cardElement ? latest.current.cards.get(cardElement.dataset.boardCardId ?? "") : undefined;
    const start = { pointerId: event.pointerId, sx: event.clientX, sy: event.clientY, origin: camera.cam, moved: false };
    if (card) {
      press.current = { kind: "card", ...start, card, dragging: false };
      return;
    }
    event.preventDefault();
    viewport.current?.focus({ preventScroll: true });
    press.current = { kind: "pan", ...start };
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    const current = press.current;
    if (!current || !pointers.current.has(event.pointerId)) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (current.kind === "pinch") {
      if (pointers.current.size < 2) return;
      const [a, b] = [...pointers.current.values()] as [CanvasPoint, CanvasPoint];
      const box = event.currentTarget.getBoundingClientRect();
      const z = clampZoom((current.z * Math.hypot(a.x - b.x, a.y - b.y)) / current.dist);
      camera.set({ x: (a.x + b.x) / 2 - box.left - current.wx * z, y: (a.y + b.y) / 2 - box.top - current.wy * z, z });
      return;
    }
    if (current.pointerId !== event.pointerId) return;
    const dx = event.clientX - current.sx;
    const dy = event.clientY - current.sy;
    if (!current.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    current.moved = true;
    if (current.kind === "card" && !current.dragging) {
      if (latest.current.readOnly || !current.card.dragNodeId) press.current = { kind: "pan", pointerId: current.pointerId, sx: current.sx, sy: current.sy, origin: current.origin, moved: true };
      else current.dragging = true;
    }
    const now = press.current!;
    if (now.kind === "pan") {
      setPanning(true);
      camera.set({ ...now.origin, x: now.origin.x + dx, y: now.origin.y + dy });
    } else if (now.kind === "card") {
      const z = camera.cam.z;
      latest.current.onDrag({ cardId: now.card.id, dx: dx / z, dy: dy / z });
    }
  };

  const onPointerEnd = (event: ReactPointerEvent<HTMLElement>) => {
    if (!pointers.current.delete(event.pointerId)) return;
    const current = press.current;
    if (!current) return;
    if (current.kind === "pinch") {
      if (pointers.current.size < 2) {
        press.current = null;
        pointers.current.clear();
      }
      return;
    }
    press.current = null;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture?.(event.pointerId);
    setPanning(false);
    const finished = event.type === "pointerup";
    const now = latest.current;
    if (current.kind === "card" && current.dragging) {
      const rect = now.rects.get(current.card.id);
      const z = camera.cam.z;
      if (finished && rect) now.onMove(current.card, { x: Math.round(rect.x + (event.clientX - current.sx) / z), y: Math.round(rect.y + (event.clientY - current.sy) / z) });
      now.onDrag(null);
    } else if (!current.moved && finished) {
      if (current.kind === "card") now.onActivate(current.card);
      else now.onBlank();
    }
  };

  return {
    panning,
    handlers: { onPointerDown, onPointerMove, onPointerUp: onPointerEnd, onPointerCancel: onPointerEnd },
  };
}
