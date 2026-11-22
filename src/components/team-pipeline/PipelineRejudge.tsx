import { RefreshCw } from "lucide-react";
import { t } from "@/lib/i18n";
import type { TeamPipelineMap } from "@/state/team-pipelines";
import { UndoToast } from "../bot-access/ShareBotButton";

/** "Judge again" in a team's menu: only a team whose pipeline can be read and changed has it. */
export function PipelineRejudgeItem({ map, section, itemClass, onProblem }: {
  map: TeamPipelineMap; section: string; itemClass: string; onProblem: (message: string) => void;
}) {
  if (!map.readable || !map.pipelineOf(section)) return null;
  return <button type="button" data-pipeline-rejudge={section} className={itemClass}
    onClick={() => void map.rejudge(section).catch((error: unknown) => onProblem(error instanceof Error ? error.message : String(error)))}>
    <RefreshCw size={14} />{t("teamPipeline.rejudge")}
  </button>;
}

export function PipelineRejudgeToast({ map, sections }: { map: TeamPipelineMap; sections: ReadonlyArray<{ key: string; name: string }> }) {
  const judged = map.rejudged;
  if (!judged) return null;
  const name = sections.find((section) => section.key === judged.section)?.name ?? judged.section;
  return <UndoToast key={judged.key} clearOfComposer text={t("teamPipeline.rejudged", { name })} failedText={t("teamPipeline.undoFailed")}
    onUndo={map.undoRejudge} onDone={map.forgetRejudge} />;
}
