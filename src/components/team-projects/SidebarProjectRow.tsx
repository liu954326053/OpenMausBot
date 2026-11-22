import { FolderClosed, FolderOpen, MoreHorizontal } from "lucide-react";
import type { MouseEvent } from "react";

import type { TeamProjectWire } from "../../../shared/team-projects";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { stateForBot } from "@/lib/mascot";
import { sidebarAttentionLabel, sidebarSectionAttention, type SidebarSectionAttention } from "@/lib/sidebar-attention";
import type { Bot } from "@/state/store";
import { BotAvatar } from "../Avatar";
import { rowSelectedSurface } from "../SidebarRowMarkers";
import { SectionAttention } from "../SidebarSectionHeader";
import { SIMPLE_RAIL_BUTTON, SIMPLE_ROW_FOCUS } from "../SidebarSimpleTop";

const HOVER_CONTROL = "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 max-md:opacity-70 touch:opacity-70";

/** One project in the sidebar. `expanded`: its lead shows under it. */
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

/** A project's lead under its open row, set in to the project's name: a click opens the lead's conversation. */
export function SidebarProjectLead({ bot, simple, selected, onOpen }: { bot: Bot; simple: boolean; selected: boolean; onOpen: () => void }) {
  const attention = sidebarSectionAttention([bot], []);
  return (
    <button type="button" data-sidebar-project-lead={bot.id} aria-current={selected ? "page" : undefined} onClick={onOpen} title={bot.name}
      className={cn(
        "relative flex w-full min-w-0 items-center gap-2 text-start", SIMPLE_ROW_FOCUS,
        simple ? "h-10 rounded-[8px] ps-[50px] pe-2" : "h-8 rounded-md ps-[46px] pe-2",
        selected ? rowSelectedSurface : "hover:bg-raised/50",
      )}>
      <BotAvatar bot={bot} state={stateForBot(bot)} size={simple ? 22 : 20} />
      <span className="min-w-0 flex-1 truncate text-[13px] leading-5 text-ink">{bot.name}</span>
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
