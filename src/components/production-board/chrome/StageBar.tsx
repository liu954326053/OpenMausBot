import { Fragment } from "react";
import { t } from "@/lib/i18n";
import { BOARD_STAGES, type BoardStage } from "@/lib/production-board/overlay";
import type { BoardStageState } from "@/lib/production-board/types";

export const stageState = (state: BoardStageState): "done" | "active" | "failed" | undefined => (state === "wait" ? undefined : state);

export function StageBar({ stages, current, insetEnd, onStage }: {
  stages: Record<BoardStage, BoardStageState>;
  /** The stage the view is on, if any. */
  current?: BoardStage;
  /** What the side panel takes of the board's width, so the bar centres in the room beside it. */
  insetEnd: number;
  onStage(stage: BoardStage): void;
}) {
  return (
    <nav
      className="stagebar"
      aria-label={t("productionBoard.stages.label")}
      style={{ maxWidth: `calc(100% - 24px - ${insetEnd}px)`, ...(insetEnd > 0 ? { left: `calc((100% - ${insetEnd}px) / 2)` } : {}) }}
    >
      {BOARD_STAGES.map((stage, at) => {
        const name = t(`productionBoard.stage.${stage}`);
        return (
          <Fragment key={stage}>
            {at > 0 ? <span className="schip-sep" aria-hidden="true" /> : null}
            <button
              type="button"
              className="schip"
              data-state={stageState(stages[stage])}
              aria-current={current === stage ? "true" : "false"}
              aria-label={`${name} · ${t(`productionBoard.stageState.${stages[stage]}`)}`}
              onClick={() => onStage(stage)}
            >
              <span className="fno" aria-hidden="true">{at + 1}</span>
              {name}
            </button>
          </Fragment>
        );
      })}
    </nav>
  );
}
