// Adapted from basketikun/infinite-canvas@9cd3deac web/src/components/canvas/canvas-node-prompt-panel.tsx, MIT License, Copyright (c) 2026 basketikun (full text in third_party/infinite-canvas/LICENSE)
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { ArrowUp, ExternalLink, LoaderCircle, Maximize2, MessagesSquare, Minimize2, Settings, Square } from "lucide-react";
import { botIdOfNode, generationKindOf, type CanvasNode } from "../../../shared/project-canvas";
import { connectedReferences, mentionReferences, referenceCounts, referenceFiles } from "../../../shared/project-canvas-references";
import type { GenerationKind } from "../../../shared/project-generation";
import { AttachmentGallery } from "@/components/AttachmentGallery";
import { FOLDED_SENT_TEXT, foldsSentText } from "@/components/chat-bubble";
import { ChatMarkdown } from "@/components/ChatMarkdown";
import { CitationBadge } from "@/components/CitationUI";
import { Select } from "@/components/Select";
import { Segmented } from "@/components/SettingsPrimitives";
import { ThreadRefText } from "@/components/ThreadRefs";
import { atBottom, followBottomGrowth, useBottomFollowResize } from "@/lib/bottom-follow";
import { splitTranscriptCitations } from "@/lib/citations";
import { cn } from "@/lib/cn";
import { splitTranscriptAttachments } from "@/lib/composer-attachments";
import { t } from "@/lib/i18n";
import { canvasErrorText } from "@/lib/project-canvas/backend";
import { referenceProblems } from "@/lib/project-canvas/settings";
import type { CanvasExchangeMessage } from "@/lib/project-canvas/types";
import { serverErrorText } from "@/lib/server-error";
import { useCanvasUi } from "./canvas-ui";
import { shotOf } from "./node-kinds";
import { ModelPicker, PANEL_SURFACE, PanelLabel, problemText, PromptInput, ReferenceBar, SettingsPopover } from "./panel-parts";
import { WaitingCard } from "./WaitingCard";

export function NodePanel({ node }: { node: CanvasNode }) {
  switch (node.type) {
    case "bot": return <BotPanel node={node} />;
    case "text": return <TextPanel node={node} />;
    case "shot": return <ShotPanel node={node} />;
    case "config": return node.metadata?.role === "creation" ? <CreationPanel node={node} /> : <PromptPanel node={node} />;
    case "image":
    case "video": return <PromptPanel node={node} />;
    default: return null;
  }
}

/** A field's text that survives switching to another node and back. */
function useDraft(nodeId: string, initial: string): [string, (value: string) => void] {
  const ui = useCanvasUi();
  const [value, setValue] = useState(() => ui.drafts.get(nodeId) ?? initial);
  const update = (next: string) => {
    setValue(next);
    ui.drafts.set(nodeId, next);
  };
  return [value, update];
}

/** Starting and stopping a node's generation from its panel, with the refusal to show beside the button. */
function useGenerating(node: CanvasNode) {
  const ui = useCanvasUi();
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const start = async (prompt: string) => {
    setBusy(true);
    setRefusal(null);
    try {
      const refused = await ui.controller.generate(node.id, prompt);
      if (refused) setRefusal(serverErrorText(refused, refused.error));
      else ui.drafts.delete(node.id);
    } catch (error) {
      setRefusal(canvasErrorText(error));
    } finally {
      setBusy(false);
    }
  };
  const stop = async () => {
    setRefusal(null);
    try {
      await ui.controller.cancelGeneration(node.id);
    } catch (error) {
      setRefusal(canvasErrorText(error));
    }
  };
  return { busy, refusal, start, stop, loading: node.metadata?.status === "loading" };
}

