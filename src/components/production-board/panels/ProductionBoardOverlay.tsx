import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject, type SyntheticEvent } from "react";
import { botNodeId, type CanvasFileRef, type CanvasSnapshot } from "../../../../shared/project-canvas";
import { activeLocale } from "@/lib/i18n";
import type { BoardOverlayProps } from "@/lib/production-board/overlay";
import type { CanvasBotLook } from "@/lib/project-canvas/types";
import { AssetDetails } from "./AssetDetails";
import { boardIndex, type BoardIndex } from "@/lib/production-board/board-index";
import { BotChatWindow, type ChatSession } from "./BotChatWindow";
import { detailsView } from "@/lib/production-board/details-view";
import type { OverlayBackend } from "@/lib/production-board/overlay-backend";
import { NO_LOOK } from "./panel-parts";
import { panelRows, type PanelRows } from "@/lib/production-board/panel-rows";
import { SIDE_PANEL_ROOM, SidePanel } from "./SidePanel";
import { useViewFollow } from "@/lib/production-board/view-follow";

/** Narrower than this, the side panel starts folded. */
const PANEL_UNFOLDS_FROM = 900;

export interface LayerSize {
  width: number;
  height: number;
}

/** The side panel, a bot's chat window beside its card and an asset's details, drawn over the production board. */
export function ProductionBoardOverlay(props: BoardOverlayProps) {
  const { projectId, snapshot, backend, opened } = props;
  const locale = activeLocale();
  const index = useMemo(() => boardIndex(snapshot), [snapshot]);
  const pictureUrl = useCallback((file: CanvasFileRef) => backend.fileUrl(projectId, file), [backend, projectId]);
  const rows = usePanelRows(index, pictureUrl);
  const looks = useBotLooks(backend, projectId, snapshot);
  const layerRef = useRef<HTMLDivElement>(null);
  const layer = useLayerSize(layerRef);
  const [panelChoice, setPanelChoice] = useState<boolean | null>(null);
  const panelOpen = panelChoice ?? layer.width >= PANEL_UNFOLDS_FROM;
  const board = useBoardCalls(props);
  const followView = useViewFollow(props.subscribeView);
  const [sessions] = useState(() => new Map<string, ChatSession>());
  const chatOpened = opened?.kind === "bot" ? opened : null;
  const chatBot = chatOpened ? snapshot.bots[chatOpened.botId] : undefined;
  const assetOpened = opened?.kind === "asset" ? opened : null;
  const detailed = assetOpened ? index.assetOf(assetOpened.nodeId) : null;
  const details = useKeptValue(detailed ? detailsView(detailed, index, snapshot.bots[index.ownerOf(detailed)], snapshot.drafts, pictureUrl) : null);
  useEffect(() => {
    if ((chatOpened && !chatBot) || (assetOpened && !detailed)) board.close();
  }, [board, chatOpened, chatBot, assetOpened, detailed]);
  useStopsWheel(layerRef);
  return (
    <div
      ref={layerRef}
      data-board-overlay=""
      data-canvas-no-zoom=""
      data-canvas-shortcuts-ignore=""
      className="pointer-events-none absolute inset-0 overflow-hidden"
      onPointerDown={stop}
      onDoubleClick={stop}
      onContextMenu={stop}
    >
      <SidePanel
        rows={rows}
        looks={looks}
        open={panelOpen}
        onOpenChange={setPanelChoice}
        chatBotId={chatOpened?.botId}
        onBot={board.onBot}
        onAsset={board.onAsset}
        onEpisode={board.onEpisode}
        locale={locale}
      />
      {chatOpened && chatBot ? (
        <BotChatWindow
          key={chatBot.botId}
          projectId={projectId}
          bot={chatBot}
          look={looks[chatBot.botId] ?? NO_LOOK}
          index={index}
          backend={backend}
          readOnly={snapshot.readOnly !== undefined}
          references={chatOpened.references}
          sessions={sessions}
          pictureUrl={pictureUrl}
          layer={layer}
          reserved={panelOpen ? SIDE_PANEL_ROOM.open : SIDE_PANEL_ROOM.folded}
          anchorOf={board.anchorOf}
          subscribeView={followView}
          onClose={board.close}
          locale={locale}
        />
      ) : null}
      {details ? <AssetDetails view={details} onAsk={board.onAsk} onLocate={board.onLocate} onAsset={board.openAsset} onClose={board.close} locale={locale} /> : null}
    </div>
  );
}

