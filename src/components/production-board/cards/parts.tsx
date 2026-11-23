import { Play } from "lucide-react";
import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import type { CanvasNodeMetadata } from "../../../../shared/project-canvas";
import { BotAvatar } from "@/components/Avatar";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import type { CanvasBotLook } from "@/lib/project-canvas/types";
import { serverErrorText } from "@/lib/server-error";
import { BOARD_CARD_SIZES, type BoardCardKind } from "./sizes";
import { TONE_DOT, TONE_TEXT, type BoardStatus, type BoardTone } from "./tone";

/** A bot a card names: who a task or an episode went to. */
export interface BoardBotRef {
  name: string;
  look?: CanvasBotLook;
}

/** How the picture or video a card shows is being made: the generating node's own fields. */
export type BoardGeneration = Pick<CanvasNodeMetadata, "status" | "errorKey" | "errorParams" | "errorDetails">;

/** A shot a character or a scene is in. */
export interface BoardShotRef {
  episode?: number;
  number: number;
}

/** The look of a bot whose own look the board does not have. */
export const SILVER: CanvasBotLook = { color: "silver" };

export function clockLength(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

export const failureText = (generation: BoardGeneration | undefined): string =>
  serverErrorText(generation, generation?.errorDetails || t("boardCards.generationFailed"));

/** The board's card: its kind's size, flat on the board, opening on a click anywhere that is not one of its actions. */
export function CardShell({ kind, label, tone, onOpen, className, children }: {
  kind: BoardCardKind;
  label: string;
  tone?: BoardTone;
  onOpen?: () => void;
  className?: string;
  children: ReactNode;
}) {
  const { width, height } = BOARD_CARD_SIZES[kind];
  return (
    <article
      data-board-card={kind}
      data-board-tone={tone}
      aria-label={label}
      style={{ width, height }}
      className={cn(
        "relative flex flex-col overflow-hidden rounded-xl border bg-card text-ink",
        tone === "failed" ? "border-danger/60" : tone === "asking" ? "border-warning/60" : "border-hairline",
        onOpen && "cursor-pointer",
        className,
      )}
      onClick={onOpen ? () => onOpen() : undefined}
    >
      {children}
    </article>
  );
}

const alone = (action: () => void) => (event: MouseEvent) => {
  event.stopPropagation();
  action();
};

/** For a player's own controls: using them leaves the card closed. */
export const keepClosed = (event: MouseEvent) => event.stopPropagation();

/** The card's name, which opens it from the keyboard too. */
export function CardName({ text, title = text, onOpen, className, data = "card-name" }: {
  text: string;
  title?: string;
  onOpen?: () => void;
  className?: string;
  data?: string;
}) {
  const props = { [`data-${data}`]: "", title, dir: "auto" as const };
  const look = cn("min-w-0 truncate text-start", className);
  return onOpen
    ? <button type="button" className={cn(look, "rounded-md")} onClick={alone(onOpen)} {...props}>{text}</button>
    : <span className={look} {...props}>{text}</span>;
}

/** A button on a card that does its own thing and leaves the card closed. */
export function CardAction({ onClick, label, icon, className }: { onClick: () => void; label: string; icon?: ReactNode; className?: string }) {
  const act = alone(onClick);
  return (
    <button type="button" data-board-card-action="" className={cn("ui-button ui-button-sm shrink-0 whitespace-nowrap", className)} onClick={act}>
      {icon}
      {label}
    </button>
  );
}

/** A quiet mark on something made before a change to what it was made from. */
export function StaleMark({ reason, className }: { reason: string; className?: string }) {
  return <span data-stale="" title={reason} className={cn("ui-chip shrink-0 bg-control text-ink-tertiary", className)}>{t("boardCards.stale.label")}</span>;
}

export function StatusMark({ status, className }: { status: BoardStatus; className?: string }) {
  return (
    <span data-board-status={status.tone} className={cn("inline-flex shrink-0 items-center gap-1.5 text-[12px] font-medium leading-4", TONE_TEXT[status.tone], className)}>
      <span aria-hidden="true" className={cn("size-2 shrink-0 rounded-full", TONE_DOT[status.tone])} />
      {status.label}
    </span>
  );
}

export function Meter({ done, total, tone, label }: { done: number; total: number; tone: BoardTone; label: string }) {
  const share = total > 0 ? Math.min(1, Math.max(0, done / total)) : 0;
  return (
    <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={total} aria-valuenow={done} className="h-1 overflow-hidden rounded-full bg-ink/[0.08]">
      <div className={cn("h-full rounded-full", tone === "done" ? "bg-success" : tone === "failed" ? "bg-danger" : tone === "working" || tone === "asking" ? "bg-accent" : "bg-ink-tertiary")} style={{ width: `${share * 100}%` }} />
    </div>
  );
}

export const percentOf = (done: number, total: number): number => (total > 0 ? Math.round((Math.min(done, total) / total) * 100) : 0);

export function BotChip({ bot, label }: { bot: BoardBotRef; label?: string }) {
  return (
    <span data-bot-chip="" title={label ?? bot.name} className="inline-flex min-w-0 items-center gap-1.5">
      <BotAvatar bot={{ name: bot.name, ...(bot.look ?? SILVER) }} size={16} />
      <span data-bot-chip-name="" dir="auto" className="min-w-0 truncate text-[12px] leading-4 text-ink-secondary">{bot.name}</span>
    </span>
  );
}

/** A group label inside a card. */
export function CardLabel({ children }: { children: ReactNode }) {
  return <span className="text-[12px] font-medium leading-4 text-ink-tertiary">{children}</span>;
}

/** A video that waits on its first frame until the person plays it, then plays where it is with its controls. */
export function InlineVideo({ src, posterUrl, label, onPlay, className }: {
  src: string;
  posterUrl?: string;
  label: string;
  onPlay?: () => void;
  className?: string;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  useEffect(() => setPlaying(false), [src]);
  const play = () => {
    setPlaying(true);
    video.current?.play().catch(() => setPlaying(false));
    onPlay?.();
  };
  return (
    <div className={cn("relative overflow-hidden bg-black", className)}>
      <video ref={video} src={src} poster={posterUrl} preload="metadata" playsInline controls={playing} className="size-full object-cover" onClick={keepClosed} />
      {playing ? null : (
        <button type="button" aria-label={label} title={label} className="absolute inset-0 m-auto flex size-10 items-center justify-center rounded-full bg-black/55 text-white" onClick={alone(play)}>
          <Play size={16} aria-hidden="true" className="translate-x-px" />
        </button>
      )}
    </div>
  );
}

/** The space a picture takes when there is none yet, or while it is made. */
export function PicturePlaceholder({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("flex size-full flex-col items-center justify-center gap-2 bg-ink/[0.04] p-3 text-center text-[12px] leading-4 text-ink-tertiary", className)}>
      {children}
    </div>
  );
}
