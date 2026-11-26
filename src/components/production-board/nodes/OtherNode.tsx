import { File, FileText, Image, LoaderCircle, Music, Video, type LucideIcon } from "lucide-react";
import type { CanvasNodeType } from "../../../../shared/project-canvas";
import { t } from "@/lib/i18n";
import type { BoardOtherCard } from "@/lib/production-board/types";
import { failureText, Ic, type NodeContext } from "./parts";

const TEXT_LINES = 6;
const TYPE_ICON: Partial<Record<CanvasNodeType, LucideIcon>> = { text: FileText, image: Image, video: Video, audio: Music };

function OtherBody({ card, ctx }: { card: BoardOtherCard; ctx: NodeContext }) {
  const { node } = card;
  const metadata = node.metadata;
  const file = metadata?.file;
  const { generate } = ctx.actions;
  if (file && node.type === "image") return <img src={ctx.fileUrl(file)} alt={node.title} draggable={false} />;
  if (file && node.type === "video") return <video src={ctx.fileUrl(file)} controls preload="metadata" playsInline />;
  if (file && node.type === "audio") return <audio src={ctx.fileUrl(file)} controls preload="metadata" />;
  if (metadata?.status === "loading") return <span className="st run"><Ic icon={LoaderCircle} className="spin" />{t("boardCards.generating")}</span>;
  if (metadata?.status === "error") {
    return (
      <>
        <p className="ot-fail">{failureText(metadata)}</p>
        {metadata.prompt && generate ? <button type="button" className="btn-ink" onClick={() => generate(node.id)}>{t("boardCards.generateAgain")}</button> : null}
      </>
    );
  }
  const text = (metadata?.content ?? metadata?.prompt)?.trim();
  if (text) return <p className="ot-text">{text.split("\n").slice(0, TEXT_LINES).join("\n")}</p>;
  return node.type === "text" ? <p className="ot-text">{t("boardCards.generic.empty")}</p> : null;
}

export function OtherNode({ card, ctx }: { card: BoardOtherCard; ctx: NodeContext }) {
  return (
    <>
      <h3 className="ot-head">
        <Ic icon={TYPE_ICON[card.node.type] ?? File} />
        {card.node.title}
      </h3>
      <OtherBody card={card} ctx={ctx} />
    </>
  );
}
