import { memo, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type Dispatch, type KeyboardEvent, type ReactNode, type RefObject, type SetStateAction } from "react";
import { ArrowUp, Clapperboard, Drama, ExternalLink, File, FileText, Film, Image as ImageIcon, ListChecks, LoaderCircle, MessagesSquare, Mountain, Music, Plus, ScrollText, Square, Video, X, type LucideIcon } from "lucide-react";
import { episodeCode } from "../../../../shared/production";
import { botNodeId, CANVAS_TASK_REFERENCES_MAX, type CanvasBotState, type CanvasFileRef } from "../../../../shared/project-canvas";
import { AttachmentGallery } from "@/components/AttachmentGallery";
import { BotAvatar } from "@/components/Avatar";
import { ChatMarkdown } from "@/components/ChatMarkdown";
import { CitationBadge } from "@/components/CitationUI";
import { ThreadRefText } from "@/components/ThreadRefs";
import { atBottom, followBottomGrowth } from "@/lib/bottom-follow";
import { splitTranscriptCitations } from "@/lib/citations";
import { cn } from "@/lib/cn";
import { splitTranscriptAttachments } from "@/lib/composer-attachments";
import { activeLocale, t } from "@/lib/i18n";
import { assetCode, assetKindLabel } from "@/lib/production-board/asset-words";
import type { AssetKind, BoardAsset, BoardIndex } from "@/lib/production-board/board-index";
import type { BoardAnchor } from "@/lib/production-board/overlay";
import type { OverlayBackend } from "@/lib/production-board/overlay-backend";
import { botStatus, toneState } from "@/lib/production-board/status";
import { useViewFollow } from "@/lib/production-board/view-follow";
import { canvasErrorText } from "@/lib/project-canvas/backend";
import type { CanvasBotLook, CanvasExchangeMessage } from "@/lib/project-canvas/types";
import { sendsMessage, useSendKey } from "@/lib/send-key";
import { CHAT_SHEET_BELOW, placeChat } from "./chat-place";
import { ChatWaiting } from "./ChatWaiting";

/** What the person was writing to a bot and the references they added or took away, kept while its window is closed. */
export interface ChatSession {
  draft: string;
  /** Node ids. */
  added: readonly string[];
  /** Node ids of offered references the person took away. */
  removed: readonly string[];
}

const NEW_CHAT: ChatSession = { draft: "", added: [], removed: [] };
const SIZE_BEFORE_LAYOUT = { width: 420, height: 480 };

export interface ChatWindowProps {
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
  layer: { width: number; height: number };
  reserved: number;
  anchorOf(nodeId: string): BoardAnchor | null;
  subscribeView(listener: () => void): () => void;
  /** The board's zoom now: the arrow meets the bot's card at its head, which grows with it. */
  zoom(): number;
  /** Brings a reference's card into view. */
  focusNode?(cardId: string): void;
  onClose(): void;
}

const QUICK_JOBS = ["lead", "script", "character", "scene", "storyboard", "post"] as const;
type QuickJob = (typeof QUICK_JOBS)[number];

const jobOf = (bot: CanvasBotState): QuickJob | undefined =>
  bot.lead ? "lead" : bot.stages.find((stage): stage is QuickJob => (QUICK_JOBS as readonly string[]).includes(stage));

const MOCKUP_KINDS: Record<AssetKind, string> = {
  character: "char", scene: "scene", episode: "ep", shot: "shot", result: "result", final: "final", brief: "brief", plan: "tasks",
  text: "other", image: "other", video: "other", audio: "other", file: "other",
};

const KIND_ICONS: Record<AssetKind, LucideIcon> = {
  character: Drama, scene: Mountain, episode: ScrollText, shot: Clapperboard, result: Video, final: Film, brief: FileText, plan: ListChecks,
  text: FileText, image: ImageIcon, video: Video, audio: Music, file: File,
};

/** "EP01 SH03 · 船影", or the title alone for what belongs to no episode. */
const referenceName = (asset: BoardAsset): string => [assetCode(asset), asset.title].filter(Boolean).join(" · ");

