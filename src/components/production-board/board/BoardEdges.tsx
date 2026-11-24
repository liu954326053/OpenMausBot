import { memo, type CSSProperties } from "react";
import { episodeCode } from "../../../../shared/production";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import type { EdgePath } from "@/lib/production-board/edge-paths";
import type { BoardEdge, BoardEdgeLabel } from "@/lib/production-board/types";

export function edgeLabelText(label: BoardEdgeLabel): string {
  switch (label.kind) {
    case "dispatchScript":
      return t("productionBoard.edge.dispatchScript");
    case "dispatchCharacters":
      return t("productionBoard.edge.dispatchCharacters");
    case "dispatchScenes":
      return t("productionBoard.edge.dispatchScenes");
    case "episodes":
      return t("productionBoard.edge.episodes", { count: label.count });
    case "dispatchEpisode":
      return t("productionBoard.edge.dispatchEpisode", { episode: episodeCode(label.episode) });
    case "videos":
      return t("productionBoard.edge.videos", { ready: label.ready, shots: label.shots });
    case "cut":
      return t("productionBoard.edge.cut", { episode: episodeCode(label.episode) });
    case "refine":
      return t("productionBoard.edge.refine");
  }
}

const SCREEN = (px: number) => `calc(${px}px / var(--board-zoom, 1))`;

const FLOW_STYLE = `@keyframes board-edge-flow{to{stroke-dashoffset:calc(-24px / var(--board-zoom, 1))}}@media (prefers-reduced-motion:reduce){[data-edge-flow]{animation:none!important}}:root[data-reduced-motion=true] [data-edge-flow]{animation:none!important}`;

/** Line width and dashes in screen pixels, so a line reads the same at every zoom: done solid, active dashed 10/14 with
 * a band flowing along it, waiting dashed 5/6, and the finer dashes of a refined scene and a reference. The finished and
 * running lines sit back, as in the mockup, leaving the moving band the brightest part. */
function lineStyle(edge: BoardEdge): CSSProperties {
  const width = edge.kind === "ref" ? 1.3 : 1.5;
  const opacity = edge.state === "active" ? 0.45 : edge.state === "done" ? 0.62 : 1;
  if (edge.kind === "ref") return { strokeWidth: SCREEN(width), strokeOpacity: opacity, strokeDasharray: `${SCREEN(3)} ${SCREEN(7)}` };
  if (edge.kind === "derive") return { strokeWidth: SCREEN(width), strokeOpacity: opacity, strokeDasharray: `${SCREEN(2)} ${SCREEN(6)}` };
  if (edge.state === "wait") return { strokeWidth: SCREEN(width), strokeOpacity: opacity, strokeDasharray: `${SCREEN(5)} ${SCREEN(6)}` };
  if (edge.state === "active") return { strokeWidth: SCREEN(width), strokeOpacity: opacity, strokeDasharray: `${SCREEN(10)} ${SCREEN(14)}` };
  return { strokeWidth: SCREEN(width), strokeOpacity: opacity };
}

function tone(edge: BoardEdge): string {
  if (edge.kind === "ref") return "text-ink-tertiary/40";
  if (edge.state === "done") return "text-success";
  if (edge.state === "active") return "text-warning";
  if (edge.state === "wait") return "text-ink-tertiary/60";
  return "text-ink-tertiary";
}

function isDispatch(label: BoardEdgeLabel | undefined): boolean {
  return label?.kind === "dispatchScript" || label?.kind === "dispatchCharacters" || label?.kind === "dispatchScenes" || label?.kind === "dispatchEpisode";
}

function labelClass(edge: BoardEdge): string {
  if (edge.state === "wait") return "border-dashed border-hairline bg-panel text-ink-tertiary";
  if (isDispatch(edge.label)) return "border-success bg-success font-semibold text-success-ink";
  return "border-hairline bg-panel text-ink-secondary";
}

/** The board's lines in world coordinates; zoomed far out they lose their arrowheads and labels. */
export const BoardEdges = memo(function BoardEdges({ items, far }: { items: ReadonlyArray<{ edge: BoardEdge; path: EdgePath }>; far: boolean }) {
  return (
    <>
      <style>{FLOW_STYLE}</style>
      <svg aria-hidden="true" className="pointer-events-none absolute top-0 overflow-visible" style={{ left: 0, width: 1, height: 1 }}>
        {items.map(({ edge, path }) => (
          <g key={edge.id} data-board-edge={edge.id} data-edge-kind={edge.kind} data-edge-state={edge.state} className={tone(edge)}>
            <path d={path.d} fill="none" stroke="currentColor" strokeLinecap="round" style={lineStyle(edge)} />
            {edge.state === "active" && edge.kind !== "ref" ? (
              <path
                data-edge-flow=""
                d={path.d}
                fill="none"
                stroke="currentColor"
                strokeLinecap="round"
                strokeOpacity={0.85}
                style={{ strokeWidth: SCREEN(2.4), strokeDasharray: `${SCREEN(10)} ${SCREEN(14)}`, animation: "board-edge-flow 1s linear infinite" }}
              />
            ) : null}
            {far ? null : <path d={path.arrow} fill="currentColor" />}
          </g>
        ))}
      </svg>
      {far
        ? null
        : items.map(({ edge, path }) =>
            edge.label ? (
              <span
                key={edge.id}
                data-board-edge-label={edge.id}
                className={cn(
                  "pointer-events-none absolute inline-flex h-6 items-center whitespace-nowrap rounded-full border px-2.5 text-[12px] leading-4 -translate-x-1/2 -translate-y-1/2",
                  labelClass(edge),
                )}
                style={{ left: path.label.x, top: path.label.y }}
              >
                {edgeLabelText(edge.label)}
              </span>
            ) : null,
          )}
    </>
  );
});
