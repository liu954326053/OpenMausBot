import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type Dispatch, type KeyboardEvent, type RefObject, type SetStateAction } from "react";
import { ArrowUp, Crown, ExternalLink, LoaderCircle, Square, X } from "lucide-react";
import { botNodeId, type CanvasBotState, type CanvasFileRef } from "../../../../shared/project-canvas";
import { cn } from "@/lib/cn";
import { activeLocale, t } from "@/lib/i18n";
import type { BoardAnchor } from "@/lib/production-board/overlay";
import { canvasErrorText } from "@/lib/project-canvas/backend";
import type { CanvasBotLook, CanvasExchangeMessage } from "@/lib/project-canvas/types";
import { sendsMessage, useSendKey } from "@/lib/send-key";
import type { BoardAsset, BoardIndex } from "./board-index";
import { CHAT_SHEET_BELOW, placeChat, type PlacementInput } from "./chat-placement";
import { ChatExchange } from "./ChatExchange";
import { ChatWaiting } from "./ChatWaiting";
import type { OverlayBackend } from "./overlay-backend";
import { BotFace, BotStatus } from "./panel-parts";
import { ReferencePicker, ReferenceTray } from "./ReferenceTray";
import { taskText } from "./task-text";

/** What the person was writing to a bot and the references they added or took away, kept while its window is closed. */
export interface ChatSession {
  draft: string;
  /** Node ids. */
  added: readonly string[];
  /** Node ids of offered references the person took away. */
  removed: readonly string[];
}

const NEW_CHAT: ChatSession = { draft: "", added: [], removed: [] };

export interface BotChatWindowProps {
  projectId: string;
  bot: CanvasBotState;
  look: CanvasBotLook;
  index: BoardIndex;
  backend: OverlayBackend;
  readOnly: boolean;
  /** Node ids it was opened with, added to the tray once each time they come. */
  references: readonly string[] | undefined;
  /** By bot id: what each window left, which the next window for that bot starts from. */
  sessions: Map<string, ChatSession>;
  pictureUrl(file: CanvasFileRef): string;
  layer: PlacementInput["layer"];
  reserved: number;
  anchorOf(nodeId: string): BoardAnchor | null;
  subscribeView(listener: () => void): () => void;
  onClose(): void;
  locale: string;
}

