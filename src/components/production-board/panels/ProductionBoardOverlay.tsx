import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject, type SyntheticEvent } from "react";
import { botNodeId, type CanvasFileRef, type CanvasSnapshot } from "../../../../shared/project-canvas";
import { boardIndex, type BoardIndex } from "@/lib/production-board/board-index";
import { detailsLinks, detailsView, type DetailsLink, type DetailsView } from "@/lib/production-board/details-view";
import type { BoardOverlayProps } from "@/lib/production-board/overlay";
import type { BoardCard } from "@/lib/production-board/types";
import type { OverlayBackend } from "@/lib/production-board/overlay-backend";
import { panelRows, type PanelRows } from "@/lib/production-board/panel-rows";
import { useViewFollow } from "@/lib/production-board/view-follow";
import type { CanvasBotLook } from "@/lib/project-canvas/types";
import type { NodeActions, NodeContext } from "../nodes/parts";
import { ChatWindow, type ChatSession } from "./ChatWindow";
import { DetailModal } from "./DetailModal";
import { SIDE_PANEL_ROOM, SidePanel } from "./SidePanel";

/** Narrower than this, the side panel starts folded. */
const PANEL_UNFOLDS_FROM = 900;

export interface LayerSize {
  width: number;
  height: number;
}

/** A card's name as the details modal writes it in a link. */
export function cardTitle(card: BoardCard | undefined, nameOf: (botId: string) => string): string {
  if (!card) return "";
  switch (card.kind) {
    case "bot": return nameOf(card.botId);
    case "character":
    case "scene": return card.name;
    case "stack": return card.id;
    case "other": return card.node.title;
    default: return card.title;
  }
}

