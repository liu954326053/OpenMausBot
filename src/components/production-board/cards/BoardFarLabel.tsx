import { cn } from "@/lib/cn";
import { BOARD_CARD_SIZES, type BoardCardKind } from "./sizes";
import { TONE_DOT, type BoardTone } from "./tone";

const FAR_LABEL_BASE = 0.86;
const FAR_LABEL_MAX_GROWTH = 13;

/** How much the far view's label is scaled on the board at `zoom`, so that it reads at about one size on screen. */
export const farLabelScale = (zoom: number): number => FAR_LABEL_BASE * Math.min(FAR_LABEL_MAX_GROWTH, Math.max(1, 1 / zoom));

export interface BoardFarLabelProps {
  kind: BoardCardKind;
  name: string;
  tone: BoardTone;
  /** The board's zoom. */
  zoom: number;
  statusLabel?: string;
}

/** What stands in a card's place when the board is zoomed too far out to read cards: its name and its state's colour. */
export function BoardFarLabel({ kind, name, tone, zoom, statusLabel }: BoardFarLabelProps) {
  const { width, height } = BOARD_CARD_SIZES[kind];
  return (
    <div data-board-far={kind} title={statusLabel ? `${name} · ${statusLabel}` : name} style={{ width, height }} className="flex items-center justify-center">
      <span
        data-far-pill=""
        style={{ transform: `scale(${farLabelScale(zoom)})` }}
        className="inline-flex max-w-[320px] items-center gap-1.5 whitespace-nowrap rounded-full border border-hairline bg-card px-2.5 py-1 text-[13px] font-medium leading-[18px] text-ink"
      >
        <span data-far-dot="" aria-hidden="true" className={cn("size-2 shrink-0 rounded-full", TONE_DOT[tone])} />
        <span data-far-name="" dir="auto" className="min-w-0 truncate">{name}</span>
        {statusLabel ? <span className="sr-only">{statusLabel}</span> : null}
      </span>
    </div>
  );
}
