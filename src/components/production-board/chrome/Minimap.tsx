import { useEffect, useRef, type PointerEvent } from "react";
import { t } from "@/lib/i18n";
import type { BoardCard } from "@/lib/production-board/types";
import type { CameraStore, Rect } from "../engine/camera";
import { drawMinimap, minimapColor, minimapFrame, minimapPoint, type MinimapColors, type MinimapFrame } from "../engine/minimap";

const FALLBACK_WIDTH = 208;

export interface MinimapItem {
  id: string;
  rect: Rect;
  kind: BoardCard["kind"];
  state?: "done" | "working" | "waiting" | "failed";
}

function boardColors(canvas: HTMLCanvasElement): MinimapColors {
  const style = getComputedStyle(canvas.closest(".mj-board") ?? document.documentElement);
  const read = (name: string) => style.getPropertyValue(name).trim();
  const text = read("--text");
  return {
    bg: read("--bg"),
    working: read("--amber"),
    done: read("--teal"),
    idle: read("--text-3"),
    failed: read("--danger"),
    sheet: read("--line-2"),
    plain: read("--card-2"),
    view: text,
    viewFill: `color-mix(in srgb, ${text} 8%, transparent)`,
  };
}

export function Minimap({ world, items, camera, insetEnd, onJump }: {
  world: Rect;
  items: ReadonlyArray<MinimapItem>;
  camera: CameraStore;
  insetEnd: number;
  onJump(world: { x: number; y: number }): void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameRef = useRef<MinimapFrame | null>(null);
  const draggingRef = useRef(false);
  const itemsRef = useRef(items);
  const repaintRef = useRef<(() => void) | null>(null);
  const { x, y, w, h } = world;

  useEffect(() => {
    itemsRef.current = items;
    repaintRef.current?.();
  }, [items]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const bounds = { x, y, w, h };
    let frame = minimapFrame(bounds, FALLBACK_WIDTH);
    let dpr = 1;
    let colors = boardColors(canvas);
    const paint = () => itemsRef.current.map((item) => ({ rect: item.rect, color: minimapColor(item.kind, item.state, colors) }));
    let painted = paint();
    const draw = () => drawMinimap(ctx, frame, dpr, painted, camera.cam, camera.size, colors);
    const repaint = () => {
      painted = paint();
      draw();
    };
    repaintRef.current = repaint;
    const setup = () => {
      frame = minimapFrame(bounds, canvas.clientWidth || FALLBACK_WIDTH);
      frameRef.current = frame;
      dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(frame.width * dpr);
      canvas.height = Math.round(frame.height * dpr);
      canvas.style.height = `${frame.height}px`;
      draw();
    };
    setup();
    const unsubscribe = camera.subscribe(draw);
    const skin = new MutationObserver(() => {
      colors = boardColors(canvas);
      repaint();
    });
    skin.observe(document.documentElement, { attributes: true, attributeFilter: ["data-skin"] });
    let width = canvas.clientWidth;
    const resize = typeof ResizeObserver === "function"
      ? new ResizeObserver(() => {
        if (canvas.clientWidth === width) {
          draw();
          return;
        }
        width = canvas.clientWidth;
        setup();
      })
      : null;
    resize?.observe(canvas);
    const board = canvas.closest(".mj-board");
    if (board) resize?.observe(board);
    return () => {
      repaintRef.current = null;
      unsubscribe();
      skin.disconnect();
      resize?.disconnect();
    };
  }, [x, y, w, h, camera]);

  const jump = (event: PointerEvent<HTMLDivElement>) => {
    const canvas = canvasRef.current;
    const frame = frameRef.current;
    if (!canvas || !frame) return;
    const box = canvas.getBoundingClientRect();
    onJump(minimapPoint(frame, event.clientX - box.left, event.clientY - box.top));
  };
  const stopDragging = () => {
    draggingRef.current = false;
  };

  return (
    <div
      className="minimap"
      role="img"
      aria-label={t("productionBoard.toolbar.minimap")}
      style={{ right: 12 + insetEnd }}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        draggingRef.current = true;
        jump(event);
      }}
      onPointerMove={(event) => {
        if (draggingRef.current) jump(event);
      }}
      onPointerUp={stopDragging}
      onPointerCancel={stopDragging}
    >
      <canvas ref={canvasRef} />
    </div>
  );
}
