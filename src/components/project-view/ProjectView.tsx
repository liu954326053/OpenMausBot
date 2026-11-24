import { Loader2 } from "lucide-react";
import { useEffect, useRef } from "react";

import { WindowDragStrip } from "@/components/DesktopCapabilities";
import { ProductionBoardOverlay } from "@/components/production-board/panels/ProductionBoardOverlay";
import { ServerProjectCanvas } from "@/components/project-canvas/ServerProjectCanvas";
import { useViewerEmail } from "@/lib/default-bot";
import { t } from "@/lib/i18n";
import { useShowThreads } from "@/lib/thread-preferences";
import { useStoreDispatch, useStoreSelector } from "@/state/store-select";
import { useTeamProjectSide } from "@/state/team-projects";
import { landingBot, openBot } from "@/state/thread-navigation";
import { ProjectTopBar } from "./ProjectTopBar";

export interface ProjectViewProps {
  projectId: string;
  /** The member the person chose in the sidebar; none when they opened the project itself. */
  selectedBotId?: string;
}

/** A project's canvas, under the project's top bar, whose switch goes to the lead's conversation. */
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
      <ServerProjectCanvas projectId={project.id} selectedBotId={selectedBotId} topBarSlot={<ProjectTopBar project={project} mode="canvas" />} overlay={ProductionBoardOverlay} />
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
