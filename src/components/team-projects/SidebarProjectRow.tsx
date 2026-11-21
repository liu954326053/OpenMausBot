import { ChevronRight, Crown, FolderClosed, MoreHorizontal } from "lucide-react";
import type { MouseEvent } from "react";

import type { TeamProjectWire } from "../../../shared/team-projects";
import { botShowsUnread } from "@/lib/bot-unread";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { sidebarAttentionLabel, sidebarSectionAttention } from "@/lib/sidebar-attention";
import { visibleMessages, type Bot, type Group } from "@/state/store";
import { BotAvatar } from "../Avatar";
import { sidebarBotStatus } from "../SidebarBotActivity";
import { AvatarActivityDot, RowStatusText, rowSelectedSurface, rowSurface, type RowActivity } from "../SidebarRowMarkers";
import { SectionAttention } from "../SidebarSectionHeader";
import { SIMPLE_RAIL_BUTTON, SIMPLE_ROW_FOCUS } from "../SidebarSimpleTop";

const HOVER_CONTROL = "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 max-md:opacity-70 touch:opacity-70";

/** One project in the sidebar: a click opens its view, the chevron shows its team below it. */
export function SidebarProjectRow({ project, team, rooms, simple, open, selected, menuOpen, onOpen, onToggle, onMenu }: {
  project: TeamProjectWire;
  team: Bot[];
  rooms: Group[];
  simple: boolean;
  open: boolean;
  selected: boolean;
  menuOpen: boolean;
  onOpen: () => void;
  /** Absent while a search decides what is shown. */
  onToggle?: () => void;
  /** Absent on a computer this app only drives. */
  onMenu?: (x: number, y: number, returnTo: HTMLElement) => void;
}) {
  const attention = sidebarSectionAttention(team, rooms);
  const menuAt = (event: MouseEvent<HTMLButtonElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    onMenu?.(rect.right - 200, rect.bottom + 4, event.currentTarget);
  };
  return (
    <div className="group relative">
      <button type="button" data-sidebar-project-row={project.id} aria-current={selected ? "page" : undefined} onClick={onOpen}
        onContextMenu={onMenu ? (event) => { event.preventDefault(); onMenu(event.clientX, event.clientY, event.currentTarget); } : undefined}
        onKeyDown={onMenu ? (event) => {
          if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return;
          event.preventDefault();
          const rect = event.currentTarget.getBoundingClientRect();
          onMenu(rect.left + rect.width / 2, rect.top + rect.height / 2, event.currentTarget);
        } : undefined}
        className={cn(
          "relative flex w-full min-w-0 items-center gap-2.5 text-start", SIMPLE_ROW_FOCUS,
          simple ? "h-11 rounded-[8px] ps-6 pe-9" : "h-9 rounded-md ps-6 pe-9",
          selected ? rowSelectedSurface : "hover:bg-raised/50",
        )}>
        <span aria-hidden="true" className={cn("grid shrink-0 place-items-center bg-raised text-ink-secondary", simple ? "size-8 rounded-[10px]" : "size-7 rounded-lg")}>
          <FolderClosed size={simple ? 16 : 15} strokeWidth={1.75} />
        </span>
        <span className={cn("min-w-0 flex-1 truncate text-ink", simple ? "text-[14px] font-medium leading-5" : "text-[14px] font-semibold leading-5")}>{project.name}</span>
        {!open && <SectionAttention attention={attention} label={sidebarAttentionLabel(attention)} />}
      </button>
      {onToggle && (
        <button type="button" aria-label={t(open ? "sidebar.section.collapse" : "sidebar.section.expand", { name: project.name })} aria-expanded={open} onClick={onToggle}
          className="absolute start-0.5 top-1/2 flex size-5 -translate-y-1/2 items-center justify-center rounded text-ink-secondary outline-none hover:text-ink focus-visible:ring-1 focus-visible:ring-accent/60">
          <ChevronRight aria-hidden="true" size={12} className={cn("transition-transform rtl:-scale-x-100", open && "rotate-90")} />
        </button>
      )}
      {onMenu && (
        <button type="button" aria-label={t("teamProjects.actions", { name: project.name })} aria-haspopup="menu" aria-expanded={menuOpen} onClick={menuAt}
          className={cn("absolute end-1 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded text-ink-secondary hover:bg-raised hover:text-ink focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-focus",
            menuOpen ? "opacity-100" : HOVER_CONTROL)}>
          <MoreHorizontal size={16} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

/** A project in the narrow sidebar: its first letter in a square, with the mark of its team's state. */
export function SidebarProjectTile({ project, team, rooms, selected, onOpen, onMenu }: {
  project: TeamProjectWire;
  team: Bot[];
  rooms: Group[];
  selected: boolean;
  onOpen: () => void;
  onMenu?: (x: number, y: number, returnTo: HTMLElement) => void;
}) {
  const attention = sidebarSectionAttention(team, rooms);
  const label = sidebarAttentionLabel(attention);
  return (
    <button type="button" data-sidebar-project-row={project.id} aria-label={label ? `${project.name}, ${label}` : project.name} title={project.name}
      aria-current={selected ? "page" : undefined} onClick={onOpen}
      onContextMenu={onMenu ? (event) => { event.preventDefault(); onMenu(event.clientX, event.clientY, event.currentTarget); } : undefined}
      className={cn(SIMPLE_RAIL_BUTTON, "relative mx-auto size-[46px]", selected && "bg-raised text-ink")}>
      <span aria-hidden="true" className="grid size-8 place-items-center rounded-[10px] bg-raised text-[14px] font-semibold text-ink">
        {[...project.name.trim()][0]?.toLocaleUpperCase() ?? <FolderClosed size={16} />}
      </span>
      <span aria-hidden="true" className="absolute -end-0.5 -top-0.5 flex"><SectionAttention attention={attention} label="" /></span>
    </button>
  );
}

/** A member of an open project: a click opens the project with this bot chosen. */
export function SidebarProjectMember({ bot, lead, simple, selected, queued, onOpen }: {
  bot: Bot;
  lead: boolean;
  simple: boolean;
  selected: boolean;
  queued: Record<string, unknown[]>;
  onOpen: () => void;
}) {
  const { waiting, working, failed, teammateWait, queued: inQueue } = sidebarBotStatus(bot, queued, visibleMessages(bot));
  const unread = botShowsUnread(bot);
  const activity: RowActivity | null = working ? "working" : failed ? "failed" : teammateWait ? "teammate" : inQueue ? "queued" : null;
  return (
    <button type="button" data-sidebar-bot-row={bot.id} data-sidebar-project-member={bot.id} aria-current={selected ? "page" : undefined} onClick={onOpen}
      className={cn(
        "relative flex w-full min-w-0 items-center gap-2 text-start", SIMPLE_ROW_FOCUS, rowSurface(selected),
        simple ? "h-10 rounded-[8px] ps-9 pe-3" : "h-8 rounded-md ps-9 pe-3",
        selected ? rowSelectedSurface : "hover:bg-raised/50",
      )}>
      <span className="relative flex shrink-0">
        <BotAvatar bot={bot} size={simple ? 26 : 22} animated={working} />
        <AvatarActivityDot activity={activity} />
      </span>
      <span className="min-w-0 truncate text-[13px] text-ink">{bot.name}</span>
      {lead && <Crown size={11} aria-label={t("sidebar.bot.chiefOfStaff")} className="shrink-0 text-warning" />}
      <span className="flex-1" />
      {(waiting || unread) && (
        <span aria-hidden="true" data-testid={waiting ? "waiting-dot" : "unread-dot"} title={waiting ? t("sidebar.preview.waiting") : t("task.unread")}
          className={cn("size-2 shrink-0 rounded-full", waiting ? "bg-warning" : "bg-accent")} />
      )}
      {waiting && <span className="sr-only">{t("sidebar.preview.waiting")}</span>}
      <RowStatusText working={working} failed={failed} unread={unread} />
    </button>
  );
}
