import { useId, type ReactNode } from "react";
import { AlertCircle, Clock, LoaderCircle } from "lucide-react";
import type { CanvasBotStatus } from "../../../../shared/project-canvas";
import { BotAvatar } from "@/components/Avatar";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import type { CanvasBotLook } from "@/lib/project-canvas/types";
import type { LocaleKey } from "@/locales";

export const NO_LOOK: CanvasBotLook = { color: "silver" };

export const PANEL_ROW = "flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-start transition-colors duration-[120ms] hover:bg-ink/[0.06] motion-reduce:transition-none";
export const ROW_META = "block truncate text-[12px] leading-4 text-ink-tertiary";

const STATUS: Record<CanvasBotStatus, { key: LocaleKey; className: string; icon: ReactNode }> = {
  working: { key: "boardPanels.status.working", className: "text-accent-text", icon: <LoaderCircle size={14} aria-hidden="true" className="animate-spin motion-reduce:animate-none" /> },
  queued: { key: "boardPanels.status.queued", className: "text-ink-secondary", icon: <Clock size={14} aria-hidden="true" /> },
  waiting: { key: "boardPanels.status.waiting", className: "text-warning", icon: <AlertCircle size={14} aria-hidden="true" /> },
  idle: { key: "boardPanels.status.idle", className: "text-ink-tertiary", icon: null },
  error: { key: "boardPanels.status.error", className: "text-danger", icon: <AlertCircle size={14} aria-hidden="true" /> },
};

export function BotStatus({ status }: { status: CanvasBotStatus }) {
  const look = STATUS[status];
  return <span className={cn("inline-flex shrink-0 items-center gap-1 text-[12px] leading-4", look.className)}>{look.icon}{t(look.key)}</span>;
}

/** A bot's avatar beside its name, which says who it is; the dot says it has replies the person hasn't read. */
export function BotFace({ name, look, size }: { name: string; look: CanvasBotLook; size: number }) {
  return (
    <span className="relative flex shrink-0">
      <span aria-hidden="true" className="flex">
        <BotAvatar bot={{ name, ...look }} size={size} />
      </span>
      {look.unread ? <span role="img" aria-label={t("boardPanels.team.unread")} className="absolute -end-0.5 -top-0.5 size-2.5 rounded-full border-2 border-menu bg-accent" /> : null}
    </span>
  );
}

export function RowGroup({ label, count, children }: { label?: string; count?: number; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={label ? id : undefined} className="flex flex-col pb-1">
      {label ? (
        <h3 id={id} className="flex items-center justify-between gap-2 px-2 pb-1 pt-2 text-[12px] font-medium leading-4 text-ink-tertiary">
          <span className="truncate">{label}</span>
          {count === undefined ? null : <span className="tabular-nums">{count}</span>}
        </h3>
      ) : null}
      <ul className="flex flex-col">{children}</ul>
    </section>
  );
}

export function EmptyLine({ text }: { text: string }) {
  return <p className="px-2 py-3 text-[13px] leading-[18px] text-ink-tertiary">{text}</p>;
}
