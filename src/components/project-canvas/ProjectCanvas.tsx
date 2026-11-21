// Adapted from basketikun/infinite-canvas@9cd3deac web/src/pages/canvas/project.tsx, MIT License, Copyright (c) 2026 basketikun (full text in third_party/infinite-canvas/LICENSE)
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AlertCircle, Archive, FolderX, List, LoaderCircle, Network, Settings, X } from "lucide-react";
import {
  botNodeId,
  CANVAS_NODE_SIZE,
  canvasFileNodeType,
  type CanvasNode,
  type CanvasNodeMetadata,
  type CanvasOp,
  type CanvasPoint,
  type CanvasViewport,
} from "../../../shared/project-canvas";
import { useCaptionChrome, WindowDragStrip } from "@/components/DesktopCapabilities";
import { useModalDialog } from "@/hooks/use-modal-dialog";
import { t } from "@/lib/i18n";
import type { CanvasBackend } from "@/lib/project-canvas/backend";
import { CanvasController, type CanvasState } from "@/lib/project-canvas/controller";
import {
  applyGroupSelection,
  applyUngroupSelection,
  canGroupSelection,
  canUngroupSelection,
  collectGroupMemberNodes,
  focusViewportForNode,
  groupWrapRect,
  nodeBounds,
  normalizeConnection,
  screenToWorld,
  zoomAroundCenter,
  type CanvasSize,
} from "@/lib/project-canvas/geometry";
import { addNodeOp, diffCanvasOps } from "@/lib/project-canvas/ops";
import { copySelection, duplicateNode, isContentNode, pasteClipboard, type CanvasClipboard } from "@/lib/project-canvas/selection";
import { randomUuid } from "@/lib/random-uuid";
import { CanvasUiContext, nodeById, type CanvasTool, type CanvasUi, type CreatableNodeType } from "./canvas-ui";
import { CanvasStage, type StageMenuRequest } from "./CanvasStage";
import { CanvasToolbar, Minimap, ZoomDock } from "./docks";
import { CanvasContextMenu, CreateMenu, NodeContextMenu } from "./menus";
import { NodeList } from "./NodeList";
import { ProjectSettingsDialog } from "./ProjectSettingsDialog";
import { useCanvasShortcuts } from "./use-canvas-shortcuts";

export interface ProjectCanvasProps {
  projectId: string;
  selectedBotId?: string;
  backend: CanvasBackend;
  /** Shown in the top bar, such as the notice that the project's team changed. */
  topBarSlot?: ReactNode;
}

const NOTICE_MS = 4000;
const PANEL_ROOM_BELOW = 360;

export function ProjectCanvas({ projectId, selectedBotId, backend, topBarSlot }: ProjectCanvasProps) {
  const [attempt, setAttempt] = useState(0);
  const [controller, setController] = useState<CanvasController | null>(null);
  useEffect(() => {
    const next = new CanvasController(backend, projectId);
    setController(next);
    void next.start();
    return () => next.dispose();
  }, [backend, projectId, attempt]);
  if (!controller) return <CanvasMessage busy />;
  return <CanvasLoaded key={`${projectId}:${attempt}`} controller={controller} selectedBotId={selectedBotId} topBarSlot={topBarSlot} onRetry={() => setAttempt((count) => count + 1)} />;
}

function CanvasMessage({ busy, error, onRetry }: { busy?: boolean; error?: string; onRetry?: () => void }) {
  return (
    <div className="relative flex h-full flex-col items-center justify-center gap-3 bg-app p-6 text-center">
      <WindowDragStrip />
      {busy ? <LoaderCircle size={16} aria-label={t("projectCanvas.loading")} className="animate-spin text-ink-tertiary motion-reduce:animate-none" /> : null}
      {error ? (
        <>
          <AlertCircle size={16} aria-hidden="true" className="text-danger" />
          <p role="alert" className="max-w-sm text-[13px] leading-[18px] text-ink-secondary">{t("projectCanvas.loadFailed", { reason: error })}</p>
          <button type="button" className="ui-button ui-button-md" onClick={onRetry}>{t("projectCanvas.retryLoad")}</button>
        </>
      ) : null}
    </div>
  );
}

