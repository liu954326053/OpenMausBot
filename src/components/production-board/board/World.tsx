import { memo, type CSSProperties, type SyntheticEvent } from "react";
import { episodeCode } from "../../../../shared/production";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import type { BoardStage } from "@/lib/production-board/overlay";
import type { BoardCard, BoardEdge, BoardEdgeLabel } from "@/lib/production-board/types";
import type { Rect } from "../engine/camera";
import type { EdgePath } from "../engine/edge-paths";
import { NODE_CLASS, NodeBody, nodeFacts } from "../nodes";
import { NodeFrame } from "../nodes/NodeFrame";
import type { NodeContext } from "../nodes/parts";

export interface DrawnCard {
  card: BoardCard;
  rect: Rect;
}

export interface DrawnEdge {
  edge: BoardEdge;
  path: EdgePath;
  /** A reference line's place among all of them, which staggers the light along it. */
  refIndex?: number;
}

export interface WorldProps {
  cards: readonly DrawnCard[];
  edges: readonly DrawnEdge[];
  selectedId?: string;
  related: ReadonlySet<string>;
  lit: ReadonlySet<string>;
  hoveredId?: string;
  draggingId?: string;
  entering: ReadonlySet<BoardStage>;
  stageOf: ReadonlyMap<string, BoardStage | undefined>;
  ctx: NodeContext;
  /** Where the hint of an empty board goes, under the lead's card. */
  emptyHintAt?: { x: number; y: number };
  onHeight(cardId: string, height: number): void;
  onHover(cardId: string | null): void;
}

function edgeLabelText(label: BoardEdgeLabel): string {
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

const cardIdAt = (target: EventTarget | null): string | undefined =>
  (target instanceof Element ? target.closest<HTMLElement>("[data-board-card-id]")?.dataset.boardCardId : undefined);

const BoardNode = memo(function BoardNode({ card, rect, ctx, selected, related, dragging, entering, onHeight }: {
  card: BoardCard;
  rect: Rect;
  ctx: NodeContext;
  selected: boolean;
  related: boolean;
  dragging: boolean;
  entering: boolean;
  onHeight(cardId: string, height: number): void;
}) {
  const facts = nodeFacts(card, ctx.snapshot);
  return (
    <NodeFrame
      card={card}
      rect={rect}
      kind={NODE_CLASS[card.kind]}
      label={facts.label}
      state={facts.state}
      vstate={facts.vstate}
      selected={selected}
      related={related}
      dragging={dragging}
      entering={entering}
      onHeight={onHeight}
    >
      <NodeBody card={card} ctx={ctx} />
    </NodeFrame>
  );
});

function EdgeLines({ edge, path, refIndex, on, hovered, entering }: DrawnEdge & { on: boolean; hovered: boolean; entering: boolean }) {
  const ref = edge.kind === "ref";
  return (
    <g
      className={cn("edge", `t-${edge.kind}`, `s-${edge.state}`, on && "is-on", hovered && "is-hov", entering && "pre")}
      data-board-edge={edge.id}
      style={ref ? ({ "--i": refIndex ?? 0 } as CSSProperties) : undefined}
    >
      <path className="ln" d={path.d} />
      {ref ? <path className="tl" d={path.d} /> : null}
      {ref ? <path className="gl" d={path.d} /> : null}
      <path className="fl" d={path.d} />
      <path className="ah" d={path.arrow} />
      <circle className="pt" r={3.5} cx={path.start.x} cy={path.start.y} />
    </g>
  );
}

/** What the camera moves: the lines, their labels over them, and the cards over both, in world coordinates. */
export const World = memo(function World({ cards, edges, selectedId, related, lit, hoveredId, draggingId, entering, stageOf, ctx, emptyHintAt, onHeight, onHover }: WorldProps) {
  const isEntering = (cardId: string) => {
    const stage = stageOf.get(cardId);
    return stage !== undefined && entering.has(stage);
  };
  const edgeEntering = (edge: BoardEdge) => entering.size > 0 && (isEntering(edge.from) || isEntering(edge.to));
  const drawEdge = (item: DrawnEdge) => (
    <EdgeLines
      key={item.edge.id}
      {...item}
      on={lit.has(item.edge.id)}
      hovered={item.edge.kind === "ref" && hoveredId !== undefined && (item.edge.from === hoveredId || item.edge.to === hoveredId)}
      entering={edgeEntering(item.edge)}
    />
  );
  const hover = (event: SyntheticEvent) => {
    const id = cardIdAt(event.target);
    if (id) onHover(id);
  };
  return (
    <>
      <svg className="edges" aria-hidden="true">{edges.filter((item) => item.edge.kind !== "ref").map(drawEdge)}</svg>
      <svg className="edges" aria-hidden="true">{edges.filter((item) => item.edge.kind === "ref").map(drawEdge)}</svg>
      <div className="labels" aria-hidden="true">
        {edges.map(({ edge, path }) => (edge.label ? (
          <div
            key={edge.id}
            className={cn("elabel", `t-${edge.kind}`, `s-${edge.state}`, lit.has(edge.id) && "is-on", edgeEntering(edge) && "pre")}
            style={{ left: path.label.x, top: path.label.y }}
          >
            {edgeLabelText(edge.label)}
          </div>
        ) : null))}
      </div>
      <div
        className="nodes"
        onPointerOver={hover}
        onFocus={hover}
        onPointerOut={(event) => {
          const left = event.target instanceof Element ? event.target.closest("[data-board-card-id]") : null;
          if (left && !(event.relatedTarget instanceof Node && left.contains(event.relatedTarget))) onHover(null);
        }}
      >
        {cards.map(({ card, rect }) => (
          <BoardNode
            key={card.id}
            card={card}
            rect={rect}
            ctx={ctx}
            selected={card.id === selectedId}
            related={related.has(card.id)}
            dragging={card.id === draggingId}
            entering={isEntering(card.id)}
            onHeight={onHeight}
          />
        ))}
        {emptyHintAt ? <p className="empty-hint" style={{ left: emptyHintAt.x, top: emptyHintAt.y }}>{t("productionBoard.emptyHint")}</p> : null}
      </div>
    </>
  );
});
