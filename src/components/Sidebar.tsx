import { OrganizationIdentity } from "./OrganizationIdentity";
import { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type Dispatch } from "react";
import { createPortal } from "react-dom";
import { Bot as BotIcon, ChevronRight, Crown, FolderPlus, Loader2, MoreHorizontal, Phone, Pin, Plus, Search, Users } from "lucide-react";
import { sidebarState } from "./sidebar-state"; import { sameFields, useStoreDispatch, useStoreSelector } from "@/state/store-select";
import { api, formatTime, visibleMessages, currentTaskBot, botOpensTo, openBot, openThread, type Action, type AppState, type Bot, type BotProject, type InstanceInfo, type Message } from "@/state/store";
import { approvalModeFor } from "../../shared/approval-mode";
import { liveActivityLabel, sidebarMessage } from "@/lib/live-activity";
import { SidebarWorkingStep } from "./SidebarWorkingStep"; import { FadeLine } from "./FadeLine";
import { openBotRow } from "@/state/thread-navigation";

import { BotAvatar } from "./Avatar";
import { BotEngineMark, BotModelBadge, botTooltip } from "./BotModelBadge"; import { SidebarBotRole } from "./BotRole";
import { stateForBot } from "@/lib/mascot";
import { cn } from "@/lib/cn";
import { useRememberedDisclosure } from "@/lib/remembered-disclosure";
import { useMenuMotion } from "./MenuMotion";
import { lastNonReceipt } from "@/lib/receipts";
import { botPreview, lastLine } from "./sidebar-preview";
import { activeLocale, t } from "@/lib/i18n"; import { isBotHeld } from "@/lib/bot-pause";
import { ConfirmDialog } from "./ConfirmDialog";
import { BulkSelectFilters, ThreadListFooter, deleteThreadsInBulk, retitleThreadsInBulk, useBulkSelect } from "./BulkSelectBar";
import { SidebarBotThreadsPeek } from "./SidebarBotThreadsPeek";
import { LocalComputerAutoWarning } from "./LocalComputerAutoWarning";
import { useDesktopCapabilities, windowFramed } from "./DesktopCapabilities";
import { ImportDialog } from "./lazy-screens";
import { openCommandPalette } from "./CommandPalette";
import { TeamDialog } from "./TeamDialog";
import { RenameTitle } from "./RenameTitle";
import { BotProjectDialog, FolderActions, FolderIcon, navigateThreadMenu } from "./BotProjects";
import { NewTaskFolderDialog } from "./NewTaskFolderDialog";
import { useOwnerOrAdmin } from "@/lib/use-owner-or-admin";
import { draggedFolder, FOLDER_DRAG_TYPE, moveFolder, placeFolder } from "@/lib/folder-order";
import { folderUnreadThreadIds, markFolderRead } from "@/lib/folder-read";
import { HelperThreadGroup, orderedThreadList, partitionHelperThreads, SidebarThreadRow, stampClock, threadRecency, threadRowActions, useRelativeNow, useRevealedThreadRow, useSnoozeExpiry, visibleSidebarThreads } from "./SidebarThreadRow";
import { setSidebarDensity, useSidebarDensity, useSidebarShowAllThreads, type SidebarDensity } from "@/lib/sidebar-preferences";
import { useToolsSection } from "./SidebarSections";
import { moveBotsToSection } from "./bot-sections";
import { botListItemPointerIntent } from "@/lib/sidebar-selection";
import { SidebarFooter } from "./SidebarFooter";
import { SidebarPhoneBar } from "./SidebarPhoneBar";
import { PhoneHero } from "./SidebarPhoneHero";
import { SidebarProfileMenu } from "./SidebarProfileMenu";
import { PHONE_LAYOUT, useMediaQuery } from "@/lib/use-media-query";
import { GlassBar, GlassScrollFrame, GlassScroller } from "./GlassScrollFrame";
import { DesktopWorkspaceSwitcher, endCloudHowTo } from "./DesktopWorkspaceSwitcher"; import { PlaceTint } from "./PlaceTint"; import { ChromeRailToggle } from "./ChromeRailToggle";
import { useCloudOwner } from "./CloudOwner"; import { OtherPlaceBots, OwnBotHomeMark } from "./OtherPlaceBots"; import { NewBotOtherPlaceItem, useNewBotHereLabel } from "./NewBotPlaceItems";
import { NeedsYouButton, OwnerPickerHost } from "./TeamOwner"; import { SidebarPeople } from "./SidebarPeople"; import { SidebarInboxRow } from "./SidebarInboxRow"; import { TeamSideSwitch, useTeamSideLists } from "./TeamSideSwitch"; import { SidebarActiveThreads } from "./SidebarActiveThreads"; import { useInboxSupport } from "@/state/inbox";
import { MENU_ITEM, MENU_SHEET } from "./menu-recipe";
import { ELEVATED_CONTROL } from "./elevated";
import { SidebarResizeHandle, useSidebarWidth } from "./SidebarResizeHandle";
import { PHONE_TOP_BUTTON, SIMPLE_CORNER_BUTTON, SIMPLE_ROW_FOCUS, SIMPLE_TOP_BUTTON, SidebarSearchPill, SidebarSearchToggle } from "./SidebarSimpleTop";
import { isSidebarToggle } from "@/lib/keyboard-shortcuts";
import { SimpleRailFooter } from "./SidebarSimpleRail";
import { useShowThreads } from "@/lib/thread-preferences";
import { useBotUnread } from "./unread-notice";
import { attentionHasRunningWork, crossBotAttentionThreads, runningRoutineRun, SidebarBotActivity, sidebarBotStatus } from "./SidebarBotActivity";
import { SidebarNoBots, SidebarTileGrid } from "./SidebarTiles";
import { BotContextMenu } from "./SidebarBotMenu";
export { BotContextMenu };
import { AvatarActivityDot, AvatarCornerDot, RowDot, RowStatusText, rowSelectedSurface, rowSurface } from "./SidebarRowMarkers";
import { SidebarTeamProjects } from "./team-projects/SidebarTeamProjects";
import { NewTeamProjectDialog } from "./team-projects/NewTeamProjectDialog";
import { useTeamProjectSide } from "@/state/team-projects";
import { newBotOnTeamMap, showOnTeamMap } from "@/state/team-map-focus";
import { sidebarMainBot, unreadOutsideProjects } from "@/lib/sidebar-projects";
import { useLiveMedia } from "@/lib/live-call-media";
import { LiveCallPill, liveBadgeFor } from "./LiveCallPill";
import { ShortcutHint } from "./ShortcutHint";
import { usePopoverDismiss } from "@/hooks/use-popover-dismiss";
import { useAdvancedMode } from "@/lib/interface-mode";
import { useViewerEmail, useWelcomingBot } from "@/lib/default-bot";
import { archiveBotWithNotice, onArchiveNotice } from "./bot-archive";
import { onBotMenuRequest, type BotMenuRequest } from "./bot-menu-request";
import { ArchivedBotsPanel, botConfirmProps, type BotConfirmKind } from "./ArchivedBotsPanel"; import { MovedBotRows } from "./MoveToTeam"; import { MovedToMyCloudRow } from "./MoveToMyCloud";
import { SectionPicker } from "./SidebarSectionPicker";

export { ArchivedBotRow, ArchivedBotsPanel, archivedDeleteAllCopy, botConfirmCopy, type BotConfirmKind } from "./ArchivedBotsPanel";

/** The centre of macOS's traffic lights (14px tall) with the window's frame off, where the window puts them at 16,16. */
export const MAC_TRAFFIC_LIGHT_CENTER_Y = 23;

export interface MenuState {
  botId: string;
  x: number;
  y: number;
}

export function openBotContextMenu(onMenu: (menu: MenuState) => void, botId: string, event: React.MouseEvent) {
  event.preventDefault();
  onMenu({ botId, x: event.clientX, y: event.clientY });
}

/** A confirmation may span live fleet updates; never authorize from its snapshot. */
export function currentArchivableBot(bots: readonly Bot[], id: string): Bot | undefined {
  const active = bots.filter((candidate) => !candidate.hidden);
  if (active.length <= 1) return undefined;
  return active.find((candidate) => candidate.id === id && !candidate.chiefOfStaff && !candidate.defaultBot);
}