/** The side panel, a bot's chat window beside its card and a card's details, drawn over the production board. */
export function ProductionBoardOverlay(props: BoardOverlayProps) {
  const { projectId, snapshot, backend, opened, board } = props;
  const index = useMemo(() => boardIndex(snapshot), [snapshot]);
  const pictureUrl = useCallback((file: CanvasFileRef) => backend.fileUrl(projectId, file), [backend, projectId]);
  const rows = usePanelRows(index, pictureUrl);
  const looks = useBotLooks(backend, projectId, snapshot);
  const layerRef = useRef<HTMLDivElement>(null);
  const layer = useLayerSize(layerRef);
  const [panelChoice, setPanelChoice] = useState<boolean | null>(null);
  const panelOpen = panelChoice ?? layer.width >= PANEL_UNFOLDS_FROM;
  const readOnly = snapshot.readOnly !== undefined;
  const calls = useBoardCalls(props);
  const followView = useViewFollow(props.subscribeView);
  const [sessions] = useState(() => new Map<string, ChatSession>());
  const chatOpened = opened?.kind === "bot" ? opened : null;
  const chatBot = chatOpened ? snapshot.bots[chatOpened.botId] : undefined;
  const assetOpened = opened?.kind === "asset" ? opened : null;
  const card = assetOpened ? board.cards.find((one) => one.nodeIds.includes(assetOpened.nodeId)) : undefined;
  const detailed = assetOpened ? index.assetOf(assetOpened.nodeId) : null;
  const details = useKeptValue(detailed ? detailsView(detailed, index, snapshot.bots[index.ownerOf(detailed)], snapshot.drafts, pictureUrl) : null);
  const links = useMemo(() => (card ? detailsLinks(card.id, board, (cardId) => cardTitle(board.cards.find((one) => one.id === cardId), (botId) => snapshot.bots[botId]?.name ?? botId) || cardId) : { upstream: [] as DetailsLink[], downstream: [] as DetailsLink[] }), [card, board]);
  const detailActions = useDetailActions(props, details);
  const ctx = useMemo<NodeContext | null>(() => (details && detailActions ? {
    snapshot,
    looks,
    fileUrl: pictureUrl,
    takeOf: (shotId) => {
      const result = board.cards.find((one) => one.kind === "result" && one.shotId === shotId);
      return result?.kind === "result" ? result.takes.find((take) => take.selected) ?? result.takes.at(-1) : undefined;
    },
    actions: detailActions,
  } : null), [details, detailActions, snapshot, looks, pictureUrl, board]);
  useEffect(() => {
    if ((chatOpened && !chatBot) || (assetOpened && !detailed)) calls.close();
  }, [calls, chatOpened, chatBot, assetOpened, detailed]);
  return (
    <div ref={layerRef} data-board-overlay="" className="pointer-events-none absolute inset-0 overflow-hidden" onPointerDown={stop} onDoubleClick={stop} onContextMenu={stop}>
      <SidePanel rows={rows} looks={looks} open={panelOpen} onOpenChange={setPanelChoice} chatBotId={chatOpened?.botId} onBot={calls.onBot} onAsset={calls.onAsset} onEpisode={calls.onEpisode} />
      {chatOpened && chatBot ? (
        <ChatWindow
          key={chatBot.botId}
          projectId={projectId}
          bot={chatBot}
          look={looks[chatBot.botId] ?? { color: "silver" }}
          index={index}
          backend={backend}
          readOnly={readOnly}
          references={chatOpened.references}
          sessions={sessions}
          pictureUrl={pictureUrl}
          layer={layer}
          reserved={panelOpen ? SIDE_PANEL_ROOM.open : SIDE_PANEL_ROOM.folded}
          anchorOf={calls.anchorOf}
          subscribeView={followView}
          zoom={props.zoom}
          focusNode={calls.onLocate}
          onClose={calls.close}
        />
      ) : null}
      {details && ctx ? (
        <DetailModal
          view={details}
          links={links}
          card={card}
          ctx={ctx}
          readOnly={readOnly}
          onClose={calls.close}
          onLocate={() => {
            calls.onLocate(details.nodeId);
            calls.close();
          }}
          onAsk={calls.onAskOwner(details)}
          onOpenCard={calls.onOpenCard}
          onSelectTake={readOnly ? undefined : calls.onSelectTake}
        />
      ) : null}
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
    onLocate: (cardId: string) => latest.current.focusNode(cardId),
    onAskOwner: (view: DetailsView) => () => {
      if (!view.owner) return;
      latest.current.focusNode(botNodeId(view.owner.botId));
      latest.current.open({ kind: "bot", botId: view.owner.botId, references: [view.nodeId] });
    },
    onOpenCard: (link: DetailsLink) => {
      if (link.botId) latest.current.open({ kind: "bot", botId: link.botId });
      else if (link.nodeId) latest.current.open({ kind: "asset", nodeId: link.nodeId });
    },
    onSelectTake: (nodeId: string) => {
      void latest.current.backend.selectTake(latest.current.projectId, nodeId);
    },
  }), []);
}

/** What a details modal's buttons call: it can close, locate its card and ask its bot, as the chat window and the panel do. */
function useDetailActions(props: BoardOverlayProps, view: DetailsView | null): NodeActions | null {
  const latest = useRef(props);
  useLayoutEffect(() => {
    latest.current = props;
  });
  return useMemo(() => (view ? {
    focusCard: (cardId: string) => latest.current.focusNode(cardId),
    openChat: (botId: string) => latest.current.open({ kind: "bot", botId }),
    openStack: () => undefined,
    generate: () => undefined,
    selectTake: (nodeId: string) => {
      void latest.current.backend.selectTake(latest.current.projectId, nodeId);
    },
    retry: () => undefined,
    openDraft: () => undefined,
  } : null), [view]);
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

function useLayerSize(ref: RefObject<HTMLElement | null>): LayerSize {
  const [size, setSize] = useState<LayerSize>({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
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

/** Read again with every snapshot, as the board's own canvas does: a look carries whether the bot has unread replies. */
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
