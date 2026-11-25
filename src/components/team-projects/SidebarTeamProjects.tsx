import { Archive, FolderX, Pencil, Plus, Trash2, UsersRound } from "lucide-react";
import { useCallback, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

import type { TeamProjectWire } from "../../../shared/team-projects";
import { TEAM_PROJECT_NAME_MAX, isTeamProjectName } from "../../../shared/team-projects";
import { cn } from "@/lib/cn";
import { hiddenFromSidebar, myDefaultBot, useViewerEmail } from "@/lib/default-bot";
import { activeLocale, t } from "@/lib/i18n";
import { useRememberedDisclosure } from "@/lib/remembered-disclosure";
import { sidebarSectionAttention, type SidebarSectionAttention } from "@/lib/sidebar-attention";
import type { SidebarDensity } from "@/lib/sidebar-preferences";
import { splitEpisodes, teamProjectsVersion, type TeamProjectSide } from "@/lib/team-projects";
import { useShowThreads } from "@/lib/thread-preferences";
import { openProject, projectDisclosure, projectRoomOf } from "@/state/project-open";
import type { Bot, Group } from "@/state/store";
import { useStoreDispatch, useStoreSelector } from "@/state/store-select";
import { archiveProject, deleteProject, renameProject, restoreProject, useTeamProjectsLoader } from "@/state/team-projects";
import { openBot } from "@/state/thread-navigation";
import { UndoToast } from "../bot-access/ShareBotButton";
import { navigateThreadMenu } from "../BotProjects";
import { ConfirmDialog } from "../ConfirmDialog";
import { MENU_ITEM, MENU_SHEET } from "../menu-recipe";
import { useHeldMenuMotion } from "../MenuMotion";
import { SidebarRailSeparator } from "../SidebarSimpleRail";
import { SIMPLE_RAIL_BUTTON } from "../SidebarSimpleTop";
import { SidebarProjectEpisodes } from "./SidebarProjectEpisodes";
import { SidebarProjectBot, SidebarProjectRoom, SidebarProjectRow, SidebarProjectTile } from "./SidebarProjectRow";
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

/** What of a project is on screen: its canvas, a conversation listed under it, another of its conversations, or nothing. */
type ProjectOnScreen = "canvas" | "listed" | "other" | null;

/** One row per project; a click opens its group chat and shows it under the row with every bot of the project, and a
 * click on the row of the project on screen folds it again. A search lists the projects whose name holds it, nothing
 * under them. */
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
  const openChat = useStoreSelector((state) => (state.activeView === "chat" ? state.selectedId : null));
  const latest = useRef({ selectedId, shownProject });
  latest.current = { selectedId, shownProject };
  const [menu, setMenu] = useState<{ project: TeamProjectWire; x: number; y: number } | null>(null);
  const menuMotion = useHeldMenuMotion(menu);
  const menuReturn = useRef<HTMLElement | null>(null);
  const [archived, setArchived] = useState<{ project: TeamProjectWire; left: { from: string; to: string } | null } | null>(null);
  const [reviewing, setReviewing] = useState<TeamProjectWire | null>(null);
  const [renaming, setRenaming] = useState<TeamProjectWire | null>(null);
  const [removing, setRemoving] = useState<{ project: TeamProjectWire; pending: boolean } | null>(null);
  const forget = useCallback(() => setArchived(null), []);
  const labelId = useId();
  const openRoom = useCallback((room: Group) => dispatch({ type: "select", id: room.id }), [dispatch]);
  const openProjectBot = useCallback((bot: Bot) => openBot(dispatch, bot, showThreads), [dispatch, showThreads]);

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
    setMenu({ project, x: Math.max(8, Math.min(x, window.innerWidth - MENU_WIDTH - 10)), y: Math.max(8, Math.min(y, window.innerHeight - 190)) });
  };

  const holds = (project: TeamProjectWire, id: string) =>
    all.bots.some((bot) => bot.id === id && side.of(bot)?.id === project.id) || side.teamRooms(project, all.groups).some((group) => group.id === id);
  const inProject = (project: TeamProjectWire, id: string) => latest.current.shownProject?.id === project.id || holds(project, id);
  const hasOwnRow = (id: string) => side.bots(all.bots.filter((bot) => bot.id === id)).length > 0;
  const listedUnder = (project: TeamProjectWire) => ({ room: projectRoomOf(project, all.groups), bots: side.team(project, listedBots) });
  const onScreen = (project: TeamProjectWire): ProjectOnScreen => {
    if (shownProject?.id === project.id) return "canvas";
    if (openChat === null || !holds(project, openChat) || hasOwnRow(openChat)) return null;
    const { room, bots } = listedUnder(project);
    return room?.id === openChat || bots.some((bot) => bot.id === openChat) ? "listed" : "other";
  };
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
  const rename = (project: TeamProjectWire) => {
    closeMenu();
    setRenaming(project);
  };
  const askRemove = (project: TeamProjectWire) => {
    closeMenu();
    setRemoving({ project, pending: false });
  };
  /** The bot to open when the project on screen goes away, as archiving does; undefined when the open chat is elsewhere. */
  const homeOutside = (project: TeamProjectWire) => {
    const open = latest.current.selectedId;
    const outside = all.bots.filter((bot) => !bot.hidden && !hiddenFromSidebar(bot, viewer) && !side.of(bot));
    const home = inProject(project, open) ? myDefaultBot(outside, viewer) ?? outside.find((bot) => bot.defaultBot) ?? outside[0] : undefined;
    return { open, home };
  };
  const remove = async () => {
    if (!removing || removing.pending) return;
    const project = removing.project;
    const { home } = homeOutside(project);
    setRemoving({ project, pending: true });
    try {
      await deleteProject(project.id);
    } catch (error) {
      setRemoving(null);
      onError(error instanceof Error && error.message ? error.message : t("teamProjects.deleteFailed", { name: project.name }));
      return;
    }
    setRemoving(null);
    if (home) openBot(dispatch, home, showThreads);
  };
  const changesOf = (project: TeamProjectWire) => (remote ? undefined : project.teamChanges);
  const undo = async ({ project, left }: NonNullable<typeof archived>) => {
    await restoreProject(project.id);
    if (left && latest.current.selectedId === left.to) dispatch({ type: "select", id: left.from });
  };
  const show = (project: TeamProjectWire) => openProject(dispatch, project, all, showThreads);
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
            <button type="button" role="menuitem" autoFocus={!menuMotion.value.project.teamChanges} data-team-project-rename=""
              className={cn(MENU_ITEM, "hover:bg-menu-hover [&>svg]:text-ink-secondary")}
              onClick={() => rename(menuMotion.value!.project)}>
              <Pencil size={16} aria-hidden="true" />{t("teamProjects.rename")}
            </button>
            <button type="button" role="menuitem" data-team-project-archive=""
              className={cn(MENU_ITEM, "hover:bg-menu-hover [&>svg]:text-ink-secondary")}
              onClick={() => void archive(menuMotion.value!.project)}>
              <Archive size={16} aria-hidden="true" />{t("teamProjects.archive")}
            </button>
            <button type="button" role="menuitem" data-team-project-delete=""
              className={cn(MENU_ITEM, "text-danger hover:bg-danger/10 [&>svg]:text-danger")}
              onClick={() => askRemove(menuMotion.value!.project)}>
              <Trash2 size={16} aria-hidden="true" />{t("teamProjects.delete")}
            </button>
          </div>
        </div>,
        document.body,
      )}
      {archived && <UndoToast key={archived.project.id} clearOfComposer text={t("teamProjects.archived", { name: archived.project.name })}
        failedText={t("teamProjects.undoFailed", { place: dataSettingsPlace() })} onUndo={() => undo(archived)} onDone={forget} />}
      {reviewing?.teamChanges && <TeamChangesDialog project={reviewing} changes={reviewing.teamChanges} onClose={() => setReviewing(null)} />}
      {renaming && <RenameProjectDialog project={renaming} onClose={() => setRenaming(null)} />}
      {removing && (
        <ConfirmDialog open title={t("teamProjects.deleteTitle", { name: removing.project.name })} body={t("teamProjects.deleteBody")}
          confirmLabel={t("teamProjects.deleteConfirm")} icon={<Trash2 size={18} />} pending={removing.pending}
          onCancel={() => { if (!removing.pending) setRemoving(null); }} onConfirm={() => void remove()} />
      )}
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
              <SidebarProjectTile project={project} attention={attention} selected={onScreen(project) !== null}
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
      {mayCreate && (
        <button type="button" data-team-project-new="" onClick={onNew} className="ui-button ui-button-primary mb-1 w-full">
          <Plus size={16} aria-hidden="true" className="shrink-0" />{t("teamProjects.new")}
        </button>
      )}
      {noMatch}
      {shownProjects.length > 0 && (
        <>
          <div id={labelId} data-sidebar-projects-label="" className="px-2 pb-1 pt-2 text-[12px] font-medium leading-4 text-ink-tertiary">{t("teamProjects.list")}</div>
          <div role="group" aria-labelledby={labelId} data-sidebar-project-list="" className={cn("flex flex-col ps-3", gap)}>
            {shownProjects.map(({ project, attention }) => (
              <ProjectBlock key={project.id} project={project} attention={attention} {...listedUnder(project)} openChat={openChat} simple={simple} gap={gap}
                listOnly={query !== ""} onScreen={onScreen(project)} menuOpen={menu?.project.id === project.id} onMenu={openMenu?.(project)}
                onReview={changesOf(project) ? () => review(project) : undefined} onOpen={() => show(project)}
                onOpenRoom={openRoom} onOpenBot={openProjectBot} />
            ))}
          </div>
        </>
      )}
      {floating}
    </div>
  );
}