function CanvasLoaded({ controller, selectedBotId, topBarSlot, onRetry }: { controller: CanvasController; selectedBotId?: string; topBarSlot?: ReactNode; onRetry: () => void }) {
  const state = useSyncExternalStore(controller.subscribe, controller.getState);
  if (state.phase === "failed") return <CanvasMessage error={state.loadError} onRetry={onRetry} />;
  if (state.phase === "loading" || !state.snapshot) return <CanvasMessage busy />;
  return <CanvasWorkspace controller={controller} state={state} selectedBotId={selectedBotId} topBarSlot={topBarSlot} />;
}

type OpenMenu =
  | { kind: "create"; request: StageMenuRequest }
  | { kind: "node"; request: StageMenuRequest }
  | { kind: "canvas"; request: StageMenuRequest };

function CanvasWorkspace({ controller, state, selectedBotId, topBarSlot }: { controller: CanvasController; state: CanvasState; selectedBotId?: string; topBarSlot?: ReactNode }) {
  const snapshot = state.snapshot!;
  const readOnly = Boolean(snapshot.readOnly);
  const { dragProps } = useCaptionChrome();
  const [selection, setSelection] = useState<ReadonlySet<string>>(() => new Set());
  const [selectedConnectionId, setSelectedConnectionId] = useState<string | null>(null);
  const [panelNodeId, setPanelNodeId] = useState<string | null>(null);
  const [pickingFor, setPickingFor] = useState<string | null>(null);
  const [tool, setTool] = useState<CanvasTool>("pan");
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [menu, setMenu] = useState<OpenMenu | null>(null);
  const [minimapOpen, setMinimapOpen] = useState(true);
  const [listOpen, setListOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [preview, setPreview] = useState<{ url: string; title: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [size, setSize] = useState<CanvasSize>({ width: 0, height: 0 });
  const drafts = useRef(new Map<string, string>()).current;
  const clipboard = useRef<CanvasClipboard | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const uploadAt = useRef<CanvasPoint | undefined>(undefined);
  const viewport = state.viewport;
  const sizeRef = useRef(size);
  sizeRef.current = size;

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), NOTICE_MS);
    return () => clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    if (state.writeError) {
      setNotice(t("projectCanvas.saveFailed", { reason: state.writeError }));
      controller.dismissWriteError();
    }
  }, [state.writeError, controller]);

  const center = useCallback((): CanvasPoint => screenToWorld(controller.getState().viewport, { x: sizeRef.current.width / 2, y: sizeRef.current.height / 2 }), [controller]);

  const focusFrame = useCallback((frame: Pick<CanvasNode, "position" | "width" | "height">, withPanel: boolean) => {
    if (!sizeRef.current.width) return;
    controller.setViewport(focusViewportForNode(frame, sizeRef.current, { above: 28, below: withPanel ? PANEL_ROOM_BELOW : 0, bottomInset: 72 }));
  }, [controller]);

  const focusedBot = useRef<string | null>(null);
  useEffect(() => {
    if (!selectedBotId || !size.width || focusedBot.current === selectedBotId) return;
    const node = nodeById(snapshot, botNodeId(selectedBotId));
    if (!node) return;
    focusedBot.current = selectedBotId;
    setSelection(new Set([node.id]));
    focusFrame(node, false);
  }, [selectedBotId, size.width, snapshot, focusFrame]);

  const apply = useCallback((ops: CanvasOp[]) => controller.apply(ops), [controller]);

  const deleteNodes = useCallback((ids: Iterable<string>) => {
    const doomed = [...ids].filter((id) => {
      const node = nodeById(snapshot, id);
      return node && isContentNode(node);
    });
    if (!doomed.length) return;
    apply([{ type: "delete_node", ids: doomed }]);
    setSelection((current) => new Set([...current].filter((id) => !doomed.includes(id))));
    if (panelNodeId && doomed.includes(panelNodeId)) setPanelNodeId(null);
  }, [apply, snapshot, panelNodeId]);

  const connect = useCallback((fromNodeId: string, toNodeId: string) => {
    if (snapshot.connections.some((connection) => connection.fromNodeId === fromNodeId && connection.toNodeId === toNodeId)) return;
    if (!normalizeConnection(nodeById(snapshot, fromNodeId), nodeById(snapshot, toNodeId), "source")) return;
    apply([{ type: "connect_nodes", id: randomUuid(), fromNodeId, toNodeId }]);
  }, [apply, snapshot]);

  const createNode = useCallback((type: CreatableNodeType, at?: CanvasPoint, connectFrom?: string | { nodeId: string; handle: "source" | "target" }): string | null => {
    if (readOnly) return null;
    const nodeSize = CANVAS_NODE_SIZE[type];
    const middle = at ?? center();
    const id = randomUuid();
    const metadata: CanvasNodeMetadata | undefined = type === "config" ? { generationMode: "image" } : undefined;
    const node: CanvasNode = { id, type, title: "", position: { x: middle.x - nodeSize.width / 2, y: middle.y - nodeSize.height / 2 }, ...nodeSize, ...(metadata ? { metadata } : {}) };
    const ops: CanvasOp[] = [addNodeOp(node)];
    const from = typeof connectFrom === "string" ? { nodeId: connectFrom, handle: "source" as const } : connectFrom;
    const link = from ? normalizeConnection(nodeById(snapshot, from.nodeId), node, from.handle) : null;
    if (link) ops.push({ type: "connect_nodes", id: randomUuid(), ...link });
    apply(ops);
    setSelection(new Set([id]));
    setSelectedConnectionId(null);
    if (type !== "group") setPanelNodeId(id);
    return id;
  }, [apply, center, readOnly, snapshot]);

  const uploadFiles = useCallback((files: readonly File[], at?: CanvasPoint) => {
    if (readOnly || !files.length) return;
    const base = at ?? center();
    void (async () => {
      for (const [index, file] of files.entries()) {
        const nodeSize = CANVAS_NODE_SIZE[canvasFileNodeType(file.type || "application/octet-stream")];
        const spot = { x: base.x - nodeSize.width / 2 + index * 32, y: base.y - nodeSize.height / 2 + index * 32 };
        try {
          const { nodeId } = await controller.upload(file, spot);
          setSelection(new Set([nodeId]));
        } catch (error) {
          setNotice(t("projectCanvas.uploadFailed", { name: file.name, reason: error instanceof Error ? error.message : String(error) }));
        }
      }
    })();
  }, [center, controller, readOnly]);

  const pasteNodes = useCallback((source: CanvasClipboard, at?: CanvasPoint) => {
    const pasted = pasteClipboard(source, { center: at ?? center(), newId: randomUuid, copyTitle: (title) => (title ? t("projectCanvas.node.copyTitle", { title }) : "") });
    const groupsFirst = [...pasted.nodes].sort((a, b) => Number(b.type === "group") - Number(a.type === "group"));
    apply([...groupsFirst.map(addNodeOp), ...pasted.connections.map((connection): CanvasOp => ({ type: "connect_nodes", id: connection.id, fromNodeId: connection.fromNodeId, toNodeId: connection.toNodeId }))]);
    setSelection(new Set(pasted.nodes.map((node) => node.id)));
    setPanelNodeId(null);
  }, [apply, center]);

  const group = useCallback(() => {
    if (readOnly || !canGroupSelection(selection, snapshot.nodes)) return;
    const rect = groupWrapRect(collectGroupMemberNodes(selection, snapshot.nodes));
    const groupNode: CanvasNode = { id: randomUuid(), type: "group", title: "", position: { x: rect.x, y: rect.y }, width: rect.width, height: rect.height };
    const result = applyGroupSelection(selection, snapshot.nodes, groupNode);
    if (!result) return;
    apply(diffCanvasOps(snapshot, { ...snapshot, nodes: result.nodes }));
    setSelection(new Set(result.selectedIds));
    setPanelNodeId(null);
  }, [apply, readOnly, selection, snapshot]);

  const ungroup = useCallback(() => {
    if (readOnly || !canUngroupSelection(selection, snapshot.nodes)) return;
    const result = applyUngroupSelection(selection, snapshot.nodes);
    if (!result) return;
    apply(diffCanvasOps(snapshot, { ...snapshot, nodes: result.nodes }));
    setSelection(new Set(result.selectedIds));
  }, [apply, readOnly, selection, snapshot]);

  const duplicate = useCallback(() => {
    const only = selection.size === 1 ? nodeById(snapshot, [...selection][0]!) : undefined;
    if (readOnly || !only || !isContentNode(only) || only.type === "group") return;
    const copy = duplicateNode(only, snapshot.connections, { newId: randomUuid, copyTitle: (title) => (title ? t("projectCanvas.node.copyTitle", { title }) : "") });
    apply([...copy.nodes.map(addNodeOp), ...copy.connections.map((connection): CanvasOp => ({ type: "connect_nodes", id: connection.id, fromNodeId: connection.fromNodeId, toNodeId: connection.toNodeId }))]);
    setSelection(new Set(copy.nodes.map((node) => node.id)));
  }, [apply, readOnly, selection, snapshot]);

  const copy = useCallback(() => {
    const copied = copySelection(selection, snapshot.nodes, snapshot.connections);
    if (!copied) return false;
    clipboard.current = copied;
    setNotice(t("projectCanvas.copied", { count: copied.nodes.length }));
    return true;
  }, [selection, snapshot]);

  const removeSelection = useCallback(() => {
    if (readOnly) return;
    const connection = snapshot.connections.find((candidate) => candidate.id === selectedConnectionId);
    if (connection?.kind === "content") {
      apply([{ type: "delete_connections", id: connection.id }]);
      setSelectedConnectionId(null);
      return;
    }
    deleteNodes(selection);
  }, [apply, deleteNodes, readOnly, selection, selectedConnectionId, snapshot.connections]);

  const clearCanvas = useCallback(() => {
    const ids = snapshot.nodes.filter(isContentNode).map((node) => node.id);
    if (!ids.length || readOnly) return;
    apply([{ type: "delete_node", ids }]);
    setSelection(new Set());
    setPanelNodeId(null);
    setNotice(t("projectCanvas.cleared"));
  }, [apply, readOnly, snapshot.nodes]);

  const fitAll = useCallback(() => {
    if (!snapshot.nodes.length) return;
    const bounds = nodeBounds(snapshot.nodes);
    focusFrame({ position: { x: bounds.left, y: bounds.top }, width: bounds.right - bounds.left, height: bounds.bottom - bounds.top }, false);
  }, [focusFrame, snapshot.nodes]);

  const resetView = useCallback(() => controller.setViewport({ x: sizeRef.current.width / 2, y: sizeRef.current.height / 2, k: 1 }), [controller]);

  useEffect(() => {
    if (!pickingFor) return;
    const stopPicking = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      setPickingFor(null);
    };
    window.addEventListener("keydown", stopPicking, true);
    return () => window.removeEventListener("keydown", stopPicking, true);
  }, [pickingFor]);

  const escape = useCallback(() => {
    if (menu) return setMenu(null);
    if (panelNodeId) return setPanelNodeId(null);
    setSelection(new Set());
    setSelectedConnectionId(null);
  }, [menu, panelNodeId]);

  useCanvasShortcuts(!settingsOpen && !preview, {
    undo: () => controller.undo(),
    redo: () => controller.redo(),
    selectAll: () => setSelection(new Set(snapshot.nodes.map((node) => node.id))),
    copy,
    duplicate,
    group,
    ungroup,
    remove: removeSelection,
    escape,
    tool: setTool,
    panning: setSpaceHeld,
    pasteCopy: () => {
      if (readOnly || !clipboard.current) return false;
      pasteNodes(clipboard.current);
      return true;
    },
    paste: (event) => {
      if (readOnly) return;
      const files = [...(event.clipboardData?.files ?? [])];
      if (files.length) {
        event.preventDefault();
        uploadFiles(files);
        return;
      }
      const text = event.clipboardData?.getData("text/plain")?.trim();
      if (!text) return;
      event.preventDefault();
      const id = createNode("text");
      if (id) apply([{ type: "update_node", id, metadata: { content: text } }]);
    },
  });

  const ui = useMemo<CanvasUi>(() => ({
    controller,
    state,
    snapshot,
    readOnly,
    selection,
    selectedConnectionId,
    panelNodeId,
    pickingFor,
    drafts,
    select: (ids) => setSelection(new Set(ids)),
    selectConnection: setSelectedConnectionId,
    openPanel: (nodeId) => {
      setPanelNodeId(nodeId);
      if (nodeId !== pickingFor) setPickingFor(null);
    },
    createNode: (type, at, connectFrom) => createNode(type, at, connectFrom),
    renameNode: (nodeId, title) => apply([{ type: "update_node", id: nodeId, patch: { title } }]),
    updateMetadata: (nodeId, metadata) => apply([{ type: "update_node", id: nodeId, metadata }]),
    connect,
    removeReference: (nodeId, sourceNodeId) => {
      const ids = snapshot.connections.filter((connection) => connection.kind === "content" && connection.fromNodeId === sourceNodeId && connection.toNodeId === nodeId).map((connection) => connection.id);
      if (ids.length) apply([{ type: "delete_connections", ids }]);
    },
    deleteNodes,
    startPicking: setPickingFor,
    focusNode: (nodeId) => {
      const node = nodeById(snapshot, nodeId);
      if (!node) return;
      setSelection(new Set([nodeId]));
      focusFrame(node, false);
    },
    previewImage: (url, title) => setPreview({ url, title }),
    uploadFiles,
    showNotice: setNotice,
    openSettings: () => setSettingsOpen(true),
  }), [apply, connect, controller, createNode, deleteNodes, drafts, focusFrame, panelNodeId, pickingFor, readOnly, selectedConnectionId, selection, snapshot, state, uploadFiles]);

  const openUpload = (at?: CanvasPoint) => {
    uploadAt.current = at;
    fileInput.current?.click();
  };
  const menuNode = menu?.kind === "node" && menu.request.nodeId ? nodeById(snapshot, menu.request.nodeId) : undefined;
  const panelTypes = new Set<CanvasNode["type"]>(["bot", "shot", "text", "image", "video", "config"]);

  return (
    <CanvasUiContext.Provider value={ui}>
      <div className="flex h-full min-h-0 flex-col bg-app text-ink" data-project-canvas="">
        <header {...dragProps} className="flex h-12 shrink-0 items-center gap-2 border-b border-edge px-4 max-md:ps-12">
          <h1 className="min-w-0 truncate text-[17px] font-semibold leading-6" title={snapshot.project.name}>{snapshot.project.name}</h1>
          {readOnly ? (
            <span className="ui-chip gap-1"><Archive size={14} aria-hidden="true" />{t("projectCanvas.archived")}</span>
          ) : null}
          {snapshot.project.folderState === "missing" ? (
            <span className="ui-chip gap-1 text-warning" title={t("projectCanvas.folderMissingHint")}><FolderX size={14} aria-hidden="true" />{t("projectCanvas.folderMissing")}</span>
          ) : null}
          <div className="flex min-w-0 flex-1 items-center gap-2" data-project-canvas-slot="">{topBarSlot}</div>
          <button type="button" className="ui-icon-button" aria-pressed={listOpen} aria-label={t("projectCanvas.nodeList.title")} title={t("projectCanvas.nodeList.title")} onClick={() => setListOpen((open) => !open)}>
            <List size={16} aria-hidden="true" />
          </button>
          <button type="button" className="ui-button ui-button-md" disabled={readOnly} onClick={() => controller.tidy()} title={t("projectCanvas.tidyHint")}>
            <Network size={14} aria-hidden="true" />
            {t("projectCanvas.tidy")}
          </button>
          <button type="button" className="ui-icon-button" aria-label={t("projectCanvas.settings.projectTitle")} title={t("projectCanvas.settings.projectTitle")} onClick={() => setSettingsOpen(true)}>
            <Settings size={16} aria-hidden="true" />
          </button>
        </header>
        <div className="relative isolate min-h-0 flex-1 overflow-hidden">
          <CanvasStage
            tool={tool}
            panning={spaceHeld}
            onSize={setSize}
            onCreateMenu={(request) => setMenu({ kind: "create", request })}
            onContextMenu={(request) => setMenu(request.nodeId ? { kind: "node", request } : { kind: "canvas", request })}
          />
          {pickingFor ? (
            <div className="pointer-events-none absolute inset-x-0 top-4 z-[85] flex justify-center">
              <div role="status" className="popover-surface pointer-events-auto flex items-center gap-2 rounded-xl border border-hairline/50 bg-menu py-1 pe-1 ps-3 text-[13px] leading-[18px] text-ink">
                {t("projectCanvas.reference.pickingBanner")}
                <button type="button" className="ui-button ui-button-sm" onClick={() => setPickingFor(null)}>{t("projectCanvas.reference.done")}</button>
              </div>
            </div>
          ) : null}
          {listOpen ? <NodeList aboveMinimap={minimapOpen} onClose={() => setListOpen(false)} onFocus={(nodeId) => ui.focusNode(nodeId)} /> : null}
          {minimapOpen ? <Minimap nodes={snapshot.nodes} viewport={viewport} size={size} onCenter={(point) => controller.setViewport({ ...viewport, x: size.width / 2 - point.x * viewport.k, y: size.height / 2 - point.y * viewport.k })} /> : null}
          <CanvasToolbar tool={tool} onTool={setTool} onFocus={fitAll} onCreate={(type) => createNode(type)} onUpload={() => openUpload()} onDeleteSelection={removeSelection} onClear={clearCanvas} />
          <ZoomDock viewport={viewport} minimapOpen={minimapOpen} onMinimap={() => setMinimapOpen((open) => !open)} onReset={resetView} onZoom={(k) => controller.setViewport(zoomAroundCenter(viewport, size, k) satisfies CanvasViewport)} />
          {menu?.kind === "create" ? (
            <CreateMenu
              at={menu.request.screen}
              withConnection={Boolean(menu.request.connectFrom)}
              onPick={(type) => {
                createNode(type, menu.request.world, menu.request.connectFrom);
                setMenu(null);
              }}
              onUpload={() => {
                openUpload(menu.request.world);
                setMenu(null);
              }}
              onClose={() => setMenu(null)}
            />
          ) : null}
          {menu?.kind === "node" && menuNode ? (
            <NodeContextMenu
              at={menu.request.screen}
              onClose={() => setMenu(null)}
              actions={{
                ...(panelTypes.has(menuNode.type) ? { openPanel: () => setPanelNodeId(menuNode.id) } : {}),
                ...(!readOnly && isContentNode(menuNode) && menuNode.type !== "group" && selection.size <= 1 ? { duplicate } : {}),
                ...([...selection].some((id) => isContentNode(nodeById(snapshot, id) ?? menuNode)) ? { copy: () => void copy() } : {}),
                ...(!readOnly && canGroupSelection(selection, snapshot.nodes) ? { group } : {}),
                ...(!readOnly && canUngroupSelection(selection, snapshot.nodes) ? { ungroup } : {}),
                ...(!readOnly && [...selection].some((id) => { const node = nodeById(snapshot, id); return node && isContentNode(node); }) ? { remove: () => deleteNodes(selection) } : {}),
              }}
            />
          ) : null}
          {menu?.kind === "canvas" ? (
            <CanvasContextMenu
              at={menu.request.screen}
              onClose={() => setMenu(null)}
              actions={{
                ...(!readOnly && clipboard.current ? { paste: () => pasteNodes(clipboard.current!, menu.request.world) } : {}),
                selectAll: () => setSelection(new Set(snapshot.nodes.map((node) => node.id))),
                ...(!readOnly ? { tidy: () => controller.tidy(), create: (type: CreatableNodeType) => createNode(type, menu.request.world) } : {}),
              }}
            />
          ) : null}
          {notice ? (
            <div className="pointer-events-none absolute inset-x-0 top-4 z-[95] flex justify-center">
              <div role="status" className="popover-surface pointer-events-auto flex max-w-md items-center gap-2 rounded-xl border border-hairline/50 bg-menu py-1.5 pe-1.5 ps-3 text-[13px] leading-[18px] text-ink">
                <span className="min-w-0 flex-1">{notice}</span>
                <button type="button" className="ui-icon-button" aria-label={t("projectCanvas.dismiss")} onClick={() => setNotice(null)}><X size={14} aria-hidden="true" /></button>
              </div>
            </div>
          ) : null}
        </div>
        <input
          ref={fileInput}
          type="file"
          multiple
          hidden
          onChange={(event) => {
            uploadFiles([...(event.target.files ?? [])], uploadAt.current);
            event.target.value = "";
          }}
        />
      </div>
      {settingsOpen ? <ProjectSettingsDialog onClose={() => setSettingsOpen(false)} /> : null}
      {preview ? <ImagePreview url={preview.url} title={preview.title} onClose={() => setPreview(null)} /> : null}
    </CanvasUiContext.Provider>
  );
}

function ImagePreview({ url, title, onClose }: { url: string; title: string; onClose: () => void }) {
  const dialogRef = useRef<HTMLDivElement>(null);
  useModalDialog(dialogRef, onClose);
  return createPortal(
    <div className="ui-scrim fixed inset-0 z-[100] flex items-center justify-center p-8" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} className="relative flex max-h-full max-w-full outline-none">
        <img src={url} alt={title} className="max-h-[calc(100vh-64px)] max-w-full rounded-xl object-contain" />
        <button type="button" className="ui-icon-button absolute end-2 top-2 bg-menu" aria-label={t("projectCanvas.dismiss")} onClick={onClose}>
          <X size={16} aria-hidden="true" />
        </button>
      </div>
    </div>,
    document.body,
  );
}
