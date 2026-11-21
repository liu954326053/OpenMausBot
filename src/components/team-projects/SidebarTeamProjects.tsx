import { Archive, FolderX, Plus, UsersRound } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { createPortal } from "react-dom";

import type { TeamProjectWire } from "../../../shared/team-projects";
import { cn } from "@/lib/cn";
import { hiddenFromSidebar, myDefaultBot, useViewerEmail } from "@/lib/default-bot";
import { t } from "@/lib/i18n";
import { sidebarSectionAttention } from "@/lib/sidebar-attention";
import type { SidebarDensity } from "@/lib/sidebar-preferences";
import { teamProjectsVersion, type TeamProjectSide } from "@/lib/team-projects";
import { useShowThreads } from "@/lib/thread-preferences";
import type { Bot, Group } from "@/state/store";
import { useStoreDispatch, useStoreSelector } from "@/state/store-select";
import { archiveProject, restoreProject, useTeamProjectsLoader } from "@/state/team-projects";
import { openBot } from "@/state/thread-navigation";
import { UndoToast } from "../bot-access/ShareBotButton";
import { navigateThreadMenu } from "../BotProjects";
import { MENU_ITEM, MENU_SHEET } from "../menu-recipe";
import { useHeldMenuMotion } from "../MenuMotion";
import { SidebarRailSeparator } from "../SidebarSimpleRail";
import { SIMPLE_RAIL_BUTTON } from "../SidebarSimpleTop";
import { SidebarProjectRow, SidebarProjectTile } from "./SidebarProjectRow";
import { TeamChangesDialog } from "./TeamChangesDialog";
import { dataSettingsPlace } from "./where-in-settings";

export interface SidebarTeamProjectsMode {
  density: SidebarDensity;
  advanced: boolean;
  /** The sidebar's lists sit 2px apart, not 4px. */
  tight: boolean;
  /** This app drives another computer: its projects are shown, and made and archived on that computer only. */
  remote: boolean;
}

interface Lists {
  bots: Bot[];
  groups: Group[];
}

const MENU_WIDTH = 200;