const stop = (event: SyntheticEvent) => event.stopPropagation();

/** The board's callbacks as functions that never change, calling whichever the board gave last: the board may give new
 * ones each time it draws. */
function useBoardCalls(props: BoardOverlayProps) {
  const latest = useRef(props);
  useLayoutEffect(() => {
    latest.current = props;
  });
  return useMemo(() => ({
    anchorOf: (nodeId: string) => latest.current.anchorOf(nodeId),
    close: () => latest.current.close(),
    onBot: (botId: string) => {
      latest.current.focusNode(botNodeId(botId));
      latest.current.open({ kind: "bot", botId });
    },
    onAsset: (cardId: string) => latest.current.focusNode(cardId),
    onEpisode: (episode: number) => latest.current.focusEpisode(episode),
    onAsk: (botId: string, nodeId: string) => {
      latest.current.focusNode(botNodeId(botId));
      latest.current.open({ kind: "bot", botId, references: [nodeId] });
    },
    onLocate: (cardId: string) => {
      latest.current.focusNode(cardId);
      latest.current.close();
    },
    openAsset: (nodeId: string) => latest.current.open({ kind: "asset", nodeId }),
  }), []);
}

function usePanelRows(index: BoardIndex, pictureUrl: (file: CanvasFileRef) => string): PanelRows {
  const last = useRef<PanelRows | null>(null);
  return useMemo(() => {
    last.current = panelRows(index, pictureUrl, last.current);
    return last.current;
  }, [index, pictureUrl]);
}

/** `value`, or the one given before while it is the same JSON. */
function useKeptValue<Value>(value: Value): Value {
  const kept = useRef(value);
  if (kept.current !== value && JSON.stringify(kept.current) !== JSON.stringify(value)) kept.current = value;
  return kept.current;
}

/** The board zooms on a wheel with a listener of its own on an element around this one. */
function useStopsWheel(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const element = ref.current!;
    const onWheel = (event: WheelEvent) => event.stopPropagation();
    element.addEventListener("wheel", onWheel, { passive: true });
    return () => element.removeEventListener("wheel", onWheel);
  }, [ref]);
}

function useLayerSize(ref: RefObject<HTMLElement | null>): LayerSize {
  const [size, setSize] = useState<LayerSize>({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const element = ref.current!;
    const take = (width: number, height: number) => setSize((current) => (current.width === width && current.height === height ? current : { width, height }));
    const rect = element.getBoundingClientRect();
    take(rect.width, rect.height);
    const observer = new ResizeObserver((entries) => {
      const { width, height } = entries[0]!.contentRect;
      take(width, height);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return size;
}

/** Read again with every snapshot, as the board's own canvas does: a look carries whether the bot has unread replies.
 * The workspace answers for all its bots; the project's are kept, and those that did not change keep their objects, so
 * rows drawn from them stay as they are. */
function useBotLooks(backend: OverlayBackend, projectId: string, snapshot: CanvasSnapshot): Record<string, CanvasBotLook> {
  const [looks, setLooks] = useState<Record<string, CanvasBotLook>>({});
  useEffect(() => {
    let live = true;
    backend.readBotLooks(projectId).then((next) => {
      if (live) setLooks((current) => sameLooksKept(current, projectLooks(next, snapshot)));
    }, () => undefined);
    return () => {
      live = false;
    };
  }, [backend, projectId, snapshot]);
  return looks;
}

function projectLooks(looks: Record<string, CanvasBotLook>, snapshot: CanvasSnapshot): Record<string, CanvasBotLook> {
  return Object.fromEntries(Object.keys(snapshot.bots).flatMap((botId) => (looks[botId] ? [[botId, looks[botId]]] : [])));
}

function sameLooksKept(current: Record<string, CanvasBotLook>, next: Record<string, CanvasBotLook>): Record<string, CanvasBotLook> {
  let changed = Object.keys(current).length !== Object.keys(next).length;
  const kept: Record<string, CanvasBotLook> = {};
  for (const [botId, look] of Object.entries(next)) {
    const before = current[botId];
    const same = before !== undefined && JSON.stringify(before) === JSON.stringify(look);
    kept[botId] = same ? before : look;
    changed ||= !same;
  }
  return changed ? kept : current;
}
