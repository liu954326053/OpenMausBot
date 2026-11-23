import { AppWindow, BookOpen, FolderOpen, FolderTree, Globe, Puzzle, Rocket, Server, UsersRound, Zap } from "lucide-react";
import { useId, useMemo, type ReactNode } from "react";

import { useAppTriggers } from "@/lib/app-triggers";
import { appsOpen, mcpOpen } from "@/lib/apps-panel";
import { automationsFrom, hasUnseenProblemRun } from "@/lib/automations";
import { cn } from "@/lib/cn";
import { useCloudFilesReady } from "@/lib/cloud-files";
import { skillsLibraryEnabled, publishedAppsEnabled } from "@/lib/feature-flags";
import { t } from "@/lib/i18n";
import { useAdvancedMode } from "@/lib/interface-mode";
import { useWebPanels } from "@/lib/web-panel-preferences";
import { useSidebarToolsLayout, type SidebarDensity } from "@/lib/sidebar-preferences";
import { useStore } from "@/state/store";

import { SidebarSectionHeader } from "./SidebarSectionHeader";
import { UpdateIndicator } from "./UpdateIndicator";


function NavRow({
  id,
  label,
  icon,
  active = false,
  attention = false,
  unread = false,
  iconsOnly,
  rail = false,
  tourId,
  onClick,
}: {
  id: string;
  label: string;
  icon: (active: boolean) => ReactNode;
  active?: boolean;
  attention?: boolean;
  /** Something it leads to is unread. */
  unread?: boolean;
  iconsOnly: boolean;
  rail?: boolean;
  tourId?: string;
  onClick: () => void;
}) {
  const unreadId = useId();
  return (
    <>
      <button
        type="button"
        data-tour={tourId}
        data-sidebar-nav={id}
        onClick={onClick}
        aria-label={iconsOnly ? label : undefined}
        aria-describedby={unread ? unreadId : undefined}
        title={iconsOnly ? label : undefined}
        aria-current={active ? "page" : undefined}
        className={cn(
          "relative flex items-center rounded-xl transition-colors",
          rail ? "size-9 shrink-0 justify-center" : iconsOnly ? "mx-auto size-[46px] shrink-0 justify-center" : "w-full min-h-9 gap-3 px-3 py-1.5 text-left",
          active ? "bg-raised text-ink" : "text-ink hover:bg-raised/50",
        )}
      >
        {icon(active)}
        {!iconsOnly && <span className="flex-1 truncate text-[14px] font-medium leading-5">{label}</span>}
        {attention && (
          <span
            data-testid="routines-attention"
            className={cn("size-2 shrink-0 rounded-full bg-danger", iconsOnly && (rail ? "absolute right-1 top-1" : "absolute right-2 top-2"))}
          />
        )}
        {unread && !attention && (
          <span data-sidebar-nav-unread="" aria-hidden="true"
            className={cn("size-2 shrink-0 rounded-full bg-accent", iconsOnly && (rail ? "absolute end-1 top-1" : "absolute end-2 top-2"))} />
        )}
      </button>
      {unread && <span id={unreadId} hidden>{t("task.unread")}</span>}
    </>
  );
}

export function SidebarAppsButton() {
  const { state, dispatch } = useStore();
  const label = t("sidebar.nav.apps");
  return (
    <button
      type="button"
      data-tour="nav-apps"
      data-sidebar-nav="apps"
      onClick={() => dispatch({ type: "togglePlugins", open: true, surface: "apps" })}
      aria-label={label}
      title={label}
      aria-pressed={appsOpen(state)}
      className={cn(
        "flex size-9 shrink-0 items-center justify-center rounded-xl transition-colors",
        appsOpen(state) ? "bg-raised text-accent" : "text-ink-secondary hover:bg-raised/50 hover:text-ink",
      )}
    >
      <Puzzle size={18} />
    </button>
  );
}

/** An unseen failed run of an automation the Automations page lists (the same list, so opening it clears the dot), or an app trigger in trouble. */
export function useAutomationsNeedYou(): boolean {
  const { state } = useStore();
  const appTriggers = useAppTriggers();
  const routinesOnly = typeof window !== "undefined" && window.ogb?.remoteClient?.active === true;
  const unseenProblem = useMemo(() => hasUnseenProblemRun(automationsFrom({
    routines: state.routines, webhooks: routinesOnly ? [] : state.webhooks, appTriggers: appTriggers.triggers, runs: state.routineRuns, bots: state.bots,
  })), [state.routines, state.webhooks, appTriggers.triggers, state.routineRuns, state.bots, routinesOnly]);
  return unseenProblem || appTriggers.triggers.some((trigger) => trigger.enabled && trigger.problem);
}

export function SidebarBottomButtons() {
  return (
    <div data-sidebar-bottom-buttons="" className="flex shrink-0 items-center gap-0.5">
      <SidebarAppsButton />
      <UpdateIndicator />
    </div>
  );
}

