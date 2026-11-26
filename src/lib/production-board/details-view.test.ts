import { describe, expect, it } from "vitest";
import { buildBoard } from "./board";
import { detailsLinks } from "./details-view";
import { productionBoardSample } from "@/testing/production-board-sample";

describe("what leads into a card and out of it", () => {
  it("are the cards at the other ends of its lines, a reference counted on the way in only", () => {
    const board = buildBoard(productionBoardSample({ episodes: 4 }));
    const titleOf = (cardId: string) => cardId;
    const brief = detailsLinks("brief", board, titleOf);
    expect(brief.upstream.map((link) => link.kind)).toEqual(["output"]);
    expect(brief.downstream.map((link) => link.kind)).toEqual(["handoff"]);
    for (const link of [...brief.upstream, ...brief.downstream]) {
      const other = board.cards.find((card) => card.id === link.cardId)!;
      expect(link).toMatchObject({ cardKind: other.kind, nodeId: other.nodeIds[0], botId: other.kind === "bot" ? other.botId : undefined, title: other.id });
    }
    const shot = board.cards.find((card) => card.kind === "shot" && card.references.length > 0)!;
    const links = detailsLinks(shot.id, board, titleOf);
    expect(links.upstream.some((link) => link.kind === "ref")).toBe(true);
    expect(links.downstream.every((link) => link.kind !== "ref")).toBe(true);
  });
});
