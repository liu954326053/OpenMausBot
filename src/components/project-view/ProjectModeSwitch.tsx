import { MessageSquare, Workflow } from "lucide-react";

import type { TeamProjectWire } from "../../../shared/team-projects";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { useShowThreads } from "@/lib/thread-preferences";
import { openProject } from "@/state/project-open";
import { useStoreDispatch, useStoreSelector } from "@/state/store-select";

export type ProjectMode = "chat" | "canvas";

const MODES = [
  { mode: "chat", label: "projectView.mode.chat", Icon: MessageSquare },
  { mode: "canvas", label: "projectView.mode.canvas", Icon: Workflow },
] as const;

/** At the top of a project: its lead's conversation, or its canvas. */
export function ProjectModeSwitch({ project, mode }: { project: TeamProjectWire; mode: ProjectMode }) {
  const dispatch = useStoreDispatch();
  const bots = useStoreSelector((state) => state.bots);
  const showThreads = useShowThreads();
  const choose = (next: ProjectMode) => {
    if (next === mode) return;
    if (next === "canvas") dispatch({ type: "showProject", projectId: project.id });
    else openProject(dispatch, project, bots, showThreads);
  };
  return (
    <div role="group" aria-label={t("projectView.mode")} data-project-mode={mode} className="flex shrink-0 rounded-full bg-ink/[0.05] p-[3px]">
      {MODES.map(({ mode: option, label, Icon }) => (
        <button key={option} type="button" data-project-mode-option={option} aria-pressed={mode === option} onClick={() => choose(option)}
          className={cn(
            "flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[13px] leading-4 transition-colors focus-visible:outline-2 focus-visible:outline-focus",
            mode === option ? "bg-ink/[0.14] text-ink" : "text-ink-secondary hover:text-ink",
          )}>
          <Icon size={14} aria-hidden="true" className="shrink-0" />{t(label)}
        </button>
      ))}
    </div>
  );
}