interface RenameProjectDialogProps {
  project: TeamProjectWire;
  onClose: () => void;
}

/** Only the name: the folder, the files in it and what the bots work on stay where they are. */
function RenameProjectDialog({ project, onClose }: RenameProjectDialogProps) {
  const [name, setName] = useState(project.name);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const valid = isTeamProjectName(name) && name !== project.name;
  const save = () => {
    if (!valid || pending) return;
    setPending(true);
    setError("");
    void renameProject(project.id, name)
      .then(() => onClose())
      .catch((cause: unknown) => {
        setError(cause instanceof Error && cause.message ? cause.message : t("teamProjects.renameFailed"));
        setPending(false);
      });
  };
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-6"
      onMouseDown={(event) => { if (event.target === event.currentTarget && !pending) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-labelledby="rename-project-title" data-look="dialog"
        className="w-full max-w-[420px] rounded-2xl border border-hairline/50 bg-panel p-5 shadow-2xl">
        <h2 id="rename-project-title" className="text-[15px] font-semibold text-ink">{t("teamProjects.renameTitle")}</h2>
        <label className="mt-3 flex flex-col gap-1 text-[12px] leading-4 text-ink-secondary">
          {t("teamProjects.name")}
          <input
            autoFocus
            value={name}
            maxLength={TEAM_PROJECT_NAME_MAX}
            spellCheck={false}
            disabled={pending}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") { event.preventDefault(); save(); }
              if (event.key === "Escape" && !pending) { event.preventDefault(); onClose(); }
            }}
            aria-invalid={!isTeamProjectName(name) || undefined}
            className="h-9 w-full rounded-lg border border-hairline/60 bg-panel px-3 font-sans text-[14px] text-ink outline-none focus-visible:outline-2 focus-visible:outline-focus disabled:cursor-wait disabled:opacity-60"
          />
        </label>
        <p className="mt-1 text-[12px] leading-4 text-ink-secondary">{t("teamProjects.renameHint")}</p>
        {error && <p role="alert" className="mt-2 text-[12px] leading-4 text-danger">{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={pending} className="rounded-xl px-4 py-2 text-[13px] text-ink-secondary hover:bg-raised hover:text-ink">{t("common.cancel")}</button>
          <button type="button" onClick={save} disabled={!valid || pending} className="rounded-xl bg-accent px-4 py-2 text-[13px] font-medium text-white hover:brightness-110 disabled:opacity-50">{t("common.save")}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** A project in the list: its row; while it is open, its group chat, the bots of the whole drama and its episodes under
 * it; and what to say about its folder and its team. */
function ProjectBlock({ project, attention, room, bots, openChat, simple, gap, listOnly, onScreen, menuOpen, onMenu, onReview, onOpen, onOpenRoom, onOpenBot }: {
  project: TeamProjectWire;
  attention: SidebarSectionAttention;
  /** Undefined while the project has none, or the app does not list it yet. */
  room: Group | undefined;
  /** Its listed bots, the lead first. */
  bots: Bot[];
  /** The conversation open in the chat view. */
  openChat: string | null;
  simple: boolean;
  gap: string;
  /** A search's result: the row and nothing under it. */
  listOnly: boolean;
  onScreen: ProjectOnScreen;
  menuOpen: boolean;
  onMenu?: (x: number, y: number, returnTo: HTMLElement) => void;
  /** Present while the team has changes for the person to review. */
  onReview?: () => void;
  /** Opens the project on its group chat, else its lead's conversation. */
  onOpen: () => void;
  onOpenRoom: (room: Group) => void;
  onOpenBot: (bot: Bot) => void;
}) {
  const [open, setOpen] = useRememberedDisclosure(projectDisclosure(project.id));
  const expanded = !listOnly && open && (room !== undefined || bots.length > 0);
  const { drama, episodes } = splitEpisodes(project, expanded ? bots : []);
  const locale = activeLocale();
  const click = () => {
    if (expanded && onScreen !== null) setOpen(false);
    else onOpen();
  };
  return (
    <div data-sidebar-team-project={project.id} className={cn("flex flex-col", gap)}>
      <SidebarProjectRow project={project} attention={attention} simple={simple} expanded={listOnly ? undefined : expanded}
        selected={onScreen === "canvas" || onScreen === "other" || (onScreen === "listed" && !expanded)} menuOpen={menuOpen}
        onOpen={click} onMenu={onMenu} />
      {expanded && room && <SidebarProjectRoom room={room} simple={simple} selected={openChat === room.id} locale={locale} onOpen={onOpenRoom} />}
      {drama.map((bot) => (
        <SidebarProjectBot key={bot.id} bot={bot} lead={bot.id === project.leadBotId} simple={simple} selected={openChat === bot.id} locale={locale}
          onOpen={onOpenBot} />
      ))}
      {episodes.length > 0 && <SidebarProjectEpisodes project={project} episodes={episodes} simple={simple} gap={gap} openChat={openChat} onOpenBot={onOpenBot} />}
      {project.folderState === "missing" && (
        <p data-team-project-missing="" className={cn("flex items-center gap-1.5 pb-1 text-[12px] leading-4 text-warning", simple ? "px-2" : "px-3")}>
          <FolderX size={14} aria-hidden="true" className="shrink-0" /><span className="min-w-0 truncate">{t("teamProjects.folderMissing")}</span>
        </p>
      )}
      {onReview && (
        <button type="button" data-team-project-changes="" onClick={onReview}
          className={cn("flex items-center gap-1.5 rounded-md pb-1 text-start text-[12px] leading-4 text-accent-text hover:underline focus-visible:outline-2 focus-visible:outline-focus", simple ? "px-2" : "px-3")}>
          <UsersRound size={14} aria-hidden="true" className="shrink-0" /><span className="min-w-0 truncate">{t("teamProjects.changes.notice")}</span>
        </button>
      )}
    </div>
  );
}