/** What stands in the way of generating: what the model doesn't take, the server's refusal, and no server chosen. */
function GenerationNotes({ node, kind, refusal }: { node: CanvasNode; kind: GenerationKind; refusal: string | null }) {
  const ui = useCanvasUi();
  const project = ui.state.generation?.settings;
  const models = ui.state.models[kind];
  const counts = referenceCounts(referenceFiles(mentionReferences(node.id, ui.snapshot.nodes, ui.snapshot.connections)));
  const problems = project ? referenceProblems(kind, project, node, models ?? [], counts) : [];
  return (
    <>
      {problems.map((problem) => <p key={problem.key} role="alert" className="text-[12px] leading-4 text-danger">{problemText(problem, models)}</p>)}
      {refusal ? <p role="alert" className="text-[12px] leading-4 text-danger">{refusal}</p> : null}
      {project?.[kind].server ? null : (
        <div className="flex items-center gap-2 text-[12px] leading-4 text-ink-secondary">
          <span className="flex-1">{t("projectCanvas.generate.noServer")}</span>
          <button type="button" className="ui-button ui-button-sm" onClick={() => ui.openSettings()}>
            <Settings size={14} aria-hidden="true" />
            {t("projectCanvas.settings.open")}
          </button>
        </div>
      )}
    </>
  );
}

/** The panel's last row: the node's model and settings, then Generate, or Stop while its generation runs. */
function GenerationRow({ node, kind, generating, canStart, onStart, children }: {
  node: CanvasNode;
  kind: GenerationKind;
  generating: ReturnType<typeof useGenerating>;
  canStart: boolean;
  onStart: () => void;
  children?: ReactNode;
}) {
  const ui = useCanvasUi();
  const project = ui.state.generation?.settings;
  return (
    <div className="flex items-center gap-2">
      {children}
      {project ? <ModelPicker node={node} kind={kind} project={project} /> : null}
      {project ? <SettingsPopover node={node} kind={kind} project={project} /> : null}
      <span className="flex-1" />
      {generating.loading ? (
        <button type="button" className="ui-button ui-button-md" disabled={ui.readOnly} onClick={() => void generating.stop()}>
          <Square size={14} aria-hidden="true" />
          {t("projectCanvas.generate.stop")}
        </button>
      ) : (
        <button type="button" className="ui-button ui-button-md ui-button-primary" disabled={ui.readOnly || generating.busy || !canStart} onClick={onStart}>
          {generating.busy ? <LoaderCircle size={14} aria-hidden="true" className="animate-spin motion-reduce:animate-none" /> : <ArrowUp size={14} aria-hidden="true" />}
          {t("projectCanvas.generate.start")}
        </button>
      )}
    </div>
  );
}

function PromptPanel({ node }: { node: CanvasNode }) {
  const ui = useCanvasUi();
  const kind = generationKindOf(node) ?? "image";
  const [prompt, setPrompt] = useDraft(node.id, node.metadata?.prompt ?? "");
  const [expanded, setExpanded] = useState(false);
  const generating = useGenerating(node);
  const mentions = mentionReferences(node.id, ui.snapshot.nodes, ui.snapshot.connections);
  const keepPrompt = () => {
    if (prompt !== (node.metadata?.prompt ?? "")) ui.updateMetadata(node.id, { prompt });
  };
  const generate = () => void generating.start(prompt.trim());
  return (
    <div className={PANEL_SURFACE}>
      {node.type === "config" ? (
        <Segmented
          label={t("projectCanvas.config.mode")}
          value={kind}
          disabled={ui.readOnly}
          options={[{ value: "image", label: t("projectCanvas.nodeType.image") }, { value: "video", label: t("projectCanvas.nodeType.video") }]}
          onChange={(generationMode) => ui.updateMetadata(node.id, { generationMode })}
        />
      ) : null}
      <ReferenceBar node={node} references={mentions} />
      <div className={cn("flex flex-col", expanded && "[&_textarea]:min-h-72")} onBlur={keepPrompt}>
        <PromptInput
          value={prompt}
          onChange={setPrompt}
          references={mentions}
          label={t("projectCanvas.generate.prompt")}
          placeholder={kind === "image" ? t("projectCanvas.generate.imagePlaceholder") : t("projectCanvas.generate.videoPlaceholder")}
          disabled={ui.readOnly}
          onSubmit={generate}
        />
      </div>
      <GenerationNotes node={node} kind={kind} refusal={generating.refusal} />
      <GenerationRow node={node} kind={kind} generating={generating} canStart={Boolean(prompt.trim())} onStart={generate}>
        <button type="button" className="ui-icon-button" aria-label={expanded ? t("projectCanvas.generate.collapse") : t("projectCanvas.generate.expand")} title={expanded ? t("projectCanvas.generate.collapse") : t("projectCanvas.generate.expand")} onClick={() => setExpanded((value) => !value)}>
          {expanded ? <Minimize2 size={16} aria-hidden="true" /> : <Maximize2 size={16} aria-hidden="true" />}
        </button>
      </GenerationRow>
    </div>
  );
}

