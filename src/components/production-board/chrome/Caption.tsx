import { t } from "@/lib/i18n";
import { BOARD_STAGES, type BoardStage } from "@/lib/production-board/overlay";
import { centredInRoom } from "./room";

export function Caption({ stage, insetEnd = 0 }: { stage: BoardStage | null; insetEnd?: number }) {
  return (
    <p className="caption" role="status" hidden={!stage} style={centredInRoom(insetEnd, 32, 560)}>
      {stage ? (
        <>
          <b>{t("productionBoard.caption.title", { number: BOARD_STAGES.indexOf(stage) + 1, name: t(`productionBoard.stage.${stage}`) })}</b>
          {t(`productionBoard.caption.${stage}`)}
        </>
      ) : null}
    </p>
  );
}
