import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject, type SyntheticEvent } from "react";
import { botNodeId, type CanvasFileRef, type CanvasSnapshot } from "../../../../shared/project-canvas";
import type { BoardOverlayProps } from "@/lib/production-board/overlay";
import type { CanvasBotLook } from "@/lib/project-canvas/types";
import { boardIndex, type BoardAsset } from "./board-index";
import { BotChatWindow, NEW_CHAT, type ChatSession } from "./BotChatWindow";
import type { OverlayBackend } from "./overlay-backend";
import { NO_LOOK } from "./panel-parts";
import { SIDE_PANEL_ROOM, SidePanel } from "./SidePanel";

/** Narrower than this, the side panel starts folded. */
const PANEL_UNFOLDS_FROM = 900;

export interface LayerSize {
  width: number;
  height: number;
}

/** The side panel, a bot's chat window beside its card and an asset's details, drawn over the production board. */
export function ProductionBoardOverlay(props: BoardOverlayProps) {
  const { projectId, snapshot, backend, opened } = props;
  const index = useMemo(() => boardIndex(snapshot), [snapshot]);
  const looks = useBotLooks(backend, projectId, snapshot);
  const layerRef = useRef<HTMLDivElement>(null);
  const layer = useLayerSize(layerRef);
  const [panelChoice, setPanelChoice] = useState<boolean | null>(null);
  const panelOpen = panelChoice ?? layer.width >= PANEL_UNFOLDS_FROM;
  const latest = useRef(props);
  useLayoutEffect(() => {
    latest.current = props;
  });
  const onBot = useCallback((botId: string) => {
    latest.current.focusNode(botNodeId(botId));
    latest.current.open({ kind: "bot", botId });
  }, []);
  const onAsset = useCallback((asset: BoardAsset) => latest.current.focusNode(asset.cardId), []);
  const onEpisode = useCallback((episode: number) => latest.current.focusEpisode(episode), []);
  const pictureUrl = useCallback((file: CanvasFileRef) => backend.fileUrl(projectId, file), [backend, projectId]);
  const sessions = useRef(new Map<string, ChatSession>());
  const keepSession = useCallback((botId: string, session: ChatSession) => {
    sessions.current.set(botId, session);
  }, []);
  const chatOpened = opened?.kind === "bot" ? opened : null;
  const chatBot = chatOpened ? snapshot.bots[chatOpened.botId] : undefined;
  useEffect(() => {
    if (chatOpened && !chatBot) latest.current.close();
  }, [chatOpened, chatBot]);
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
        index={index}
        looks={looks}
        pictureUrl={pictureUrl}
        open={panelOpen}
        onOpenChange={setPanelChoice}
        chatBotId={opened?.kind === "bot" ? opened.botId : undefined}
        onBot={onBot}
        onAsset={onAsset}
        onEpisode={onEpisode}
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
          session={sessions.current.get(chatBot.botId) ?? NEW_CHAT}
          onSession={keepSession}
          pictureUrl={pictureUrl}
          layer={layer}
          reserved={panelOpen ? SIDE_PANEL_ROOM.open : SIDE_PANEL_ROOM.folded}
          anchorOf={props.anchorOf}
          subscribeView={props.subscribeView}
          onClose={props.close}
        />
      ) : null}
    </div>
  );
}

const stop = (event: SyntheticEvent) => event.stopPropagation();

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
 * Looks that did not change keep their objects, so rows drawn from them stay as they are. */
function useBotLooks(backend: OverlayBackend, projectId: string, snapshot: CanvasSnapshot): Record<string, CanvasBotLook> {
  const [looks, setLooks] = useState<Record<string, CanvasBotLook>>({});
  useEffect(() => {
    let live = true;
    backend.readBotLooks(projectId).then((next) => {
      if (live) setLooks((current) => sameLooksKept(current, next));
    }, () => undefined);
    return () => {
      live = false;
    };
  }, [backend, projectId, snapshot]);
  return looks;
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
