import { Check, Circle, CircleDot, LoaderCircle, Play, X } from "lucide-react";
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

export type BoardCardSurface = "panel" | "paper" | "monitor";

const SURFACE: Readonly<Record<BoardCardSurface, string>> = {
  panel: "rounded-[10px] border-hairline bg-card text-ink shadow-board",
  paper: "rounded-[10px] border-board-paper-line bg-board-paper text-board-ink shadow-board",
  monitor: "rounded-xl border-board-paper/15 bg-board-monitor text-board-paper shadow-board",
};

export function clockLength(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

export const failureText = (generation: BoardGeneration | undefined): string =>
  serverErrorText(generation, generation?.errorDetails || t("boardCards.generationFailed"));

/** The board's card: its kind's size, flat on the board, opening on a click anywhere that is not one of its actions. */
export function CardShell({ kind, label, tone, surface = "panel", onOpen, className, children }: {
  kind: BoardCardKind;
  label: string;
  tone?: BoardTone;
  surface?: BoardCardSurface;
  onOpen?: () => void;
  className?: string;
  children: ReactNode;
}) {
  const { width, height } = BOARD_CARD_SIZES[kind];
  return (
    <article
      data-board-card={kind}
      data-board-surface={surface}
      data-board-tone={tone}
      aria-label={label}
      style={{ width, height }}
      className={cn(
        "relative flex flex-col overflow-hidden border",
        SURFACE[surface],
        tone === "failed" ? "border-danger/60" : tone === "asking" ? "border-warning/60" : null,
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
export function CardAction({ onClick, label, title, icon, className }: { onClick: () => void; label: string; title?: string; icon?: ReactNode; className?: string }) {
  const act = alone(onClick);
  return (
    <button type="button" data-board-card-action="" title={title} className={cn("ui-button ui-button-sm shrink-0 whitespace-nowrap", className)} onClick={act}>
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
  const fill = tone === "done" ? "bg-success" : tone === "failed" ? "bg-danger" : tone === "working" || tone === "asking" ? "bg-warning" : "bg-ink-tertiary";
  return (
    <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={total} aria-valuenow={done} className="h-1 overflow-hidden rounded-full bg-ink/[0.08]">
      <div className={cn("h-full rounded-full", fill)} style={{ width: `${share * 100}%` }} />
    </div>
  );
}

export const percentOf = (done: number, total: number): number => (total > 0 ? Math.round((Math.min(done, total) / total) * 100) : 0);

/** Ink capsule naming a bot on a paper card (task owner / episode handoff). */
export function PaperBotChip({ bot, label }: { bot: BoardBotRef; label?: string }) {
  return (
    <span data-bot-chip="" title={label ?? bot.name} className="inline-flex h-6 min-w-0 max-w-full items-center gap-1 rounded-full bg-board-ink pe-2 ps-1.5 text-board-paper">
      <BotAvatar bot={{ name: bot.name, ...(bot.look ?? SILVER) }} size={14} />
      <span data-bot-chip-name="" dir="auto" className="min-w-0 truncate text-[12px] leading-4">{bot.name}</span>
    </span>
  );
}

/** A group label inside a card. */
export function CardLabel({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn("text-[12px] font-medium leading-4 text-ink-tertiary", className)}>{children}</span>;
}

/** Mono code stamp on paper: EP01 / SH03 / REQ-001. */
export function PaperCode({ text, className }: { text: string; className?: string }) {
  return (
    <span data-paper-code="" className={cn("inline-flex h-6 shrink-0 items-center rounded bg-board-ink px-1.5 font-mono text-[12px] font-semibold leading-4 text-board-paper", className)}>
      {text}
    </span>
  );
}

/** The paper's rules: a heavier ink line under a head, a hairline of paper under a foot. */
export const PAPER_HEAD_RULE = "border-b-[1.5px] border-board-ink";
export const PAPER_FOOT_RULE = "border-t border-board-paper-line";

interface PaperStatusLook {
  className: string;
  icon: ReactNode;
}

const PAPER_STATUS: Readonly<Record<BoardTone, PaperStatusLook>> = {
  done: { className: "text-board-teal-ink", icon: <Check size={12} aria-hidden="true" /> },
  working: { className: "text-board-amber-ink", icon: <LoaderCircle size={12} aria-hidden="true" className="animate-spin motion-reduce:animate-none" /> },
  asking: { className: "text-board-amber-ink", icon: <CircleDot size={12} aria-hidden="true" /> },
  idle: { className: "text-board-ink-3", icon: <Circle size={12} aria-hidden="true" /> },
  failed: { className: "text-board-ink-2", icon: <X size={12} aria-hidden="true" /> },
};

/** A state written in ink on paper: its mark, then its words. */
export function PaperStatus({ status, className }: { status: BoardStatus; className?: string }) {
  const look = PAPER_STATUS[status.tone];
  return (
    <span data-board-status={status.tone} title={status.label} className={cn("inline-flex min-w-0 shrink-0 items-center gap-1.5 text-[12px] font-medium leading-4", look.className, className)}>
      {look.icon}
      <span data-card-status-text="" className="truncate">{status.label}</span>
    </span>
  );
}

/** A state struck as a round seal on a task line: filled teal for done, amber for work, an empty ring for waiting. */
export function StatusStamp({ status }: { status: BoardStatus }) {
  const look: Record<BoardTone, string> = {
    done: "border-board-teal-ink bg-board-teal-ink text-board-paper",
    working: "border-board-amber bg-board-amber text-board-ink",
    asking: "border-board-amber bg-board-amber text-board-ink",
    idle: "border-[1.5px] border-board-ink-3 text-board-ink-3",
    failed: "border-board-ink bg-board-ink text-board-paper",
  };
  return (
    <span data-board-status={status.tone} title={status.label} className={cn("inline-flex size-5 shrink-0 items-center justify-center rounded-full border", look[status.tone])}>
      {status.tone === "idle" ? null : PAPER_STATUS[status.tone].icon}
      <span className="sr-only">{status.label}</span>
    </span>
  );
}

/** A button struck on paper: an ink outline for the quieter action, the amber plate for the one that makes something. */
export function PaperButton({ label, icon, onClick, kind = "ink", iconOnly = false, className }: {
  label: string;
  icon?: ReactNode;
  onClick: () => void;
  kind?: "ink" | "generate";
  iconOnly?: boolean;
  className?: string;
}) {
  const plate = kind === "generate"
    ? "h-[30px] bg-board-amber px-3 text-[13px] font-semibold text-board-ink hover:bg-board-amber/90"
    : "h-7 border border-board-ink-3 px-2.5 text-[12px] font-medium text-board-ink hover:border-board-ink hover:bg-board-ink hover:text-board-paper";
  return (
    <button
      type="button"
      data-paper-button={kind}
      aria-label={iconOnly ? label : undefined}
      title={iconOnly ? label : undefined}
      className={cn("inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md transition-colors motion-reduce:transition-none", iconOnly && "w-7 px-0", plate, className)}
      onClick={alone(onClick)}
    >
      {icon}
      {iconOnly ? <span className="sr-only">{label}</span> : label}
    </button>
  );
}

/** The agreed brief's seal, struck a little off straight. */
export function PaperStamp({ label }: { label: string }) {
  return (
    <span data-brief-agreed="" data-paper-stamp="" className="inline-flex h-[26px] -rotate-4 items-center gap-1 rounded border-[1.5px] border-board-teal-ink px-2 text-[13px] font-semibold leading-4 text-board-teal-ink">
      <Check size={14} aria-hidden="true" />
      {label}
    </span>
  );
}

/** Binder holes on an episode script page; colour matches the canvas behind the card. */
export function ScriptHoles({ count = 3 }: { count?: number }) {
  return (
    <div data-sc-holes="" aria-hidden="true" className="pointer-events-none absolute inset-y-0 start-[9px] flex flex-col justify-around py-11">
      {Array.from({ length: count }, (_, index) => (
        <i key={index} data-sc-hole="" className="size-[11px] rounded-full bg-app shadow-[inset_0_1px_2px_var(--color-board-monitor)]" />
      ))}
    </div>
  );
}

/** A button on a monitor: an outline in the screen's own light, or a plain mark for one action. */
export function MonitorButton({ label, icon, onClick, iconOnly = false, title, className }: {
  label: string;
  icon?: ReactNode;
  onClick: () => void;
  iconOnly?: boolean;
  title?: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      data-monitor-button=""
      aria-label={iconOnly ? label : undefined}
      title={title ?? (iconOnly ? label : undefined)}
      className={cn(
        "inline-flex h-7 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-board-paper/40 text-[12px] font-medium text-board-paper transition-colors motion-reduce:transition-none hover:border-board-paper hover:bg-board-paper hover:text-board-ink",
        iconOnly ? "w-7 px-0" : "px-2.5",
        className,
      )}
      onClick={alone(onClick)}
    >
      {icon}
      {iconOnly ? <span className="sr-only">{label}</span> : label}
    </button>
  );
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
    <div className={cn("relative overflow-hidden bg-board-monitor", className)}>
      <video ref={video} src={src} poster={posterUrl} preload="metadata" playsInline controls={playing} className="size-full object-cover" onClick={keepClosed} />
      {playing ? null : (
        <button type="button" aria-label={label} title={label} className="absolute inset-0 m-auto flex size-12 items-center justify-center rounded-full border border-board-paper/85 bg-board-monitor/70 text-board-paper transition-colors motion-reduce:transition-none hover:bg-board-paper hover:text-board-ink" onClick={alone(play)}>
          <Play size={20} aria-hidden="true" className="translate-x-px fill-current" />
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
