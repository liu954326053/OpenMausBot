import { useState } from "react";
import { AlertCircle, Check, ChevronRight, LoaderCircle } from "lucide-react";
import type { PipelineRunWire, PipelineStageStatus, PipelineVideosInput, PipelineVideosStatus } from "../../../shared/pipeline-run";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { canvasErrorText } from "@/lib/project-canvas/backend";
import { useCanvasUi } from "./canvas-ui";
import { stageLabel } from "./node-kinds";

type StepStatus = PipelineStageStatus | PipelineVideosStatus;

interface RunStep {
  key: string;
  label: string;
  status: StepStatus;
  /** How far the step is, beside its name. */
  count?: string;
}

/** The run's stages in order, the videos standing before post: they are what post waits for. */
function runSteps(run: PipelineRunWire): RunStep[] {
  const steps: RunStep[] = run.stages.map(({ stage, status }) => ({ key: stage, label: stageLabel(stage) ?? stage, status }));
  const { videos } = run;
  if (!videos.shots && videos.status === "waiting" && !run.stages.some(({ stage }) => stage === "storyboard")) return steps;
  const step: RunStep = { key: "videos", label: t("projectCanvas.run.videos"), status: videos.status, ...(videos.status === "working" ? { count: t("projectCanvas.run.videosCount", { ready: videos.ready, shots: videos.shots }) } : {}) };
  const post = steps.findIndex(({ key }) => key === "post");
  steps.splice(post < 0 ? steps.length : post, 0, step);
  return steps;
}

function statusText(status: StepStatus): string {
  switch (status) {
    case "waiting": return t("projectCanvas.run.status.waiting");
    case "working": return t("projectCanvas.run.status.working");
    case "done": return t("projectCanvas.run.status.done");
    case "failed": return t("projectCanvas.run.status.failed");
    case "confirm": return t("projectCanvas.run.status.confirm");
  }
}

const STEP_INK: Record<StepStatus, string> = {
  waiting: "text-ink-tertiary",
  working: "text-ink",
  done: "text-ink-secondary",
  failed: "text-danger",
  confirm: "font-medium text-ink",
};

function StepIcon({ status }: { status: StepStatus }) {
  if (status === "working") return <LoaderCircle size={14} aria-hidden="true" className="animate-spin motion-reduce:animate-none" />;
  if (status === "done") return <Check size={14} aria-hidden="true" />;
  if (status === "failed") return <AlertCircle size={14} aria-hidden="true" />;
  return null;
}

const counted = (count: number, many: Parameters<typeof t>[0], one: Parameters<typeof t>[0]) => (count === 1 ? t(one) : t(many, { count }));

/** Where the project's run stands, in a row under the canvas's top bar, with the one thing a run waits on the person
 * for: saying to generate the videos, or what to do about the shots that got none. */
export function PipelineRunBar() {
  const ui = useCanvasUi();
  const run = ui.snapshot.run;
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!run) return null;
  const { videos } = run;
  const answer = async (action: PipelineVideosInput["action"]) => {
    setSending(true);
    setError(null);
    try {
      await ui.controller.answerVideos(action);
    } catch (cause) {
      setError(t("projectCanvas.run.answerFailed", { reason: canvasErrorText(cause) }));
    } finally {
      setSending(false);
    }
  };
  const steps = runSteps(run);
  const asks = videos.status === "confirm" || videos.status === "failed";
  const disabled = ui.readOnly || sending;
  return (
    <div data-pipeline-run="" className="flex min-h-9 shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-b border-edge px-4 py-1">
      <ol aria-label={t("projectCanvas.run.title")} className="flex min-w-0 flex-wrap items-center gap-x-1 gap-y-1 text-[12px] leading-4">
        {steps.map((step, index) => (
          <li key={step.key} data-run-step={step.key} data-status={step.status} title={statusText(step.status)} className={cn("inline-flex items-center gap-1", STEP_INK[step.status])}>
            {index ? <ChevronRight size={14} aria-hidden="true" className="me-0.5 text-ink-tertiary rtl:-scale-x-100" /> : null}
            <StepIcon status={step.status} />
            <span data-run-label="">{step.label}</span>
            {step.count ? <span className="tabular-nums text-ink-secondary">{step.count}</span> : null}
            <span className="sr-only">{statusText(step.status)}</span>
          </li>
        ))}
      </ol>
      {asks ? (
        <div className="ms-auto flex min-w-0 flex-wrap items-center justify-end gap-x-2 gap-y-1">
          {error ? <span role="alert" className="min-w-0 text-[12px] leading-4 text-danger">{error}</span> : null}
          <span className="text-[13px] leading-[18px] text-ink-secondary tabular-nums">
            {videos.status === "confirm" ? counted(videos.shots, "projectCanvas.run.shots", "projectCanvas.run.shots.one") : counted(videos.failed, "projectCanvas.run.missing", "projectCanvas.run.missing.one")}
          </span>
          {videos.status === "confirm" ? (
            <button type="button" className="ui-button ui-button-sm ui-button-primary" disabled={disabled} onClick={() => void answer("start")}>
              {counted(videos.shots - videos.ready, "projectCanvas.run.generate", "projectCanvas.run.generate.one")}
            </button>
          ) : (
            <>
              <button type="button" className="ui-button ui-button-sm" disabled={disabled} onClick={() => void answer("retry")}>{t("projectCanvas.run.retry")}</button>
              <button type="button" className="ui-button ui-button-sm" disabled={disabled} onClick={() => void answer("skip")}>{t("projectCanvas.run.skip")}</button>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
