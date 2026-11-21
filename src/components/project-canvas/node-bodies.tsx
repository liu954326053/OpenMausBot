// Adapted from basketikun/infinite-canvas@9cd3deac web/src/components/canvas/canvas-node.tsx, MIT License, Copyright (c) 2026 basketikun (full text in third_party/infinite-canvas/LICENSE)
import { useEffect, useRef, useState, type ReactNode } from "react";
import { AlertCircle, Clock, Crown, LoaderCircle, RotateCcw } from "lucide-react";
import { botIdOfNode, type CanvasBotStatus, type CanvasNode } from "../../../shared/project-canvas";
import { BotAvatar } from "@/components/Avatar";
import { ChatMarkdown } from "@/components/ChatMarkdown";
import { cn } from "@/lib/cn";
import { t, tFromServer } from "@/lib/i18n";
import { fitNodeSize } from "@/lib/project-canvas/geometry";
import { connectedReferences } from "@/lib/project-canvas/references";
import { generationKindOf, nodeSettings } from "@/lib/project-canvas/settings";
import { useCanvasUi } from "./canvas-ui";
import { formatBytes, NODE_ICONS, nodeLabel, nodeTypeLabel } from "./node-kinds";

const DEFAULT_FONT_SIZE = 14;

export function NodeBody({ node }: { node: CanvasNode }) {
  switch (node.type) {
    case "bot": return <BotBody node={node} />;
    case "shot": return <ShotBody node={node} />;
    case "text": return <TextBody node={node} />;
    case "image": return <ImageBody node={node} />;
    case "video": return <VideoBody node={node} />;
    case "audio": return <AudioBody node={node} />;
    case "file": return <FileBody node={node} />;
    case "config": return <ConfigBody node={node} />;
    case "group": return null;
  }
}

function Placeholder({ node, text }: { node: CanvasNode; text: string }) {
  const Icon = NODE_ICONS[node.type];
  return (
    <div className="flex size-full flex-col items-center justify-center gap-2 p-4 text-center text-[12px] leading-4 text-ink-tertiary">
      <Icon size={16} aria-hidden="true" />
      <span>{text}</span>
    </div>
  );
}

/** What a node shows while its generation runs or after it failed, over or instead of its content. */
function GenerationState({ node, children }: { node: CanvasNode; children: ReactNode }) {
  const ui = useCanvasUi();
  const status = node.metadata?.status;
  if (status === "loading" && !node.metadata?.file) {
    return (
      <div role="status" className="flex size-full flex-col items-center justify-center gap-2 text-[12px] text-ink-secondary">
        <LoaderCircle size={16} aria-hidden="true" className="animate-spin motion-reduce:animate-none" />
        {t("projectCanvas.node.generating")}
      </div>
    );
  }
  if (status === "error") {
    const retry = async () => {
      const refused = await ui.controller.generate(node.id, node.metadata?.prompt ?? "");
      if (refused) ui.showNotice(tFromServer(refused.errorKey, refused.error, refused.errorParams));
    };
    return (
      <div role="alert" className="flex size-full flex-col items-center justify-center gap-2 p-4 text-center">
        <AlertCircle size={16} aria-hidden="true" className="text-danger" />
        <span className="line-clamp-3 text-[12px] leading-4 text-ink-secondary">{node.metadata?.errorDetails || t("projectCanvas.node.failed")}</span>
        {!ui.readOnly && node.metadata?.prompt ? (
          <button type="button" className="ui-button ui-button-sm" onClick={() => void retry()}>
            <RotateCcw size={14} aria-hidden="true" />
            {t("projectCanvas.node.retry")}
          </button>
        ) : null}
      </div>
    );
  }
  return (
    <>
      {children}
      {status === "loading" ? <GeneratingBadge /> : null}
    </>
  );
}

function GeneratingBadge() {
  return (
    <span role="status" className="ui-chip absolute end-2 top-2 gap-1 bg-menu">
      <LoaderCircle size={14} aria-hidden="true" className="animate-spin motion-reduce:animate-none" />
      {t("projectCanvas.node.generating")}
    </span>
  );
}

export function BotStatusLabel({ status }: { status: CanvasBotStatus }) {
  const looks: Record<CanvasBotStatus, { label: string; className: string; icon: ReactNode }> = {
    working: { label: t("projectCanvas.bot.status.working"), className: "text-accent-text", icon: <LoaderCircle size={14} aria-hidden="true" className="animate-spin motion-reduce:animate-none" /> },
    queued: { label: t("projectCanvas.bot.status.queued"), className: "text-ink-secondary", icon: <Clock size={14} aria-hidden="true" /> },
    waiting: { label: t("projectCanvas.bot.status.waiting"), className: "text-warning", icon: <AlertCircle size={14} aria-hidden="true" /> },
    idle: { label: t("projectCanvas.bot.status.idle"), className: "text-ink-tertiary", icon: null },
    error: { label: t("projectCanvas.bot.status.error"), className: "text-danger", icon: <AlertCircle size={14} aria-hidden="true" /> },
  };
  const look = looks[status];
  return <span className={cn("inline-flex shrink-0 items-center gap-1 text-[12px] leading-4", look.className)}>{look.icon}{look.label}</span>;
}

