import { MessagesSquare, UsersRound } from "lucide-react";
import { useState } from "react";

import type { TeamProjectWire } from "../../../shared/team-projects";
import { SidebarPopoverMenu } from "@/components/SidebarPopoverMenu";
import { TeamChangesDialog } from "@/components/team-projects/TeamChangesDialog";
import { t } from "@/lib/i18n";
import { useStoreDispatch, useStoreSelector } from "@/state/store-select";
import { useTeamProjectSide } from "@/state/team-projects";
import { ProjectModeSwitch, type ProjectMode } from "./ProjectModeSwitch";

/** What a project's top bar shows after its name, over its canvas and over its lead's conversation alike: the switch
 * between the two, the project's folder, the changes in its team and its own group chats. */
export function ProjectTopBar({ project, mode }: { project: TeamProjectWire; mode: ProjectMode }) {
  const [reviewing, setReviewing] = useState<TeamProjectWire | null>(null);
  const changes = window.ogb?.remoteClient?.active === true ? undefined : project.teamChanges;
  return (
    <>
      <ProjectModeSwitch project={project} mode={mode} />
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
