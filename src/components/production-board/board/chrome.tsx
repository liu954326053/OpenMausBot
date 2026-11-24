import { memo, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { Check, ChevronRight, Map as MapIcon, Maximize, Waypoints, ZoomIn, ZoomOut } from "lucide-react";
import { episodeCode, type ProductionEpisodeStatus } from "../../../../shared/production";
import { MENU_GUTTER, MENU_HEADING, MENU_ITEM, MENU_SHEET } from "@/components/menu-recipe";
import { usePopoverDismiss } from "@/hooks/use-popover-dismiss";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import type { BoardLayout } from "@/lib/production-board/layout";
import { BOARD_STAGES, type BoardStage } from "@/lib/production-board/overlay";
import { compactStageName } from "@/lib/production-board/stages";
import type { BoardCardKind, BoardStageState } from "@/lib/production-board/types";
import { episodeStatus, TONE_DOT } from "../cards";
import type { BoardCamera } from "./camera";

export const CHROME_SURFACE = "popover-surface pointer-events-auto flex items-center gap-1 rounded-xl border border-hairline/50 bg-menu p-1";

/** Keeps a bar centred at the top clear of the overlay's side panel in the top-right corner. */
export const PANEL_ROOM = "pe-[20rem]";

/** What that side panel may take of the board's width, in pixels, until the board has measured it. */
export const PANEL_ROOM_PX = 320;

/** The stage bar keeps the board's own accent for the stage at work: it marks where the view is, not a card's state. */
const STAGE_DOT: Record<BoardStageState, string> = { wait: "bg-ink-tertiary", active: "bg-accent", done: "bg-success", failed: "bg-danger" };

export const stageName = (stage: BoardStage) => t(`productionBoard.stage.${stage}`);

const stageLabel = (stage: BoardStage, state: BoardStageState) => `${stageName(stage)} · ${t(`productionBoard.stageState.${state}`)}`;

function ChromeButton({ label, pressed, onClick, children }: { label: string; pressed?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" className={cn("ui-icon-button hover:bg-menu-hover", pressed && "bg-ink/[0.08] text-ink")} aria-label={label} title={label} aria-pressed={pressed} onClick={onClick}>
      {children}
    </button>
  );
}

function StageButtons({ stages, named, compact, onFocus }: { stages: Record<BoardStage, BoardStageState>; named?: BoardStage; compact?: boolean; onFocus: (stage: BoardStage) => void }) {
  return BOARD_STAGES.map((stage, at) => {
    const state = stages[stage];
    const label = stageLabel(stage, state);
    const showsName = !compact || named === stage;
    return (
      <li key={stage} className="flex shrink-0 items-center">
        {!compact && at > 0 ? <ChevronRight size={14} aria-hidden="true" className="text-ink-tertiary rtl:rotate-180" /> : null}
        <button
          type="button"
          data-board-stage={stage}
          data-stage-state={state}
          aria-label={label}
          title={label}
          className={cn(
            "flex h-7 items-center rounded-lg hover:bg-menu-hover",
            showsName ? "gap-1.5 px-2.5 text-[13px] font-medium leading-5" : "w-7 justify-center",
            state === "wait" ? "text-ink-secondary" : "text-ink",
          )}
          onClick={() => onFocus(stage)}
        >
          <span aria-hidden="true" className={cn("size-2 shrink-0 rounded-full", STAGE_DOT[state])} />
          {showsName ? stageName(stage) : null}
        </button>
      </li>
    );
  });
}

/** What the bar keeps between the board's edge and its stages. */
const BAR_INSET = 12;

/** The whole bar while its stages fit the room beside the side panel, else the compact one, which fits with far less. */
const stageBarForm = (available: number, fullWidth: number) => (fullWidth <= available ? "full" : "compact");

function stageBarSizes(nav: HTMLElement, insetEnd: number): { available: number; fullWidth: number } {
  const full = nav.querySelector<HTMLElement>('[data-stage-list="full"]');
  const surface = nav.querySelector<HTMLElement>("[data-stage-surface]");
  const style = surface ? getComputedStyle(surface) : null;
  const surfaceInsets = style ? (Number.parseFloat(style.paddingInlineStart) || 0) + (Number.parseFloat(style.paddingInlineEnd) || 0) : 0;
  return { available: nav.clientWidth - BAR_INSET * 2 - insetEnd, fullWidth: (full?.scrollWidth ?? 0) + surfaceInsets };
}

/** The five stages with their states: the whole bar when it fits the room left beside the side panel, else one small
 * control per stage in the same order, naming only the stage in view. Neither form scrolls across. */
export function BoardStageBar({ stages, viewStage, insetEnd, onFocus }: {
  stages: Record<BoardStage, BoardStageState>;
  /** The stage the view is on, which the compact bar names, or none when the view is beyond them all. */
  viewStage?: BoardStage;
  /** What the side panel takes of the board's width, so the bar keeps clear of it. */
  insetEnd: number;
  onFocus: (stage: BoardStage) => void;
}) {
  const navRef = useRef<HTMLElement>(null);
  const [measured, setMeasured] = useState<{ available: number; fullWidth: number } | null>(null);
  useLayoutEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    const take = () => {
      const next = stageBarSizes(nav, insetEnd);
      if (!nav.clientWidth || !next.fullWidth) return;
      setMeasured((last) => (last?.available === next.available && last.fullWidth === next.fullWidth ? last : next));
    };
    take();
    if (typeof ResizeObserver !== "function") return;
    const observer = new ResizeObserver(take);
    observer.observe(nav);
    return () => observer.disconnect();
  }, [insetEnd]);
  const form = measured ? stageBarForm(measured.available, measured.fullWidth) : "full";
  const compact = form === "compact";
  const named = compactStageName(stages, viewStage);
  return (
    <nav
      ref={navRef}
      data-board-chrome=""
      aria-label={t("productionBoard.stages.label")}
      data-board-stage-form={form}
      data-board-stage-reserve={String(Math.round(insetEnd))}
      data-stage-available={measured ? String(measured.available) : ""}
      data-stage-full={measured ? String(measured.fullWidth) : ""}
      className="pointer-events-none absolute inset-x-0 top-3 z-[80] flex justify-center"
      style={{ paddingInlineStart: BAR_INSET, paddingInlineEnd: BAR_INSET + insetEnd }}
    >
      <div data-stage-surface="" className={cn(CHROME_SURFACE, "relative max-w-full flex-nowrap overflow-hidden")}>
        <ol
          data-stage-list="full"
          aria-hidden={compact || undefined}
          className={cn("items-center gap-0.5", compact ? "invisible absolute start-1 top-1 flex w-max" : "flex")}
        >
          <StageButtons stages={stages} onFocus={onFocus} />
        </ol>
        {compact ? (
          <ol data-stage-list="compact" className="flex min-w-0 flex-wrap items-center justify-center gap-0.5">
            <StageButtons stages={stages} named={named} compact onFocus={onFocus} />
          </ol>
        ) : null}
      </div>
    </nav>
  );
}