/** A bot's chat beside its card: its latest exchange, the question it waits on, and a task to send with references. */
export const ChatWindow = memo(function ChatWindow(props: ChatWindowProps) {
  const { projectId, bot, look, index, backend, readOnly, pictureUrl, focusNode, onClose } = props;
  const botId = bot.botId;
  const windowRef = useRef<HTMLElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const pickerId = useId();
  usePlace(windowRef, props);
  const [session, setSession] = useSession(props);
  const connected = useMemo(() => index.connectedInto(botId), [index, botId]);
  const library = useMemo(() => index.libraryFor(botId), [index, botId]);
  const extras = useMemo(() => trayExtras(index, connected, library, session), [index, connected, library, session]);
  const taken = useMemo(() => new Set([...connected, ...extras]), [connected, extras]);
  const [picking, setPicking] = useState(false);
  const [threadShown, setThreadShown] = useState(true);
  const [sent, setSent] = useState(0);
  const { messages, readError } = useExchange(backend, projectId, bot, sent);
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const sendKey = useSendKey();
  useReadsReplies(backend, projectId, bot, look);
  useEffect(() => composerRef.current!.focus({ preventScroll: true }), []);
  const status = botStatus(bot);
  const job = jobOf(bot);
  const words = session.draft.trim();
  const busy = bot.status === "working" || bot.status === "queued";
  const overReferences = extras.length - CANVAS_TASK_REFERENCES_MAX;
  const takesTask = !sending && !readOnly && overReferences <= 0;
  const count = connected.length + extras.length;

  const send = async (text: string, fromDraft: boolean) => {
    if (!text || !takesTask) return;
    setSending(true);
    setProblem(null);
    setNotice(null);
    setPicking(false);
    setThreadShown(true);
    try {
      const response = await backend.sendTask(projectId, { botId, text, references: extras.map((asset) => asset.node.id), language: activeLocale() });
      if (fromDraft) setSession((current) => ({ ...current, draft: "" }));
      if (response.queued) setNotice(t("boardPanels.chat.queued", { name: bot.name }));
      setSent((sentBefore) => sentBefore + 1);
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
    composerRef.current!.focus({ preventScroll: true });
  };
  const togglePicker = () => (picking ? closePicker() : setPicking(true));
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== "Escape" || event.nativeEvent.isComposing) return;
    event.preventDefault();
    event.stopPropagation();
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
      className={cn("bchat", props.layer.width < CHAT_SHEET_BELOW && "is-sheet", picking && "is-picking", !threadShown && "no-thread")}
      role="dialog"
      aria-label={t("boardPanels.chat.label", { name: bot.name })}
      data-board-chat=""
      data-state={toneState(status.tone)}
      onKeyDown={onKeyDown}
    >
      <header className="bc-head">
        <span className="bc-ava" aria-hidden="true"><BotAvatar bot={{ name: bot.name, ...look }} size={34} /></span>
        <div className="bc-who">
          <b>{bot.name}</b>
          <span>{[bot.title, bot.episode === undefined ? "" : episodeCode(bot.episode)].filter(Boolean).join(" · ")}</span>
        </div>
        <span className="bc-st"><i className="led" /><span>{status.label}</span></span>
        <button type="button" className="tbtn" aria-label={t("boardPanels.close")} title={t("boardPanels.close")} onClick={onClose}>
          <X className="ic" aria-hidden="true" />
        </button>
      </header>
      <div className="bc-thread">
        <ChatLog messages={messages} readError={readError} botName={bot.name} shown={threadShown} waitingId={bot.waiting?.messageId}>
          {bot.waiting ? <ChatWaiting bot={bot} waiting={bot.waiting} onOpenChat={() => backend.openChat(projectId, botId, bot.waiting!.threadId)} /> : null}
        </ChatLog>
        {job && !readOnly ? (
          <div className="quick">
            {([1, 2] as const).map((number) => {
              const question = t(`boardPanels.chat.quick.${job}.${number}`);
              return <button key={number} type="button" className="qbtn" disabled={!takesTask} onClick={() => void send(question, false)}>{question}</button>;
            })}
          </div>
        ) : null}
      </div>
      <div className="bc-picker" id={pickerId} hidden={!picking}>
        {picking ? <ReferencePicker index={index} taken={taken} pictureUrl={pictureUrl} onAdd={add} onDone={closePicker} /> : null}
      </div>
      <div className="bc-compose">
        <div className="bc-lbl">
          <b>{t("boardPanels.chat.references")}</b>
          <span>{count ? (count === 1 ? t("boardPanels.chat.referenceCount.one") : t("boardPanels.chat.referenceCount", { count })) : null}</span>
        </div>
        <div className="bc-refs">
          {connected.map((asset) => <ReferenceTile key={asset.cardId} asset={asset} locked botName={bot.name} pictureUrl={pictureUrl} focusNode={focusNode} />)}
          {extras.map((asset) => <ReferenceTile key={asset.cardId} asset={asset} botName={bot.name} pictureUrl={pictureUrl} focusNode={focusNode} onRemove={remove} />)}
          <button type="button" className="rt-add" aria-expanded={picking} aria-controls={pickerId} aria-label={t("boardPanels.chat.addReference")} title={t("boardPanels.chat.addReference")} onClick={togglePicker}>
            <Plus className="ic" aria-hidden="true" />
          </button>
        </div>
        {overReferences > 0 ? <p className="bc-note is-bad">{t("boardPanels.chat.tooManyReferences", { max: CANVAS_TASK_REFERENCES_MAX, over: overReferences })}</p> : null}
        <textarea
          ref={composerRef}
          className="bc-input"
          dir="auto"
          rows={3}
          value={session.draft}
          disabled={readOnly}
          aria-label={t("boardPanels.chat.message", { name: bot.name })}
          placeholder={t("boardPanels.chat.placeholder", { name: bot.name })}
          onInput={(event) => {
            const draft = event.currentTarget.value;
            setSession((current) => ({ ...current, draft }));
          }}
          onKeyDown={(event) => {
            if (!sendsMessage(event.nativeEvent, sendKey)) return;
            event.preventDefault();
            void send(words, true);
          }}
        />
        {readOnly ? <p className="bc-note">{t("boardPanels.chat.readOnly")}</p> : null}
        {problem ? <p role="alert" className="bc-note is-bad">{problem}</p> : null}
        {notice ? <p role="status" className="bc-note">{notice}</p> : null}
        <div className="bc-actions">
          <button type="button" className="bc-pill" aria-pressed={threadShown} aria-label={t("boardPanels.chat.threadToggle")} onClick={() => setThreadShown((shown) => !shown)}>
            <MessagesSquare className="ic" aria-hidden="true" />
            {t("boardPanels.chat.thread")}
          </button>
          {busy ? (
            <button type="button" className="bc-pill" disabled={readOnly} onClick={stop}>
              <Square className="ic" aria-hidden="true" />
              {t("boardPanels.chat.stop")}
            </button>
          ) : null}
          <button type="button" className="bc-pill" onClick={() => backend.openChat(projectId, botId, bot.output?.threadId)}>
            <ExternalLink className="ic" aria-hidden="true" />
            {t("boardPanels.chat.openInChat")}
          </button>
          <button type="button" className="bc-send" disabled={!words || !takesTask} onClick={() => void send(words, true)}>
            {sending ? <LoaderCircle className="ic spin" aria-hidden="true" /> : <ArrowUp className="ic" aria-hidden="true" />}
            {t("boardPanels.chat.send")}
          </button>
        </div>
      </div>
    </section>
  );
});

