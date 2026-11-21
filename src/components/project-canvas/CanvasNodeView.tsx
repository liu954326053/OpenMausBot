// Adapted from basketikun/infinite-canvas@9cd3deac web/src/components/canvas/canvas-node.tsx, MIT License, Copyright (c) 2026 basketikun (full text in third_party/infinite-canvas/LICENSE)
import { createContext, memo, useContext, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { CanvasNode } from "../../../shared/project-canvas";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import type { HandleType, ResizeCorner } from "@/lib/project-canvas/geometry";
import { pageDirection, useCanvasUi } from "./canvas-ui";
import { NodeBody } from "./node-bodies";
import { nodeLabel } from "./node-kinds";
import { NodePanel } from "./NodePanel";

/** What the stage lends each node: the zoom, the connection being drawn, and where a node's pointer presses go. */
export interface StageHandlers {
  k: number;
  connecting: { nodeId: string; handle: HandleType } | null;
  connectionTarget: string | null;
  onNodePointerDown(event: ReactPointerEvent, node: CanvasNode): void;
  onHandlePointerDown(event: ReactPointerEvent, node: CanvasNode, handle: HandleType): void;
  onResizePointerDown(event: ReactPointerEvent, node: CanvasNode, corner: ResizeCorner): void;
}

export const StageHandlersContext = createContext<StageHandlers | null>(null);

const CORNERS: Array<{ corner: ResizeCorner; className: string }> = [
  { corner: "top-left", className: "-start-3.5 -top-3.5 cursor-nwse-resize" },
  { corner: "top-right", className: "-end-3.5 -top-3.5 cursor-nesw-resize" },
  { corner: "bottom-left", className: "-start-3.5 -bottom-3.5 cursor-nesw-resize" },
  { corner: "bottom-right", className: "-end-3.5 -bottom-3.5 cursor-nwse-resize" },
];

export interface CanvasNodeViewProps {
  node: CanvasNode;
  selected: boolean;
  related: boolean;
  panelOpen: boolean;
}

export const CanvasNodeView = memo(function CanvasNodeView({ node, selected, related, panelOpen }: CanvasNodeViewProps) {
  const ui = useCanvasUi();
  const stage = useContext(StageHandlersContext)!;
  const [hovered, setHovered] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);
  const isGroup = node.type === "group";
  const connectionTarget = stage.connectionTarget === node.id;
  const showChrome = selected || hovered || Boolean(stage.connecting);
  const label = nodeLabel(node);
  useEffect(() => {
    if (renaming) titleRef.current?.select();
  }, [renaming]);
  const finishRename = (save: boolean) => {
    const value = titleRef.current?.value.trim() ?? "";
    setRenaming(false);
    if (save && value !== node.title) ui.renameNode(node.id, value);
  };
  const canRename = !ui.readOnly && node.type !== "bot";
  return (
    <div
      data-canvas-node={node.id}
      data-node-type={node.type}
      role="group"
      aria-label={label}
      className={cn("absolute", isGroup ? "z-[5]" : panelOpen ? "z-[60]" : selected ? "z-50" : "z-10")}
      style={{ left: node.position.x, top: node.position.y, width: node.width, height: node.height }}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onPointerDownCapture={(event) => stage.onNodePointerDown(event, node)}
    >
      <div className={cn("absolute -top-7 start-1 flex h-6 max-w-full items-center", !(showChrome || renaming) && "invisible")}>
        {renaming ? (
          <input
            ref={titleRef}
            defaultValue={node.title}
            dir="auto"
            aria-label={t("projectCanvas.node.rename")}
            className="h-6 w-56 rounded-md border border-hairline bg-inset px-2 text-[12px] text-ink outline-none focus-visible:border-focus"
            onPointerDown={(event) => event.stopPropagation()}
            onBlur={() => finishRename(true)}
            onKeyDown={(event) => {
              if (event.key === "Enter") finishRename(true);
              if (event.key === "Escape") {
                event.stopPropagation();
                finishRename(false);
              }
            }}
          />
        ) : (
          <span
            dir="auto"
            className="truncate text-[12px] font-medium leading-4 text-ink-secondary"
            title={canRename ? t("projectCanvas.node.renameHint") : label}
            onDoubleClick={(event) => {
              event.stopPropagation();
              if (canRename) setRenaming(true);
            }}
          >
            {label}
          </span>
        )}
      </div>

      <div
        className={cn(
          "relative size-full overflow-hidden rounded-xl border transition-colors duration-150 motion-reduce:transition-none",
          isGroup ? "border-dashed bg-ink/[0.02]" : "bg-card",
          selected || connectionTarget ? "border-accent ring-1 ring-accent" : related ? "border-ink-tertiary" : isGroup ? "border-ink-tertiary" : "border-hairline",
        )}
      >
        <NodeBody node={node} />
      </div>

      {node.type !== "group" ? (
        <Handle node={node} handle="target" visible={showChrome} label={t("projectCanvas.node.input")} />
      ) : null}
      {node.type !== "config" && node.type !== "bot" ? (
        <Handle node={node} handle="source" visible={showChrome} label={t("projectCanvas.node.output")} />
      ) : null}

      {selected && !ui.readOnly
        ? CORNERS.map(({ corner, className }) => (
          <span
            key={corner}
            aria-hidden="true"
            data-resize-corner={corner}
            className={cn("absolute z-20 size-7", className)}
            onPointerDown={(event) => stage.onResizePointerDown(event, node, corner)}
          />
        ))
        : null}

      {panelOpen ? (
        <div className="pointer-events-none absolute inset-x-0 top-full z-[70] flex justify-center pt-4">
          <div
            data-node-panel=""
            data-canvas-no-zoom=""
            dir={pageDirection()}
            className="pointer-events-auto w-[600px] shrink-0"
            style={{ transform: `scale(${1 / stage.k})`, transformOrigin: "top center" }}
            onPointerDown={(event) => event.stopPropagation()}
            onDoubleClick={(event) => event.stopPropagation()}
          >
            <NodePanel node={node} />
          </div>
        </div>
      ) : null}
    </div>
  );
});

function Handle({ node, handle, visible, label }: { node: CanvasNode; handle: HandleType; visible: boolean; label: string }) {
  const ui = useCanvasUi();
  const stage = useContext(StageHandlersContext)!;
  if (ui.readOnly) return null;
  return (
    <span
      role="presentation"
      title={label}
      data-handle={handle}
      className={cn(
        "absolute top-1/2 z-20 flex size-12 -translate-y-1/2 items-center justify-center",
        handle === "target" ? "-start-6" : "-end-6",
        !visible && "pointer-events-none opacity-0",
      )}
      onPointerDown={(event) => stage.onHandlePointerDown(event, node, handle)}
    >
      <span className="size-3 rounded-full border-2 border-accent bg-card" />
    </span>
  );
}