/** A bot's chat beside its card: its latest exchange, the question it waits on, and a task to send with references. */
export const BotChatWindow = memo(function BotChatWindow(props: BotChatWindowProps) {
  const { projectId, bot, look, index, backend, readOnly, pictureUrl, onClose, locale } = props;
  const botId = bot.botId;
  const windowRef = useRef<HTMLElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const sheet = usePlacement(windowRef, props);
  const [session, setSession] = useSession(props);
  const connected = useMemo(() => index.connectedInto(botId), [index, botId]);
  const library = useMemo(() => index.libraryFor(botId), [index, botId]);
  const extras = useMemo(() => trayExtras(index, connected, library, session), [index, connected, library, session]);
  const taken = useMemo(() => new Set([...connected, ...extras]), [connected, extras]);
  const [picking, setPicking] = useState(false);
  const [sent, setSent] = useState(0);
  const { messages, readError } = useExchange(backend, projectId, bot, sent);
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const sendKey = useSendKey();
  useReadsReplies(backend, projectId, bot, look);
  useEffect(() => composerRef.current!.focus({ preventScroll: true }), []);
  const words = session.draft.trim();
  const busy = bot.status === "working" || bot.status === "queued";

  const send = async () => {
    if (!words || sending || readOnly) return;
    setSending(true);
    setProblem(null);
    setNotice(null);
    try {
      const response = await backend.sendTask(projectId, { botId, text: taskText(words, extras), language: activeLocale() });
      setSession((current) => ({ ...current, draft: "" }));
      if (response.queued) setNotice(t("boardPanels.chat.queued", { name: bot.name }));
      setSent((count) => count + 1);
    } catch (cause) {
      setProblem(t("boardPanels.chat.sendFailed", { reason: canvasErrorText(cause) }));
    } finally {
      setSending(false);
    }
  };
  const stop = () => {
    setProblem(null);
    backend.stopBot(projectId, botId).catch((cause: unknown) => setProblem(t("boardPanels.chat.stopFailed", { name: bot.name, reason: canvasErrorText(cause) })));
  };
  const closePicker = () => {
    setPicking(false);
    composerRef.current!.focus();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== "Escape" || event.nativeEvent.isComposing) return;
    event.preventDefault();
    if (picking) closePicker();
    else onClose();
  };
  const add = (asset: BoardAsset) => setSession((current) => ({
    ...current,
    added: [...current.added, asset.node.id],
    removed: current.removed.filter((id) => id !== asset.node.id),
  }));
  const remove = (asset: BoardAsset) => setSession((current) => ({
    ...current,
    added: current.added.filter((id) => id !== asset.node.id),
    removed: library.includes(asset) ? [...current.removed, asset.node.id] : current.removed,
  }));

  return (
    <section
      ref={windowRef}
      role="dialog"
      aria-label={t("boardPanels.chat.label", { name: bot.name })}
      data-board-chat=""
      style={sheet ? undefined : { left: 0, top: 0 }}
      className={cn("pointer-events-auto absolute flex", sheet ? "inset-x-0 bottom-0 max-h-[70%]" : "max-h-[min(640px,calc(100%-24px))] w-96")}
      onKeyDown={onKeyDown}
    >
      <div className={cn("popover-surface flex min-h-0 w-full animate-pop-in flex-col overflow-hidden border border-hairline/50 bg-menu motion-reduce:animate-none", sheet ? "rounded-t-xl border-b-0" : "rounded-xl")}>
        <header className="flex items-center gap-2.5 border-b border-hairline/50 px-4 py-3">
          <BotFace name={bot.name} look={look} size={32} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1 text-[13px] font-medium leading-[18px] text-ink">
              <span className="truncate">{bot.name}</span>
              {bot.lead ? <Crown size={14} role="img" aria-label={t("boardPanels.team.lead")} className="shrink-0 text-warning" /> : null}
            </div>
            <div className="flex min-w-0 items-center gap-1.5 text-[12px] leading-4 text-ink-tertiary">
              {bot.title ? <span className="truncate">{bot.title}</span> : null}
              <BotStatus status={bot.status} />
            </div>
          </div>
          <button type="button" className="ui-icon-button size-8" aria-label={t("boardPanels.close")} title={t("boardPanels.close")} onClick={onClose}>
            <X size={16} aria-hidden="true" />
          </button>
        </header>
        {picking ? (
          <div className="flex min-h-0 flex-1 flex-col px-4 py-3">
            <ReferencePicker index={index} taken={taken} pictureUrl={pictureUrl} onAdd={add} onDone={closePicker} />
          </div>
        ) : <ChatExchange messages={messages} botName={bot.name} readError={readError} locale={locale} />}
        <div className="flex flex-col gap-2 border-t border-hairline/50 px-4 pb-3 pt-2.5">
          {bot.waiting ? <ChatWaiting bot={bot} waiting={bot.waiting} onOpenChat={() => backend.openChat(projectId, botId, bot.waiting!.threadId)} /> : null}
          <ReferenceTray connected={connected} extras={extras} botName={bot.name} pictureUrl={pictureUrl} pickerOpen={picking} onPick={() => (picking ? closePicker() : setPicking(true))} onRemove={remove} />
          <textarea
            ref={composerRef}
            dir="auto"
            rows={2}
            value={session.draft}
            disabled={readOnly}
            aria-label={t("boardPanels.chat.message", { name: bot.name })}
            placeholder={t("boardPanels.chat.placeholder", { name: bot.name })}
            className="max-h-32 min-h-14 w-full resize-none rounded-lg border border-hairline bg-transparent px-2.5 py-2 text-[13px] leading-[18px] text-ink [field-sizing:content] placeholder:text-ink-tertiary disabled:opacity-60"
            onChange={(event) => setSession((current) => ({ ...current, draft: event.target.value }))}
            onKeyDown={(event) => {
              if (!sendsMessage(event.nativeEvent, sendKey)) return;
              event.preventDefault();
              void send();
            }}
          />
          {readOnly ? <p className="text-[12px] leading-4 text-ink-tertiary">{t("boardPanels.chat.readOnly")}</p> : null}
          {problem ? <p role="alert" className="text-[12px] leading-4 text-danger">{problem}</p> : null}
          {notice ? <p role="status" className="text-[12px] leading-4 text-ink-secondary">{notice}</p> : null}
          <div className="flex items-center gap-2">
            <button type="button" className="ui-button ui-button-md" onClick={() => backend.openChat(projectId, botId, bot.output?.threadId)}>
              <ExternalLink size={14} aria-hidden="true" />
              {t("boardPanels.chat.openInChat")}
            </button>
            <span className="flex-1" />
            {busy ? (
              <button type="button" className="ui-button ui-button-md" disabled={readOnly} onClick={stop}>
                <Square size={14} aria-hidden="true" />
                {t("boardPanels.chat.stop")}
              </button>
            ) : null}
            <button type="button" className="ui-button ui-button-md ui-button-primary" disabled={readOnly || sending || !words} onClick={() => void send()}>
              {sending ? <LoaderCircle size={14} aria-hidden="true" className="animate-spin motion-reduce:animate-none" /> : <ArrowUp size={14} aria-hidden="true" />}
              {t("boardPanels.chat.send")}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
});

