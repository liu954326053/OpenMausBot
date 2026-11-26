import { Bot, Clapperboard, Drama, Megaphone, Mountain, PenLine, Scissors, type LucideIcon } from "lucide-react";
import { PRODUCTION_JOBS, type ProductionJob } from "../../../../shared/production";
import { botNodeId, type CanvasBotState, type CanvasFileRef, type CanvasSnapshot } from "../../../../shared/project-canvas";
import { BotAvatar } from "@/components/Avatar";
import { formatTime } from "@/lib/clock-time";
import { cn } from "@/lib/cn";
import type { BoardBotCard, BoardTake, RetryTarget } from "@/lib/production-board/types";
import type { CanvasBotLook } from "@/lib/project-canvas/types";

export interface NodeActions {
  /** Brings a card into view; a bot's also opens its chat. */
  focusCard(cardId: string): void;
  openChat(botId: string): void;
  openStack(): void;
  generate?(nodeId: string): void;
  selectTake?(nodeId: string): void;
  retry?(target: RetryTarget): void;
  openDraft?(): void;
}

export interface NodeContext {
  snapshot: CanvasSnapshot;
  looks: Readonly<Record<string, CanvasBotLook>>;
  fileUrl(file: CanvasFileRef): string;
  /** The take of a shot the film uses, else its newest; none while it has no video. */
  takeOf(shotId: string): BoardTake | undefined;
  actions: NodeActions;
}

export type JobKey = ProductionJob | "lead" | "other";

export const JOB_ICON: Readonly<Record<JobKey, LucideIcon>> = {
  lead: Megaphone,
  script: PenLine,
  character: Drama,
  scene: Mountain,
  storyboard: Clapperboard,
  post: Scissors,
  other: Bot,
};

export const jobKey = (card: Pick<BoardBotCard, "lead" | "job">): JobKey => (card.lead ? "lead" : card.job ?? "other");

const botJobKey = (bot: CanvasBotState, snapshot: CanvasSnapshot): JobKey =>
  jobKey({ lead: bot.lead || bot.botId === snapshot.project.leadBotId, job: PRODUCTION_JOBS.find((job) => bot.stages.includes(job)) });

export function Ic({ icon: Icon, className }: { icon: LucideIcon; className?: string }) {
  return <Icon className={cn("ic", className)} aria-hidden="true" />;
}

export function Chips({ items }: { items: readonly string[] }) {
  return (
    <div className="chips">
      {items.map((item, index) => <span key={index} className="chip">{item}</span>)}
    </div>
  );
}

export function Pal({ colors, label }: { colors: readonly string[]; label: string }) {
  return (
    <span className="pal" role="img" aria-label={label}>
      {colors.map((color, index) => <i key={index} style={{ background: color }} />)}
    </span>
  );
}

export function Meter({ percent, label }: { percent: number; label: string }) {
  const filled = Math.min(100, Math.max(0, percent));
  return (
    <div className="meter" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(filled)}>
      <i style={{ width: `${filled}%` }} />
    </div>
  );
}

export function BotFace({ botId, ctx, size, fallback }: { botId: string; ctx: NodeContext; size: number; fallback: JobKey }) {
  const look = ctx.looks[botId];
  if (!look) return <Ic icon={JOB_ICON[fallback]} />;
  return <BotAvatar bot={{ name: ctx.snapshot.bots[botId]?.name, ...look }} size={size} />;
}

export function BotButton({ botId, ctx, suffix, label }: { botId: string; ctx: NodeContext; suffix?: string; label?: string }) {
  const bot = ctx.snapshot.bots[botId];
  if (!bot) return null;
  return (
    <button type="button" className="tk-who" aria-label={label} onClick={() => ctx.actions.focusCard(botNodeId(botId))}>
      <BotFace botId={botId} ctx={ctx} size={14} fallback={botJobKey(bot, ctx.snapshot)} />
      {suffix ? `${bot.name} · ${suffix}` : bot.name}
    </button>
  );
}

export function clock(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

export const timeOfDay = (at: number): string => formatTime(at);
