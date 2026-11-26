import { vi } from "vitest";
import { buildBoard } from "@/lib/production-board/board";
import type { BoardCard } from "@/lib/production-board/types";
import { PRODUCTION_BOARD_LOOKS, productionBoardSample, type ProductionBoardSampleOptions } from "@/testing/production-board-sample";
import type { NodeActions, NodeContext } from "../nodes/parts";

/** The sample drama's board with every episode in work unfolded, and a context whose actions record their calls. */
export function boardFixture(options: ProductionBoardSampleOptions = { episodes: 4 }) {
  const snapshot = productionBoardSample(options);
  const board = buildBoard(snapshot);
  const actions = { focusCard: vi.fn(), openChat: vi.fn(), openStack: vi.fn(), generate: vi.fn(), selectTake: vi.fn(), retry: vi.fn(), openDraft: vi.fn() } satisfies NodeActions;
  const takeOf: NodeContext["takeOf"] = (shotId) => {
    const result = board.cards.find((card) => card.kind === "result" && card.shotId === shotId);
    return result?.kind === "result" ? result.takes.find((take) => take.selected) ?? result.takes.at(-1) : undefined;
  };
  const ctx: NodeContext = { snapshot, looks: PRODUCTION_BOARD_LOOKS, fileUrl: (file) => `/files/${file.path}`, takeOf, actions };
  const cardOf = <Kind extends BoardCard["kind"]>(kind: Kind, where: (card: Extract<BoardCard, { kind: Kind }>) => boolean = () => true) =>
    board.cards.find((card): card is Extract<BoardCard, { kind: Kind }> => card.kind === kind && where(card as Extract<BoardCard, { kind: Kind }>))!;
  return { snapshot, board, ctx, actions, cardOf };
}
