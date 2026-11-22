import { FolderX } from "lucide-react";

import { ChatView } from "@/components/ChatView";
import { useCaptionChrome } from "@/components/DesktopCapabilities";
import { t } from "@/lib/i18n";
import type { Bot } from "@/state/store";
import { useTeamProjectSide } from "@/state/team-projects";
import { ProjectTopBar } from "./ProjectTopBar";

/** A conversation with one of a project's bots, under the project's top bar, whose switch goes to the project's canvas.
 * Any other conversation shows as it is. */
export function ProjectChat({ bot }: { bot: Bot }) {
  const side = useTeamProjectSide();
  const { dragProps } = useCaptionChrome();
  const project = side.shown ? side.of(bot) : undefined;
  if (!project || project.archivedAt !== undefined) return <ChatView bot={bot} />;
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
        <ChatView bot={bot} />
      </div>
    </div>
  );
}
