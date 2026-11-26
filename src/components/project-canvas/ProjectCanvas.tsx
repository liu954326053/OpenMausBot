// Adapted from basketikun/infinite-canvas@9cd3deac web/src/pages/canvas/project.tsx, MIT License, Copyright (c) 2026 basketikun (full text in third_party/infinite-canvas/LICENSE)
import { useEffect, useMemo, useState, useSyncExternalStore, type ComponentType, type ReactNode } from "react";
import { AlertCircle, Archive, FolderX, LoaderCircle, Settings, X } from "lucide-react";
import { useCaptionChrome, WindowDragStrip } from "@/components/DesktopCapabilities";
import { ProductionBoard, type BoardHost } from "@/components/production-board/ProductionBoard";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import type { BoardOpened, BoardOverlayProps } from "@/lib/production-board/overlay";
import type { CanvasBackend } from "@/lib/project-canvas/backend";
import { CanvasController, type CanvasState } from "@/lib/project-canvas/controller";
import { serverErrorText } from "@/lib/server-error";
import { CanvasUiContext, type CanvasUi } from "./canvas-ui";
import { ProjectSettingsDialog } from "./ProjectSettingsDialog";

export interface ProjectCanvasProps {
  projectId: string;
  selectedBotId?: string;
  backend: CanvasBackend;
  /** Shown in the top bar, such as the notice that the project's team changed. */
  topBarSlot?: ReactNode;
  /** Drawn over the board: what a card opens, such as a bot's chat or an asset's details. */
  overlay?: ComponentType<BoardOverlayProps>;
}

const NOTICE_MS = 4000;

export function ProjectCanvas({ projectId, selectedBotId, backend, topBarSlot, overlay }: ProjectCanvasProps) {
  const [attempt, setAttempt] = useState(0);
  const [controller, setController] = useState<CanvasController | null>(null);
  useEffect(() => {
    const next = new CanvasController(backend, projectId);
    setController(next);
    void next.start();
    return () => next.dispose();
  }, [backend, projectId, attempt]);
  if (!controller) return <CanvasMessage busy />;
  return <CanvasLoaded key={`${projectId}:${attempt}`} controller={controller} selectedBotId={selectedBotId} topBarSlot={topBarSlot} overlay={overlay} onRetry={() => setAttempt((count) => count + 1)} />;
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

function CanvasLoaded({ controller, selectedBotId, topBarSlot, overlay, onRetry }: {
  controller: CanvasController;
  selectedBotId?: string;
  topBarSlot?: ReactNode;
  overlay?: ComponentType<BoardOverlayProps>;
  onRetry: () => void;
}) {
  const state = useSyncExternalStore(controller.subscribe, controller.getState);
  if (state.phase === "failed") return <CanvasMessage error={state.loadError} onRetry={onRetry} />;
  if (state.phase === "loading" || !state.snapshot) return <CanvasMessage busy />;
  return <CanvasWorkspace controller={controller} state={state} selectedBotId={selectedBotId} topBarSlot={topBarSlot} overlay={overlay} />;
}

function CanvasWorkspace({ controller, state, selectedBotId, topBarSlot, overlay }: {
  controller: CanvasController;
  state: CanvasState;
  selectedBotId?: string;
  topBarSlot?: ReactNode;
  overlay?: ComponentType<BoardOverlayProps>;
}) {
  const snapshot = state.snapshot!;
  const readOnly = Boolean(snapshot.readOnly);
  const { dragProps } = useCaptionChrome();
  const [opened, setOpened] = useState<BoardOpened | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

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

  const host = useMemo<BoardHost>(() => ({
    fileUrl: (file) => controller.fileUrl(file),
    move: (nodeId, position) => {
      controller.apply([{ type: "update_node", id: nodeId, patch: { position } }]);
    },
    generate: async (nodeId) => {
      const node = controller.getState().snapshot?.nodes.find((one) => one.id === nodeId);
      const refused = await controller.generate(nodeId, node?.metadata?.prompt ?? "");
      if (refused) throw new Error(serverErrorText(refused, refused.error));
    },
    selectTake: (nodeId) => controller.selectTake(nodeId),
    retry: (target) => controller.retry(target),
    openDraft: async () => {
      await controller.openDraft();
    },
  }), [controller]);

  const ui = useMemo<CanvasUi>(() => ({
    controller,
    state,
    snapshot,
    readOnly,
    panelNodeId: opened?.kind === "asset" ? opened.nodeId : null,
  }), [controller, opened, readOnly, snapshot, state]);

  return (
    <CanvasUiContext.Provider value={ui}>
      <div className="flex h-full min-h-0 flex-col bg-app text-ink" data-project-canvas="">
        <header {...dragProps} className="flex h-12 shrink-0 items-center gap-2 border-b border-edge px-4 max-md:ps-12">
          <h1 className="min-w-0 truncate text-[17px] font-semibold leading-6" title={snapshot.project.name}>{snapshot.project.name}</h1>
          {readOnly ? (
            <span className="ui-chip gap-1"><Archive size={14} aria-hidden="true" />{t("projectCanvas.archived")}</span>
          ) : null}
          {snapshot.project.folderState === "missing" ? (
            <span className="ui-chip gap-1 text-warning" title={t("projectCanvas.folderMissingHint")}><FolderX size={14} aria-hidden="true" />{t("teamProjects.folderMissing")}</span>
          ) : null}
          <div className="flex min-w-0 flex-1 items-center gap-2" data-project-canvas-slot="">{topBarSlot}</div>
          <button type="button" className="ui-icon-button" aria-label={t("projectCanvas.settings.projectTitle")} title={t("projectCanvas.settings.projectTitle")} onClick={() => setSettingsOpen(true)}>
            <Settings size={16} aria-hidden="true" />
          </button>
        </header>
        <div className="relative isolate min-h-0 flex-1 overflow-hidden">
          <ProductionBoard
            projectId={snapshot.project.id}
            snapshot={snapshot}
            backend={controller.backend}
            looks={state.looks}
            host={host}
            opened={opened}
            onOpenedChange={setOpened}
            overlay={overlay}
            focusBotId={selectedBotId}
          />
          {notice ? (
            <div data-project-notice="" className={cn("pointer-events-none absolute inset-x-0 top-14 z-[95] flex justify-center px-3", overlay && "pe-[20rem]")}>
              <div role="status" className="popover-surface pointer-events-auto flex max-w-md items-center gap-2 rounded-xl border border-hairline/50 bg-menu py-1.5 pe-1.5 ps-3 text-[13px] leading-[18px] text-ink">
                <span className="min-w-0 flex-1">{notice}</span>
                <button type="button" className="ui-icon-button" aria-label={t("projectCanvas.dismiss")} onClick={() => setNotice(null)}><X size={14} aria-hidden="true" /></button>
              </div>
            </div>
          ) : null}
        </div>
      </div>
      {settingsOpen ? <ProjectSettingsDialog onClose={() => setSettingsOpen(false)} /> : null}
    </CanvasUiContext.Provider>
  );
}
