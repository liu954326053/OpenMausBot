// Adapted from basketikun/infinite-canvas@9cd3deac web/src/components/canvas/canvas-connections.tsx, MIT License, Copyright (c) 2026 basketikun (full text in third_party/infinite-canvas/LICENSE)
import { X } from "lucide-react";
import type { CanvasConnection, CanvasNode } from "../../../shared/project-canvas";
import { t } from "@/lib/i18n";
import { connectionCurve, curveInView, type CanvasBounds } from "@/lib/project-canvas/geometry";

/** A node still to come from `sourceId`: a generation's next result, or the node a reply becomes, `replyNodeId`. */
export interface GhostFrame {
  sourceId: string;
  frame: Pick<CanvasNode, "position" | "width" | "height">;
  label: string;
  replyNodeId?: string;
}

export const ghostKey = (ghost: GhostFrame) => ghost.replyNodeId ?? ghost.sourceId;

export function CanvasConnections({ nodes, connections, bounds, selectedId, active, draft, ghosts, k, readOnly, onSelect, onDelete }: {
  nodes: ReadonlyMap<string, CanvasNode>;
  connections: readonly CanvasConnection[];
  bounds: CanvasBounds;
  selectedId: string | null;
  /** Connections that touch a selected node. */
  active: ReadonlySet<string>;
  draft: string | null;
  ghosts: readonly GhostFrame[];
  k: number;
  readOnly: boolean;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const selected = connections.find((connection) => connection.id === selectedId && connection.kind === "content");
  const selectedCurve = selected && nodes.get(selected.fromNodeId) && nodes.get(selected.toNodeId) ? connectionCurve(nodes.get(selected.fromNodeId)!, nodes.get(selected.toNodeId)!) : null;
  return (
    <>
      <svg className="pointer-events-none absolute start-0 top-0 overflow-visible" width="1" height="1" aria-hidden="true">
        {connections.map((connection) => {
          const from = nodes.get(connection.fromNodeId);
          const to = nodes.get(connection.toNodeId);
          if (!from || !to) return null;
          const curve = connectionCurve(from, to);
          if (!curveInView(curve, bounds)) return null;
          if (connection.kind === "dispatch") {
            return <path key={connection.id} data-connection={connection.id} data-kind="dispatch" d={curve.path} fill="none" stroke="var(--color-ink-tertiary)" strokeWidth={2} strokeDasharray="2 6" strokeLinecap="round" opacity={0.9} />;
          }
          const isSelected = connection.id === selectedId;
          const isActive = isSelected || active.has(connection.id);
          return (
            <g key={connection.id} data-connection={connection.id} data-kind="content">
              <path
                d={curve.path}
                fill="none"
                stroke="transparent"
                strokeWidth={16}
                pointerEvents={readOnly ? "none" : "stroke"}
                className="cursor-pointer"
                onPointerDown={(event) => {
                  if (readOnly || event.button !== 0) return;
                  event.stopPropagation();
                  onSelect(connection.id);
                }}
              />
              <path d={curve.path} fill="none" stroke={isActive ? "var(--color-accent)" : "var(--color-ink-tertiary)"} strokeWidth={isActive ? 3 : 2} opacity={isActive ? 1 : 0.82} />
            </g>
          );
        })}
        {ghosts.map((ghost) => {
          const from = nodes.get(ghost.sourceId);
          return from ? <path key={`ghost:${ghostKey(ghost)}`} data-ghost-connection={ghostKey(ghost)} d={connectionCurve(from, ghost.frame).path} fill="none" stroke="var(--color-ink-tertiary)" strokeWidth={2} strokeDasharray="5 5" /> : null;
        })}
        {draft ? <path d={draft} fill="none" stroke="var(--color-accent)" strokeWidth={2} strokeDasharray="5 5" /> : null}
      </svg>
      {selected && selectedCurve && !readOnly ? (
        <button
          type="button"
          aria-label={t("projectCanvas.connection.delete")}
          title={t("projectCanvas.connection.delete")}
          className="absolute z-[55] flex size-6 items-center justify-center rounded-full border border-hairline bg-menu text-ink-secondary hover:text-ink"
          style={{ left: (selectedCurve.start.x + selectedCurve.end.x) / 2, top: (selectedCurve.start.y + selectedCurve.end.y) / 2, transform: `translate(-50%, -50%) scale(${1 / k})` }}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => onDelete(selected.id)}
        >
          <X size={14} aria-hidden="true" />
        </button>
      ) : null}
    </>
  );
}
