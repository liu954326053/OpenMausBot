import { memo, useEffect, useRef, useSyncExternalStore, type ReactNode } from "react";
import { Check, ChevronRight, Map as MapIcon, Maximize, Waypoints, ZoomIn, ZoomOut } from "lucide-react";
import { episodeCode, type ProductionEpisodeStatus } from "../../../../shared/production";
import { MENU_GUTTER, MENU_HEADING, MENU_ITEM, MENU_SHEET } from "@/components/menu-recipe";
import { usePopoverDismiss } from "@/hooks/use-popover-dismiss";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import type { BoardLayout } from "@/lib/production-board/layout";
import { BOARD_STAGES, type BoardStage } from "@/lib/production-board/overlay";
import type { BoardCardKind, BoardStageState } from "@/lib/production-board/types";
import { episodeStatus, TONE_DOT, type BoardTone } from "../cards";
import type { BoardCamera } from "./camera";

export const CHROME_SURFACE = "popover-surface pointer-events-auto flex items-center gap-1 rounded-xl border border-hairline/50 bg-menu p-1";

/** Keeps a bar centred at the top clear of the overlay's side panel in the top-right corner. */
export const PANEL_ROOM = "pe-[20rem]";

const STAGE_TONE: Record<BoardStageState, BoardTone> = { wait: "idle", active: "working", done: "done", failed: "failed" };

export const stageName = (stage: BoardStage) => t(`productionBoard.stage.${stage}`);

function ChromeButton({ label, pressed, onClick, children }: { label: string; pressed?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" className={cn("ui-icon-button hover:bg-menu-hover", pressed && "bg-ink/[0.08] text-ink")} aria-label={label} title={label} aria-pressed={pressed} onClick={onClick}>
      {children}
    </button>
  );
}

export function BoardStageBar({ stages, onFocus, roomForPanel }: { stages: Record<BoardStage, BoardStageState>; onFocus: (stage: BoardStage) => void; roomForPanel: boolean }) {
  return (
    <nav data-board-chrome="" aria-label={t("productionBoard.stages.label")} className={cn("pointer-events-none absolute inset-x-0 top-3 z-[80] flex justify-center px-3", roomForPanel && PANEL_ROOM)}>
      <ol className={cn(CHROME_SURFACE, "max-w-full overflow-x-auto")}>
        {BOARD_STAGES.map((stage, at) => {
          const state = stages[stage];
          const label = `${stageName(stage)} · ${t(`productionBoard.stageState.${state}`)}`;
          return (
            <li key={stage} className="flex shrink-0 items-center">
              {at > 0 ? <ChevronRight size={14} aria-hidden="true" className="text-ink-tertiary rtl:rotate-180" /> : null}
              <button
                type="button"
                data-board-stage={stage}
                data-stage-state={state}
                aria-label={label}
                title={label}
                className={cn("flex h-7 items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-medium leading-5 hover:bg-menu-hover", state === "wait" ? "text-ink-secondary" : "text-ink")}
                onClick={() => onFocus(stage)}
              >
                <span aria-hidden="true" className={cn("size-2 shrink-0 rounded-full", TONE_DOT[STAGE_TONE[state]])} />
                {stageName(stage)}
              </button>
            </li>
          );
        })}
      </ol>
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