export function SidebarFooterNav({
  density,
  rail = false,
  collapsed = false,
  onToggleCollapsed,
  teamMapUnread = false,
}: {
  density: SidebarDensity;
  rail?: boolean;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
  /** A bot in no project or a group chat outside the projects has something unread: the sidebar lists neither. */
  teamMapUnread?: boolean;
}) {
  const { state, dispatch } = useStore();
  const advanced = useAdvancedMode();
  const webPanels = useWebPanels();
  const iconsOnly = density === "icons";
  const toolsLayout = useSidebarToolsLayout();
  const toolbar = advanced && !iconsOnly && toolsLayout === "toolbar";
  const iconSize = iconsOnly && !rail ? 20 : 18;
  const tone = (active: boolean) => (active ? "text-accent" : "text-ink-secondary");
  const automationsNeedYou = useAutomationsNeedYou();
  const automationsRow = <NavRow
    id="automations"
    label={t("sidebar.nav.automations")}
    tourId="nav-automations"
    iconsOnly={iconsOnly || toolbar}
    active={state.activeView === "routines"}
    attention={automationsNeedYou}
    icon={(active) => <Zap size={iconSize} className={tone(active)} />}
    onClick={() => dispatch({ type: "showRoutines", view: "list" })}
  />;
  const filesRow = useCloudFilesReady() && <NavRow
    id="files"
    label={t("sidebar.nav.files")}
    iconsOnly={iconsOnly}
    rail={rail}
    active={state.activeView === "files"}
    icon={(active) => <FolderOpen size={iconSize} className={tone(active)} />}
    onClick={() => dispatch({ type: "showFiles" })}
  />;
  if (!advanced && !iconsOnly) return null;
  const appsRow = iconsOnly && <NavRow
    id="apps"
    label={t("sidebar.nav.apps")}
    tourId="nav-apps"
    iconsOnly={iconsOnly}
    rail={rail}
    active={appsOpen(state)}
    icon={(active) => <Puzzle size={iconSize} className={tone(active)} />}
    onClick={() => dispatch({ type: "togglePlugins", open: true, surface: "apps" })}
  />;
  if (rail) return <nav data-tour="tools" aria-label={t("sidebar.tools")} className="flex flex-col items-center gap-0.5">{appsRow}</nav>;

  const rows = (
    <>
      {automationsRow}
      {appsRow}
      {(advanced || iconsOnly) && (
        <NavRow
          id="team-map"
          label={t("sidebar.nav.teamMap")}
          tourId="team-tools"
          iconsOnly={iconsOnly || toolbar}
          active={state.activeView === "team-map"}
          unread={teamMapUnread}
          icon={(active) => <UsersRound size={iconSize} className={tone(active)} />}
          onClick={() => dispatch({ type: "showTeamMap" })}
        />
      )}
      {filesRow}
      {publishedAppsEnabled(state.config) && (
        <NavRow
          id="published-apps"
          label={t("sidebar.nav.publishedApps")}
          iconsOnly={iconsOnly || toolbar}
          active={state.activeView === "published-apps"}
          icon={(active) => <Rocket size={iconSize} className={tone(active)} />}
          onClick={() => dispatch({ type: "showPublishedApps" })}
        />
      )}
      {skillsLibraryEnabled(state.config) && (
        <NavRow
          id="skills-library"
          label={t("skills.library.title")}
          iconsOnly={iconsOnly || toolbar}
          active={state.activeView === "skills-library"}
          icon={(active) => <BookOpen size={iconSize} className={tone(active)} />}
          onClick={() => dispatch({ type: "showSkillsLibrary" })}
        />
      )}
      <NavRow
        id="mcp"
        label={t("connectors.tab.mcp")}
        iconsOnly={iconsOnly || toolbar}
        active={mcpOpen(state)}
        icon={(active) => <Server size={iconSize} className={tone(active)} />}
        onClick={() => dispatch({ type: "togglePlugins", open: true, surface: "mcp" })}
      />
      {state.config?.team && (
        <NavRow
          id="team-files"
          label={t("sidebar.nav.teamFiles")}
          iconsOnly={iconsOnly || toolbar}
          active={state.activeView === "team-files"}
          icon={(active) => <FolderTree size={iconSize} className={tone(active)} />}
          onClick={() => dispatch({ type: "showTeamFiles" })}
        />
      )}
      {advanced && webPanels.map((panel) => (
        <NavRow
          key={panel.id}
          id={`web-panel-${panel.id}`}
          label={panel.name}
          iconsOnly={iconsOnly || toolbar}
          active={state.activeView === "web-panel" && state.webPanelId === panel.id}
          icon={(active) => (panel.page ? <AppWindow size={iconSize} className={tone(active)} /> : <Globe size={iconSize} className={tone(active)} />)}
          onClick={() => dispatch({ type: "showWebPanel", id: panel.id })}
        />
      ))}
    </>
  );

  if (iconsOnly) {
    return <nav data-tour="tools" aria-label={t("sidebar.tools")} className="flex flex-col items-center gap-1">{rows}</nav>;
  }
  return (
    <div data-tour="tools">
      <SidebarSectionHeader
        name={t("sidebar.tools")}
        collapsed={collapsed}
        alert={collapsed && automationsNeedYou}
        attention={collapsed && teamMapUnread ? { unread: 1, waiting: 0, working: 0 } : undefined}
        onToggle={onToggleCollapsed}
        reorderable={false}
        dragging={false}
      />
      {!collapsed && <nav aria-label={t("sidebar.tools")} className={toolbar ? "flex flex-row gap-1" : "flex flex-col gap-0.5"}>{rows}</nav>}
    </div>
  );
}