function BotBody({ node }: { node: CanvasNode }) {
  const ui = useCanvasUi();
  const botId = botIdOfNode(node.id) ?? "";
  const bot = ui.snapshot.bots[botId];
  const look = ui.state.looks[botId] ?? { color: "silver" as const };
  if (!bot) return <Placeholder node={node} text={t("projectCanvas.bot.left")} />;
  return (
    <div className="flex size-full flex-col gap-2 p-3">
      <div className="flex items-center gap-2">
        <BotAvatar bot={{ name: bot.name, ...look }} size={32} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1">
            <span className="truncate text-[13px] font-medium leading-[18px] text-ink">{bot.name}</span>
            {bot.lead ? <Crown size={14} aria-label={t("projectCanvas.bot.lead")} className="shrink-0 text-ink-tertiary" /> : null}
          </div>
          <div className="truncate text-[12px] leading-4 text-ink-tertiary">{bot.title || nodeTypeLabel("bot")}</div>
        </div>
        <BotStatusLabel status={bot.status} />
      </div>
      {bot.status === "working" && bot.doing ? <div className="truncate text-[12px] leading-4 text-ink-secondary">{bot.doing}</div> : null}
      <div dir="auto" className="relative min-h-0 flex-1 overflow-hidden text-[13px] leading-[18px] [mask-image:linear-gradient(to_bottom,black_75%,transparent)]">
        {bot.output ? <ChatMarkdown text={bot.output.text} /> : <span className="text-ink-tertiary">{t("projectCanvas.bot.noOutput")}</span>}
      </div>
    </div>
  );
}

function ShotBody({ node }: { node: CanvasNode }) {
  const ui = useCanvasUi();
  const project = ui.state.generation?.settings;
  const settings = project ? nodeSettings("video", project, node) : null;
  const model = settings && ui.state.models.video?.find((candidate) => candidate.id === settings.model);
  const references = connectedReferences(node.id, ui.snapshot.nodes, ui.snapshot.connections).filter((reference) => reference.kind === "image" || reference.kind === "audio").length;
  const prompt = node.metadata?.prompt?.trim();
  if (node.metadata?.status === "error") return <GenerationState node={node}>{null}</GenerationState>;
  return (
    <div className="relative flex size-full flex-col gap-3 p-4">
      <p dir="auto" className={cn("line-clamp-5 min-h-0 flex-1 whitespace-pre-wrap break-words text-[13px] leading-[18px]", prompt ? "text-ink" : "text-ink-tertiary")}>
        {prompt || t("projectCanvas.shot.noPrompt")}
      </p>
      <div className="flex flex-wrap gap-1">
        {settings ? (
          <>
            <span className="ui-chip tabular-nums">{t("projectCanvas.settings.secondsValue", { count: settings.seconds })}</span>
            <span className="ui-chip">{settings.resolution}</span>
            <span className="ui-chip max-w-full truncate">{model?.name ?? (settings.model || t("projectCanvas.settings.noModel"))}</span>
          </>
        ) : null}
        <span className="ui-chip tabular-nums">{t("projectCanvas.shot.references", { count: references })}</span>
      </div>
      {node.metadata?.status === "loading" ? <GeneratingBadge /> : null}
    </div>
  );
}

function TextBody({ node }: { node: CanvasNode }) {
  const ui = useCanvasUi();
  const [editing, setEditing] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const content = node.metadata?.content ?? "";
  const writer = ui.state.writing[node.id];
  const writerName = writer ? ui.snapshot.bots[writer.botId]?.name : undefined;
  const fontSize = node.metadata?.fontSize ?? DEFAULT_FONT_SIZE;
  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);
  const finish = (save: boolean) => {
    const value = inputRef.current?.value ?? content;
    setEditing(false);
    if (save && value !== content) ui.updateMetadata(node.id, { content: value });
  };
  return (
    <div className="relative size-full">
      {editing ? (
        <textarea
          ref={inputRef}
          dir="auto"
          defaultValue={content}
          aria-label={t("projectCanvas.text.edit")}
          data-canvas-no-zoom=""
          className="size-full resize-none bg-transparent p-4 text-ink outline-none"
          style={{ fontSize, lineHeight: 1.65 }}
          onBlur={() => finish(true)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              finish(false);
            }
          }}
          onPointerDown={(event) => event.stopPropagation()}
        />
      ) : (
        <div
          dir="auto"
          className={cn("size-full overflow-hidden whitespace-pre-wrap break-words p-4", content ? "text-ink" : "text-ink-tertiary")}
          style={{ fontSize, lineHeight: 1.65 }}
          onDoubleClick={() => !ui.readOnly && setEditing(true)}
        >
          {content || t("projectCanvas.text.empty")}
        </div>
      )}
      {writer ? (
        <span role="status" className="ui-chip absolute end-2 top-2 gap-1 bg-menu">
          <LoaderCircle size={14} aria-hidden="true" className="animate-spin motion-reduce:animate-none" />
          {t("projectCanvas.text.writing", { name: writerName ?? "" })}
        </span>
      ) : null}
    </div>
  );
}