const NO_FOLDERS: BotProject[] = [];

export function BotThreadList({ bot, selected, pendingQueued, routineRuns, reveal, locale, dispatch, activityLabel, hidden = false }: BotRowProps & {
  activityLabel?: string;
  hidden?: boolean;
}) {
  const now = useRelativeNow();
  const tasks = (bot.tasks ?? [{ threadId: bot.threadId, title: t("task.newShort"), createdAt: 0 }])
    .filter((task) => !task.routineRunId)
    .map((task) => ({ ...task, queued: Boolean(pendingQueued[task.threadId]?.length) }));
  const projects = bot.projects ?? NO_FOLDERS;
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [editingProject, setEditingProject] = useState<string | null>(null);
  const [folderMenu, setFolderMenu] = useState<{ projectId: string; left: number; top: number } | null>(null);
  const [markingRead, setMarkingRead] = useState(false);
  const [readError, setReadError] = useState<string | null>(null);
  const [readStatus, setReadStatus] = useState("");
  const [reordering, setReordering] = useState(false);
  const [reorderError, setReorderError] = useState<string | null>(null);
  const [reorderStatus, setReorderStatus] = useState("");
  const [folderDrop, setFolderDrop] = useState<{ id: string; place: "before" | "after" } | null>(null);
  const draggingFolder = useRef<string | null>(null);
  const [showAll, setShowAll] = useSidebarShowAllThreads(bot.id);
  const [permissionRefresh, setPermissionRefresh] = useState<{ threadId: string; kind: "local-auto" } | null>(null);
  const currentProjectId = tasks.find((task) => task.threadId === bot.threadId)?.projectId;
  useEffect(() => {
    if (selected && currentProjectId) setCollapsed((previous) => {
      if (!previous.has(currentProjectId)) return previous;
      const next = new Set(previous);
      next.delete(currentProjectId);
      return next;
    });
  }, [selected, currentProjectId]);
  useSnoozeExpiry(tasks);
  const bulk = useBulkSelect();
  const { own: ownTasks, helpers } = bulk.active ? { own: tasks, helpers: [] } : partitionHelperThreads(tasks, bot.threadId, projects);
  const visibleTasks = orderedThreadList(visibleSidebarThreads(ownTasks, bot.threadId, showAll || bulk.active, routineRuns));
  const visibleProjectIndex = (projectId: string) => visibleTasks.findIndex((task) => task.projectId === projectId);
  const folderRank = (projectId: string) => {
    const index = visibleProjectIndex(projectId);
    return index < 0 ? Number.POSITIVE_INFINITY : index;
  };
  const orderedProjects = [...projects].sort((a, b) => folderRank(a.id) - folderRank(b.id) || projects.indexOf(a) - projects.indexOf(b));
  useRevealedThreadRow(reveal, selected ? bot.threadId : null);
  const latest = useRef(bot);
  latest.current = bot;
  const botId = bot.id;
  const actions = useMemo(() => ({
    onSelect: (task: { threadId: string }) => {
      if (task.threadId !== latest.current.threadId) dispatch({ type: "switchTask", botId, threadId: task.threadId });
      else dispatch({ type: "select", id: botId });
    },
    ...threadRowActions(botId, dispatch),
    onRefreshPermissions: (task: { threadId: string }) => {
      const current = latest.current;
      const mode = approvalModeFor(current);
      const threadMode = approvalModeFor(currentTaskBot(current, task.threadId));
      if (mode === "auto" && current.computer === "local" && threadMode !== "auto") {
        setPermissionRefresh({ threadId: task.threadId, kind: "local-auto" });
        return;
      }
      dispatch({ type: "refreshTaskPermissions", botId, threadId: task.threadId });
    },
  }), [botId, dispatch]);
  const renderThread = (task: (typeof tasks)[number]) => {
    const thread = currentTaskBot(bot, task.threadId);
    return <SidebarThreadRow key={task.threadId} task={{ ...task, busy: thread.busy, activity: thread.activity, waitingForTeammates: thread.waitingForTeammates }} ownerId={bot.id} current={selected && task.threadId === bot.threadId} folders={projects}
      activityLabel={task.threadId === bot.threadId ? activityLabel : undefined} now={stampClock(threadRecency(task), now)} locale={locale} {...actions}
      selectMode={bulk.active} checked={selection.has(task.threadId)} onToggleSelect={bulk.toggle} />;
  };
  const ungrouped = visibleTasks.filter((task) => !projects.some((project) => project.id === task.projectId));
  const shownRows = [...orderedProjects.filter((project) => bulk.active || !collapsed.has(project.id)).flatMap((project) => visibleTasks.filter((task) => task.projectId === project.id)), ...ungrouped]
    .map((task) => { const thread = currentTaskBot(bot, task.threadId); return { ...task, busy: thread.busy, activity: thread.activity }; });
  const selection = bulk.forRows(shownRows);
  const projectToEdit = projects.find((project) => project.id === editingProject);
  const projectIds = projects.map((project) => project.id);
  const saveOrder = (ids: string[], onSaved?: () => void) => {
    if (reordering || ids.every((id, index) => id === projectIds[index])) return;
    setReordering(true); setReorderError(null); setReorderStatus(t("folder.reordering"));
    dispatch({ type: "reorderProjects", botId: bot.id, projectIds: ids,
      onSaved: () => { setReordering(false); setReorderStatus(t("folder.reordered")); onSaved?.(); },
      onError: (message) => { setReordering(false); setReorderStatus(""); setReorderError(message); } });
  };
  const resetFolderDrag = () => { draggingFolder.current = null; setFolderDrop(null); };
  const readFolder = async (projectId: string, onSaved: () => void) => {
    if (markingRead) return;
    setMarkingRead(true); setReadError(null); setReadStatus(t("folder.markingRead"));
    try {
      await markFolderRead(bot, projectId, api, (updated) => dispatch({ type: "botPatched", bot: updated }));
      setReadStatus(t("folder.markedRead"));
      onSaved();
    } catch (error) {
      setReadError(error instanceof Error ? error.message : String(error));
      setReadStatus("");
    } finally { setMarkingRead(false); }
  };
  return (
    <div hidden={hidden} className="mb-2 space-y-0.5" role="group" aria-label={t("task.namedList", { name: bot.name })}
      onDragOver={(event) => { if (event.dataTransfer.types.includes(FOLDER_DRAG_TYPE)) event.stopPropagation(); }}
      onDrop={(event) => { if (event.dataTransfer.types.includes(FOLDER_DRAG_TYPE)) { event.preventDefault(); event.stopPropagation(); resetFolderDrag(); } }}>
      {!hidden && <>
      {bulk.active && <BulkSelectFilters rows={shownRows} selected={selection} now={now} onChange={bulk.setSelected} onDone={bulk.finish} />}
      {orderedProjects.map((project) => {
        const index = projects.indexOf(project);
        const projectTasks = tasks.filter((task) => task.projectId === project.id);
        const visible = visibleTasks.filter((task) => task.projectId === project.id);
        const open = bulk.active || !collapsed.has(project.id);
        const waiting = projectTasks.some((task) => task.activity === "waiting-on-you");
        const working = projectTasks.some((task) => task.busy);
        return <div key={project.id} data-sidebar-project={project.id}>
          <div data-sidebar-folder-row={project.id} draggable={!reordering}
            onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); setFolderMenu({ projectId: project.id, left: event.clientX, top: event.clientY }); }}
            onDragStart={(event) => {
              event.stopPropagation();
              event.dataTransfer.effectAllowed = "move";
              event.dataTransfer.setData(FOLDER_DRAG_TYPE, JSON.stringify({ botId: bot.id, projectId: project.id }));
              draggingFolder.current = project.id;
            }}
            onDragEnd={(event) => { event.stopPropagation(); resetFolderDrag(); }}
            onDragOver={(event) => {
              if (!event.dataTransfer.types.includes(FOLDER_DRAG_TYPE)) return;
              event.stopPropagation();
              if (!draggingFolder.current || reordering) { event.dataTransfer.dropEffect = "none"; return; }
              event.preventDefault(); event.dataTransfer.dropEffect = "move";
              const rect = event.currentTarget.getBoundingClientRect();
              setFolderDrop({ id: project.id, place: event.clientY < rect.top + rect.height / 2 ? "before" : "after" });
            }}
            onDragLeave={(event) => { if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setFolderDrop(null); }}
            onDrop={(event) => {
              if (!event.dataTransfer.types.includes(FOLDER_DRAG_TYPE)) return;
              event.preventDefault(); event.stopPropagation();
              const from = draggedFolder(event.dataTransfer.getData(FOLDER_DRAG_TYPE), bot.id, projectIds);
              const rect = event.currentTarget.getBoundingClientRect();
              if (from) saveOrder(placeFolder(projectIds, from, project.id, event.clientY < rect.top + rect.height / 2 ? "before" : "after"));
              resetFolderDrag();
            }}
            className={cn("group/folder flex items-center gap-0.5 rounded-md pl-0.5 text-ink-secondary hover:bg-raised/30",
              folderDrop?.id === project.id && draggingFolder.current !== project.id && (folderDrop.place === "before" ? "shadow-[0_-2px_var(--color-accent)]" : "shadow-[0_2px_var(--color-accent)]"))}>
            <button type="button" aria-expanded={open} onClick={() => setCollapsed((previous) => {
              const next = new Set(previous);
              if (next.has(project.id)) next.delete(project.id); else next.add(project.id);
              return next;
            })} className="flex size-6 shrink-0 items-center justify-center rounded outline-none hover:text-ink focus-visible:ring-1 focus-visible:ring-accent/60" aria-label={t(open ? "task.collapseNamed" : "task.expandNamed", { name: project.name })}>
              <ChevronRight aria-hidden="true" size={11} className={cn("shrink-0 transition-transform", open && "rotate-90")} />
            </button>
            <button type="button" aria-label={t("folder.iconNamed", { name: project.name })} title={t("folder.iconNamed", { name: project.name })} onClick={() => setEditingProject(project.id)} className="flex size-6 shrink-0 items-center justify-center rounded hover:bg-raised"><FolderIcon emoji={project.emoji} size={14} /></button>
            <button type="button" data-sidebar-folder-label={project.id} draggable={!reordering} aria-expanded={open} onClick={() => setCollapsed((previous) => {
              const next = new Set(previous);
              if (next.has(project.id)) next.delete(project.id); else next.add(project.id);
              return next;
            })} className="flex min-h-8 min-w-0 flex-1 cursor-grab select-none items-center gap-1.5 py-1 text-left text-[13px] font-semibold active:cursor-grabbing" title={project.name}>
              <span className="truncate">{project.name}</span>
              <span className="shrink-0 text-[10px] font-normal opacity-50">{projectTasks.length}</span>
              {!open && (waiting ? <span className="text-[10px] text-warning">{t("task.waiting")}</span> : working ? <Loader2 size={10} className="shrink-0 animate-spin text-success" /> : projectTasks.some((task) => task.unread) ? <span className="size-1.5 shrink-0 rounded-full bg-accent" aria-label={t("task.unreadMany")} /> : null)}
            </button>
            <button type="button" title={t("task.newIn", { name: project.name })} aria-label={t("task.newIn", { name: project.name })} onClick={() => dispatch({ type: "newTask", botId: bot.id, projectId: project.id })}
              className="flex size-6 items-center justify-center rounded opacity-0 hover:bg-raised hover:text-ink focus-visible:opacity-100 group-hover/folder:opacity-100 max-md:opacity-70 touch:opacity-70"><Plus size={12} /></button>
            <FolderActions project={project} canMoveUp={index > 0} canMoveDown={index < projects.length - 1} canMarkRead={folderUnreadThreadIds(bot, project.id).length > 0} saving={reordering || markingRead}
              menu={folderMenu?.projectId === project.id ? folderMenu : null} onMenuChange={(menu) => setFolderMenu(menu ? { ...menu, projectId: project.id } : null)}
              onEdit={() => setEditingProject(project.id)} onMove={(direction, onSaved) => saveOrder(moveFolder(projectIds, project.id, direction), onSaved)}
              onMarkRead={(onSaved) => { void readFolder(project.id, onSaved); }} />
          </div>
          {(open || visible.some((task) => task.pinned === true)) && <div role="group" aria-label={t("task.namedList", { name: project.name })}>
            {(open ? visible : visible.filter((task) => task.pinned === true)).map(renderThread)}
            {projectTasks.length === 0 && <p className="px-2.5 py-1 text-[11px] text-ink-tertiary">{t("task.empty")}</p>}
            {/* A closed folder shows only its pinned threads. The short list keeps only the newest threads, so an open folder can hold none of them: offer the rest. */}
            {open && !bulk.active && visible.length < projectTasks.length && <button type="button" data-sidebar-folder-show-all={project.id} onClick={() => setShowAll(true)}
              className="inline-flex h-7 items-center pl-6 text-[13px] font-medium leading-4 text-ink-secondary hover:text-ink">{t("folder.showAll")}</button>}
          </div>}
        </div>;
      })}
      {reorderError && <p role="alert" className="px-2.5 py-1 text-[12px] text-danger">{reorderError}</p>}
      <span role="status" className="sr-only">{reorderStatus}</span>
      {readError && <p role="alert" className="px-2.5 py-1 text-[12px] text-danger">{readError}</p>}
      <span role="status" className="sr-only">{readStatus}</span>
      {projects.length > 0 && ungrouped.length > 0 && <div className="pl-6 pr-3 pb-1 pt-2 text-[11px] text-ink-tertiary">{t("task.list")}</div>}
      {ungrouped.map(renderThread)}
      <HelperThreadGroup tasks={orderedThreadList(helpers)} renderThread={renderThread} />
      <ThreadListFooter bulk={bulk} rows={shownRows} selected={selection} total={ownTasks.length} canShowAll={!showAll && ownTasks.length > visibleTasks.length} canSelect={tasks.length > 1}
        onShowAll={() => setShowAll(true)} onShowFewer={showAll && !bulk.active && visibleSidebarThreads(ownTasks, bot.threadId, false, routineRuns).length < ownTasks.length ? () => setShowAll(false) : undefined} freshConversation onDelete={(threadIds) => deleteThreadsInBulk({ botId: bot.id }, threadIds, dispatch)}
        onRetitle={(threadIds) => retitleThreadsInBulk(bot.id, threadIds)} />
      <LocalComputerAutoWarning
        open={permissionRefresh?.kind === "local-auto"}
        onCancel={() => setPermissionRefresh(null)}
        onConfirm={() => {
          const threadId = permissionRefresh?.threadId;
          setPermissionRefresh(null);
          if (threadId) dispatch({ type: "refreshTaskPermissions", botId: bot.id, threadId, acknowledgeLocalAuto: true });
        }}
      />
      {projectToEdit && <BotProjectDialog bot={bot} project={projectToEdit} onClose={() => setEditingProject(null)} />}
      </>}
    </div>
  );
}