interface ChatLogProps {
  /** Null until the first read comes back. */
  messages: readonly CanvasExchangeMessage[] | null;
  readError: string | null;
  botName: string;
  shown: boolean;
  waitingId: string | undefined;
  children: ReactNode;
}

/** The bot's latest exchange, kept scrolled to its end while the person reads at the end. */
function ChatLog({ messages, readError, botName, shown, waitingId, children }: ChatLogProps) {
  const logRef = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  useLayoutEffect(() => {
    if (!shown) return;
    const log = logRef.current!;
    const follow = () => followBottomGrowth(log, following.current);
    follow();
    const observer = new ResizeObserver(follow);
    for (const row of log.children) observer.observe(row);
    return () => observer.disconnect();
  }, [messages, readError, shown, waitingId]);
  return (
    <div ref={logRef} className="chat-log" role="log" aria-live="polite" aria-label={botName} onScroll={() => (following.current = atBottom(logRef.current!))}>
      {readError ? <p className="msg sys" role="alert">{readError}</p> : null}
      {messages === null && !readError ? <p className="msg bot typing" role="img" aria-label={t("boardPanels.chat.loading")}><i /><i /><i /></p> : null}
      {messages?.length === 0 ? <p className="msg sys">{t("boardPanels.chat.empty", { name: botName })}</p> : null}
      {messages?.map((message) => <ExchangeRow key={message.id} message={message} botName={botName} />)}
      {children}
    </div>
  );
}

