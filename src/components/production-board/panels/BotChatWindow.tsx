import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type Dispatch, type KeyboardEvent, type RefObject, type SetStateAction } from "react";
import { ArrowUp, AtSign, Crown, ExternalLink, LoaderCircle, Square, X } from "lucide-react";
import { botNodeId, CANVAS_TASK_REFERENCES_MAX, type CanvasBotState, type CanvasFileRef } from "../../../../shared/project-canvas";
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
  const overReferences = extras.length - CANVAS_TASK_REFERENCES_MAX;
  const sendable = Boolean(words) && !sending && !readOnly && overReferences <= 0;

  const send = async () => {
    if (!sendable) return;
    setSending(true);
    setProblem(null);
    setNotice(null);
    try {
      const response = await backend.sendTask(projectId, { botId, text: words, references: extras.map((asset) => asset.node.id), language: activeLocale() });
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
      data-bot-state={bot.status}
      style={sheet ? undefined : { left: 0, top: 0 }}
      className={cn(
        "group/chat pointer-events-auto absolute flex flex-col",
        sheet ? "inset-x-2 bottom-2 max-h-[min(70%,480px)]" : "max-h-[calc(100%-72px)] w-[420px]",
      )}
      onKeyDown={onKeyDown}
    >
      <span
        data-chat-arrow=""
        aria-hidden="true"
        className="pointer-events-none absolute z-10 hidden size-3 rotate-45 bg-menu group-data-[side=right]/chat:-start-1.5 group-data-[side=right]/chat:block group-data-[side=right]/chat:border-b group-data-[side=right]/chat:border-s group-data-[side=right]/chat:border-board-line-2 group-data-[side=left]/chat:-end-1.5 group-data-[side=left]/chat:block group-data-[side=left]/chat:border-e group-data-[side=left]/chat:border-t group-data-[side=left]/chat:border-board-line-2"
      />
      <div data-chat-surface="" className="board-type board-panel-shadow pointer-events-auto relative flex min-h-0 animate-fade-in flex-col overflow-hidden rounded-[14px] border border-board-line-2 bg-menu motion-reduce:animate-none">
        <header className="flex flex-none items-center gap-2.5 border-b border-hairline px-2 pb-2.5 pe-2 ps-3 pt-2.5">
          <span
            data-chat-avatar=""
            data-bot-state={bot.status}
            className={cn(
              "grid size-[34px] shrink-0 place-items-center overflow-hidden rounded-[9px] border",
              bot.status === "working" || bot.status === "queued" ? "border-board-amber bg-board-amber text-board-ink" : "border-hairline bg-control",
            )}
          >
            <BotFace name={bot.name} look={look} size={26} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-1">
              <span data-chat-name="" className="truncate text-[15px] font-semibold leading-5 text-ink">{bot.name}</span>
              {bot.lead ? <Crown size={14} role="img" aria-label={t("boardPanels.team.lead")} className="shrink-0 text-warning" /> : null}
            </div>
            <div data-chat-role="" className="truncate text-[12px] leading-4 text-ink-tertiary">{bot.title}</div>
          </div>
          <BotStatus status={bot.status} />
          <button type="button" className="ui-icon-button size-7 shrink-0" aria-label={t("boardPanels.close")} title={t("boardPanels.close")} onClick={onClose}>
            <X size={16} aria-hidden="true" />
          </button>
        </header>
        {picking ? (
          <div data-chat-picker="" className="flex min-h-0 flex-1 flex-col overflow-y-auto px-3 pb-3">
            <ReferencePicker index={index} taken={taken} pictureUrl={pictureUrl} onAdd={add} onDone={closePicker} />
          </div>
        ) : <ChatExchange messages={messages} botName={bot.name} readError={readError} locale={locale} />}
        <div className={cn("flex flex-none flex-col gap-2 p-3", picking ? "border-t-0" : "border-t border-hairline")}>
          {bot.waiting ? <ChatWaiting bot={bot} waiting={bot.waiting} onOpenChat={() => backend.openChat(projectId, botId, bot.waiting!.threadId)} /> : null}
          <ReferenceTray connected={connected} extras={extras} botName={bot.name} pictureUrl={pictureUrl} pickerOpen={picking} onPick={() => (picking ? closePicker() : setPicking(true))} onRemove={remove} />
          {overReferences > 0 ? <p className="text-[12px] leading-4 text-danger">{t("boardPanels.chat.tooManyReferences", { max: CANVAS_TASK_REFERENCES_MAX, over: overReferences })}</p> : null}
          <textarea
            ref={composerRef}
            dir="auto"
            rows={3}
            value={session.draft}
            disabled={readOnly}
            aria-label={t("boardPanels.chat.message", { name: bot.name })}
            placeholder={t("boardPanels.chat.placeholder", { name: bot.name })}
            className={cn(
              "w-full resize-none rounded-[10px] border border-hairline bg-app px-3 py-2.5 text-[14px] leading-[1.55] text-ink outline-none placeholder:text-ink-tertiary focus:border-ink-secondary disabled:opacity-60",
              sheet ? "h-16" : "h-[92px]",
            )}
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
            <button
              type="button"
              data-chat-reference-pill=""
              aria-expanded={picking}
              title={t("boardPanels.chat.addReference")}
              className="inline-flex h-[34px] shrink-0 items-center gap-1.5 rounded-full border border-hairline pe-3.5 ps-3 text-[14px] leading-none text-ink-secondary transition-colors duration-[120ms] hover:bg-card hover:text-ink motion-reduce:transition-none"
              onClick={() => (picking ? closePicker() : setPicking(true))}
            >
              <AtSign size={15} aria-hidden="true" />
              {t("boardPanels.chat.mention")}
            </button>
            <span className="flex-1" />
            {busy ? (
              <button type="button" className="ui-button ui-button-sm" disabled={readOnly} onClick={stop}>
                <Square size={14} aria-hidden="true" />
                {t("boardPanels.chat.stop")}
              </button>
            ) : null}
            <button type="button" className="ui-button ui-button-sm" onClick={() => backend.openChat(projectId, botId, bot.output?.threadId)}>
              <ExternalLink size={14} aria-hidden="true" />
              {t("boardPanels.chat.openInChat")}
            </button>
            <button
              type="button"
              data-chat-send=""
              disabled={!sendable}
              onClick={() => void send()}
              className="inline-flex h-[34px] shrink-0 items-center gap-1.5 rounded-full bg-board-amber pe-4 ps-3 text-[14px] font-semibold leading-none text-board-ink transition-colors duration-[120ms] hover:brightness-105 disabled:bg-control disabled:text-ink-tertiary motion-reduce:transition-none"
            >
              {sending ? <LoaderCircle size={15} aria-hidden="true" className="animate-spin motion-reduce:animate-none" /> : <ArrowUp size={15} aria-hidden="true" />}
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
    const arrow = element.querySelector<HTMLElement>("[data-chat-arrow]");
    if (placement.mode !== "beside" || placement.arrow === null) {
      delete element.dataset.side;
      return;
    }
    element.dataset.side = placement.side;
    if (arrow) arrow.style.top = `${Math.round(placement.arrow) - 6}px`;
  }, [windowRef]);
  useLayoutEffect(() => {
    input.current = { anchorId: botNodeId(bot.botId), layer, reserved, anchorOf };
    place();
  });
  useLayoutEffect(() => subscribeView(place), [subscribeView, place]);
  useLayoutEffect(() => {
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

/** What the task names as its references: the bot's offered references the person kept, then what they added, leaving
 * out what is connected into the bot, which the server sends by itself. */
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