/** One row per project; a click opens its canvas. A search lists the projects whose name holds it, nothing under them. */
export function SidebarTeamProjects({ side, all, query, mode, onNew, onError }: {
  side: TeamProjectSide;
  /** Every bot and group chat the sidebar lists on this side. */
  all: Lists;
  /** The sidebar's search, trimmed. */
  query: string;
  mode: SidebarTeamProjectsMode;
  onNew: () => void;
  onError: (text: string) => void;
}) {
  const dispatch = useStoreDispatch();
  const showThreads = useShowThreads();
  const viewer = useViewerEmail();
  useTeamProjectsLoader(useStoreSelector((state) => teamProjectsVersion(state.bots, state.sections)));
  const selectedId = useStoreSelector((state) => state.selectedId);
  const shownProject = useStoreSelector((state) => (state.activeView === "project" ? state.project : undefined));
  const latest = useRef({ selectedId, shownProject });
  latest.current = { selectedId, shownProject };
  const [menu, setMenu] = useState<{ project: TeamProjectWire; x: number; y: number } | null>(null);
  const menuMotion = useHeldMenuMotion(menu);
  const menuReturn = useRef<HTMLElement | null>(null);
  const [archived, setArchived] = useState<{ project: TeamProjectWire; left: { from: string; to: string } | null } | null>(null);
  const [reviewing, setReviewing] = useState<TeamProjectWire | null>(null);
  const forget = useCallback(() => setArchived(null), []);

  const listedBots = all.bots.filter((bot) => !bot.hidden);
  const shownProjects = side.projects
    .filter((project) => project.name.toLowerCase().includes(query.toLowerCase()))
    .map((project) => ({ project, attention: sidebarSectionAttention(side.team(project, listedBots), side.teamRooms(project, all.groups)) }));
  const noMatch = query !== "" && shownProjects.length === 0 && (
    <p data-sidebar-no-project-match="" className="px-3 py-6 text-center text-[13px] text-ink-secondary">{t("sidebar.noProjectMatch", { query })}</p>
  );
  if (!side.shown) return noMatch || null;

  const { density, advanced, remote } = mode;
  const icons = density === "icons";
  const simple = !advanced && !icons;
  const gap = mode.tight ? "gap-0.5" : "gap-1";

  const closeMenu = () => {
    if (menuReturn.current?.isConnected) menuReturn.current.focus();
    setMenu(null);
  };
  const openMenu = remote ? undefined : (project: TeamProjectWire) => (x: number, y: number, returnTo: HTMLElement) => {
    menuReturn.current = returnTo;
    setMenu({ project, x: Math.max(8, Math.min(x, window.innerWidth - MENU_WIDTH - 10)), y: Math.max(8, Math.min(y, window.innerHeight - 60)) });
  };

  const inProject = (project: TeamProjectWire, id: string) =>
    latest.current.shownProject?.id === project.id ||
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
  const review = (project: TeamProjectWire) => {
    closeMenu();
    setReviewing(project);
  };
  const changesOf = (project: TeamProjectWire) => (remote ? undefined : project.teamChanges);
  const undo = async ({ project, left }: NonNullable<typeof archived>) => {
    await restoreProject(project.id);
    if (left && latest.current.selectedId === left.to) dispatch({ type: "select", id: left.from });
  };
  const show = (project: TeamProjectWire) => dispatch({ type: "showProject", projectId: project.id });
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
            {menuMotion.value.project.teamChanges && (
              <button type="button" role="menuitem" autoFocus data-team-project-review="" className={cn(MENU_ITEM, "hover:bg-menu-hover [&>svg]:text-ink-secondary")}
                onClick={() => review(menuMotion.value!.project)}>
                <UsersRound size={16} aria-hidden="true" />{t("teamProjects.changes.review")}
              </button>
            )}
            <button type="button" role="menuitem" autoFocus={!menuMotion.value.project.teamChanges} data-team-project-archive=""
              className={cn(MENU_ITEM, "hover:bg-menu-hover [&>svg]:text-ink-secondary")}
              onClick={() => void archive(menuMotion.value!.project)}>
              <Archive size={16} aria-hidden="true" />{t("teamProjects.archive")}
            </button>
          </div>
        </div>,
        document.body,
      )}
      {archived && <UndoToast key={archived.project.id} text={t("teamProjects.archived", { name: archived.project.name })}
        failedText={t("teamProjects.undoFailed", { place: dataSettingsPlace() })} onUndo={() => undo(archived)} onDone={forget} />}
      {reviewing?.teamChanges && <TeamChangesDialog project={reviewing} changes={reviewing.teamChanges} onClose={() => setReviewing(null)} />}
    </>
  );

  if (icons) {
    return (
      <div data-sidebar-team-projects="" className={cn("flex flex-col", gap)}>
        {shownProjects.length > 0 && <SidebarRailSeparator />}
        {shownProjects.map(({ project, attention }) => {
          const missing = project.folderState === "missing";
          const missingText = t("teamProjects.folderMissingNamed", { name: project.name });
          const changedText = t("teamProjects.changes.noticeNamed", { name: project.name });
          return (
            <div key={project.id} role="group" aria-label={project.name} data-sidebar-team-project={project.id} className={cn("flex flex-col", gap)}>
              <SidebarProjectTile project={project} attention={attention} selected={shownProject?.id === project.id}
                onOpen={() => show(project)} onMenu={openMenu?.(project)} />
              {missing && (
                <span role="img" data-team-project-missing="" aria-label={missingText} title={missingText} className="mx-auto flex size-6 shrink-0 items-center justify-center text-warning">
                  <FolderX size={16} aria-hidden="true" />
                </span>
              )}
              {changesOf(project) && (
                <button type="button" data-team-project-changes="" aria-label={changedText} title={changedText} onClick={() => review(project)}
                  className={cn(SIMPLE_RAIL_BUTTON, "mx-auto text-accent-text")}>
                  <UsersRound size={16} aria-hidden="true" />
                </button>
              )}
            </div>
          );
        })}
        {mayCreate && (
          <button type="button" data-team-project-new="" aria-label={t("teamProjects.new")} title={t("teamProjects.new")} onClick={onNew}
            className={cn(SIMPLE_RAIL_BUTTON, "mx-auto")}>
            <Plus size={18} aria-hidden="true" />
          </button>
        )}
        {floating}
      </div>
    );
  }

  return (
    <div data-sidebar-team-projects="" className={cn("flex flex-col", gap)}>
      {noMatch}
      {shownProjects.map(({ project, attention }) => {
        const missing = project.folderState === "missing";
        return (
          <div key={project.id} data-sidebar-team-project={project.id} className={cn("flex flex-col", gap)}>
            <SidebarProjectRow project={project} attention={attention} simple={simple}
              selected={shownProject?.id === project.id} menuOpen={menu?.project.id === project.id}
              onOpen={() => show(project)} onMenu={openMenu?.(project)} />
            {missing && (
              <p data-team-project-missing="" className={cn("flex items-center gap-1.5 pb-1 text-[12px] leading-4 text-warning", simple ? "px-2" : "px-3")}>
                <FolderX size={14} aria-hidden="true" className="shrink-0" /><span className="min-w-0 truncate">{t("teamProjects.folderMissing")}</span>
              </p>
            )}
            {changesOf(project) && (
              <button type="button" data-team-project-changes="" onClick={() => review(project)}
                className={cn("flex items-center gap-1.5 rounded-md pb-1 text-start text-[12px] leading-4 text-accent-text hover:underline focus-visible:outline-2 focus-visible:outline-focus", simple ? "px-2" : "px-3")}>
                <UsersRound size={14} aria-hidden="true" className="shrink-0" /><span className="min-w-0 truncate">{t("teamProjects.changes.notice")}</span>
              </button>
            )}
          </div>
        );
      })}
      {mayCreate && (
        <button type="button" data-team-project-new="" onClick={onNew}
          className={cn(
            "flex items-center gap-1.5 text-ink-secondary hover:bg-raised/50 hover:text-ink focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus",
            simple ? "h-[30px] rounded-lg px-2 text-[13px] leading-[18px]" : "mx-2 rounded-md px-1 py-1 text-[12px] leading-4",
            advanced && shownProjects.length > 0 && "mt-1",
          )}>
          <Plus size={simple ? 14 : 13} aria-hidden="true" className="shrink-0" />{t("teamProjects.new")}
        </button>
      )}
      {floating}
    </div>
  );
}