const ExchangeRow = memo(function ExchangeRow({ message, botName }: { message: CanvasExchangeMessage; botName: string }) {
  return message.role === "person" ? (
    <div className="msg me" dir="auto">
      <span className="sr-only">{t("boardPanels.chat.you")}: </span>
      <SentText text={message.text} />
    </div>
  ) : (
    <div className="msg bot" dir="auto">
      <span className="sr-only">{botName}: </span>
      <ChatMarkdown text={message.text} />
    </div>
  );
}, (before, after) => before.botName === after.botName && before.message.id === after.message.id && before.message.role === after.message.role && before.message.text === after.message.text);

/** A person's message as the chat shows it: its pictures and files, its words, then what it cites. */
function SentText({ text }: { text: string }) {
  const cited = splitTranscriptCitations(text);
  const { display, images, files } = splitTranscriptAttachments(cited.display);
  return (
    <>
      {images.length || files.length ? <AttachmentGallery images={images} files={files} /> : null}
      {display ? <p><ThreadRefText text={display} /></p> : null}
      {cited.citations.length ? <span className="mrefs">{cited.citations.map((citation) => <CitationBadge key={citation.id} citation={citation} />)}</span> : null}
    </>
  );
}

function Thumb({ asset, pictureUrl }: { asset: BoardAsset; pictureUrl(file: CanvasFileRef): string }) {
  const file = asset.media?.type === "image" ? asset.media.metadata?.file : undefined;
  const Icon = KIND_ICONS[asset.kind];
  return file ? <img src={pictureUrl(file)} alt="" loading="lazy" draggable={false} /> : <Icon className="ic" aria-hidden="true" />;
}

interface ReferenceTileProps {
  asset: BoardAsset;
  /** Connected into the bot's card: the server sends it with every task, and only the board takes it away. */
  locked?: boolean;
  botName: string;
  pictureUrl(file: CanvasFileRef): string;
  focusNode?(cardId: string): void;
  onRemove?(asset: BoardAsset): void;
}

function ReferenceTile({ asset, locked = false, botName, pictureUrl, focusNode, onRemove }: ReferenceTileProps) {
  const about = `${assetKindLabel(asset)} · ${asset.title}`;
  return (
    <span className={cn("rt", `rt-${MOCKUP_KINDS[asset.kind]}`, locked && "is-locked")} title={locked ? `${about}\n${t("boardPanels.chat.connected", { name: botName })}` : about}>
      <button type="button" className="rt-main" aria-label={about} onClick={() => focusNode?.(asset.cardId)}>
        <Thumb asset={asset} pictureUrl={pictureUrl} />
        <span className="rt-tag">{assetCode(asset) || asset.title}</span>
      </button>
      {onRemove && !locked ? (
        <button type="button" className="rt-x" aria-label={t("boardPanels.chat.removeReference", { title: asset.title })} onClick={() => onRemove(asset)}>
          <X className="ic" aria-hidden="true" />
        </button>
      ) : null}
    </span>
  );
}

interface ReferencePickerProps {
  index: BoardIndex;
  /** What the tray holds already, which the picker leaves out. */
  taken: ReadonlySet<BoardAsset>;
  pictureUrl(file: CanvasFileRef): string;
  onAdd(asset: BoardAsset): void;
  onDone(): void;
}

