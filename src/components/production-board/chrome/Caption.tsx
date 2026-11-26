import { t } from "@/lib/i18n";
import { BOARD_STAGES, type BoardStage } from "@/lib/production-board/overlay";

export function Caption({ stage }: { stage: BoardStage | null }) {
  return (
    <p className="caption" role="status" hidden={!stage}>
      {stage ? (
        <>
          <b>{t("productionBoard.caption.title", { number: BOARD_STAGES.indexOf(stage) + 1, name: t(`productionBoard.stage.${stage}`) })}</b>
          {t(`productionBoard.caption.${stage}`)}
        </>
      ) : null}
    </p>
  );
}
