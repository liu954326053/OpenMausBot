// Adapted from basketikun/infinite-canvas@9cd3deac web/src/components/canvas/canvas-node-prompt-panel.tsx, MIT License, Copyright (c) 2026 basketikun (full text in third_party/infinite-canvas/LICENSE)
import { useEffect, useState } from "react";
import { ArrowUp, ExternalLink, LoaderCircle, Maximize2, MessagesSquare, Minimize2, Settings, Square } from "lucide-react";
import { botIdOfNode, generationKindOf, type CanvasNode } from "../../../shared/project-canvas";
import { connectedReferences, mentionReferences, referenceCounts, referenceFiles } from "../../../shared/project-canvas-references";
import { ChatMarkdown } from "@/components/ChatMarkdown";
import { Select } from "@/components/Select";
import { Segmented } from "@/components/SettingsPrimitives";
import { approvalDetailText } from "@/lib/approval-summary";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { canvasErrorText } from "@/lib/project-canvas/backend";
import { referenceProblems } from "@/lib/project-canvas/settings";
import type { CanvasExchangeMessage } from "@/lib/project-canvas/types";
import { serverErrorText } from "@/lib/server-error";
import { useCanvasUi } from "./canvas-ui";
import { ModelPicker, PANEL_SURFACE, PanelLabel, problemText, PromptInput, ReferenceBar, SettingsPopover } from "./panel-parts";

