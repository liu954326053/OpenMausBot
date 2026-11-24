import { memo, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode, type RefObject } from "react";
import { Check, Map as MapIcon, Maximize, Waypoints, ZoomIn, ZoomOut } from "lucide-react";
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

export const CHROME_SURFACE = "board-type pointer-events-auto flex items-center gap-1 rounded-xl border border-hairline bg-panel/94 p-1";

/** Keeps a bar centred at the top clear of the overlay's side panel in the top-right corner. */
export const PANEL_ROOM = "pe-[20rem]";

/** What that side panel may take of the board's width, in pixels, until the board has measured it. */
export const PANEL_ROOM_PX = 320;

export const stageName = (stage: BoardStage) => t(`productionBoard.stage.${stage}`);

const stageLabel = (stage: BoardStage, state: BoardStageState) => `${stageName(stage)} · ${t(`productionBoard.stageState.${state}`)}`;

const STAGE_NUMBER_TONE: Record<BoardStageState, string> = {
  wait: "bg-control text-ink-secondary",
  done: "bg-success text-success-ink",
  active: "bg-warning text-app",
  failed: "bg-danger text-danger-ink",
};

function ChromeButton({ label, pressed, wide, mark, onClick, children }: { label: string; pressed?: boolean; wide?: boolean; mark?: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      data-board-chrome-button={mark}
      className={cn(
        "inline-flex h-8 shrink-0 items-center justify-center rounded-lg text-[13px] leading-4 text-ink-secondary",
        "transition-colors duration-100 hover:bg-ink/[0.06] active:bg-ink/[0.08]",
        wide ? "gap-1.5 px-2.5" : "w-8",
        pressed ? "bg-ink/[0.08] text-warning" : null,
      )}
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function StageButtons({ stages, viewStage, named, compact, measure, onFocus }: {
  stages: Record<BoardStage, BoardStageState>;
  viewStage?: BoardStage;
  named?: BoardStage;
  compact?: boolean;
  /** The hidden copy the bar measures, which is not a control of its own. */
  measure?: boolean;
  onFocus: (stage: BoardStage) => void;
}) {
  return BOARD_STAGES.map((stage, at) => {
    const state = stages[stage];
    const label = stageLabel(stage, state);
    const showsName = !compact || named === stage;
    const current = !measure && viewStage === stage;
    return (
      <li key={stage} className="flex shrink-0 items-center">
        {at > 0 ? <span data-stage-sep="" aria-hidden="true" className="mx-1 h-px w-2.5 shrink-0 bg-hairline" /> : null}
        <button
          type="button"
          data-board-stage={measure ? undefined : stage}
          data-stage-state={state}
          aria-current={current ? "true" : undefined}
          aria-label={label}
          title={label}
          className={cn(
            "flex h-7 items-center rounded-lg transition-colors duration-100",
            showsName ? "gap-1.5 px-2" : "w-7 justify-center",
            current ? "bg-control text-ink" : state === "wait" ? "text-ink-secondary hover:bg-menu-hover" : "text-ink hover:bg-menu-hover",
          )}
          tabIndex={measure ? -1 : undefined}
          onClick={() => onFocus(stage)}
        >
          <span data-stage-number="" aria-hidden="true" className={cn("grid size-5 shrink-0 place-items-center rounded-full font-mono text-[11px] font-semibold tabular-nums", STAGE_NUMBER_TONE[state])}>
            {at + 1}
          </span>
          {showsName ? <span data-stage-name="" className="whitespace-nowrap text-[13px] font-medium leading-[18px]">{stageName(stage)}</span> : null}
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
          className={cn("items-center gap-1", compact ? "invisible absolute start-1 top-1 flex w-max" : "flex")}
        >
          <StageButtons stages={stages} viewStage={viewStage} measure={compact} onFocus={onFocus} />
        </ol>
        {compact ? (
          <ol data-stage-list="compact" className="flex min-w-0 flex-wrap items-center justify-center gap-1">
            <StageButtons stages={stages} viewStage={viewStage} named={named} compact onFocus={onFocus} />
          </ol>
        ) : null}
      </div>
    </nav>
  );
}

export function BoardToolbar({ camera, showRefs, minimap, compact, domRef, onRefs, onMinimap, onZoom, onFit }: {
  camera: BoardCamera;
  showRefs: boolean;
  minimap: boolean;
  /** A board too narrow for the words beside the icons. */
  compact?: boolean;
  domRef?: RefObject<HTMLDivElement | null>;
  onRefs: () => void;
  onMinimap: () => void;
  onZoom: (factor: number) => void;
  onFit: () => void;
}) {
  const zoom = useSyncExternalStore(camera.subscribe, () => Math.round(camera.view.k * 100));
  return (
    <div ref={domRef} role="toolbar" data-board-toolbar="" aria-label={t("productionBoard.toolbar.label")} className={CHROME_SURFACE}>
      <ChromeButton label={t("productionBoard.toolbar.zoomOut")} onClick={() => onZoom(1 / 1.2)}>
        <ZoomOut size={16} aria-hidden="true" />
      </ChromeButton>
      <span data-board-zoom="" className="min-w-13 text-center text-[12px] leading-4 text-ink-secondary tabular-nums">{t("productionBoard.toolbar.zoom", { percent: zoom })}</span>
      <ChromeButton label={t("productionBoard.toolbar.zoomIn")} onClick={() => onZoom(1.2)}>
        <ZoomIn size={16} aria-hidden="true" />
      </ChromeButton>
      <span data-board-toolbar-sep="" aria-hidden="true" className="mx-1 h-4 w-px shrink-0 bg-hairline" />
      <ChromeButton wide={!compact} label={t("productionBoard.toolbar.fit")} onClick={onFit}>
        <Maximize size={16} aria-hidden="true" />
        {compact ? null : <span>{t("productionBoard.toolbar.fitLabel")}</span>}
      </ChromeButton>
      <ChromeButton wide={!compact} label={t("productionBoard.toolbar.references")} pressed={showRefs} onClick={onRefs}>
        <Waypoints size={16} aria-hidden="true" />
        {compact ? null : <span>{t("productionBoard.toolbar.referencesLabel")}</span>}
      </ChromeButton>
      <ChromeButton mark="minimap" label={t("productionBoard.toolbar.minimap")} pressed={minimap} onClick={onMinimap}>
        <MapIcon size={16} aria-hidden="true" />
      </ChromeButton>
    </div>
  );
}

/** The minimap's frame: an inner map 12 short of the box, 6px around it, 12 from the board's edge. */
const MINIMAP = { maxHeight: 140, padding: 400, inset: 12, box: 220, narrowBox: 150 };

/** How wide the minimap's frame is on a board of this width. */
export const minimapBoxWidth = (compact: boolean) => (compact ? MINIMAP.narrowBox : MINIMAP.box);
const MINIMAP_FILL: Partial<Record<BoardCardKind, string>> = {
  bot: "fill-accent/60",
  brief: "fill-ink/30",
  plan: "fill-ink/30",
  episode: "fill-ink/30",
  stack: "fill-ink/30",
  shot: "fill-ink/30",
  character: "fill-ink-tertiary/60",
  scene: "fill-ink-tertiary/60",
  result: "fill-warning/80",
  final: "fill-ink/80",
};

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

export function BoardMinimap({ layout, kinds, camera, insetEnd, bottom, compact, onCentre }: {
  layout: BoardLayout;
  kinds: ReadonlyMap<string, BoardCardKind>;
  camera: BoardCamera;
  /** What the side panel takes of the board's width, so the map keeps clear of it. */
  insetEnd: number;
  /** Where to sit, above the toolbar's corner, when the two would meet at the bottom. */
  bottom?: number;
  /** A narrow board gets the smaller map, leaving the toolbar its corner. */
  compact?: boolean;
  onCentre: (world: { x: number; y: number }) => void;
}) {
  const { bounds } = layout;
  const box = minimapBoxWidth(Boolean(compact));
  const width = box - 12;
  const left = bounds.x - MINIMAP.padding;
  const top = bounds.y - MINIMAP.padding;
  const k = Math.min(width / (bounds.width + MINIMAP.padding * 2), MINIMAP.maxHeight / (bounds.height + MINIMAP.padding * 2));
  const height = Math.max(40, Math.round((bounds.height + MINIMAP.padding * 2) * k));
  const scale = { left, top, k };
  const centre = (event: React.PointerEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const unit = rect.width ? width / rect.width : 1;
    onCentre({ x: left + ((event.clientX - rect.left) * unit) / k, y: top + ((event.clientY - rect.top) * unit) / k });
  };
  return (
    <div
      data-board-minimap=""
      className="board-type pointer-events-auto absolute bottom-3 z-[80] rounded-xl border border-board-line bg-panel/94 p-1.5"
      style={{ width: box, insetInlineEnd: MINIMAP.inset + insetEnd, ...(bottom === undefined ? {} : { bottom }) }}
    >
      <svg
        role="img"
        aria-label={t("productionBoard.toolbar.minimap")}
        className="block h-auto w-full cursor-pointer touch-none rounded-md bg-app"
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
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
    </div>
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
