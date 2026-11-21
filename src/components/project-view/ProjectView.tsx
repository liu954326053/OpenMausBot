import { Loader2, MessagesSquare, UsersRound } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { TeamProjectWire } from "../../../shared/team-projects";
import { WindowDragStrip } from "@/components/DesktopCapabilities";
import { ServerProjectCanvas } from "@/components/project-canvas/ServerProjectCanvas";
import { SidebarPopoverMenu } from "@/components/SidebarPopoverMenu";
import { TeamChangesDialog } from "@/components/team-projects/TeamChangesDialog";
import { useViewerEmail } from "@/lib/default-bot";
import { t } from "@/lib/i18n";
import { useShowThreads } from "@/lib/thread-preferences";
import { useStoreDispatch, useStoreSelector } from "@/state/store-select";
import { useTeamProjectSide } from "@/state/team-projects";
import { landingBot, openBot } from "@/state/thread-navigation";

export interface ProjectViewProps {
  projectId: string;
  /** The member the person chose in the sidebar; none when they opened the project itself. */
  selectedBotId?: string;
}

/** A project's canvas. Its top bar adds what the canvas does not draw: the project's folder, the changes in its team
 * and its own group chats. */
export function ProjectView({ projectId, selectedBotId }: ProjectViewProps) {
  const side = useTeamProjectSide();
  const project = side.projects.find((one) => one.id === projectId);

  if (!project) {
    return (
      <main data-project-loading="" className="relative flex min-w-0 flex-1 items-center justify-center bg-app text-ink-secondary">
        <WindowDragStrip />
        <Loader2 size={20} role="status" aria-label={t("projectView.loading")} className="animate-spin motion-reduce:animate-none" />
        {side.shown && <OpenLandingBot />}
      </main>
    );
  }

  return (
    <main data-project-view={project.id} className="flex min-w-0 flex-1 flex-col overflow-hidden bg-app text-ink">
      <ServerProjectCanvas projectId={project.id} selectedBotId={selectedBotId} topBarSlot={<ProjectTopBar project={project} />} />
    </main>
  );
}

/** Mounted while the open project is gone, archived or deleted: the bot the app lands on opens in its place. */
function OpenLandingBot() {
  const dispatch = useStoreDispatch();
  const bots = useStoreSelector((state) => state.bots);
  const viewer = useViewerEmail();
  const showThreads = useShowThreads();
  const landed = useRef(false);

  useEffect(() => {
    if (landed.current) return;
    landed.current = true;
    const home = landingBot(bots, viewer);
    if (home) openBot(dispatch, home, showThreads);
  }, [bots, viewer, dispatch, showThreads]);
  return null;
}

function ProjectTopBar({ project }: { project: TeamProjectWire }) {
  const [reviewing, setReviewing] = useState<TeamProjectWire | null>(null);
  const changes = window.ogb?.remoteClient?.active === true ? undefined : project.teamChanges;
  return (
    <>
      {project.folderState === "ready" && (
        <span dir="ltr" title={project.folder} data-project-folder="" className="min-w-0 truncate text-start font-mono text-[12px] leading-4 text-ink-tertiary">{project.folder}</span>
      )}
      <span className="flex-1" />
      {changes && (
        <button type="button" data-project-team-changes="" title={t("teamProjects.changes.review")} onClick={() => setReviewing(project)}
          className="flex shrink-0 items-center gap-1.5 rounded-md text-[12px] leading-4 text-accent-text hover:underline focus-visible:outline-2 focus-visible:outline-focus">
          <UsersRound size={14} aria-hidden="true" className="shrink-0" />{t("teamProjects.changes.notice")}
        </button>
      )}
      <ProjectRooms project={project} />
      {reviewing?.teamChanges && <TeamChangesDialog project={reviewing} changes={reviewing.teamChanges} onClose={() => setReviewing(null)} />}
    </>
  );
}

/** The project's own group chats: a menu of them, there only while the project has some. */
function ProjectRooms({ project }: { project: TeamProjectWire }) {
  const dispatch = useStoreDispatch();
  const groups = useStoreSelector((state) => state.groups);
  const rooms = useTeamProjectSide().teamRooms(project, groups);
  if (!rooms.length) return null;
  const label = t("sidebar.section.channels");
  return (
    <SidebarPopoverMenu ariaLabel={label} triggerTitle={label} align="end" triggerClassName="ui-icon-button"
      items={rooms.map((group) => ({
        key: group.id,
        label: group.name,
        icon: <MessagesSquare size={16} aria-hidden="true" />,
        attention: group.unread,
        attentionTone: "accent" as const,
        trailing: group.unread ? <span className="sr-only">{t("task.unread")}</span> : undefined,
        onSelect: () => dispatch({ type: "select", id: group.id }),
      }))}
      renderTrigger={() => <MessagesSquare size={16} aria-hidden="true" />} />
  );
}