export function BoardToolbar({ camera, showRefs, minimap, onRefs, onMinimap, onZoom, onFit }: {
  camera: BoardCamera;
  showRefs: boolean;
  minimap: boolean;
  onRefs: () => void;
  onMinimap: () => void;
  onZoom: (factor: number) => void;
  onFit: () => void;
}) {
  const zoom = useSyncExternalStore(camera.subscribe, () => Math.round(camera.view.k * 100));
  return (
    <div role="toolbar" aria-label={t("productionBoard.toolbar.label")} className={CHROME_SURFACE}>
      <ChromeButton label={t("productionBoard.toolbar.references")} pressed={showRefs} onClick={onRefs}>
        <Waypoints size={16} aria-hidden="true" />
      </ChromeButton>
      <ChromeButton label={t("productionBoard.toolbar.minimap")} pressed={minimap} onClick={onMinimap}>
        <MapIcon size={16} aria-hidden="true" />
      </ChromeButton>
      <span aria-hidden="true" className="mx-1 h-5 w-px bg-hairline" />
      <ChromeButton label={t("productionBoard.toolbar.zoomOut")} onClick={() => onZoom(1 / 1.2)}>
        <ZoomOut size={16} aria-hidden="true" />
      </ChromeButton>
      <span data-board-zoom="" className="w-11 text-center text-[12px] leading-4 text-ink-secondary tabular-nums">{t("productionBoard.toolbar.zoom", { percent: zoom })}</span>
      <ChromeButton label={t("productionBoard.toolbar.zoomIn")} onClick={() => onZoom(1.2)}>
        <ZoomIn size={16} aria-hidden="true" />
      </ChromeButton>
      <ChromeButton label={t("productionBoard.toolbar.fit")} onClick={onFit}>
        <Maximize size={16} aria-hidden="true" />
      </ChromeButton>
    </div>
  );
}

const MINIMAP = { width: 220, height: 140, padding: 400 };
const MINIMAP_FILL: Partial<Record<BoardCardKind, string>> = { bot: "fill-accent/70", final: "fill-success/60", stack: "fill-ink/40" };