/** Every asset of the project not in the tray yet, by kind, to add to the task with a click. */
function ReferencePicker({ index, taken, pictureUrl, onAdd, onDone }: ReferencePickerProps) {
  const filterRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  useEffect(() => filterRef.current!.focus({ preventScroll: true }), []);
  const groups = useMemo(() => [
    { label: t("boardPanels.chat.group.scripts"), assets: index.scripts },
    { label: t("boardPanels.assets.characters"), assets: index.characters },
    { label: t("boardPanels.assets.scenes"), assets: index.scenes },
    { label: t("boardPanels.assets.shots"), assets: index.shotsByEpisode.flatMap((group) => group.shots) },
    { label: t("boardPanels.chat.group.results"), assets: index.results },
    { label: t("boardPanels.chat.group.documents"), assets: [...index.documents, ...index.finals, ...index.others] },
  ], [index]);
  const needle = query.trim().toLowerCase();
  const shown = groups
    .map((group) => ({ ...group, assets: group.assets.filter((asset) => !taken.has(asset) && (!needle || referenceName(asset).toLowerCase().includes(needle))) }))
    .filter((group) => group.assets.length);
  return (
    <>
      <header className="pk-head">
        <b>{t("boardPanels.chat.pickerTitle")}</b>
        <button type="button" className="lnk" onClick={onDone}>{t("boardPanels.chat.pickerDone")}</button>
      </header>
      <input
        ref={filterRef}
        className="pk-filter"
        type="text"
        dir="auto"
        value={query}
        aria-label={t("boardPanels.chat.pickerFilter")}
        placeholder={t("boardPanels.chat.pickerFilter")}
        onChange={(event) => setQuery(event.target.value)}
      />
      {shown.length ? shown.map((group) => (
        <div key={group.label}>
          <p className="pk-lbl">{group.label}</p>
          <div className="pk-list">
            {group.assets.map((asset) => (
              <button key={asset.cardId} type="button" className="pk" onClick={() => onAdd(asset)}>
                <span className="pk-th" aria-hidden="true"><Thumb asset={asset} pictureUrl={pictureUrl} /></span>
                <span title={referenceName(asset)}>{referenceName(asset)}</span>
              </button>
            ))}
          </div>
        </div>
      )) : <p className="pk-empty">{t("boardPanels.chat.pickerEmpty")}</p>}
    </>
  );
}

/** Beside the card, docked or a sheet: set on the element itself whenever the board moves, the window resizes or the
 * layer does, so a move of the board draws nothing. */
function usePlace(windowRef: RefObject<HTMLElement | null>, { bot, layer, reserved, anchorOf, subscribeView, zoom }: ChatWindowProps): void {
  const input = useRef({ anchorId: botNodeId(bot.botId), layer, reserved, anchorOf, zoom });
  const place = useCallback(() => {
    const element = windowRef.current;
    if (!element) return;
    const { anchorId, layer, reserved, anchorOf, zoom } = input.current;
    const size = { width: element.offsetWidth || SIZE_BEFORE_LAYOUT.width, height: element.offsetHeight || SIZE_BEFORE_LAYOUT.height };
    const spot = placeChat(anchorOf(anchorId), size, layer, reserved, zoom());
    element.classList.toggle("is-sheet", spot.sheet);
    if (spot.sheet) {
      element.style.transform = "";
      element.style.removeProperty("--ty");
      element.dataset.side = "none";
      return;
    }
    element.style.transform = `translate(${spot.left}px, ${spot.top}px)`;
    element.style.setProperty("--ty", `${spot.arrowY}px`);
    element.dataset.side = spot.side;
  }, [windowRef]);
  useLayoutEffect(() => {
    input.current = { anchorId: botNodeId(bot.botId), layer, reserved, anchorOf, zoom };
    place();
  });
  const follow = useViewFollow(subscribeView);
  useLayoutEffect(() => follow(place), [follow, place]);
  useLayoutEffect(() => {
    const observer = new ResizeObserver(() => place());
    observer.observe(windowRef.current!);
    return () => observer.disconnect();
  }, [windowRef, place]);
}

function useSession({ bot, index, references, sessions }: ChatWindowProps): [ChatSession, Dispatch<SetStateAction<ChatSession>>] {
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