/** A shot holds its description. Its video is generated from its creation node, which also holds its references. */
function ShotPanel({ node }: { node: CanvasNode }) {
  const ui = useCanvasUi();
  const [prompt, setPrompt] = useDraft(node.id, node.metadata?.prompt ?? "");
  const mentions = mentionReferences(node.id, ui.snapshot.nodes, ui.snapshot.connections);
  const creation = ui.snapshot.nodes.find((candidate) => candidate.metadata?.role === "creation" && candidate.metadata.shotId === node.id);
  const keepPrompt = () => {
    if (prompt !== (node.metadata?.prompt ?? "")) ui.updateMetadata(node.id, { prompt });
    ui.drafts.delete(node.id);
  };
  return (
    <div className={PANEL_SURFACE}>
      <ReferenceBar node={node} references={mentions} into={creation?.id} />
      <div className="flex flex-col" onBlur={keepPrompt}>
        <PromptInput
          value={prompt}
          onChange={setPrompt}
          references={mentions}
          label={t("projectCanvas.shot.prompt")}
          placeholder={t("projectCanvas.shot.promptPlaceholder")}
          disabled={ui.readOnly}
          onSubmit={keepPrompt}
        />
      </div>
    </div>
  );
}

/** A shot's creation node generates the shot's video from the shot's description, with its own references, model and
 * settings. */
function CreationPanel({ node }: { node: CanvasNode }) {
  const ui = useCanvasUi();
  const generating = useGenerating(node);
  const shot = shotOf(node, ui.snapshot.nodes);
  const own = node.metadata?.prompt ?? "";
  const described = Boolean(own.trim() || shot?.metadata?.prompt?.trim());
  return (
    <div className={PANEL_SURFACE}>
      <ReferenceBar node={node} references={mentionReferences(node.id, ui.snapshot.nodes, ui.snapshot.connections)} />
      {described ? null : <p className="text-[12px] leading-4 text-ink-secondary">{shot ? t("projectCanvas.creation.noShotPrompt") : t("projectCanvas.creation.noShot")}</p>}
      <GenerationNotes node={node} kind="video" refusal={generating.refusal} />
      <GenerationRow node={node} kind="video" generating={generating} canStart={described} onStart={() => void generating.start(own)} />
    </div>
  );
}

/** Reads a bot's conversation as its chat would: when its panel opens, and as replies come in while the panel stays open
 * and the person is at the window. */
function useReadsConversation(botId: string) {
  const ui = useCanvasUi();
  const unread = ui.state.looks[botId]?.unread;
  const opening = useRef(true);
  useEffect(() => {
    if (unread && (opening.current || document.hasFocus())) ui.controller.readConversation(botId);
    opening.current = false;
  }, [botId, unread, ui.controller]);
}

/** Keeps a conversation at its latest message as the chat keeps its transcript: it opens there, follows what comes in
 * while the reader stays at the end, and leaves a reader who has scrolled up where they are. */
function useFollowsLatest(openKey: string | null) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  useLayoutEffect(() => {
    following.current = true;
  }, [openKey]);
  const follow = useCallback(() => {
    if (scrollRef.current) followBottomGrowth(scrollRef.current, following.current);
  }, []);
  useBottomFollowResize(scrollRef, listRef, openKey, follow);
  const onScroll = useCallback(() => {
    if (scrollRef.current) following.current = atBottom(scrollRef.current);
  }, []);
  return { scrollRef, listRef, onScroll };
}

