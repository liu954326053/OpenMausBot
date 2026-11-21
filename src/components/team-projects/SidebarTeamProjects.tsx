import { Archive, FolderX, Plus } from "lucide-react";
import { useCallback, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

import type { TeamProjectWire } from "../../../shared/team-projects";
import { cn } from "@/lib/cn";
import { hiddenFromSidebar, myDefaultBot, useViewerEmail } from "@/lib/default-bot";
import { t } from "@/lib/i18n";
import { sidebarSectionAttention } from "@/lib/sidebar-attention";
import type { SidebarDensity } from "@/lib/sidebar-preferences";
import { teamProjectSectionId, teamProjectsVersion, type TeamProjectSide } from "@/lib/team-projects";
import { useShowThreads } from "@/lib/thread-preferences";
import type { Bot, Group } from "@/state/store";
import { useStoreDispatch, useStoreSelector } from "@/state/store-select";
import { archiveProject, restoreProject, useTeamProjectsLoader } from "@/state/team-projects";
import { openBot } from "@/state/thread-navigation";
import { UndoToast } from "../bot-access/ShareBotButton";
import { navigateThreadMenu } from "../BotProjects";
import { MENU_ITEM, MENU_SHEET } from "../menu-recipe";
import { useHeldMenuMotion } from "../MenuMotion";
import { SidebarSectionHeader } from "../SidebarSectionHeader";
import { SidebarRailSeparator } from "../SidebarSimpleRail";
import { SIMPLE_RAIL_BUTTON } from "../SidebarSimpleTop";
import { NewTeamProjectDialog } from "./NewTeamProjectDialog";
import { dataSettingsPlace } from "./where-in-settings";

export interface SidebarTeamProjectsMode {
  density: SidebarDensity;
  advanced: boolean;
  /** The sidebar's lists sit 2px apart, not 4px. */
  tight: boolean;
  /** This app drives another computer: its projects are shown, and made and archived on that computer only. */
  remote: boolean;
  /** Departments or other lists come after the projects. */
  followed: boolean;
}

interface Lists {
  bots: Bot[];
  groups: Group[];
}

const MENU_WIDTH = 200;

export function SidebarTeamProjects({ side, all, found, query, sections, mode, botRow, roomRow, onError }: {
  side: TeamProjectSide;
  /** Every bot and group chat the sidebar lists on this side, and those a search found (all of them without a search). */
  all: Lists;
  found: Lists;
  /** Trimmed and in lower case. */
  query: string;
  sections: { interactive: boolean; collapsed(id: string): boolean; toggle(id: string): void };
  mode: SidebarTeamProjectsMode;
  botRow: (bot: Bot) => ReactNode;
  roomRow: (group: Group) => ReactNode;
  onError: (text: string) => void;
}) {
  const dispatch = useStoreDispatch();
  const showThreads = useShowThreads();
  const viewer = useViewerEmail();
  useTeamProjectsLoader(useStoreSelector((state) => teamProjectsVersion(state.bots, state.sections)));
  const selectedId = useStoreSelector((state) => state.selectedId);
  const latest = useRef({ selectedId });
  latest.current = { selectedId };
  const [menu, setMenu] = useState<{ project: TeamProjectWire; x: number; y: number } | null>(null);
  const menuMotion = useHeldMenuMotion(menu);
  const menuReturn = useRef<HTMLElement | null>(null);
  const [archived, setArchived] = useState<{ project: TeamProjectWire; left: { from: string; to: string } | null } | null>(null);
  const [creating, setCreating] = useState(false);
  const forget = useCallback(() => setArchived(null), []);

  if (!side.shown) return null;

  const { density, advanced, remote } = mode;
  const icons = density === "icons";
  const simple = !advanced && !icons;
  const gap = mode.tight ? "gap-0.5" : "gap-1";

  const closeMenu = () => {
    if (menuReturn.current?.isConnected) menuReturn.current.focus();
    setMenu(null);
  };
  const openMenu = (project: TeamProjectWire, x: number, y: number, returnTo: HTMLElement) => {
    menuReturn.current = returnTo;
    setMenu({ project, x: Math.max(8, Math.min(x, window.innerWidth - MENU_WIDTH - 10)), y: Math.max(8, Math.min(y, window.innerHeight - 60)) });
  };

  const inProject = (project: TeamProjectWire, id: string) =>
    all.bots.some((bot) => bot.id === id && side.of(bot)?.id === project.id) || side.teamRooms(project, all.groups).some((group) => group.id === id);
  const archive = async (project: TeamProjectWire) => {
    closeMenu();
    const open = latest.current.selectedId;
    const outside = all.bots.filter((bot) => !bot.hidden && !hiddenFromSidebar(bot, viewer) && !side.of(bot));
    const home = inProject(project, open) ? myDefaultBot(outside, viewer) ?? outside.find((bot) => bot.defaultBot) ?? outside[0] : undefined;
    try {
      await archiveProject(project.id);
    } catch {
      onError(t("teamProjects.archiveFailed", { name: project.name }));
      return;
    }
    if (home) openBot(dispatch, home, showThreads);
    setArchived({ project, left: home ? { from: open, to: home.id } : null });
  };
  const undo = async ({ project, left }: NonNullable<typeof archived>) => {
    await restoreProject(project.id);
    if (left && latest.current.selectedId === left.to) dispatch({ type: "select", id: left.from });
  };

  const shownProjects = side.projects.flatMap((project) => {
    const named = Boolean(query) && project.name.toLowerCase().includes(query);
    const from = named ? { bots: all.bots.filter((bot) => !bot.hidden), groups: all.groups } : found;
    const team = side.team(project, from.bots), rooms = side.teamRooms(project, from.groups);
    return !query || named || team.length + rooms.length > 0 ? [{ project, team, rooms }] : [];
  });
  const mayCreate = !remote && !query;

  const floating = (
    <>
      {menuMotion.shown && menuMotion.value && createPortal(
        <div className={cn("fixed inset-0 z-40", menuMotion.closing && "pointer-events-none")} onMouseDown={closeMenu}>
          <div role="menu" aria-label={menuMotion.value.project.name} style={{ left: menuMotion.value.x, top: menuMotion.value.y, width: MENU_WIDTH }}
            className={cn("absolute text-ink", MENU_SHEET, menuMotion.className)} {...menuMotion.exitProps}
            onMouseDown={(event) => event.stopPropagation()} onKeyDown={(event) => {
              if (event.key === "Escape" || event.key === "Tab") { event.preventDefault(); event.stopPropagation(); closeMenu(); return; }
              navigateThreadMenu(event);
            }}>
            <button type="button" role="menuitem" autoFocus data-team-project-archive="" className={cn(MENU_ITEM, "hover:bg-menu-hover [&>svg]:text-ink-secondary")}
              onClick={() => void archive(menuMotion.value!.project)}>
              <Archive size={16} aria-hidden="true" />{t("teamProjects.archive")}
            </button>
          </div>
        </div>,
        document.body,
      )}
      {archived && <UndoToast key={archived.project.id} text={t("teamProjects.archived", { name: archived.project.name })}
        failedText={t("teamProjects.undoFailed", { place: dataSettingsPlace() })} onUndo={() => undo(archived)} onDone={forget} />}
      {creating && <NewTeamProjectDialog onClose={() => setCreating(false)} />}
    </>
  );

  if (icons) {
    return (
      <div data-sidebar-team-projects="" className={cn("flex flex-col", gap)}>
        {shownProjects.map(({ project, team, rooms }) => {
          const missing = project.folderState === "missing";
          const missingText = t("teamProjects.folderMissingNamed", { name: project.name });
          return (
            <div key={project.id} role="group" aria-label={project.name} data-sidebar-team-project={project.id} className={cn("flex flex-col", gap)}>
              <SidebarRailSeparator />
              {missing && (
                <span role="img" data-team-project-missing="" aria-label={missingText} title={missingText} className="mx-auto flex size-6 shrink-0 items-center justify-center text-warning">
                  <FolderX size={16} aria-hidden="true" />
                </span>
              )}
              <div data-team-project-team="" className={cn("flex flex-col", gap, missing && "opacity-50")}>
                {team.map(botRow)}
                {rooms.map(roomRow)}
              </div>
            </div>
          );
        })}
        {mayCreate && (
          <button type="button" data-team-project-new="" aria-label={t("teamProjects.new")} title={t("teamProjects.new")} onClick={() => setCreating(true)}
            className={cn(SIMPLE_RAIL_BUTTON, "mx-auto")}>
            <Plus size={18} aria-hidden="true" />
          </button>
        )}
        {mode.followed && <SidebarRailSeparator />}
        {floating}
      </div>
    );
  }

  return (
    <div data-sidebar-team-projects="" className={cn("flex flex-col", gap, advanced && mode.followed && "pb-3")}>
      {shownProjects.map(({ project, team, rooms }, index) => {
        const id = teamProjectSectionId(project.id);
        const collapsed = sections.collapsed(id);
        const missing = project.folderState === "missing";
        const menuOpen = menu?.project.id === project.id;
        return (
          <div key={project.id} data-sidebar-team-project={project.id} className={cn("flex flex-col", gap, advanced && index > 0 && "pt-3")}>
            <SidebarSectionHeader
              name={project.name}
              line={simple} reserveMenu={simple && !remote}
              collapsed={collapsed}
              attention={collapsed ? sidebarSectionAttention(team, rooms) : undefined}
              onToggle={sections.interactive ? () => sections.toggle(id) : undefined}
              reorderable={false} dragging={false}
              menuLabel={t("teamProjects.actions", { name: project.name })} menuOpen={menuOpen}
              onMenu={remote ? undefined : (button) => {
                const rect = button.getBoundingClientRect();
                openMenu(project, rect.right - MENU_WIDTH, rect.bottom + 4, button);
              }}
              onContextMenu={remote ? undefined : (event) => {
                event.preventDefault();
                openMenu(project, event.clientX, event.clientY, event.currentTarget.querySelector<HTMLElement>("button") ?? event.currentTarget);
              }}
            />
            {missing && (
              <p data-team-project-missing="" className={cn("flex items-center gap-1.5 pb-1 text-[12px] leading-4 text-warning", simple ? "px-2" : "px-3")}>
                <FolderX size={14} aria-hidden="true" className="shrink-0" /><span className="min-w-0 truncate">{t("teamProjects.folderMissing")}</span>
              </p>
            )}
            {!collapsed && (
              <div data-team-project-team="" className={cn("flex flex-col", gap, missing && "opacity-50")}>
                {team.map(botRow)}
                {rooms.map(roomRow)}
              </div>
            )}
          </div>
        );
      })}
      {mayCreate && (
        <button type="button" data-team-project-new="" onClick={() => setCreating(true)}
          className={cn(
            "flex items-center gap-1.5 text-ink-secondary hover:bg-raised/50 hover:text-ink focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus",
            simple ? "h-[30px] rounded-lg px-2 text-[13px] leading-[18px]" : "mx-2 rounded-md px-1 py-1 text-[12px] leading-4",
            advanced && shownProjects.length > 0 && "mt-2",
          )}>
          <Plus size={simple ? 14 : 13} aria-hidden="true" className="shrink-0" />{t("teamProjects.new")}
        </button>
      )}
      {floating}
    </div>
  );
}
