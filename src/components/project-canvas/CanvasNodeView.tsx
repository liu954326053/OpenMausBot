// Adapted from basketikun/infinite-canvas@9cd3deac web/src/components/canvas/canvas-node.tsx, MIT License, Copyright (c) 2026 basketikun (full text in third_party/infinite-canvas/LICENSE)
import { createContext, memo, useContext, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Check } from "lucide-react";
import type { CanvasNode, CanvasViewport } from "../../../shared/project-canvas";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { canvasErrorText } from "@/lib/project-canvas/backend";
import { panelPlacement, type CanvasSize, type HandleType, type ResizeCorner } from "@/lib/project-canvas/geometry";
import { pageDirection, useCanvasUi } from "./canvas-ui";
import { NodeBody } from "./node-bodies";
import { nodeLabel, pipelineLabel } from "./node-kinds";
import { NodePanel } from "./NodePanel";

/** What the stage lends each node: the connection being drawn, and where a node's pointer presses go. */
export interface StageHandlers {
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
}

export const CanvasNodeView = memo(function CanvasNodeView({ node, selected, related }: CanvasNodeViewProps) {
  const ui = useCanvasUi();
  const stage = useContext(StageHandlersContext)!;
  const [hovered, setHovered] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);
  const isGroup = node.type === "group";
  const connectionTarget = stage.connectionTarget === node.id;
  const showChrome = selected || hovered || Boolean(stage.connecting);
  const label = nodeLabel(node);
  const kind = pipelineLabel(node, ui.snapshot);
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
      className={cn("absolute", isGroup ? "z-[5]" : selected ? "z-50" : "z-10")}
      style={{ left: node.position.x, top: node.position.y, width: node.width, height: node.height }}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onPointerDownCapture={(event) => stage.onNodePointerDown(event, node)}
    >
      <div className="absolute inset-x-1 -top-7 flex h-6 items-center gap-2">
        {kind ? <span data-node-kind="" className="max-w-[60%] shrink-0 truncate text-[12px] leading-4 text-ink-tertiary" title={kind}>{kind}</span> : null}
        <div className={cn("flex min-w-0 flex-1 items-center", !(showChrome || renaming) && "invisible")}>
          {renaming ? (
            <input
              ref={titleRef}
              defaultValue={node.title}
              dir="auto"
              aria-label={t("projectCanvas.node.rename")}
              className="h-6 w-56 max-w-full rounded-md border border-hairline bg-inset px-2 text-[12px] text-ink outline-none focus-visible:border-focus"
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
        <NodeMarks node={node} />
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
    </div>
  );
});

/** What the pipeline says of a node, at the end of the row above it: that something it was made from changed, and for a
 * take whether it is the one its shot uses, with the way to make it that one. */
function NodeMarks({ node }: { node: CanvasNode }) {
  const ui = useCanvasUi();
  const [choosing, setChoosing] = useState(false);
  const { role, selected, stale, file } = node.metadata ?? {};
  const choose = async () => {
    setChoosing(true);
    try {
      await ui.controller.selectTake(node.id);
    } catch (error) {
      ui.showNotice(t("projectCanvas.take.selectFailed", { reason: canvasErrorText(error) }));
    } finally {
      setChoosing(false);
    }
  };
  return (
    <>
      {stale ? (
        <span data-node-stale="" title={t("projectCanvas.staleHint")} className="inline-flex shrink-0 items-center gap-1.5 text-[12px] leading-4 text-ink-secondary">
          <span aria-hidden="true" className="size-1.5 rounded-full bg-warning" />
          {t("projectCanvas.stale")}
        </span>
      ) : null}
      {role === "take" && selected ? (
        <span data-take-selected="" className="inline-flex shrink-0 items-center gap-1 text-[12px] font-medium leading-4 text-accent-text">
          <Check size={14} aria-hidden="true" />
          {t("projectCanvas.take.selected")}
        </span>
      ) : null}
      {role === "take" && !selected && file && !ui.readOnly ? (
        <button type="button" className="ui-button ui-button-sm shrink-0" disabled={choosing} onClick={() => void choose()}>{t("projectCanvas.take.select")}</button>
      ) : null}
    </>
  );
}

/** The open node's panel, on the screen over the canvas and its docks and wholly inside the canvas. Hidden while the
 * canvas is panned, something on it is dragged or its node is out of view, and kept as it was. */
export function NodePanelLayer({ node, viewport, size, hidden, onPointerDownCapture }: {
  node: CanvasNode;
  viewport: CanvasViewport;
  size: CanvasSize;
  hidden: boolean;
  onPointerDownCapture: (event: ReactPointerEvent) => void;
}) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(0);
  useLayoutEffect(() => {
    const content = contentRef.current!;
    const measure = () => setHeight(content.offsetHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(content);
    return () => observer.disconnect();
  }, []);
  const place = panelPlacement(node, viewport, height, size);
  return (
    <div
      data-node-panel=""
      data-canvas-no-zoom=""
      dir={pageDirection()}
      className={cn("absolute z-[81]", height > place.maxHeight && "overflow-y-auto", hidden && "invisible")}
      style={{ left: place.left, top: place.top, width: place.width, maxHeight: place.maxHeight }}
      onPointerDownCapture={onPointerDownCapture}
      onPointerDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      <div ref={contentRef}>
        <NodePanel node={node} />
      </div>
    </div>
  );
}

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