function BotPanel({ node }: { node: CanvasNode }) {
  const ui = useCanvasUi();
  const botId = botIdOfNode(node.id) ?? "";
  const bot = ui.snapshot.bots[botId];
  const [text, setText] = useDraft(node.id, "");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exchangeOpen, setExchangeOpen] = useState(false);
  const [exchange, setExchange] = useState<CanvasExchangeMessage[] | null>(null);
  const outputId = bot?.output?.messageId;
  const latest = useFollowsLatest(exchangeOpen ? botId : null);
  useReadsConversation(botId);
  useEffect(() => {
    if (!exchangeOpen) return;
    let live = true;
    ui.controller.readExchange(botId).then((messages) => live && setExchange(messages), (cause: unknown) => live && setError(canvasErrorText(cause)));
    return () => {
      live = false;
    };
  }, [exchangeOpen, outputId, botId, ui.controller]);
  if (!bot) return null;
  const references = connectedReferences(node.id, ui.snapshot.nodes, ui.snapshot.connections);
  const busy = bot.status === "working" || bot.status === "queued";
  const send = async () => {
    if (!text.trim()) return;
    setSending(true);
    setError(null);
    try {
      const response = await ui.controller.sendTask({ botId, text: text.trim() });
      setText("");
      if (response.queued) ui.showNotice(t("projectCanvas.bot.queued", { name: bot.name }));
    } catch (cause) {
      setError(canvasErrorText(cause));
    } finally {
      setSending(false);
    }
  };
  return (
    <div className={PANEL_SURFACE}>
      <ReferenceBar node={node} references={references} />
      {bot.waiting ? <WaitingCard bot={bot} waiting={bot.waiting} onOpenChat={() => ui.controller.openChat(botId, bot.waiting?.threadId)} /> : null}
      <PromptInput
        value={text}
        onChange={setText}
        references={references}
        label={t("projectCanvas.bot.message", { name: bot.name })}
        placeholder={t("projectCanvas.bot.placeholder", { name: bot.name })}
        disabled={ui.readOnly}
        onSubmit={() => void send()}
      />
      {error ? <p role="alert" className="text-[12px] leading-4 text-danger">{error}</p> : null}
      <div className="flex items-center gap-2">
        <button type="button" className="ui-button ui-button-md" aria-expanded={exchangeOpen} onClick={() => setExchangeOpen((value) => !value)}>
          <MessagesSquare size={14} aria-hidden="true" />
          {t("projectCanvas.bot.conversation")}
        </button>
        <span className="flex-1" />
        {busy ? (
          <button type="button" className="ui-button ui-button-md" disabled={ui.readOnly} onClick={() => void ui.controller.stopBot(botId)}>
            <Square size={14} aria-hidden="true" />
            {t("projectCanvas.bot.stop")}
          </button>
        ) : null}
        <button type="button" className="ui-button ui-button-md ui-button-primary" disabled={ui.readOnly || sending || !text.trim()} onClick={() => void send()}>
          {sending ? <LoaderCircle size={14} aria-hidden="true" className="animate-spin motion-reduce:animate-none" /> : <ArrowUp size={14} aria-hidden="true" />}
          {t("projectCanvas.bot.send")}
        </button>
      </div>
      {exchangeOpen ? (
        <div className="flex flex-col gap-3 border-t border-hairline pt-3">
          <div ref={latest.scrollRef} data-panel-conversation="" className="max-h-72 overflow-y-auto" onScroll={latest.onScroll}>
            <div ref={latest.listRef} className="flex flex-col gap-3">
              {exchange === null ? <LoaderCircle size={16} aria-label={t("projectCanvas.loading")} className="animate-spin text-ink-tertiary motion-reduce:animate-none" /> : null}
              {exchange?.length === 0 ? <p className="text-[12px] leading-4 text-ink-tertiary">{t("projectCanvas.bot.noExchange")}</p> : null}
              {exchange?.map((message) => (
                <div key={message.id} className="flex flex-col gap-1">
                  <span className="text-[12px] font-medium leading-4 text-ink-secondary">{message.role === "person" ? t("projectCanvas.bot.you") : bot.name}</span>
                  <div dir="auto" className="text-[13px] leading-[18px] text-ink">{message.role === "person" ? <SentMessage text={message.text} /> : <ChatMarkdown text={message.text} />}</div>
                </div>
              ))}
            </div>
          </div>
          <button type="button" className="ui-button ui-button-sm self-start" onClick={() => ui.controller.openChat(botId, bot.output?.threadId)}>
            <ExternalLink size={14} aria-hidden="true" />
            {t("projectCanvas.bot.openChat")}
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** A person's message as the chat shows it: its pictures and files, then its words, folded when long. */
function SentMessage({ text }: { text: string }) {
  const [unfolded, setUnfolded] = useState(false);
  const cited = splitTranscriptCitations(text);
  const { display, images, files } = splitTranscriptAttachments(cited.display);
  const folds = foldsSentText(display);
  return (
    <>
      <AttachmentGallery images={images} files={files} className={cn("w-64", !display && "mb-0")} />
      {display ? <div className={cn("whitespace-pre-wrap [overflow-wrap:anywhere]", folds && !unfolded && FOLDED_SENT_TEXT)}><ThreadRefText text={display} /></div> : null}
      {cited.citations.length ? <div className="mt-2 flex flex-wrap gap-1.5">{cited.citations.map((citation) => <CitationBadge key={citation.id} citation={citation} />)}</div> : null}
      {folds ? (
        <button type="button" className="mt-1 text-[13px] text-ink-secondary hover:text-ink" onClick={() => setUnfolded((open) => !open)}>
          {unfolded ? t("chat.showLess") : t("chat.showFull")}
        </button>
      ) : null}
    </>
  );
}

function TextPanel({ node }: { node: CanvasNode }) {
  const ui = useCanvasUi();
  const bots = Object.values(ui.snapshot.bots).sort((a, b) => Number(b.lead) - Number(a.lead) || a.name.localeCompare(b.name));
  const author = node.createdBy?.kind === "bot" ? node.createdBy.botId : undefined;
  const [botId, setBotId] = useState(() => (author && ui.snapshot.bots[author] ? author : bots[0]?.botId ?? ""));
  const [request, setRequest] = useDraft(node.id, "");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const fillingIn = ui.state.writing[node.id];
  const writers = new Set([...(fillingIn ? [fillingIn.botId] : []), ...ui.state.replies.filter((reply) => reply.nodeId === node.id).map((reply) => reply.botId)]);
  const bot = ui.snapshot.bots[botId];
  const mentions = mentionReferences(node.id, ui.snapshot.nodes, ui.snapshot.connections);
  const placeholder = node.metadata?.content?.trim() ? "projectCanvas.text.revisePlaceholder" : "projectCanvas.text.requestPlaceholder";
  const send = async () => {
    if (!request.trim() || !bot) return;
    setSending(true);
    setError(null);
    try {
      await ui.controller.sendTask({ botId, text: request.trim(), targetNodeId: node.id });
      setRequest("");
    } catch (cause) {
      setError(canvasErrorText(cause));
    } finally {
      setSending(false);
    }
  };
  return (
    <div className={PANEL_SURFACE}>
      <ReferenceBar node={node} references={mentions} />
      <div className="flex items-center gap-2">
        <PanelLabel>{t("projectCanvas.text.writer")}</PanelLabel>
        <Select size="sm" aria-label={t("projectCanvas.text.writer")} value={botId} disabled={ui.readOnly || !bots.length} onChange={(event) => setBotId(event.target.value)}>
          {bots.map((candidate) => <option key={candidate.botId} value={candidate.botId}>{candidate.name}</option>)}
        </Select>
      </div>
      <PromptInput
        value={request}
        onChange={setRequest}
        references={mentions}
        label={t("projectCanvas.text.request")}
        placeholder={t(placeholder, { name: bot?.name ?? "" })}
        disabled={ui.readOnly || !bot}
        onSubmit={() => void send()}
      />
      {error ? <p role="alert" className="text-[12px] leading-4 text-danger">{error}</p> : null}
      <div className="flex items-center justify-end gap-2">
        {writers.size ? (
          <button type="button" className="ui-button ui-button-md" disabled={ui.readOnly} onClick={() => writers.forEach((writer) => void ui.controller.stopBot(writer))}>
            <Square size={14} aria-hidden="true" />
            {t("projectCanvas.bot.stop")}
          </button>
        ) : null}
        <button type="button" className="ui-button ui-button-md ui-button-primary" disabled={ui.readOnly || sending || Boolean(fillingIn) || !request.trim() || !bot} onClick={() => void send()}>
          {sending ? <LoaderCircle size={14} aria-hidden="true" className="animate-spin motion-reduce:animate-none" /> : <ArrowUp size={14} aria-hidden="true" />}
          {t("projectCanvas.text.ask", { name: bot?.name ?? "" })}
        </button>
      </div>
    </div>
  );
}
