// Adapted from basketikun/infinite-canvas@9cd3deac web/src/pages/canvas/project.tsx (viewport and pointer handling), MIT License, Copyright (c) 2026 basketikun (full text in third_party/infinite-canvas/LICENSE)
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { LoaderCircle } from "lucide-react";
import { generationKindOf, type CanvasNode, type CanvasPoint, type CanvasViewport } from "../../../shared/project-canvas";
import { isReferenceNode } from "../../../shared/project-canvas-references";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { nextOutputFrame, takesResultInPlace } from "@/lib/project-canvas/generation";
import {
  connectionDropTarget,
  draftCurve,
  gridBackground,
  intersects,
  normalizeConnection,
  resizeFrame,
  screenToWorld,
  settleDraggedNodes,
  visibleBounds,
  zoomAtPoint,
  type CanvasSize,
  type HandleType,
  type ResizeCorner,
  type ResizeStart,
} from "@/lib/project-canvas/geometry";
import { diffCanvasOps } from "@/lib/project-canvas/ops";
import { clickSelection, dragNodeIds, nodesInRect, rectFromPoints } from "@/lib/project-canvas/selection";
import { relatedNodeIds, useCanvasUi, type CanvasTool } from "./canvas-ui";
import { CanvasConnections, ghostKey, type GhostFrame } from "./CanvasConnections";
import { CanvasNodeView, NodePanelLayer, StageHandlersContext, type StageHandlers } from "./CanvasNodeView";

const DRAG_THRESHOLD = 3;
const NOT_A_DRAG = "button, a, input, textarea, select, video, audio, [contenteditable='true'], [data-node-panel], [data-handle], [data-resize-corner]";

type Interaction =
  | { kind: "pan"; pointerId: number; start: CanvasPoint; origin: CanvasViewport }
  | { kind: "marquee"; pointerId: number; start: CanvasPoint; current: CanvasPoint; additive: boolean; base: string[]; moved: boolean }
  | { kind: "drag"; pointerId: number; start: CanvasPoint; ids: Set<string>; nodeId: string; moved: boolean; dx: number; dy: number }
  | { kind: "resize"; pointerId: number; start: CanvasPoint; nodeId: string; frame: ResizeStart; current: Pick<CanvasNode, "position" | "width" | "height"> | null }
  | { kind: "connect"; pointerId: number; nodeId: string; handle: HandleType; pointer: CanvasPoint; target: string | null; nearNode: boolean };

export interface StageMenuRequest {
  screen: CanvasPoint;
  world: CanvasPoint;
  nodeId?: string;
  connectFrom?: { nodeId: string; handle: HandleType };
}

