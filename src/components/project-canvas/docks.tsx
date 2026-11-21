// Adapted from basketikun/infinite-canvas@9cd3deac web/src/components/canvas/canvas-toolbar.tsx, canvas-zoom-controls.tsx
// and canvas-minimap.tsx, MIT License, Copyright (c) 2026 basketikun (full text in third_party/infinite-canvas/LICENSE)
import { useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { CircleHelp, Compass, Crosshair, Eraser, Focus, Grid3x3, Hand, MousePointer2, Redo2, Trash2, Undo2, Upload } from "lucide-react";
import type { CanvasBackgroundMode, CanvasNode, CanvasViewport } from "../../../shared/project-canvas";
import { MENU_HEADING, MENU_ITEM, MENU_SHEET } from "@/components/menu-recipe";
import { usePopoverDismiss } from "@/hooks/use-popover-dismiss";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { isMacPlatform } from "@/lib/keyboard-shortcuts";
import { MAX_ZOOM, MIN_ZOOM, nodeBounds, type CanvasSize } from "@/lib/project-canvas/geometry";
import { useCanvasUi, type CanvasTool, type CreatableNodeType } from "./canvas-ui";
import { addNodeLabel, NODE_ICONS } from "./node-kinds";

export const DOCK_SURFACE = "popover-surface pointer-events-auto flex items-center gap-1 rounded-xl border border-hairline/50 bg-menu p-1";
export const CREATABLE_TYPES: CreatableNodeType[] = ["text", "image", "video", "shot", "config", "group"];

function DockButton({ label, onClick, disabled, pressed, children }: { label: string; onClick: () => void; disabled?: boolean; pressed?: boolean; children: ReactNode }) {
  return (
    <button type="button" className={cn("ui-icon-button", pressed && "bg-ink/[0.08] text-ink")} aria-label={label} title={label} aria-pressed={pressed} disabled={disabled} onClick={onClick}>
      {children}
    </button>
  );
}

const Divider = () => <span aria-hidden="true" className="mx-1 h-5 w-px bg-hairline" />;

function BackgroundMenu({ value, onChange }: { value: CanvasBackgroundMode; onChange: (mode: CanvasBackgroundMode) => void }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  usePopoverDismiss(open, rootRef, () => setOpen(false));
  const modes: Array<{ mode: CanvasBackgroundMode; label: string }> = [
    { mode: "dots", label: t("projectCanvas.background.dots") },
    { mode: "lines", label: t("projectCanvas.background.lines") },
    { mode: "blank", label: t("projectCanvas.background.blank") },
  ];
  return (
    <div ref={rootRef} className="relative">
      <DockButton label={t("projectCanvas.background.title")} pressed={open} onClick={() => setOpen((shown) => !shown)}>
        <Grid3x3 size={16} aria-hidden="true" />
      </DockButton>
      {open ? (
        <div role="menu" className={cn(MENU_SHEET, "absolute bottom-full end-0 mb-2 w-44")}>
          <div className={MENU_HEADING}>{t("projectCanvas.background.title")}</div>
          {modes.map(({ mode, label }) => (
            <button key={mode} type="button" role="menuitemradio" aria-checked={value === mode} className={cn(MENU_ITEM, value === mode && "bg-menu-active")} onClick={() => {
              onChange(mode);
              setOpen(false);
            }}>
              {label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function CanvasToolbar({ tool, onTool, onFocus, onCreate, onUpload, onDeleteSelection, onClear }: {
  tool: CanvasTool;
  onTool: (tool: CanvasTool) => void;
  onFocus: () => void;
  onCreate: (type: CreatableNodeType) => void;
  onUpload: () => void;
  onDeleteSelection: () => void;
  onClear: () => void;
}) {
  const ui = useCanvasUi();
  const deletable = [...ui.selection].some((id) => ui.snapshot.nodes.find((node) => node.id === id)?.type !== "bot") || Boolean(ui.selectedConnectionId);
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-6 z-[80] flex justify-center">
      <div role="toolbar" aria-label={t("projectCanvas.toolbar.label")} className={DOCK_SURFACE}>
        <DockButton label={t("projectCanvas.toolbar.select")} pressed={tool === "select"} onClick={() => onTool("select")}>
          <MousePointer2 size={16} aria-hidden="true" />
        </DockButton>
        <DockButton label={t("projectCanvas.toolbar.pan")} pressed={tool === "pan"} onClick={() => onTool("pan")}>
          <Hand size={16} aria-hidden="true" />
        </DockButton>
        <Divider />
        <DockButton label={t("projectCanvas.toolbar.undo")} disabled={!ui.state.canUndo || ui.readOnly} onClick={() => ui.controller.undo()}>
          <Undo2 size={16} aria-hidden="true" />
        </DockButton>
        <DockButton label={t("projectCanvas.toolbar.redo")} disabled={!ui.state.canRedo || ui.readOnly} onClick={() => ui.controller.redo()}>
          <Redo2 size={16} aria-hidden="true" />
        </DockButton>
        <DockButton label={t("projectCanvas.toolbar.focus")} onClick={onFocus}>
          <Crosshair size={16} aria-hidden="true" />
        </DockButton>
        <Divider />
        {CREATABLE_TYPES.map((type) => {
          const Icon = NODE_ICONS[type];
          return (
            <DockButton key={type} label={addNodeLabel(type)} disabled={ui.readOnly} onClick={() => onCreate(type)}>
              <Icon size={16} aria-hidden="true" />
            </DockButton>
          );
        })}
        <DockButton label={t("projectCanvas.toolbar.upload")} disabled={ui.readOnly || ui.snapshot.project.folderState === "missing"} onClick={onUpload}>
          <Upload size={16} aria-hidden="true" />
        </DockButton>
        <Divider />
        <BackgroundMenu value={ui.snapshot.backgroundMode} onChange={(mode) => ui.controller.setBackground(mode)} />
        <DockButton label={t("projectCanvas.toolbar.delete")} disabled={ui.readOnly || !deletable} onClick={onDeleteSelection}>
          <Trash2 size={16} aria-hidden="true" />
        </DockButton>
        <DockButton label={t("projectCanvas.toolbar.clear")} disabled={ui.readOnly || !ui.snapshot.nodes.some((node) => node.type !== "bot")} onClick={onClear}>
          <Eraser size={16} aria-hidden="true" />
        </DockButton>
      </div>
    </div>
  );
}

function canvasShortcuts(): Array<{ keys: string; label: string }> {
  const mac = isMacPlatform();
  const mod = mac ? "⌘" : "Ctrl";
  const shift = mac ? "⇧" : "Shift";
  return [
    { keys: `${mod} Z`, label: t("projectCanvas.toolbar.undo") },
    { keys: `${mod} ${shift} Z`, label: t("projectCanvas.toolbar.redo") },
    { keys: `${mod} A`, label: t("projectCanvas.shortcuts.selectAll") },
    { keys: `${mod} C`, label: t("projectCanvas.shortcuts.copy") },
    { keys: `${mod} V`, label: t("projectCanvas.shortcuts.paste") },
    { keys: `${mod} D`, label: t("projectCanvas.shortcuts.duplicate") },
    { keys: `${mod} G`, label: t("projectCanvas.shortcuts.group") },
    { keys: `${mod} ${shift} G`, label: t("projectCanvas.shortcuts.ungroup") },
    { keys: mac ? "⌫" : "Delete", label: t("projectCanvas.toolbar.delete") },
    { keys: "Esc", label: t("projectCanvas.shortcuts.escape") },
    { keys: "Space", label: t("projectCanvas.shortcuts.pan") },
    { keys: "V", label: t("projectCanvas.toolbar.select") },
    { keys: "H", label: t("projectCanvas.toolbar.pan") },
  ];
}

function ShortcutHelp() {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  usePopoverDismiss(open, rootRef, () => setOpen(false));
  return (
    <div ref={rootRef} className="relative">
      <DockButton label={t("projectCanvas.shortcuts.title")} pressed={open} onClick={() => setOpen((shown) => !shown)}>
        <CircleHelp size={16} aria-hidden="true" />
      </DockButton>
      {open ? (
        <div role="dialog" aria-label={t("projectCanvas.shortcuts.title")} className={cn(MENU_SHEET, "absolute bottom-full end-0 mb-2 w-72")}>
          <div className={MENU_HEADING}>{t("projectCanvas.shortcuts.title")}</div>
          <dl className="flex flex-col">
            {canvasShortcuts().map((shortcut) => (
              <div key={shortcut.keys} className="flex h-[30px] items-center gap-2 px-2 text-[13px] leading-[18px]">
                <dt className="flex-1 truncate text-ink">{shortcut.label}</dt>
                <dd><kbd className="rounded border border-hairline/50 px-1.5 py-0.5 text-[11px] leading-none text-ink-secondary">{shortcut.keys}</kbd></dd>
              </div>
            ))}
          </dl>
          <p className="px-2 pb-1 text-[12px] leading-4 text-ink-tertiary">{t("projectCanvas.shortcuts.wheel")}</p>
        </div>
      ) : null}
    </div>
  );
}

export function ZoomDock({ viewport, minimapOpen, onMinimap, onReset, onZoom }: {
  viewport: CanvasViewport;
  minimapOpen: boolean;
  onMinimap: () => void;
  onReset: () => void;
  onZoom: (k: number) => void;
}) {
  const percent = Math.round(viewport.k * 100);
  return (
    <div className="pointer-events-none absolute bottom-6 end-6 z-[80] flex">
      <div className={DOCK_SURFACE}>
        <DockButton label={minimapOpen ? t("projectCanvas.zoom.hideMinimap") : t("projectCanvas.zoom.showMinimap")} pressed={minimapOpen} onClick={onMinimap}>
          <Compass size={16} aria-hidden="true" />
        </DockButton>
        <DockButton label={t("projectCanvas.zoom.reset")} onClick={onReset}>
          <Focus size={16} aria-hidden="true" />
        </DockButton>
        <input
          type="range"
          min={MIN_ZOOM * 100}
          max={MAX_ZOOM * 100}
          value={percent}
          aria-label={t("projectCanvas.zoom.level")}
          className="w-24 accent-accent"
          onChange={(event) => onZoom(Number(event.target.value) / 100)}
        />
        <span className="w-11 text-end text-[12px] leading-4 text-ink-secondary tabular-nums">{t("projectCanvas.zoom.percent", { count: percent })}</span>
        <ShortcutHelp />
      </div>
    </div>
  );
}

const MINIMAP_WIDTH = 240;
const MINIMAP_HEIGHT = 160;
const MINIMAP_PADDING = 500;

export function Minimap({ nodes, viewport, size, onCenter }: { nodes: readonly CanvasNode[]; viewport: CanvasViewport; size: CanvasSize; onCenter: (world: { x: number; y: number }) => void }) {
  const raw = nodes.length ? nodeBounds(nodes) : { left: 0, top: 0, right: 0, bottom: 0 };
  const bounds = { left: raw.left - MINIMAP_PADDING, top: raw.top - MINIMAP_PADDING, right: raw.right + MINIMAP_PADDING, bottom: raw.bottom + MINIMAP_PADDING };
  const scale = Math.min(MINIMAP_WIDTH / (bounds.right - bounds.left), MINIMAP_HEIGHT / (bounds.bottom - bounds.top));
  const view = { x: -viewport.x / viewport.k, y: -viewport.y / viewport.k, width: size.width / viewport.k, height: size.height / viewport.k };
  const toMap = (x: number, y: number) => ({ x: (x - bounds.left) * scale, y: (y - bounds.top) * scale });
  const center = (event: ReactPointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    onCenter({ x: bounds.left + (event.clientX - rect.left) / scale, y: bounds.top + (event.clientY - rect.top) / scale });
  };
  const viewOnMap = toMap(view.x, view.y);
  return (
    <div className="pointer-events-none absolute bottom-24 start-6 z-[80] flex">
      <div
        role="img"
        aria-label={t("projectCanvas.zoom.minimap")}
        dir="ltr"
        className="popover-surface pointer-events-auto relative cursor-pointer overflow-hidden rounded-xl border border-hairline/50 bg-menu"
        style={{ width: MINIMAP_WIDTH, height: MINIMAP_HEIGHT }}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture?.(event.pointerId);
          center(event);
        }}
        onPointerMove={(event) => {
          if (event.buttons === 1) center(event);
        }}
      >
        {nodes.map((node) => {
          const at = toMap(node.position.x, node.position.y);
          return (
            <span
              key={node.id}
              className={cn("absolute", node.type === "bot" ? "bg-accent/60" : node.type === "group" ? "border border-ink-tertiary" : "bg-ink/25")}
              style={{ left: at.x, top: at.y, width: Math.max(2, node.width * scale), height: Math.max(2, node.height * scale) }}
            />
          );
        })}
        <span className="absolute border border-accent" style={{ left: viewOnMap.x, top: viewOnMap.y, width: view.width * scale, height: view.height * scale }} />
      </div>
    </div>
  );
}