export function NodePanel({ node }: { node: CanvasNode }) {
  switch (node.type) {
    case "bot": return <BotPanel node={node} />;
    case "text": return <TextPanel node={node} />;
    case "image":
    case "video":
    case "config":
    case "shot": return <PromptPanel node={node} />;
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

function PromptPanel({ node }: { node: CanvasNode }) {
  const ui = useCanvasUi();
  const kind = generationKindOf(node) ?? "image";
  const project = ui.state.generation?.settings;
  const [prompt, setPrompt] = useDraft(node.id, node.metadata?.prompt ?? "");
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const loading = node.metadata?.status === "loading";
  const models = ui.state.models[kind];
  const mentions = mentionReferences(node.id, ui.snapshot.nodes, ui.snapshot.connections);
  const counts = referenceCounts(referenceFiles(mentions));
  const problems = project ? referenceProblems(kind, project, node, models ?? [], counts) : [];
  const noServer = !project?.[kind].server;
  const keepPrompt = () => {
    if (prompt !== (node.metadata?.prompt ?? "")) ui.updateMetadata(node.id, { prompt });
  };
  const generate = async () => {
    setBusy(true);
    setRefusal(null);
    try {
      const refused = await ui.controller.generate(node.id, prompt.trim());
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
  const isShot = node.type === "shot";
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
          label={isShot ? t("projectCanvas.shot.prompt") : t("projectCanvas.generate.prompt")}
          placeholder={isShot ? t("projectCanvas.shot.promptPlaceholder") : kind === "image" ? t("projectCanvas.generate.imagePlaceholder") : t("projectCanvas.generate.videoPlaceholder")}
          disabled={ui.readOnly}
          onSubmit={() => void generate()}
        />
      </div>
      {problems.map((problem) => <p key={problem.key} role="alert" className="text-[12px] leading-4 text-danger">{problemText(problem, models)}</p>)}
      {refusal ? <p role="alert" className="text-[12px] leading-4 text-danger">{refusal}</p> : null}
      {noServer ? (
        <div className="flex items-center gap-2 text-[12px] leading-4 text-ink-secondary">
          <span className="flex-1">{t("projectCanvas.generate.noServer")}</span>
          <button type="button" className="ui-button ui-button-sm" onClick={() => ui.openSettings()}>
            <Settings size={14} aria-hidden="true" />
            {t("projectCanvas.settings.open")}
          </button>
        </div>
      ) : null}
      <div className="flex items-center gap-2">
        <button type="button" className="ui-icon-button" aria-label={expanded ? t("projectCanvas.generate.collapse") : t("projectCanvas.generate.expand")} title={expanded ? t("projectCanvas.generate.collapse") : t("projectCanvas.generate.expand")} onClick={() => setExpanded((value) => !value)}>
          {expanded ? <Minimize2 size={16} aria-hidden="true" /> : <Maximize2 size={16} aria-hidden="true" />}
        </button>
        {project ? <ModelPicker node={node} kind={kind} project={project} /> : null}
        {project ? <SettingsPopover node={node} kind={kind} project={project} /> : null}
        <span className="flex-1" />
        {loading ? (
          <button type="button" className="ui-button ui-button-md" disabled={ui.readOnly} onClick={() => void stop()}>
            <Square size={14} aria-hidden="true" />
            {t("projectCanvas.generate.stop")}
          </button>
        ) : (
          <button type="button" className="ui-button ui-button-md ui-button-primary" disabled={ui.readOnly || busy || !prompt.trim()} onClick={() => void generate()}>
            {busy ? <LoaderCircle size={14} aria-hidden="true" className="animate-spin motion-reduce:animate-none" /> : <ArrowUp size={14} aria-hidden="true" />}
            {isShot ? t("projectCanvas.shot.generate") : t("projectCanvas.generate.start")}
          </button>
        )}
      </div>
    </div>
  );
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
  const waitingDetail = bot.waiting ? approvalDetailText(bot.waiting.card) : "";
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
      {bot.waiting ? (
        <div role="status" className="flex flex-col gap-2 rounded-lg border border-warning/50 p-3">
          <div className="text-[13px] font-medium leading-[18px] text-ink">{bot.waiting.card.title}</div>
          {waitingDetail ? <div className="text-[12px] leading-4 text-ink-secondary">{waitingDetail}</div> : null}
          <button type="button" className="ui-button ui-button-sm self-start" onClick={() => ui.controller.openChat(botId, bot.waiting?.threadId)}>
            <ExternalLink size={14} aria-hidden="true" />
            {t("projectCanvas.bot.answerInChat")}
          </button>
        </div>
      ) : null}
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
          <div className="flex max-h-72 flex-col gap-3 overflow-y-auto">
            {exchange === null ? <LoaderCircle size={16} aria-label={t("projectCanvas.loading")} className="animate-spin text-ink-tertiary motion-reduce:animate-none" /> : null}
            {exchange?.length === 0 ? <p className="text-[12px] leading-4 text-ink-tertiary">{t("projectCanvas.bot.noExchange")}</p> : null}
            {exchange?.map((message) => (
              <div key={message.id} className="flex flex-col gap-1">
                <span className="text-[12px] font-medium leading-4 text-ink-secondary">{message.role === "person" ? t("projectCanvas.bot.you") : bot.name}</span>
                <div dir="auto" className="text-[13px] leading-[18px] text-ink"><ChatMarkdown text={message.text} /></div>
              </div>
            ))}
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

function TextPanel({ node }: { node: CanvasNode }) {
  const ui = useCanvasUi();
  const bots = Object.values(ui.snapshot.bots).sort((a, b) => Number(b.lead) - Number(a.lead) || a.name.localeCompare(b.name));
  const author = node.createdBy?.kind === "bot" ? node.createdBy.botId : undefined;
  const [botId, setBotId] = useState(() => (author && ui.snapshot.bots[author] ? author : bots[0]?.botId ?? ""));
  const [request, setRequest] = useDraft(node.id, "");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const writing = Boolean(ui.state.writing[node.id]);
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
        {writing ? (
          <button type="button" className="ui-button ui-button-md" disabled={ui.readOnly} onClick={() => void ui.controller.stopBot(botId)}>
            <Square size={14} aria-hidden="true" />
            {t("projectCanvas.bot.stop")}
          </button>
        ) : null}
        <button type="button" className="ui-button ui-button-md ui-button-primary" disabled={ui.readOnly || sending || writing || !request.trim() || !bot} onClick={() => void send()}>
          {sending ? <LoaderCircle size={14} aria-hidden="true" className="animate-spin motion-reduce:animate-none" /> : <ArrowUp size={14} aria-hidden="true" />}
          {t("projectCanvas.text.ask", { name: bot?.name ?? "" })}
        </button>
      </div>
    </div>
  );
}