export function CanvasStage({ tool, panning, onSize, onCreateMenu, onContextMenu }: {
  tool: CanvasTool;
  /** Space or the middle button is held: a press pans whatever the tool. */
  panning: boolean;
  onSize: (size: CanvasSize) => void;
  onCreateMenu: (request: StageMenuRequest) => void;
  onContextMenu: (request: StageMenuRequest) => void;
}) {
  const ui = useCanvasUi();
  const { snapshot, selection, readOnly } = ui;
  const viewport = ui.state.viewport;
  const rootRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<CanvasSize>({ width: 0, height: 0 });
  const [interaction, setInteraction] = useState<Interaction | null>(null);
  const interactionRef = useRef<Interaction | null>(null);
  const viewportRef = useRef(viewport);
  viewportRef.current = viewport;
  const frameRef = useRef<number | null>(null);

  const update = useCallback((next: Interaction | null) => {
    interactionRef.current = next;
    if (frameRef.current !== null) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      setInteraction(interactionRef.current);
    });
  }, []);
  const begin = (next: Interaction) => {
    interactionRef.current = next;
    setInteraction(next);
  };

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const observer = new ResizeObserver(([entry]) => {
      const next = { width: entry!.contentRect.width, height: entry!.contentRect.height };
      setSize(next);
      onSize(next);
    });
    observer.observe(root);
    return () => observer.disconnect();
  }, [onSize]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const onWheel = (event: WheelEvent) => {
      if ((event.target as Element | null)?.closest?.("[data-canvas-no-zoom]")) return;
      event.preventDefault();
      const rect = root.getBoundingClientRect();
      ui.controller.setViewport(zoomAtPoint(viewportRef.current, { x: event.clientX - rect.left, y: event.clientY - rect.top }, event.deltaY));
    };
    root.addEventListener("wheel", onWheel, { passive: false });
    return () => root.removeEventListener("wheel", onWheel);
  }, [ui.controller]);

  useEffect(() => () => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
  }, []);

  const local = (event: { clientX: number; clientY: number }): CanvasPoint => {
    const rect = rootRef.current!.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };
  const world = (event: { clientX: number; clientY: number }) => screenToWorld(viewportRef.current, local(event));
  const capture = (pointerId: number) => rootRef.current?.setPointerCapture?.(pointerId);

  const nodesById = useMemo(() => new Map(snapshot.nodes.map((node) => [node.id, node])), [snapshot.nodes]);

  const displayNodes = useMemo(() => {
    if (interaction?.kind === "drag" && interaction.moved) {
      return snapshot.nodes.map((node) => (interaction.ids.has(node.id) ? { ...node, position: { x: node.position.x + interaction.dx, y: node.position.y + interaction.dy } } : node));
    }
    if (interaction?.kind === "resize" && interaction.current) {
      const frame = interaction.current;
      return snapshot.nodes.map((node) => (node.id === interaction.nodeId ? { ...node, ...frame } : node));
    }
    return snapshot.nodes;
  }, [snapshot.nodes, interaction]);
  const displayById = useMemo(() => new Map(displayNodes.map((node) => [node.id, node])), [displayNodes]);

  const handlers: StageHandlers = {
    connecting: interaction?.kind === "connect" ? { nodeId: interaction.nodeId, handle: interaction.handle } : null,
    connectionTarget: interaction?.kind === "connect" ? interaction.target : null,
    onNodePointerDown(event, node) {
      if (event.button !== 0 || panning) return;
      if (ui.pickingFor && ui.pickingFor !== node.id) {
        event.stopPropagation();
        event.preventDefault();
        if (isReferenceNode(node, snapshot.nodes)) ui.connect(node.id, ui.pickingFor);
        else ui.showNotice(t("projectCanvas.reference.notReference"));
        return;
      }
      if ((event.target as Element).closest(NOT_A_DRAG)) {
        if (!selection.has(node.id)) ui.select([node.id]);
        return;
      }
      event.stopPropagation();
      const next = clickSelection(selection, node.id, event.shiftKey || event.metaKey || event.ctrlKey);
      ui.select(next);
      ui.selectConnection(null);
      begin({ kind: "drag", pointerId: event.pointerId, start: local(event), ids: readOnly ? new Set() : dragNodeIds(next, snapshot.nodes), nodeId: node.id, moved: false, dx: 0, dy: 0 });
    },
    onHandlePointerDown(event, node, handle) {
      if (event.button !== 0 || readOnly) return;
      event.stopPropagation();
      event.preventDefault();
      capture(event.pointerId);
      begin({ kind: "connect", pointerId: event.pointerId, nodeId: node.id, handle, pointer: world(event), target: null, nearNode: false });
    },
    onResizePointerDown(event, node, corner: ResizeCorner) {
      if (event.button !== 0 || readOnly) return;
      event.stopPropagation();
      event.preventDefault();
      capture(event.pointerId);
      const keepsRatio = (node.type === "image" && node.metadata?.file) || node.type === "video";
      begin({ kind: "resize", pointerId: event.pointerId, start: local(event), nodeId: node.id, frame: { corner, left: node.position.x, top: node.position.y, width: node.width, height: node.height, ratio: keepsRatio ? node.width / node.height : null }, current: null });
    },
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    const onSomething = Boolean((event.target as Element).closest("[data-canvas-node], [data-node-panel], button, input, textarea"));
    if (event.button === 2) return;
    if (event.button === 1 || panning || (tool === "pan" && !onSomething)) {
      // A middle press starts the browser's autoscroll on Windows and Linux; a left one must still move the focus, so
      // the text being written in a node is saved.
      if (event.button === 1) event.preventDefault();
      capture(event.pointerId);
      begin({ kind: "pan", pointerId: event.pointerId, start: local(event), origin: viewportRef.current });
      return;
    }
    if (event.button !== 0 || onSomething) return;
    const start = world(event);
    capture(event.pointerId);
    const additive = event.shiftKey;
    begin({ kind: "marquee", pointerId: event.pointerId, start, current: start, additive, base: additive ? [...selection] : [], moved: false });
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const current = interactionRef.current;
    if (!current || current.pointerId !== event.pointerId) return;
    if (current.kind === "pan") {
      const point = local(event);
      ui.controller.setViewport({ ...current.origin, x: current.origin.x + point.x - current.start.x, y: current.origin.y + point.y - current.start.y });
      return;
    }
    if (current.kind === "marquee") {
      const point = world(event);
      const rect = rectFromPoints(current.start, point);
      const moved = current.moved || Math.hypot(point.x - current.start.x, point.y - current.start.y) * viewportRef.current.k > DRAG_THRESHOLD;
      if (moved) ui.select(new Set([...current.base, ...nodesInRect(snapshot.nodes, rect)]));
      update({ ...current, current: point, moved });
      return;
    }
    if (current.kind === "drag") {
      const point = local(event);
      const dx = point.x - current.start.x;
      const dy = point.y - current.start.y;
      const moved = current.moved || Math.hypot(dx, dy) > DRAG_THRESHOLD;
      // Chrome sends click and dblclick to the element holding the pointer, so a node's press takes it only once it drags.
      if (moved && !current.moved) capture(event.pointerId);
      update(current.ids.size ? { ...current, moved, dx: dx / viewportRef.current.k, dy: dy / viewportRef.current.k } : { ...current, moved });
      return;
    }
    if (current.kind === "resize") {
      const point = local(event);
      const frame = resizeFrame(current.frame, (point.x - current.start.x) / viewportRef.current.k, (point.y - current.start.y) / viewportRef.current.k);
      update({ ...current, current: frame });
      return;
    }
    const from = nodesById.get(current.nodeId);
    if (!from) return;
    const point = world(event);
    const drop = connectionDropTarget(snapshot.nodes, from, current.handle, point, viewportRef.current.k);
    const valid = drop.nodeId && normalizeConnection(from, nodesById.get(drop.nodeId), current.handle) ? drop.nodeId : null;
    update({ ...current, pointer: point, target: valid, nearNode: drop.nearNode });
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const current = interactionRef.current;
    if (!current || current.pointerId !== event.pointerId) return;
    interactionRef.current = null;
    setInteraction(null);
    rootRef.current?.releasePointerCapture?.(event.pointerId);
    const stayed = current.kind === "pan" && Math.hypot(local(event).x - current.start.x, local(event).y - current.start.y) <= DRAG_THRESHOLD;
    if ((current.kind === "marquee" && !current.moved) || stayed) {
      ui.select([]);
      ui.selectConnection(null);
      ui.openPanel(null);
      ui.startPicking(null);
    }
    if (current.kind === "drag") {
      const node = nodesById.get(current.nodeId);
      if (current.moved && current.ids.size) {
        const moved = snapshot.nodes.map((candidate) => (current.ids.has(candidate.id) ? { ...candidate, position: { x: candidate.position.x + current.dx, y: candidate.position.y + current.dy } } : candidate));
        const settled = settleDraggedNodes(current.ids, moved);
        ui.controller.apply(diffCanvasOps(snapshot, { ...snapshot, nodes: settled }));
      } else if (!current.moved && node && node.type !== "group" && !event.shiftKey && !event.metaKey && !event.ctrlKey) {
        ui.openPanel(node.id);
      }
    }
    if (current.kind === "resize" && current.current) {
      ui.controller.apply([{ type: "update_node", id: current.nodeId, patch: current.current }]);
    }
    if (current.kind === "connect") {
      const from = nodesById.get(current.nodeId);
      if (current.target) {
        const link = normalizeConnection(from, nodesById.get(current.target), current.handle);
        if (link) ui.connect(link.fromNodeId, link.toNodeId);
      } else if (!current.nearNode && from) {
        onCreateMenu({ screen: local(event), world: current.pointer, connectFrom: { nodeId: from.id, handle: current.handle } });
      }
    }
  };

  const bounds = visibleBounds(viewport, size);
  const shownNodes = displayNodes.filter((node) => intersects(node, bounds) || selection.has(node.id));
  const panelNode = ui.panelNodeId ? displayById.get(ui.panelNodeId) : undefined;
  const related = relatedNodeIds(selection, snapshot.connections);
  const activeConnections = new Set(snapshot.connections.filter((connection) => selection.has(connection.fromNodeId) || selection.has(connection.toNodeId)).map((connection) => connection.id));
  const ghosts: GhostFrame[] = [
    ...displayNodes.flatMap((node) => {
      const kind = generationKindOf(node);
      if (!kind || node.metadata?.status !== "loading" || takesResultInPlace(node)) return [];
      return [{ sourceId: node.id, frame: nextOutputFrame(node, kind, displayNodes, snapshot.connections, ui.state.replies), label: t("projectCanvas.node.generating") }];
    }),
    ...ui.state.replies.map((reply) => ({ sourceId: reply.nodeId, frame: reply, label: t("projectCanvas.text.writing", { name: snapshot.bots[reply.botId]?.name ?? "" }), replyNodeId: reply.id })),
  ];
  let draft: string | null = null;
  if (interaction?.kind === "connect") {
    const from = displayById.get(interaction.nodeId);
    if (from) draft = draftCurve(from, interaction.handle, interaction.pointer, interaction.target ? displayById.get(interaction.target) : undefined);
  }
  const grid = gridBackground(viewport);
  const background: CSSProperties = snapshot.backgroundMode === "blank"
    ? {}
    : snapshot.backgroundMode === "dots"
      ? { backgroundImage: `radial-gradient(circle, color-mix(in srgb, var(--color-ink) 22%, transparent) ${grid.dot}px, transparent ${grid.dot + 0.5}px)`, backgroundSize: `${grid.size}px ${grid.size}px`, backgroundPosition: `${grid.x}px ${grid.y}px` }
      : {
        backgroundImage: "linear-gradient(to right, color-mix(in srgb, var(--color-ink) 10%, transparent) 1px, transparent 1px), linear-gradient(to bottom, color-mix(in srgb, var(--color-ink) 10%, transparent) 1px, transparent 1px)",
        backgroundSize: `${grid.size}px ${grid.size}px`,
        backgroundPosition: `${grid.x}px ${grid.y}px`,
      };
  const marquee = interaction?.kind === "marquee" && interaction.moved ? rectFromPoints(interaction.start, interaction.current) : null;
  const cursor = interaction?.kind === "pan" ? "grabbing" : panning || tool === "pan" ? "grab" : ui.pickingFor ? "copy" : undefined;

  return (
    <StageHandlersContext.Provider value={handlers}>
      <div
        ref={rootRef}
        dir="ltr"
        data-project-canvas-stage=""
        className="absolute inset-0 touch-none select-none overflow-hidden bg-app outline-none"
        style={{ ...background, cursor }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={(event) => {
          if ((event.target as Element).closest("[data-canvas-node], [data-node-panel]") || readOnly) return;
          onCreateMenu({ screen: local(event), world: world(event) });
        }}
        onContextMenu={(event) => {
          if ((event.target as Element).closest("[data-node-panel], input, textarea")) return;
          event.preventDefault();
          const nodeId = (event.target as Element).closest("[data-canvas-node]")?.getAttribute("data-canvas-node") ?? undefined;
          if (nodeId && !selection.has(nodeId)) ui.select([nodeId]);
          onContextMenu({ screen: local(event), world: world(event), nodeId });
        }}
        onDragOver={(event) => {
          if (!readOnly && event.dataTransfer.types.includes("Files")) event.preventDefault();
        }}
        onDrop={(event) => {
          if (readOnly || !event.dataTransfer.files.length) return;
          event.preventDefault();
          ui.uploadFiles([...event.dataTransfer.files], world(event));
        }}
      >
        <div className="absolute start-0 top-0 origin-top-left" style={{ transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.k})` }}>
          <CanvasConnections
            nodes={displayById}
            connections={snapshot.connections}
            bounds={bounds}
            selectedId={ui.selectedConnectionId}
            active={activeConnections}
            draft={draft}
            ghosts={ghosts}
            k={viewport.k}
            readOnly={readOnly}
            onSelect={(id) => {
              ui.selectConnection(id);
              ui.select([]);
            }}
            onDelete={(id) => {
              ui.controller.apply([{ type: "delete_connections", id }]);
              ui.selectConnection(null);
            }}
          />
          {shownNodes.map((node) => (
            <CanvasNodeView key={node.id} node={node} selected={selection.has(node.id)} related={related.has(node.id)} />
          ))}
          {ghosts.map((ghost) => (
            <div
              key={`ghost:${ghostKey(ghost)}`}
              role="status"
              data-generation-ghost={ghost.replyNodeId ? undefined : ghost.sourceId}
              data-reply-placeholder={ghost.replyNodeId}
              className="absolute z-10 flex items-center justify-center gap-2 rounded-xl border border-dashed border-ink-tertiary text-[12px] text-ink-secondary"
              style={{ left: ghost.frame.position.x, top: ghost.frame.position.y, width: ghost.frame.width, height: ghost.frame.height }}
            >
              <LoaderCircle size={16} aria-hidden="true" className="animate-spin motion-reduce:animate-none" />
              {ghost.label}
            </div>
          ))}
        </div>
        {marquee ? (
          <div
            aria-hidden="true"
            className={cn("pointer-events-none absolute rounded-md border border-accent bg-accent/10")}
            style={{ left: marquee.x * viewport.k + viewport.x, top: marquee.y * viewport.k + viewport.y, width: marquee.width * viewport.k, height: marquee.height * viewport.k }}
          />
        ) : null}
        {panelNode && size.width > 0 ? (
          <NodePanelLayer
            key={panelNode.id}
            node={panelNode}
            viewport={viewport}
            size={size}
            hidden={Boolean(interaction) || !intersects(panelNode, visibleBounds(viewport, size, 0))}
            onPointerDownCapture={(event) => handlers.onNodePointerDown(event, panelNode)}
          />
        ) : null}
      </div>
    </StageHandlersContext.Provider>
  );
}