function ImageBody({ node }: { node: CanvasNode }) {
  const ui = useCanvasUi();
  const file = node.metadata?.file;
  const url = file ? ui.controller.fileUrl(file) : null;
  const fitToPicture = (image: HTMLImageElement) => {
    if (node.metadata?.naturalWidth || !image.naturalWidth) return;
    const size = fitNodeSize(image.naturalWidth, image.naturalHeight);
    ui.controller.apply([{ type: "update_node", id: node.id, patch: size, metadata: { naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight } }], { record: false });
  };
  return (
    <GenerationState node={node}>
      {url ? (
        <img
          src={url}
          alt={nodeLabel(node)}
          draggable={false}
          className="size-full rounded-[inherit] object-cover"
          onLoad={(event) => fitToPicture(event.currentTarget)}
          onDoubleClick={() => ui.previewImage(url, nodeLabel(node))}
        />
      ) : (
        <Placeholder node={node} text={t("projectCanvas.image.empty")} />
      )}
    </GenerationState>
  );
}

function VideoBody({ node }: { node: CanvasNode }) {
  const ui = useCanvasUi();
  const file = node.metadata?.file;
  return (
    <GenerationState node={node}>
      {file ? (
        <video src={ui.controller.fileUrl(file)} controls preload="metadata" data-canvas-no-zoom="" aria-label={nodeLabel(node)} className="size-full rounded-[inherit] bg-inset object-contain" />
      ) : (
        <Placeholder node={node} text={t("projectCanvas.video.empty")} />
      )}
    </GenerationState>
  );
}

function AudioBody({ node }: { node: CanvasNode }) {
  const ui = useCanvasUi();
  const file = node.metadata?.file;
  const Icon = NODE_ICONS.audio;
  if (!file) return <Placeholder node={node} text={t("projectCanvas.audio.empty")} />;
  return (
    <div className="flex size-full flex-col justify-center gap-2 px-4">
      <div className="flex min-w-0 items-center gap-2 text-[13px] leading-[18px] text-ink">
        <Icon size={16} aria-hidden="true" className="shrink-0 text-ink-secondary" />
        <span className="truncate">{file.name}</span>
      </div>
      <audio src={ui.controller.fileUrl(file)} controls preload="metadata" data-canvas-no-zoom="" aria-label={nodeLabel(node)} className="h-8 w-full" />
    </div>
  );
}

function FileBody({ node }: { node: CanvasNode }) {
  const file = node.metadata?.file;
  const Icon = NODE_ICONS.file;
  if (!file) return <Placeholder node={node} text={t("projectCanvas.file.empty")} />;
  return (
    <div className="flex size-full items-center gap-3 px-4">
      <Icon size={16} aria-hidden="true" className="shrink-0 text-ink-secondary" />
      <div className="min-w-0">
        <div className="truncate text-[13px] font-medium leading-[18px] text-ink" title={file.path}>{file.name}</div>
        <div className="truncate text-[12px] leading-4 text-ink-tertiary">{formatBytes(file.bytes)}</div>
      </div>
    </div>
  );
}

function ConfigBody({ node }: { node: CanvasNode }) {
  const ui = useCanvasUi();
  const kind = generationKindOf(node) ?? "image";
  const prompt = node.metadata?.prompt?.trim();
  const inputs = connectedReferences(node.id, ui.snapshot.nodes, ui.snapshot.connections).length;
  return (
    <GenerationState node={node}>
      <div className="flex size-full flex-col gap-3 p-4">
        <span className="ui-chip self-start">{kind === "image" ? t("projectCanvas.config.makesImages") : t("projectCanvas.config.makesVideos")}</span>
        <p dir="auto" className={cn("line-clamp-4 min-h-0 flex-1 whitespace-pre-wrap break-words text-[13px] leading-[18px]", prompt ? "text-ink" : "text-ink-tertiary")}>
          {prompt || t("projectCanvas.config.noPrompt")}
        </p>
        <span className="text-[12px] leading-4 text-ink-tertiary tabular-nums">{t("projectCanvas.config.inputs", { count: inputs })}</span>
      </div>
    </GenerationState>
  );
}