/** Beside the card, docked or a sheet: set on the element itself whenever the board moves, the window resizes or the
 * layer does, so a move of the board draws nothing. True for a sheet. */
function usePlacement(windowRef: RefObject<HTMLElement | null>, { bot, layer, reserved, anchorOf, subscribeView }: BotChatWindowProps): boolean {
  const input = useRef({ anchorId: botNodeId(bot.botId), layer, reserved, anchorOf });
  const place = useCallback(() => {
    const element = windowRef.current!;
    const { anchorId, layer, reserved, anchorOf } = input.current;
    const placement = placeChat({ anchor: anchorOf(anchorId), size: { width: element.offsetWidth, height: element.offsetHeight }, layer, reserved });
    element.style.transform = placement.mode === "sheet" ? "" : `translate(${Math.round(placement.x)}px, ${Math.round(placement.y)}px)`;
    element.dataset.placement = placement.mode;
  }, [windowRef]);
  useLayoutEffect(() => {
    input.current = { anchorId: botNodeId(bot.botId), layer, reserved, anchorOf };
    place();
  });
  useEffect(() => subscribeView(place), [subscribeView, place]);
  useEffect(() => {
    const observer = new ResizeObserver(() => place());
    observer.observe(windowRef.current!);
    return () => observer.disconnect();
  }, [windowRef, place]);
  return layer.width < CHAT_SHEET_BELOW;
}

function useSession({ bot, index, references, sessions }: BotChatWindowProps): [ChatSession, Dispatch<SetStateAction<ChatSession>>] {
  const [session, setSession] = useState(() => sessions.get(bot.botId) ?? NEW_CHAT);
  useEffect(() => {
    sessions.set(bot.botId, session);
  }, [sessions, bot.botId, session]);
  const merged = useRef<readonly string[] | undefined>(undefined);
  useEffect(() => {
    if (!references || merged.current === references) return;
    merged.current = references;
    const ids = references.flatMap((nodeId) => index.assetOf(nodeId)?.node.id ?? []);
    setSession((current) => ({
      ...current,
      added: [...current.added, ...ids.filter((id) => !current.added.includes(id))],
      removed: current.removed.filter((id) => !ids.includes(id)),
    }));
  }, [references, index]);
  return [session, setSession];
}

/** What goes into the task's words: the bot's offered references the person kept, then what they added, leaving out
 * what is connected into the bot, which the server sends by itself. */
function trayExtras(index: BoardIndex, connected: readonly BoardAsset[], library: readonly BoardAsset[], session: ChatSession): BoardAsset[] {
  const taken = new Set(connected.map((asset) => asset.cardId));
  const removed = new Set(session.removed);
  const extras: BoardAsset[] = [];
  for (const asset of [...library, ...session.added.flatMap((nodeId) => index.assetOf(nodeId) ?? [])]) {
    if (taken.has(asset.cardId) || removed.has(asset.node.id)) continue;
    taken.add(asset.cardId);
    extras.push(asset);
  }
  return extras;
}

/** Read when the window opens, after each task sent, and when the bot moves on: its status, its output or what it waits on. */
function useExchange(backend: OverlayBackend, projectId: string, bot: CanvasBotState, sent: number) {
  const [messages, setMessages] = useState<CanvasExchangeMessage[] | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const moment = `${bot.status}|${bot.output?.messageId ?? ""}|${bot.output?.at ?? ""}|${bot.waiting?.messageId ?? ""}`;
  useEffect(() => {
    let live = true;
    backend.readExchange(projectId, bot.botId).then((next) => {
      if (!live) return;
      setMessages(next);
      setReadError(null);
    }, (cause: unknown) => {
      if (live) setReadError(t("boardPanels.chat.readFailed", { reason: canvasErrorText(cause) }));
    });
    return () => {
      live = false;
    };
  }, [backend, projectId, bot.botId, moment, sent]);
  return { messages, readError };
}

/** Opening the window reads the bot's replies, as opening its chat does; replies that come while it is open are read
 * while the app has the focus. */
function useReadsReplies(backend: OverlayBackend, projectId: string, bot: CanvasBotState, look: CanvasBotLook) {
  const opening = useRef(true);
  const unread = look.unread === true;
  const threadId = bot.output?.threadId;
  useEffect(() => {
    if (unread && (opening.current || document.hasFocus())) backend.readConversation(projectId, bot.botId, threadId);
    opening.current = false;
  }, [backend, projectId, bot.botId, threadId, unread]);
}
