import { BookOpen, FolderOpen, LayoutGrid, Puzzle, Rocket, Search, Server, UsersRound, X, Zap } from "lucide-react";

import { appsOpen, mcpOpen } from "@/lib/apps-panel";
import { useCloudFilesReady } from "@/lib/cloud-files";
import { skillsLibraryEnabled } from "@/lib/feature-flags";
import { t } from "@/lib/i18n";
import { useStore } from "@/state/store";

import { CloudRoomCard } from "./CloudRoomCard";
import { CloudUsageCard } from "./CloudUsageMeter";
import { useAutomationsNeedYou } from "./SidebarFooterNav";
import { SidebarPopoverMenu, type SidebarMenuItem } from "./SidebarPopoverMenu";
import { UpdateIndicator } from "./UpdateIndicator";

/** The phone's bottom bar: a round button for the tools that are rows in the desktop sidebar, and a search pill. */
/** `teamMapUnread`: a bot in no project or a group chat outside the projects has something unread. */
export function SidebarPhoneBar({ query, onQuery, teamMapUnread = false }: { query: string; onQuery: (query: string) => void; teamMapUnread?: boolean }) {
  const { state, dispatch } = useStore();
  const automationsNeedYou = useAutomationsNeedYou();
  const filesReady = useCloudFilesReady();
  const items: SidebarMenuItem[] = [
    {
      key: "automations",
      label: t("sidebar.nav.automations"),
      icon: <Zap size={18} />,
      active: state.activeView === "routines",
      attention: automationsNeedYou,
      onSelect: () => dispatch({ type: "showRoutines", view: "list" }),
    },
    {
      key: "team-map",
      label: t("sidebar.nav.teamMap"),
      icon: <UsersRound size={18} />,
      active: state.activeView === "team-map",
      attention: teamMapUnread,
      attentionTone: "accent",
      onSelect: () => dispatch({ type: "showTeamMap" }),
    },
    ...(filesReady ? [{
      key: "files",
      label: t("sidebar.nav.files"),
      icon: <FolderOpen size={18} />,
      active: state.activeView === "files",
      onSelect: () => dispatch({ type: "showFiles" }),
    }] : []),
    {
      key: "published-apps",
      label: t("sidebar.nav.publishedApps"),
      icon: <Rocket size={18} />,
      active: state.activeView === "published-apps",
      onSelect: () => dispatch({ type: "showPublishedApps" }),
    },
    ...(skillsLibraryEnabled(state.config) ? [{
      key: "skills-library",
      label: t("skills.library.title"),
      icon: <BookOpen size={18} />,
      active: state.activeView === "skills-library",
      onSelect: () => dispatch({ type: "showSkillsLibrary" }),
    }] : []),
    {
      key: "mcp",
      label: t("connectors.tab.mcp"),
      icon: <Server size={18} />,
      active: mcpOpen(state),
      onSelect: () => dispatch({ type: "togglePlugins", open: true, surface: "mcp" }),
    },
    {
      key: "apps",
      label: t("sidebar.nav.apps"),
      icon: <Puzzle size={18} />,
      active: appsOpen(state),
      onSelect: () => dispatch({ type: "togglePlugins", open: true, surface: "apps" }),
    },
  ];
  return (
    <div data-sidebar-phone-bar className="px-3 pb-3 pt-1">
      <CloudRoomCard />
      <CloudUsageCard />
      <div className="flex items-center gap-2 not-first:mt-2">
        <SidebarPopoverMenu
          items={items}
          ariaLabel={t("sidebar.tools")}
          triggerClassName="shrink-0 rounded-full"
          triggerTitle={t("sidebar.tools")}
          renderTrigger={({ open }) => (
            <span className={`relative flex size-11 items-center justify-center rounded-full border border-hairline text-ink ${open ? "bg-raised" : "bg-card"}`}>
              <LayoutGrid size={19} aria-hidden="true" />
              {(automationsNeedYou || teamMapUnread) && <span aria-hidden data-phone-tools-dot={automationsNeedYou ? "danger" : "accent"}
                className={`absolute right-1 top-1 size-2.5 rounded-full ring-2 ring-app ${automationsNeedYou ? "bg-danger" : "bg-accent"}`} />}
            </span>
          )}
        />
        <div className="flex h-11 min-w-0 flex-1 items-center gap-2 rounded-full border border-hairline bg-card pl-3.5 pr-1.5 text-ink-secondary focus-within:border-focus">
          <Search size={17} aria-hidden="true" className="shrink-0" />
          <input
            value={query}
            onChange={(event) => onQuery(event.target.value)}
            onKeyDown={(event) => event.key === "Escape" && onQuery("")}
            placeholder={t("sidebar.searchProjects")}
            aria-label={t("sidebar.searchProjects")}
            enterKeyHint="search"
            className="min-w-0 flex-1 bg-transparent text-[15px] text-ink placeholder:text-ink-secondary focus:outline-none"
          />
          {query !== "" && (
            <button
              type="button"
              onClick={() => onQuery("")}
              aria-label={t("sidebar.searchClose")}
              className="flex size-7 shrink-0 items-center justify-center rounded-full text-ink-secondary hover:bg-raised hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus"
            >
              <X size={15} aria-hidden="true" />
            </button>
          )}
          <UpdateIndicator />
        </div>
      </div>
    </div>
  );
}