export interface BotRowProps {
  bot: Bot;
  selected: boolean;
  deleting: boolean;
  mascotMotion: AppState["mascotMotion"];
  reveal: AppState["revealThread"];
  pendingQueued: AppState["pendingQueued"]; routineRuns?: AppState["routineRuns"];
  instances: InstanceInfo[];
  liveCall: AppState["liveCall"];
  locale: string;
  /** Paused by the person, by itself or with its department: it takes no new work. */ held?: boolean;
  density: SidebarDensity;
  dispatch: Dispatch<Action>;
  onMenu: (menu: MenuState) => void;
  renameRequest?: number;
}

export function botRowProps<State extends Pick<AppState, "activeView" | "selectedId" | "revealThread" | "deletingBots" | "mascotMotion" | "pendingQueued" | "routineRuns" | "instances" | "liveCall" | "config">>(
  state: State,
  dispatch: Dispatch<Action>,
  bot: Bot,
  layout: Pick<BotRowProps, "density" | "onMenu" | "renameRequest">,
): BotRowProps {
  const selected = state.activeView === "chat" && state.selectedId === bot.id;
  const reveal = state.revealThread;
  return {
    ...layout,
    bot,
    selected,
    deleting: state.deletingBots[bot.id] === true,
    mascotMotion: selected && state.mascotMotion?.botId === bot.id ? state.mascotMotion : null,
    reveal: reveal && (bot.threadId === reveal.threadId || bot.tasks?.some((task) => task.threadId === reveal.threadId)) ? reveal : null,
    pendingQueued: state.pendingQueued, routineRuns: state.routineRuns,
    instances: state.instances,
    liveCall: state.liveCall,
    locale: activeLocale(),
    held: isBotHeld(state.config, bot.id),
    dispatch,
  };
}

