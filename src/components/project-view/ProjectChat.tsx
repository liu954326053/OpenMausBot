import { FolderX } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";

import type { TeamProjectWire } from "../../../shared/team-projects";
import { ChatView } from "@/components/ChatView";
import { useCaptionChrome } from "@/components/DesktopCapabilities";
import { GroupView } from "@/components/GroupView";
import { useViewerEmail } from "@/lib/default-bot";
import { t } from "@/lib/i18n";
import type { TeamProjectSide } from "@/lib/team-projects";
import { useShowThreads } from "@/lib/thread-preferences";
import type { Bot, Group } from "@/state/store";
import { useStoreDispatch, useStoreSelector } from "@/state/store-select";
import { useTeamProjectSide } from "@/state/team-projects";
import { landingBot, openBot } from "@/state/thread-navigation";
import { ProjectTopBar } from "./ProjectTopBar";

/** A conversation with one of a project's bots, under the project's top bar, whose switch goes to the project's canvas.
 * Any other conversation shows as it is. */
export function ProjectChat({ bot }: { bot: Bot }) {
  const side = useTeamProjectSide();
  const project = side.shown ? side.of(bot) : undefined;
  useLeaveWhenArchived(bot.id, project);
  if (!project || project.archivedAt !== undefined) return <ChatView bot={bot} />;
  return <ProjectFrame project={project}><ChatView bot={bot} /></ProjectFrame>;
}

/** A group chat of a project, its own or another in its department, under the project's top bar. Any other group chat
 * shows as it is. */
export function ProjectGroup({ group }: { group: Group }) {
  const side = useTeamProjectSide();
  const project = side.shown ? projectOfGroup(side, group) : undefined;
  useLeaveWhenArchived(group.id, project);
  if (!project || project.archivedAt !== undefined) return <GroupView group={group} />;
  return <ProjectFrame project={project}><GroupView group={group} /></ProjectFrame>;
}

function projectOfGroup(side: TeamProjectSide, group: Group): TeamProjectWire | undefined {
  return [...side.projects, ...side.archived].find((project) => project.roomId === group.id || side.teamRooms(project, [group]).length > 0);
}

function ProjectFrame({ project, children }: { project: TeamProjectWire; children: ReactNode }) {
  const { dragProps } = useCaptionChrome();
  return (
    <div data-project-chat={project.id} className="flex min-w-0 flex-1 flex-col overflow-hidden bg-app text-ink">
      <header {...dragProps} className="flex h-12 shrink-0 items-center gap-2 border-b border-edge px-4 max-md:ps-12">
        <h1 className="min-w-0 shrink truncate text-[17px] font-semibold leading-6" title={project.name}>{project.name}</h1>
        {project.folderState === "missing" ? (
          <span className="ui-chip gap-1 text-warning" title={t("projectCanvas.folderMissingHint")}><FolderX size={14} aria-hidden="true" />{t("teamProjects.folderMissing")}</span>
        ) : null}
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <ProjectTopBar project={project} mode="chat" />
        </div>
      </header>
      <div className="relative flex min-h-0 flex-1">
        {children}
      </div>
    </div>
  );
}

/** A project archived while one of its conversations is open, in another window or on another device, gives way to the
 * bot the app lands on, as its canvas does. A conversation opened once its project was archived stays. */
function useLeaveWhenArchived(conversationId: string, project: TeamProjectWire | undefined): void {
  const dispatch = useStoreDispatch();
  const bots = useStoreSelector((state) => state.bots);
  const viewer = useViewerEmail();
  const showThreads = useShowThreads();
  const listedAt = useRef<string | null>(null);
  const place = project ? `${conversationId}:${project.id}` : null;
  const archived = project?.archivedAt !== undefined;
  useEffect(() => {
    if (place && !archived) {
      listedAt.current = place;
      return;
    }
    const was = listedAt.current;
    listedAt.current = null;
    if (!place || was !== place) return;
    const home = landingBot(bots, viewer);
    if (home) openBot(dispatch, home, showThreads);
  }, [place, archived, bots, viewer, dispatch, showThreads]);
}
