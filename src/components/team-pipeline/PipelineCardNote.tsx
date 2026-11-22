import { Fragment } from "react";
import { cardStages } from "@/lib/team-pipeline";
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import type { FlowStage, TeamPipelineWire } from "../../../shared/team-pipeline";

const STAGE_KEYS: Record<Exclude<FlowStage, "other">, LocaleKey> = {
  lead: "teamPipeline.stage.lead",
  script: "teamPipeline.stage.script",
  character: "teamPipeline.stage.character",
  storyboard: "teamPipeline.stage.storyboard",
  post: "teamPipeline.stage.post",
};

/** What a card says about its bot's place in the pipeline: its stages, and whether it is being placed or was set by hand. */
export function PipelineCardNote({ id, pipeline, botId }: { id: string; pipeline: TeamPipelineWire; botId: string }) {
  const stages = cardStages(pipeline, botId).flatMap((stage) => stage === "other" ? [] : [t(STAGE_KEYS[stage])]);
  const pending = pipeline.pending.includes(botId), manual = pipeline.manual.includes(botId);
  if (!stages.length && !pending && !manual) return null;
  return <span id={id} data-pipeline-note={botId} className="-me-6 mt-1 flex min-w-0 items-center gap-1.5 text-[11px] leading-4">
    {stages.length > 0 && <span title={stages.join(" · ")} className="flex min-w-0 gap-1">
      {stages.map((stage, index) => <Fragment key={stage}>{index > 0 && " "}
        <span data-pipeline-stage className="min-w-0 truncate rounded-full bg-ink/[0.06] px-1.5 text-ink-secondary">{stage}</span>
      </Fragment>)}
    </span>}
    {(pending || manual) && " "}
    {pending ? <span data-pipeline-pending title={t("teamPipeline.pendingHint")} className="shrink-0 text-ink-tertiary">{t("teamPipeline.pending")}</span>
      : manual && <span data-pipeline-manual title={t("teamPipeline.manualHint")} className="shrink-0 text-ink-tertiary">{t("teamPipeline.manual")}</span>}
  </span>;
}