export function useVisibleMessages(bot: Bot): Message[] {
  const { messages, activeLeafId } = bot;
  return useMemo(() => visibleMessages({ messages, activeLeafId }), [messages, activeLeafId]);
}

export const BotListItem = memo(function BotListItem(props: BotRowProps) {
  const advanced = useAdvancedMode();
  const { bot, selected, deleting, mascotMotion, reveal, pendingQueued, instances, liveCall, density, dispatch, onMenu, renameRequest } = props;
  const showThreads = useShowThreads();
  const liveMedia = useLiveMedia();
  const remoteClient = typeof window !== "undefined" && window.ogb?.remoteClient?.active === true;
  const [renaming, setRenaming] = useState(false);
  const [creatingProject, setCreatingProject] = useState(false);
  const [threadsOpen, setThreadsOpen] = useRememberedDisclosure(`bot:${bot.id}`);
  useEffect(() => { if (reveal && showThreads) setThreadsOpen(true); }, [reveal, showThreads]);
  const hasThreadList = (bot.tasks?.filter((task) => !task.routineRunId).length ?? 1) > 1 || (bot.projects?.length ?? 0) > 0;
  const iconOnly = density === "icons";
  const expanded = showThreads && !iconOnly && threadsOpen && hasThreadList;
  useEffect(() => { if (iconOnly) setRenaming(false); }, [iconOnly]);
  const simpleRow = !advanced && !showThreads && density === "comfortable";
  const simpleList = !advanced && !iconOnly;
  const railTile = iconOnly && !advanced;
  const avatarSize = iconOnly ? (railTile ? 36 : 44) : showThreads ? 32 : simpleRow ? 36 : 44;
  const tooltip = simpleList ? botTooltip(bot, instances) : undefined;
  const visible = useVisibleMessages(bot);
  const last = lastNonReceipt(visible);
  const title = bot.title.trim();
  const details = [props.held ? t("pause.badge") : "", title, bot.chiefOfStaff ? t("sidebar.bot.chiefOfStaff") : ""].filter(Boolean);
  const rowClass = cn(
    "flex w-full items-center rounded-xl text-left transition-colors duration-150", SIMPLE_ROW_FOCUS,
    iconOnly
      ? railTile ? "h-[54px] justify-center" : "justify-center px-1 py-1.5"
      : simpleRow ? "gap-2 rounded-[8px] py-2 pl-2 pr-2 md:h-[54px] md:py-0"
        : cn(showThreads ? "gap-2 py-2" : "gap-3 py-2", showThreads ? "pl-6 pr-9 group-hover:pr-[5.75rem] group-focus-within:pr-[5.75rem] max-md:pr-9 touch:pr-[5.75rem]" : "pl-2.5 pr-9"),
    !iconOnly && "max-md:rounded-2xl max-md:py-2.5",
    selected ? rowSelectedSurface : "hover:bg-raised/50",
    simpleRow && rowSurface(selected),
  );
  const { waiting, working, failed, teammateWait, queued } = sidebarBotStatus(bot, pendingQueued, visible);
  const { unread, noticing } = useBotUnread(bot);
  const onLiveCall = liveBadgeFor(bot.id, liveMedia, liveCall);
  const body = (
    <>
      <span className={cn("relative flex shrink-0", simpleRow && "-m-[3px]")} title={iconOnly || simpleList ? undefined : [bot.name, ...details].join(" · ")}>
        <BotAvatar
          bot={bot}
          state={stateForBot({ ...bot, messages: visible })}
          size={simpleRow ? avatarSize + 6 : avatarSize}
          motion={mascotMotion?.kind ?? "none"}
          motionKey={mascotMotion?.nonce ?? 0}
          animated={working || noticing || (mascotMotion?.kind ?? "none") !== "none"}
        />
        {/* Bottom-left, clear of the status dots on the right and of the row's hover actions. */}
        {(iconOnly || !simpleList) && <BotModelBadge bot={bot} instances={instances} avatarSize={avatarSize} />}
        {simpleRow && <AvatarActivityDot activity={working ? "working" : failed ? "failed" : teammateWait ? "teammate" : queued && !waiting ? "queued" : null} />}
        {!simpleRow && working && (
          <span
            data-testid="working-dot"
            className={cn(
              "absolute -right-0.5 -bottom-0.5 rounded-full border-2 border-panel bg-success",
              iconOnly ? "size-3" : "size-2.5",
            )}
          />
        )}
        {!simpleRow && waiting && <span data-testid="waiting-dot" role="status" aria-label={t("sidebar.preview.waiting")} title={t("sidebar.preview.waiting")}
          className={cn("absolute -right-0.5 -bottom-0.5 flex items-center justify-center overflow-hidden rounded-full border-2 border-panel bg-warning font-black text-panel", iconOnly ? "size-5 text-[14px]" : "size-4 text-[12px]")}><span aria-hidden="true">!</span></span>}
        {!simpleRow && <AvatarCornerDot activity={failed ? "failed" : teammateWait ? "teammate" : queued && !waiting && !working ? "queued" : null} large={iconOnly} />}
        {bot.chiefOfStaff && (iconOnly || simpleRow) && (
          <span className="absolute -left-1 -top-1 flex rounded-full bg-raised p-[3px]">
            <Crown size={11} strokeWidth={2.25} className="shrink-0 text-accent" role="img" aria-label={t("sidebar.bot.chiefOfStaff")} data-testid="chief-crown">
              <title>{t("sidebar.bot.chiefOfStaff")}</title>
            </Crown>
          </span>
        )}
        {onLiveCall && iconOnly && (
          <span className="absolute -right-1 -top-1 flex rounded-full bg-panel p-0.5">
            <Phone className="size-3 shrink-0 text-success" role="img" aria-label={t("call.live.badge")} data-testid="live-call-badge">
              <title>{t("call.live.badge")}</title>
            </Phone>
          </span>
        )}
      </span>
      <div className={cn("min-w-0 flex-1", iconOnly && "hidden")}>
        <div className={cn("flex items-baseline justify-between gap-2", simpleRow && "pe-7 group-hover:pe-[3.25rem] group-focus-within:pe-[3.25rem] touch:pe-[3.25rem] max-md:touch:pe-7")}>
          <span className={cn("flex min-w-0 grow items-center gap-1.5 truncate text-ink", simpleRow ? "text-[14px] font-medium leading-5" : "text-[15px] font-semibold leading-5")}>
            {!simpleList && bot.pinned && <Pin size={12} className="shrink-0 text-ink-secondary" />}
            <RenameTitle
              key={iconOnly ? "icons" : "expanded"}
              value={bot.name}
              editRequest={renameRequest}
              title={tooltip}
              onCommit={(name) => {
                if (remoteClient) {
                  void api(`/api/bots/${bot.id}/profile`, { method: "PATCH", body: JSON.stringify({ name }) })
                    .then(({ bot: updated }) => dispatch({ type: "botPatched", bot: updated }))
                    .catch((cause) => dispatch({ type: "error", message: cause instanceof Error ? cause.message : String(cause) }));
                } else {
                  dispatch({ type: "updateBot", botId: bot.id, patch: { name } });
                }
              }}
              onEditingChange={setRenaming}
              className="truncate"
              inputClassName={cn("w-full rounded bg-inset px-1 py-0.5", simpleRow ? "text-[14px] font-medium" : "text-[15px] font-semibold")}
            />
            {!simpleList && bot.chiefOfStaff && !renaming && (
              <Crown size={13} strokeWidth={2.25} className="shrink-0 text-accent" role="img" aria-label={t("sidebar.bot.chiefOfStaff")} data-testid="chief-crown">
                <title>{t("sidebar.bot.chiefOfStaff")}</title>
              </Crown>
            )}
            {onLiveCall && !iconOnly && !renaming && (
              <Phone className="size-3 shrink-0 text-success" role="img" aria-label={t("call.live.badge")} data-testid="live-call-badge">
                <title>{t("call.live.badge")}</title>
              </Phone>
            )}
            {!renaming && <OwnBotHomeMark />}{!simpleList && title && !renaming && <SidebarBotRole role={title} />}
          </span>
          {last && !renaming && !expanded && (
            <span className={cn(
              "shrink-0 text-[12px] tabular-nums text-ink-secondary transition-opacity",
              // Phones show the time on every row; elsewhere only the selected row, until its actions appear.
              selected && !simpleList ? "group-hover:opacity-0 group-focus-within:opacity-0 touch:opacity-0 max-md:touch:opacity-100" : "hidden max-md:inline",
            )}>
              {formatTime(last.at)}
            </span>
          )}
          {expanded && unread && <span className="size-1.5 shrink-0 rounded-full bg-accent" aria-label={t("task.unreadMany")} />}
          {simpleRow && (unread || waiting) && <RowDot waiting={waiting} />}
        </div>
        {(!expanded || deleting) && <div className="flex items-center justify-between gap-2">
          {deleting ? (
            <span role="status" className="flex min-w-0 items-center gap-1.5 truncate text-[13px] leading-[18px] text-ink-secondary">
              <Loader2 size={12} className="shrink-0 animate-spin" />
              {t("sidebar.bot.deletingRow")}
            </span>
          ) : (
            <span className={cn("flex min-w-0 items-center gap-1.5 truncate text-[13px] leading-[18px]", waiting ? simpleRow ? "text-warning" : "font-semibold text-warning" : "text-ink-secondary")}>
              {working ? (
                <SidebarWorkingStep bot={bot} last={last} />
              ) : (
                <FadeLine>{waiting ? t("sidebar.preview.waiting") : teammateWait ? t("sidebar.preview.waitingOnTeammate") : queued && !failed ? t("task.queued") : failed ? lastLine(bot, visible, instances, advanced) : botPreview(bot, visible, instances, advanced)}</FadeLine>
              )}
            </span>
          )}
          {simpleRow && <BotEngineMark bot={bot} instances={instances} className="ms-auto" />}
          {!simpleRow && unread && <span className="size-2 shrink-0 rounded-full bg-accent" aria-label={t("task.unreadMany")} />}
        </div>}
        {simpleRow && <RowStatusText working={working} failed={failed} unread={unread} />}
      </div>
    </>
  );
  const onContextMenu = (event: React.MouseEvent) => {
    openBotContextMenu(onMenu, bot.id, event);
  };
  const onSelect = (event: React.MouseEvent) => {
    if (renaming) return;
    const insideRenameInput = event.target instanceof HTMLInputElement;
    if (botListItemPointerIntent(event.type, insideRenameInput) === "select") {
      openBotRow(dispatch, bot, showThreads, selected);
    }
  };

  return (
    <>
    <div className={cn("group relative", railTile && "mx-auto w-[54px]")}
      title={railTile ? botTooltip(bot, instances) : iconOnly ? [bot.name, bot.title?.trim()].filter(Boolean).join(" · ") : undefined}>
      {/* Keep this wrapper mounted: replacing it remounts RenameTitle and leaves the row stuck in rename mode. */}
      <div
        role={renaming ? undefined : "button"}
        tabIndex={renaming ? undefined : 0}
        aria-label={
          !renaming && iconOnly
            ? deleting
              ? t("sidebar.bot.deletingAria", { name: bot.name })
              : `${bot.name}${bot.title?.trim() ? ` · ${bot.title.trim()}` : ""}${bot.chiefOfStaff ? ` · ${t("sidebar.bot.chiefOfStaff")}` : ""}${onLiveCall ? ` · ${t("call.live.badge")}` : ""}${waiting ? ` · ${t("sidebar.preview.waiting")}` : working ? ` · ${t("chat.activity.working")}` : failed ? ` · ${t("sidebar.preview.failed")}` : teammateWait ? ` · ${t("sidebar.preview.waitingOnTeammate")}` : queued ? ` · ${t("task.queued")}` : ""}${unread ? ` · ${t("task.unread")}` : ""}`
            : undefined
        }
        aria-busy={deleting || undefined}
        aria-current={selected && !expanded && !renaming ? "page" : undefined}
        data-sidebar-bot-row={bot.id} data-look="sidebar-bot"
        title={renaming ? undefined : tooltip}
        onClick={onSelect}
        onKeyDown={(event) => {
          if (renaming) return;
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            openBotRow(dispatch, bot, showThreads, selected);
          }
        }}
        onContextMenu={onContextMenu}
        className={rowClass}
      >
        {body}
      </div>
      {showThreads && !iconOnly && hasThreadList && <button
        type="button"
        aria-label={t(threadsOpen ? "task.collapseNamed" : "task.expandNamed", { name: bot.name })}
        aria-expanded={threadsOpen}
        onClick={() => setThreadsOpen((open) => !open)}
        className="absolute left-0.5 top-1/2 flex size-5 -translate-y-1/2 items-center justify-center rounded text-ink-secondary outline-none hover:text-ink focus-visible:ring-1 focus-visible:ring-accent/60"
      ><ChevronRight aria-hidden="true" size={13} className={cn("transition-transform", threadsOpen && "rotate-90")} /></button>}
      {!renaming && iconOnly && unread && (
        <span className={cn("pointer-events-none absolute size-2 rounded-full border border-panel bg-accent", railTile ? "right-1 top-1" : "bottom-1.5 right-1.5")} />
      )}
      {!renaming && !deleting && !iconOnly && <>
        {showThreads && <button type="button" aria-label={t("task.newShort")} title={t("task.newShort")} onClick={() => { setThreadsOpen(true); dispatch({ type: "newTask", botId: bot.id }); }}
          className="pointer-events-none absolute right-[3.75rem] top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded text-ink-secondary opacity-0 hover:bg-raised hover:text-ink group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100 max-md:hidden touch:pointer-events-auto touch:opacity-70"><Plus size={14} /></button>}
        {showThreads && <button type="button" aria-label={t("folder.newNamed", { name: bot.name })} title={t("folder.new")} onClick={() => { setThreadsOpen(true); setCreatingProject(true); }}
          className="pointer-events-none absolute right-8 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded text-ink-secondary opacity-0 hover:bg-raised hover:text-ink group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100 max-md:hidden touch:pointer-events-auto touch:opacity-70"><FolderPlus size={14} /></button>}
        <button type="button" data-bot-actions={bot.id} aria-label={t("sidebar.bot.actions", { name: bot.name })} title={t("sidebar.bot.actions", { name: bot.name })} aria-haspopup="menu" onClick={(event) => { const rect = event.currentTarget.getBoundingClientRect(); onMenu({ botId: bot.id, x: rect.left, y: rect.bottom }); }}
          className={cn("absolute top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded text-ink-secondary hover:bg-raised hover:text-ink", simpleRow ? "end-[3px] top-1.5 size-6 translate-y-0 rounded-lg" : "right-1",
            selected && !simpleRow ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100 max-md:pointer-events-auto max-md:opacity-70 touch:pointer-events-auto touch:opacity-70")}><MoreHorizontal size={15} /></button>
      </>}{!renaming && !deleting && simpleRow && <SidebarBotThreadsPeek bot={bot} onScreen={selected} dispatch={dispatch} />}
      {deleting && iconOnly && (
        <span className="pointer-events-none absolute bottom-1 right-1 rounded-full bg-card p-1 text-ink-secondary">
          <Loader2 size={12} className="animate-spin" />
        </span>
      )}
    </div>
    {advanced && !iconOnly && threadsOpen && hasThreadList && <BotThreadList {...props} hidden={!showThreads}
      activityLabel={liveActivityLabel(sidebarMessage(last))} />}
    {(advanced || (!iconOnly && (waiting || unread || bot.tasks?.some(runningRoutineRun)))) && <SidebarBotActivity bot={bot} rowThreadId={selected ? bot.threadId : botOpensTo(bot, showThreads)} density={density} pendingQueued={pendingQueued} dispatch={dispatch} waitingOnly={!advanced} runsOnly={expanded} />}
    {showThreads && creatingProject && <BotProjectDialog bot={bot} onClose={() => setCreatingProject(false)} />}
    </>
  );
});

export const Sidebar = memo(function Sidebar({ open, onClose, collapseToIcons = false }: {
  open: boolean;
  onClose: () => void;
  collapseToIcons?: boolean;
}) {
  const state = useStoreSelector(sidebarState, sameFields), dispatch = useStoreDispatch();
  const cloudOwner = useCloudOwner(state.config?.cloudHome === true);
  const endHowTo = useCallback(() => endCloudHowTo(dispatch), [dispatch]);
  const showThreads = useShowThreads();
  const remoteClient = window.ogb?.remoteClient?.active === true;
  const { capabilities } = useDesktopCapabilities();
  const phone = useMediaQuery(PHONE_LAYOUT, false);
  const importReturnRef = useRef<HTMLButtonElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const [confirm, setConfirm] = useState<{ kind: BotConfirmKind; bot: Bot } | null>(null);
  const cancelConfirm = useCallback(() => setConfirm(null), []);
  const [menu, setMenu] = useState<MenuState | BotMenuRequest | null>(null);
  const [renameRequest, setRenameRequest] = useState<{ botId: string; nonce: number } | null>(null);
  const [sectionPicker, setSectionPicker] = useState<MenuState | null>(null);
  const [newTeam, setNewTeam] = useState<{ botId?: string } | null>(null);
  const [newProject, setNewProject] = useState(false);
  const teamSettingsAllowed = useOwnerOrAdmin();
  const [plusOpen, setPlusOpen] = useState(false);
  const plusMotion = useMenuMotion(plusOpen);
  const advanced = useAdvancedMode();
  const inboxSupport = useInboxSupport();
  const [newFolderBotId, setNewFolderBotId] = useState<string | null>(null);
  const [newTaskFolderBotId, setNewTaskFolderBotId] = useState<string | null>(null);
  const newTaskFolderBot = state.bots.find((bot) => bot.id === newTaskFolderBotId);
  const [importUrl, setImportUrl] = useState<string | null>(null);
  const [archivedBotsOpen, setArchivedBotsOpen] = useState(false);
  const [teamFeedback, setTeamFeedback] = useState<{
    error: boolean;
    text: string;
    restoreBot?: { id: string; name: string };
  } | null>(null);
  const [query, setQuery] = useState("");
  const storedDensity = useSidebarDensity();
  const density = collapseToIcons ? "icons" : storedDensity;
  const simple = !advanced && density !== "icons";
  const simpleDesk = simple && !phone;
  const rail = !advanced && density === "icons";
  const sidePanelOpen = state.computerOpen || state.inspectorOpen;
  const sizing = useSidebarWidth({ simple: !advanced, sidePanelOpen, sidebarRef });
  const [searchOpen, setSearchOpen] = useState(false);
  const searchShown = searchOpen || query !== "";
  const searchToggleRef = useRef<HTMLButtonElement>(null);
  const closeSearch = () => { setSearchOpen(false); setQuery(""); searchToggleRef.current?.focus(); };

  useEffect(() => {
    if (density === "icons") setQuery("");
  }, [density]);

  const toggleCollapsed = () => {
    setSidebarDensity(density === "icons" ? "comfortable" : "icons");
  };
  useEffect(() => {
    if (collapseToIcons || phone) return;
    const onKey = (event: KeyboardEvent) => { if (isSidebarToggle(event)) { event.preventDefault(); toggleCollapsed(); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [collapseToIcons, phone, density]);

  useEffect(() => {
    if (!open || confirm) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [open, onClose, confirm]);

  const plusMenuRef = useRef<HTMLDivElement>(null);
  usePopoverDismiss(plusOpen, plusMenuRef, () => setPlusOpen(false));

  useEffect(() => {
    if (remoteClient) return;
    return window.ogb?.onPackageInstall?.((url) => setImportUrl(url));
  }, [remoteClient]);

  useEffect(() => {
    if (!teamFeedback) return;
    const timer = window.setTimeout(() => setTeamFeedback(null), 5000);
    return () => window.clearTimeout(timer);
  }, [teamFeedback]);


  const requestArchive = (bot: Bot) => {
    const current = currentArchivableBot(state.bots, bot.id);
    if (current) setConfirm({ kind: "archive", bot: current });
  };

  const archiveBot = async ({ id }: Pick<Bot, "id">) => {
    const bot = currentArchivableBot(state.bots, id);
    if (bot) await archiveBotWithNotice(bot, { bots: state.bots, selectedId: state.selectedId, dispatch, showThreads, notify: setTeamFeedback });
  };
  // Archives from the bot panel report here too, with the same Undo.
  useEffect(() => onArchiveNotice(setTeamFeedback), []);
  useEffect(() => onBotMenuRequest(setMenu), []);

  const undoBotArchive = async (bot: { id: string; name: string }) => {
    setTeamFeedback(null);
    try {
      const response = await api(`/api/bots/${bot.id}`, {
        method: "PATCH",
        body: JSON.stringify({ hidden: false }),
      });
      dispatch({ type: "botPatched", bot: response.bot });
      openBot(dispatch, response.bot, showThreads);
      setTeamFeedback({ error: false, text: t("sidebar.archived.restored", { name: bot.name }) });
    } catch (cause) {
      setTeamFeedback({ error: true, text: cause instanceof Error ? cause.message : String(cause) });
    }
  };

  // A framed window (WindowFrameBar) holds the traffic lights and the rail's button in its top bar, so the top row keeps
  // no room for them; in Simple it is only the corner holding Search and New, with the bot tiles beside it. With the
  // frame off on macOS, the traffic lights sit in the top row's corner.
  const framed = windowFramed(capabilities), corner = framed && simpleDesk;
  const lights = capabilities.windowChrome === "mac-inset" && !framed;
  const draggableChrome = capabilities.windowChrome !== "native";
  // SAFETY: Electron's -webkit-app-region is not in React's CSSProperties type; the renderer accepts it as an inline
  // style.
  const windowDragStyle = draggableChrome
    ? ({ WebkitAppRegion: "drag" } as React.CSSProperties)
    : undefined;
  // SAFETY: interactive buttons must opt out of the draggable title-bar region.
  const windowNoDragStyle = draggableChrome
    ? ({ WebkitAppRegion: "no-drag" } as React.CSSProperties)
    : undefined;

  const q = query.trim().toLowerCase();
  const tools = useToolsSection(density, q);

  const projectSide = useTeamProjectSide(), sideLists = useTeamSideLists(state);
  const viewerEmail = useViewerEmail(), welcoming = useWelcomingBot();
  const shownMain = sidebarMainBot(sideLists.bots, viewerEmail, { welcoming }) ?? null;
  const tiles = simpleDesk && shownMain !== null;
  const archivedBots = state.bots.filter((bot) => bot.hidden && !bot.movedTo);
  const archivedEntry = remoteClient ? undefined : { count: archivedBots.length, open: () => setArchivedBotsOpen(true) };
  const attention = crossBotAttentionThreads(state.bots, state.pendingQueued, undefined, state.groups);
  const unreadOutside = unreadOutsideProjects(sideLists.bots, sideLists.groups, projectSide, { viewer: viewerEmail, mainBotId: shownMain?.id });
  const pendingBotUndo = teamFeedback?.restoreBot;
  const botRow = (bot: Bot) => botRowProps(state, dispatch, bot, { density, onMenu: setMenu, renameRequest: renameRequest?.botId === bot.id ? renameRequest.nonce : 0 });
  const inboxRow = <SidebarInboxRow icons={density === "icons"} large={!advanced} flush={!simpleDesk} running={attentionHasRunningWork(attention)} onOpened={phone ? onClose : undefined} />;
  const railSearch = () => {
    if (collapseToIcons) return openCommandPalette();
    setSearchOpen(true);
    toggleCollapsed();
  };
  const railSearchLabel = t(collapseToIcons ? "sidebar.searchAria" : "sidebar.searchProjects");
  const plusItem = cn(MENU_ITEM, "text-ink hover:bg-menu-hover"), newBotHere = useNewBotHereLabel();
  const mayMakeBots = teamSettingsAllowed !== false || Boolean(state.config?.team);
  const mayMakeProjects = projectSide.shown && !remoteClient, mayMakeDepartments = !remoteClient && teamSettingsAllowed !== false;
  const plusControl = (mayMakeProjects || mayMakeBots || mayMakeDepartments) && (
    <div ref={plusMenuRef} className="contents">
    <button
      ref={importReturnRef}
      onClick={() => setPlusOpen((o) => !o)}
      aria-label={t("sidebar.new")}
      className={phone ? PHONE_TOP_BUTTON : corner ? SIMPLE_CORNER_BUTTON : rail || simple ? SIMPLE_TOP_BUTTON : cn(
        "flex items-center justify-center text-ink-secondary transition-colors hover:bg-ink/[0.06] hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
        density === "icons" ? "size-[46px] shrink-0 rounded-xl" : "size-8 rounded-full",
      )}
      title={t("sidebar.new")}
    >
      <Plus size={corner ? 18 : phone || simple || density === "icons" ? 20 : 18} strokeWidth={phone ? 2 : 1.5} />
    </button>
    {plusMotion.shown && (
      <>
        <div role="menu" aria-label={t("sidebar.new")} onKeyDown={navigateThreadMenu} className={cn(
          "absolute z-40 w-max min-w-[200px] overflow-hidden", MENU_SHEET,
          rail ? "left-full top-0 ml-4" : cn("top-full", advanced ? "mt-1" : "mt-1.5", density === "icons" ? "left-0" : "right-0 max-w-[calc(100vw_-_48px)] md:max-w-[calc(min(var(--sidebar-width),var(--sidebar-max))_-_48px)]"),
          plusMotion.className,
        )} {...plusMotion.exitProps}>
          {mayMakeProjects && <button data-plus-new-project="" onClick={() => { setPlusOpen(false); setNewProject(true); }} role="menuitem" className={plusItem}>
            <FolderPlus size={16} className="text-ink-secondary" />{t("teamProjects.new")}
          </button>}
          {mayMakeBots && <button
            data-plus-new-bot=""
            onClick={() => { setPlusOpen(false); dispatch(newBotOnTeamMap(dispatch)); }}
            role="menuitem"
            className={plusItem}
          >
            <BotIcon size={16} className="text-ink-secondary" />
            <span className="flex-1">{newBotHere ?? (advanced ? t("sidebar.newBot") : t("sidebar.newBotSimple"))}</span>
            {advanced && <ShortcutHint id="new-bot" />}
          </button>}{mayMakeBots && newBotHere && <NewBotOtherPlaceItem itemClass={plusItem} onClose={() => setPlusOpen(false)} />}
          {mayMakeDepartments && <button data-plus-new-department="" onClick={() => { setPlusOpen(false); setNewTeam({}); }} role="menuitem" className={plusItem}>
            <Users size={16} className="text-ink-secondary" />{t("sidebar.addDepartment")}
          </button>}
        </div>
      </>
    )}
    </div>
  );

  return (
    <aside
      ref={sidebarRef} data-look="sidebar" data-sidebar-root={!phone || open ? "" : undefined}
      tabIndex={-1}
      aria-label={t("sidebar.aria")}
      data-native-view-overlay
      data-sidebar
      onClick={(event) => {
        // The phone's list covers the whole screen: choosing the bot that is already open has to dismiss it too.
        if (phone && open && event.target instanceof Element && !(event.target instanceof HTMLInputElement) && event.target.closest("[data-sidebar-bot-row], [data-sidebar-hero], [data-sidebar-project-row]")) onClose();
      }}
      style={{ "--sidebar-width": `${sizing.width}px`, "--sidebar-max": sidePanelOpen ? advanced ? "320px" : "280px" : "calc(100vw - 320px)" } as CSSProperties}
      className={cn(
        "relative flex h-full shrink-0 flex-col border-r-[0.5px] border-edge bg-panel max-md:[--scroll-fade-surface:var(--color-app)]",
        sizing.resizing && !sizing.snapping ? "transition-none" : "transition-[width] duration-200 motion-reduce:transition-none",
        density === "icons" ? rail ? "w-[92px]" : "w-[80px]" : advanced ? "w-[320px] md:w-[var(--sidebar-width)]" : "w-[280px] md:w-[var(--sidebar-width)]",
        "md:max-w-[var(--sidebar-max)]",
        // max-md: rather than an md: cancel: Tailwind v4 emits the native `translate`, and any value but `none` makes
        // this a containing block for its `fixed` descendants.
        "max-md:absolute max-md:inset-y-0 max-md:left-0 max-md:z-40 max-md:w-full max-md:bg-app",
        "max-md:transition-transform max-md:duration-200",
        open ? "max-md:translate-x-0" : "max-md:-translate-x-full",
      )}
    >
      <GlassScrollFrame className="flex-1" fade><PlaceTint />
      <GlassBar edge="top">
      <div
        data-sidebar-top-row={corner ? "corner" : true}
        className={cn(
          "flex items-center",
          // The corner is no drag region and takes no clicks but its buttons': the tiles rise into the rest of it.
          density === "icons" ? "flex-col gap-1 px-2 pt-3.5 pb-1" : corner ? "pointer-events-none relative h-[34px] items-start justify-end px-1.5 pt-1.5" : simpleDesk ? "relative h-[60px] items-start pl-4 pr-4 pt-3" : "relative pl-4 pr-2",
          density !== "icons" && !simpleDesk && !lights && "h-12 max-md:h-16",
        )}
        style={corner ? undefined : density !== "icons" && lights && !simpleDesk ? { ...windowDragStyle, height: MAC_TRAFFIC_LIGHT_CENTER_Y * 2 } : windowDragStyle}
      >
        {phone ? (
          <div className="shrink-0" style={windowNoDragStyle}><SidebarProfileMenu iconOnly circle teamMapUnread={unreadOutside} /></div>
        ) : lights ? (
          // The traffic lights span 16-76px of the window; nothing clickable starts before 88px, with the window's rail
          // beside the page or not.
          <div aria-hidden="true" data-traffic-light-space className={density === "icons" ? "h-5 w-full" : "w-[72px] shrink-0 md:w-[calc(72px_-_var(--rail-beside,0px))]"} />
        ) : null}{!phone && !framed && <ChromeRailToggle advanced={advanced} icons={density === "icons"} style={windowNoDragStyle} />}
        {rail && <div data-sidebar-rail-top className="flex flex-col items-center gap-2 pt-1" style={windowNoDragStyle}>
          <button type="button" onClick={railSearch} aria-label={railSearchLabel} title={railSearchLabel} className={SIMPLE_TOP_BUTTON}>
            <Search size={18} strokeWidth={1.5} aria-hidden="true" />
          </button>
          <div className="relative flex">{plusControl}</div>
        </div>}
        {density !== "icons" && (simpleDesk ? <div data-sidebar-top-slot className="min-w-0 flex-1" /> : (
          <div data-sidebar-top-slot className={cn("@container/sidebar-top flex min-w-0 flex-1 items-center", simple && "justify-end")}>
            {!simple && <div data-sidebar-top-spacer className="min-w-0 flex-1 @min-[96px]/sidebar-top:min-w-6" />}
            <div data-sidebar-top-switcher className={simple ? "flex min-w-0 items-center" : "flex min-w-0 max-w-[140px] items-center"}>
              <DesktopWorkspaceSwitcher inline pill={simple} cloudHome={state.config?.cloudHome === true} place={state.config?.team?.name} owner={cloudOwner} howTo={state.cloudHowTo} onMenuClosed={endHowTo} />
            </div>
          </div>
        ))}
        {!rail && <div
          data-sidebar-top-buttons
          className={cn("relative flex shrink-0 items-center", density === "icons" ? "flex-col gap-1" : corner ? "pointer-events-auto" : simpleDesk ? "gap-2" : simple ? "gap-1 pl-0.5" : "ml-0.5 gap-0.5")}
          style={windowNoDragStyle}
        >
          {simpleDesk && <SidebarSearchToggle ref={searchToggleRef} corner={corner} open={searchShown} onToggle={() => (searchShown ? closeSearch() : setSearchOpen(true))} />}
          {density === "icons" && <button
            type="button"
            onClick={openCommandPalette}
            aria-label={t("sidebar.searchAria")}
            title={t("sidebar.searchAria")}
            className="flex size-[46px] shrink-0 items-center justify-center rounded-xl text-ink-secondary hover:bg-raised hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
          >
            <Search size={20} strokeWidth={1.5} />
          </button>}
          {advanced && inboxSupport === "no" && <SidebarActiveThreads entries={attention} icons={density === "icons"} phone={phone} dispatch={dispatch} />}
          {plusControl}
        </div>}
      </div>

      {density === "icons" && !rail && <DesktopWorkspaceSwitcher compact cloudHome={state.config?.cloudHome === true} place={state.config?.team?.name} owner={cloudOwner} howTo={state.cloudHowTo} onMenuClosed={endHowTo} />}
      <OrganizationIdentity compact={density === "icons"} />
      {phone ? null : simple ? searchShown && <SidebarSearchPill query={query} onQuery={setQuery} onClose={closeSearch} /> : <div className={cn("pt-1 pb-3", density === "icons" ? "hidden" : "px-3")}>
        <div className={cn("flex h-8 items-center gap-2 rounded-full px-3 focus-within:ring-focus", ELEVATED_CONTROL)}>
          <Search size={15} className="shrink-0 text-ink-secondary" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && setQuery("")}
            placeholder={t("sidebar.searchProjects")}
            aria-label={t("sidebar.searchProjects")}
            className="w-full bg-transparent text-[13px] text-ink placeholder:text-ink-tertiary focus:outline-none"
          />
        </div>
      </div>}
      {!q && <TeamSideSwitch compact={density === "icons"} listOnly={phone} />}
      {shownMain && tiles && <SidebarTileGrid primary={shownMain} row={botRow} corner={corner} />}
      {simpleDesk && !tiles && <SidebarNoBots />}
      {simpleDesk && inboxRow}
      </GlassBar>

      {!collapseToIcons && !phone && <SidebarResizeHandle sizing={sizing} sidebarRef={sidebarRef} avatars={density === "icons"} avatarsWidth={rail ? 92 : 80}
        onAvatars={(avatars) => setSidebarDensity(avatars ? "icons" : "comfortable")} style={windowNoDragStyle} />}

      <GlassScroller className={rail ? "[scrollbar-gutter:stable_both-edges]" : simpleDesk ? "px-3" : "px-2"}>
        <div className={cn("flex flex-col", simpleDesk ? cn("gap-0.5 pb-2", !tiles && "pt-2") : advanced ? "gap-0.5" : "gap-1 pb-2 pt-2")}>
          {shownMain && !simpleDesk && (phone ? (
            <PhoneHero bot={shownMain} selected={botRow(shownMain).selected} onOpen={() => openBotRow(dispatch, shownMain, showThreads, botRow(shownMain).selected)} onMenu={setMenu} />
          ) : (
            <div className="mb-1"><BotListItem {...botRow(shownMain)} /></div>
          ))}
          {!simpleDesk && inboxRow}
          {!q && <NeedsYouButton compact={rail} />}
          <SidebarTeamProjects side={projectSide} all={sideLists} query={query.trim()}
            mode={{ density, advanced, tight: advanced || simpleDesk, remote: remoteClient }}
            onNew={() => setNewProject(true)} onError={(text) => setTeamFeedback({ error: true, text })} />
          {!q && <SidebarPeople compact={rail} onOpened={phone ? onClose : undefined} />}
          {!q && <OtherPlaceBots />}<MovedBotRows bots={state.bots} /><MovedToMyCloudRow bots={state.bots} />
        </div>
      </GlassScroller>
      <GlassBar edge="bottom">
      <LiveCallPill
        currentBotId={state.activeView === "chat" ? state.selectedId : null}
        onOpen={(botId, threadId) => openThread(dispatch, { botId, threadId }, state, showThreads)}
        iconOnly={density === "icons"}
      />

      {rail ? <SimpleRailFooter
        owner={cloudOwner}
        archived={archivedEntry}
        teamMapUnread={unreadOutside}
      /> : phone ? <SidebarPhoneBar query={query} onQuery={setQuery} teamMapUnread={unreadOutside} /> : <SidebarFooter density={density} simple={simpleDesk} owner={cloudOwner} archived={archivedEntry} teamMapUnread={unreadOutside}
        toolsCollapsed={tools.collapsed} onToggleTools={tools.toggle} />}
      </GlassBar>
      </GlassScrollFrame>

      <BotContextMenu
          menu={menu}
          onClose={() => setMenu(null)}
          onArchive={requestArchive}
          onDelete={(bot) => setConfirm({ kind: "delete", bot })}
          onMoveToSection={(botId) => {
            if (!menu) return;
            setSectionPicker({ botId, x: menu.x, y: menu.y });
          }}
          onNewFolder={setNewFolderBotId}
          onNewTaskFolder={setNewTaskFolderBotId}
          onRename={(botId) => menu && "rename" in menu ? menu.rename(botId) : setRenameRequest((current) => ({ botId, nonce: (current?.nonce ?? 0) + 1 }))}
          onNewSection={remoteClient || teamSettingsAllowed === false ? undefined : (botId) => setNewTeam({ botId })}
        />
      {showThreads && newFolderBotId && state.bots.find((bot) => bot.id === newFolderBotId) && <BotProjectDialog bot={state.bots.find((bot) => bot.id === newFolderBotId)!} onClose={() => setNewFolderBotId(null)} />}
      {showThreads && newTaskFolderBot && <NewTaskFolderDialog bot={newTaskFolderBot} onClose={() => setNewTaskFolderBotId(null)} onReturnFocus={() => {
        sidebarRef.current?.querySelector<HTMLElement>(`[data-sidebar-bot-row="${CSS.escape(newTaskFolderBot.id)}"]`)?.focus();
      }} />}
      <ConfirmDialog {...botConfirmProps(confirm, state.bots, { archive: (bot) => { setConfirm(null); void archiveBot(bot); }, remove: (bot) => { setConfirm(null); dispatch({ type: "deleteBot", botId: bot.id }); },
        archiveInstead: (chief) => { setConfirm(null); void archiveBotWithNotice(chief, { bots: state.bots, selectedId: state.selectedId, dispatch, showThreads, notify: setTeamFeedback }); } })}
        onCancel={cancelConfirm} returnFocusRef={sidebarRef} />
      <OwnerPickerHost />
      {newTeam && <TeamDialog onClose={() => setNewTeam(null)} onCreated={(name) => {
        if (newTeam.botId) moveBotsToSection(dispatch, [newTeam.botId], name);
        showOnTeamMap(dispatch, { department: name });
      }} />}
      {newProject && <NewTeamProjectDialog onClose={() => setNewProject(false)} />}
      <SectionPicker
          current={sectionPicker ? state.bots.find((b) => b.id === sectionPicker.botId)?.section : undefined}
          anchor={sectionPicker}
          onClose={() => setSectionPicker(null)}
          onAssign={(section) => { if (sectionPicker) moveBotsToSection(dispatch, [sectionPicker.botId], section); }}
        />
      {!remoteClient && archivedBotsOpen && (
        <ArchivedBotsPanel
          bots={archivedBots}
          onClose={() => setArchivedBotsOpen(false)}
          onRestored={(message) => setTeamFeedback({ error: false, text: message })}
        />
      )}
      {!remoteClient && importUrl !== null && <ImportDialog initialUrl={importUrl || undefined} onClose={() => setImportUrl(null)}
        onAdded={(line) => { setImportUrl(null); setTeamFeedback({ error: false, text: line }); }} />}
      {teamFeedback &&
        createPortal(
          <div
            role="status"
            className={cn(
              "fixed bottom-4 left-[calc(var(--rail-beside,0px)_+_1rem)] z-[60] max-w-[300px] rounded-xl border px-3.5 py-2.5 text-[13px] shadow-xl",
              teamFeedback.error
                ? "border-danger/30 bg-card text-danger"
                : "border-hairline/50 bg-card text-ink",
            )}
          >
            <div className="flex items-center gap-3">
              <span>{teamFeedback.text}</span>
              {pendingBotUndo && (
                <button
                  onClick={() => void undoBotArchive(pendingBotUndo)}
                  className="rounded-md px-1.5 py-0.5 font-medium text-accent hover:bg-raised"
                >
                  {t("common.undo")}
                </button>
              )}
            </div>
          </div>,
          document.body,
        )}
    </aside>
  );
});