const MinimapCards = memo(function MinimapCards({ layout, kinds, scale }: { layout: BoardLayout; kinds: ReadonlyMap<string, BoardCardKind>; scale: { left: number; top: number; k: number } }) {
  return (
    <>
      {[...layout.rects].map(([id, rect]) => (
        <rect
          key={id}
          className={MINIMAP_FILL[kinds.get(id) ?? "other"] ?? "fill-ink/25"}
          x={(rect.x - scale.left) * scale.k}
          y={(rect.y - scale.top) * scale.k}
          width={Math.max(1.5, rect.width * scale.k)}
          height={Math.max(1.5, rect.height * scale.k)}
          rx={1}
        />
      ))}
    </>
  );
});

function MinimapView({ camera, scale }: { camera: BoardCamera; scale: { left: number; top: number; k: number } }) {
  const view = useSyncExternalStore(camera.subscribe, () => camera.view);
  const { width, height } = camera.size;
  return (
    <rect
      className="fill-accent/10 stroke-accent"
      strokeWidth={1}
      x={(-view.x / view.k - scale.left) * scale.k}
      y={(-view.y / view.k - scale.top) * scale.k}
      width={(width / view.k) * scale.k}
      height={(height / view.k) * scale.k}
    />
  );
}

export function BoardMinimap({ layout, kinds, camera, onCentre }: { layout: BoardLayout; kinds: ReadonlyMap<string, BoardCardKind>; camera: BoardCamera; onCentre: (world: { x: number; y: number }) => void }) {
  const { bounds } = layout;
  const left = bounds.x - MINIMAP.padding;
  const top = bounds.y - MINIMAP.padding;
  const k = Math.min(MINIMAP.width / (bounds.width + MINIMAP.padding * 2), MINIMAP.height / (bounds.height + MINIMAP.padding * 2));
  const scale = { left, top, k };
  const centre = (event: React.PointerEvent<SVGSVGElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    onCentre({ x: left + (event.clientX - box.left) / k, y: top + (event.clientY - box.top) / k });
  };
  return (
    <svg
      role="img"
      aria-label={t("productionBoard.toolbar.minimap")}
      className="popover-surface pointer-events-auto cursor-pointer rounded-xl border border-hairline/50 bg-menu"
      width={MINIMAP.width}
      height={MINIMAP.height}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture?.(event.pointerId);
        centre(event);
      }}
      onPointerMove={(event) => {
        if (event.buttons === 1) centre(event);
      }}
    >
      <MinimapCards layout={layout} kinds={kinds} scale={scale} />
      <MinimapView camera={camera} scale={scale} />
    </svg>
  );
}

export interface StackMenuEpisode {
  episode: number;
  title: string;
  status?: ProductionEpisodeStatus;
  unfolded: boolean;
}

/** The episodes that wait or are done: choosing a folded one unfolds it on the board, choosing an unfolded one folds it back. */
export function StackMenu({ episodes, at, onChoose, onClose }: { episodes: StackMenuEpisode[]; at: { x: number; y: number }; onChoose: (episode: number) => void; onClose: () => void }) {
  const rootRef = useRef<HTMLDivElement>(null);
  usePopoverDismiss(true, rootRef, onClose);
  useEffect(() => {
    rootRef.current?.querySelector<HTMLButtonElement>("[role=menuitemcheckbox]")?.focus({ preventScroll: true });
  }, []);
  return (
    <div
      ref={rootRef}
      data-board-chrome=""
      data-board-stack-menu=""
      role="menu"
      aria-label={t("productionBoard.stack.title")}
      className={cn(MENU_SHEET, "pointer-events-auto absolute z-[85] max-h-80 w-72 overflow-y-auto")}
      style={{ left: at.x, top: at.y }}
    >
      <div className={MENU_HEADING}>{t("productionBoard.stack.title")}</div>
      {episodes.map((one) => {
        const status = episodeStatus(one.status);
        return (
          <button
            key={one.episode}
            type="button"
            role="menuitemcheckbox"
            aria-checked={one.unfolded}
            data-board-stack-episode={one.episode}
            className={cn(MENU_ITEM, "hover:bg-menu-hover")}
            onClick={() => onChoose(one.episode)}
          >
            <span className={MENU_GUTTER}>{one.unfolded ? <Check size={14} aria-hidden="true" /> : null}</span>
            <span className="shrink-0 text-[12px] text-ink-secondary tabular-nums">{episodeCode(one.episode)}</span>
            <span className="min-w-0 flex-1 truncate">{one.title}</span>
            {status ? <span aria-hidden="true" className={cn("size-2 shrink-0 rounded-full", TONE_DOT[status.tone])} title={status.label} /> : null}
          </button>
        );
      })}
    </div>
  );
}
