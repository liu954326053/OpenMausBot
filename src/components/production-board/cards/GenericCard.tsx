import { File, FileText, Image, Music, Sparkles, Video } from "lucide-react";
import type { CanvasNode, CanvasNodeType } from "../../../../shared/project-canvas";
import { t } from "@/lib/i18n";
import { CardAction, CardName, CardShell, clockLength, failureText, InlineVideo, keepClosed, PicturePlaceholder } from "./parts";

export interface GenericCardProps {
  node: Pick<CanvasNode, "type" | "title" | "metadata">;
  /** The address of the node's file. */
  fileUrl?: string;
  onOpen?: () => void;
  onPlay?: () => void;
  onGenerate?: () => void;
}

const ICON: Partial<Record<CanvasNodeType, typeof File>> = { text: FileText, image: Image, video: Video, audio: Music };

function Media({ node, fileUrl, onPlay, onGenerate }: GenericCardProps) {
  const generation = node.metadata;
  if (node.type === "video" && fileUrl) {
    return <InlineVideo src={fileUrl} label={t("boardCards.result.play", { name: node.title })} onPlay={onPlay} className="size-full" />;
  }
  if (node.type === "image" && fileUrl) return <img src={fileUrl} alt={node.title} draggable={false} className="size-full object-cover" />;
  if (generation?.status === "loading") return <PicturePlaceholder>{t("boardCards.generating")}</PicturePlaceholder>;
  if (generation?.status === "error") {
    return (
      <PicturePlaceholder>
        <span data-generic-failure="" title={failureText(generation)} className="line-clamp-3 text-danger">{failureText(generation)}</span>
        {onGenerate ? <CardAction icon={<Sparkles size={14} aria-hidden="true" />} label={t("boardCards.generateAgain")} onClick={onGenerate} /> : null}
      </PicturePlaceholder>
    );
  }
  return <PicturePlaceholder>{t("boardCards.generic.empty")}</PicturePlaceholder>;
}

export function GenericCard(props: GenericCardProps) {
  const { node, fileUrl, onOpen } = props;
  const Icon = ICON[node.type] ?? File;
  const text = (node.metadata?.content ?? node.metadata?.prompt)?.trim();
  const length = node.metadata?.durationMs;
  return (
    <CardShell kind="generic" label={node.title} onOpen={onOpen}>
      <header className="flex min-w-0 items-center gap-2 px-3 pt-3">
        <Icon size={14} aria-hidden="true" className="shrink-0 text-ink-tertiary" />
        <CardName text={node.title} onOpen={onOpen} className="flex-1 text-[17px] font-semibold leading-6" />
        {length ? <span className="shrink-0 text-[12px] leading-4 text-ink-tertiary tabular-nums">{clockLength(length)}</span> : null}
      </header>
      {node.type === "image" || node.type === "video" ? (
        <div data-generic-media="" className="mx-3 mb-3 mt-2 min-h-0 flex-1 overflow-hidden rounded-lg">
          <Media {...props} />
        </div>
      ) : node.type === "audio" && fileUrl ? (
        <div className="flex flex-1 items-center px-3 pb-3">
          <audio src={fileUrl} controls preload="metadata" className="w-full" onClick={keepClosed} />
        </div>
      ) : node.type === "text" || text ? (
        <p data-generic-text="" dir="auto" className="mb-3 min-h-0 flex-1 overflow-hidden whitespace-pre-line px-3 pt-2 text-[13px] leading-[18px] text-ink-secondary">
          {text ? node.metadata?.content ?? node.metadata?.prompt : t("boardCards.generic.empty")}
        </p>
      ) : <div className="flex-1" />}
    </CardShell>
  );
}
