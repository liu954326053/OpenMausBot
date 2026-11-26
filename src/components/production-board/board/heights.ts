import type { BoardCard } from "@/lib/production-board/types";
import { ESTIMATED_HEIGHT } from "../engine/layout";

/** The heights the board measured: a card's own once it was drawn, else the last one of its kind, else the mockup's. */
export class Heights {
  readonly #ofCard = new Map<string, number>();
  readonly #ofKind = new Map<BoardCard["kind"], number>();

  /** True when the card's height changed. */
  set(cardId: string, kind: BoardCard["kind"], height: number): boolean {
    this.#ofKind.set(kind, height);
    if (this.#ofCard.get(cardId) === height) return false;
    this.#ofCard.set(cardId, height);
    return true;
  }

  readonly of = (card: BoardCard): number => this.#ofCard.get(card.id) ?? this.#ofKind.get(card.kind) ?? ESTIMATED_HEIGHT[card.kind];
}
