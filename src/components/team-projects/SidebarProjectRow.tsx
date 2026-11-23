import { Crown, FolderClosed, FolderOpen, MessagesSquare, MoreHorizontal } from "lucide-react";
import type { MouseEvent } from "react";

import type { TeamProjectWire } from "../../../shared/team-projects";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { stateForBot } from "@/lib/mascot";
import { sidebarAttentionLabel, sidebarSectionAttention, type SidebarSectionAttention } from "@/lib/sidebar-attention";
import type { Bot, Group } from "@/state/store";
import { BotAvatar } from "../Avatar";
import { rowSelectedSurface } from "../SidebarRowMarkers";
import { SectionAttention } from "../SidebarSectionHeader";
import { SIMPLE_RAIL_BUTTON, SIMPLE_ROW_FOCUS } from "../SidebarSimpleTop";

const HOVER_CONTROL = "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 max-md:opacity-70 touch:opacity-70";
const UNDER_PROJECT = cn("relative flex w-full min-w-0 items-center gap-2 text-start", SIMPLE_ROW_FOCUS);

/** Where a row under a project's row starts: at the project's name; at the name of the row it unfolds from; or a step
 * in from that, as an episode's bots under the episode. */
export type UnderProjectDepth = 0 | 1 | 2;

const UNDER_PROJECT_INSET: Record<"simple" | "advanced", Record<UnderProjectDepth, string>> = {
  simple: { 0: "ps-[50px]", 1: "ps-[80px]", 2: "ps-[92px]" },
  advanced: { 0: "ps-[46px]", 1: "ps-[74px]", 2: "ps-[86px]" },
};

export function underProjectRow(simple: boolean, depth: UnderProjectDepth, selected: boolean): string {
  return cn(UNDER_PROJECT, simple ? "h-10 rounded-[8px] pe-2" : "h-8 rounded-md pe-2", UNDER_PROJECT_INSET[simple ? "simple" : "advanced"][depth],
    selected ? rowSelectedSurface : "hover:bg-raised/50");
}

/** One project in the sidebar. `expanded`: its group chat and its bots show under it. */
export function SidebarProjectRow({ project, attention, simple, selected, expanded, menuOpen, onOpen, onMenu }: {
  project: TeamProjectWire;
  /** Over all the project's bots and group chats. */
  attention: SidebarSectionAttention;
  simple: boolean;
  selected: boolean;
  /** Absent where a project shows nothing under it, as in a search. */
  expanded?: boolean;
  menuOpen: boolean;
  onOpen: () => void;
  /** Absent on a computer this app only drives. */
  onMenu?: (x: number, y: number, returnTo: HTMLElement) => void;
}) {
  const menuAt = (event: MouseEvent<HTMLButtonElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    onMenu?.(rect.right - 200, rect.bottom + 4, event.currentTarget);
  };
  const Folder = expanded ? FolderOpen : FolderClosed;
  return (
    <div className="group relative">
      <button type="button" data-sidebar-project-row={project.id} aria-current={selected ? "page" : undefined} aria-expanded={expanded} onClick={onOpen}
        onContextMenu={onMenu ? (event) => { event.preventDefault(); onMenu(event.clientX, event.clientY, event.currentTarget); } : undefined}
        onKeyDown={onMenu ? (event) => {
          if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return;
          event.preventDefault();
          const rect = event.currentTarget.getBoundingClientRect();
          onMenu(rect.left + rect.width / 2, rect.top + rect.height / 2, event.currentTarget);
        } : undefined}
        className={cn(
          "relative flex w-full min-w-0 items-center gap-2.5 text-start", SIMPLE_ROW_FOCUS,
          simple ? "h-11 rounded-[8px] ps-2 pe-9" : "h-9 rounded-md ps-2 pe-9",
          selected ? rowSelectedSurface : "hover:bg-raised/50",
        )}>
        <span aria-hidden="true" className={cn("grid shrink-0 place-items-center bg-raised text-ink-secondary", simple ? "size-8 rounded-[10px]" : "size-7 rounded-lg")}>
          <Folder size={simple ? 16 : 15} strokeWidth={1.75} />
        </span>
        <span className={cn("min-w-0 flex-1 truncate text-ink", simple ? "text-[14px] font-medium leading-5" : "text-[14px] font-semibold leading-5")}>{project.name}</span>
        <SectionAttention attention={attention} label={sidebarAttentionLabel(attention)} />
      </button>
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

/** A project's bot under its open row, set in to the project's name: its role after its name, the lead's mark, and a
 * click that opens the bot's conversation. */
export function SidebarProjectBot({ bot, lead, role = bot.title.trim(), depth = 0, simple, selected, onOpen }: {
  bot: Bot;
  lead?: boolean;
  role?: string;
  depth?: UnderProjectDepth;
  simple: boolean;
  selected: boolean;
  onOpen: () => void;
}) {
  const attention = sidebarSectionAttention([bot], []);
  const leadLabel = lead ? t("teamProjects.lead") : "";
  return (
    <button type="button" data-sidebar-project-bot={bot.id} aria-current={selected ? "page" : undefined} onClick={onOpen} title={[bot.name, role, leadLabel].filter(Boolean).join(" · ")}
      className={underProjectRow(simple, depth, selected)}>
      <BotAvatar bot={bot} state={stateForBot(bot)} size={simple ? 22 : 20} />
      <span dir="auto" className="min-w-0 shrink truncate text-[13px] leading-5 text-ink">{bot.name}</span>
      {role ? (
        <span dir="auto" data-sidebar-project-bot-title="" className="min-w-0 flex-1 truncate text-[12px] leading-4 text-ink-tertiary">{role}</span>
      ) : (
        <span className="flex-1" />
      )}
      {lead ? (
        <span data-sidebar-project-bot-lead="" title={leadLabel} className="flex shrink-0 items-center text-ink-secondary">
          <Crown size={14} aria-hidden="true" />
          <span className="sr-only">{leadLabel}</span>
        </span>
      ) : null}
      <SectionAttention attention={attention} label={sidebarAttentionLabel(attention)} />
    </button>
  );
}

/** A project's group chat, first under its open row: a click opens the group chat. */
export function SidebarProjectRoom({ room, simple, selected, onOpen }: { room: Group; simple: boolean; selected: boolean; onOpen: () => void }) {
  const attention = sidebarSectionAttention([], [room]);
  return (
    <button type="button" data-sidebar-project-room={room.id} aria-current={selected ? "page" : undefined} onClick={onOpen} title={room.name}
      className={underProjectRow(simple, 0, selected)}>
      <span aria-hidden="true" className={cn("grid shrink-0 place-items-center text-ink-secondary", simple ? "size-[22px]" : "size-5")}>
        <MessagesSquare size={14} />
      </span>
      <span className="min-w-0 flex-1 truncate text-[13px] leading-5 text-ink">{room.name}</span>
      <SectionAttention attention={attention} label={sidebarAttentionLabel(attention)} />
    </button>
  );
}

/** A project in the narrow sidebar: its first letter in a square, with the mark of its team's state. */
export function SidebarProjectTile({ project, attention, selected, onOpen, onMenu }: {
  project: TeamProjectWire;
  attention: SidebarSectionAttention;
  selected: boolean;
  onOpen: () => void;
  onMenu?: (x: number, y: number, returnTo: HTMLElement) => void;
}) {
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
