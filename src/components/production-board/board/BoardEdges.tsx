import { memo } from "react";
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

function lineStyle(edge: BoardEdge) {
  const width = edge.state === "active" ? 2 : edge.kind === "ref" ? 1 : 1.5;
  const dashes = edge.kind === "ref" ? [2, 4] : edge.state === "wait" ? [6, 5] : undefined;
  return { strokeWidth: SCREEN(width), ...(dashes ? { strokeDasharray: dashes.map(SCREEN).join(" ") } : {}) };
}

function tone(edge: BoardEdge): string {
  if (edge.state === "active") return "text-accent";
  if (edge.kind === "ref") return "text-ink-tertiary/50";
  return edge.state === "wait" ? "text-ink-tertiary/60" : "text-ink-tertiary";
}

/** The board's lines in world coordinates; zoomed far out they lose their arrowheads and labels. */
export const BoardEdges = memo(function BoardEdges({ items, far }: { items: ReadonlyArray<{ edge: BoardEdge; path: EdgePath }>; far: boolean }) {
  return (
    <>
      <svg aria-hidden="true" className="pointer-events-none absolute top-0 overflow-visible" style={{ left: 0, width: 1, height: 1 }}>
        {items.map(({ edge, path }) => (
          <g key={edge.id} data-board-edge={edge.id} data-edge-kind={edge.kind} data-edge-state={edge.state} className={tone(edge)}>
            <path d={path.d} fill="none" stroke="currentColor" strokeLinecap="round" style={lineStyle(edge)} />
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
                  "pointer-events-none absolute whitespace-nowrap rounded-full border bg-card px-2 py-0.5 text-[11px] font-medium leading-4 -translate-x-1/2 -translate-y-1/2",
                  edge.state === "active" ? "border-accent/50 text-accent-text" : edge.state === "wait" ? "border-dashed border-hairline text-ink-tertiary" : "border-hairline text-ink-secondary",
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
