// @vitest-environment happy-dom
import { act, createElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { buildBoard } from "@/lib/production-board/board";
import type { BoardOpened, BoardOverlayProps } from "@/lib/production-board/overlay";
import { BOARD_BOTS, productionBoardBackend, productionBoardSample } from "@/testing/production-board-sample";
import { click, render, useBoardPage } from "../testing/dom-kit";
import { ProductionBoardOverlay } from "./ProductionBoardOverlay";

useBoardPage();

async function draw(opened: BoardOpened | null) {
  const snapshot = productionBoardSample({ episodes: 4 });
  const props: BoardOverlayProps = {
    projectId: snapshot.project.id, snapshot, backend: productionBoardBackend(), board: buildBoard(snapshot), opened,
    open: vi.fn(), close: vi.fn(), anchorOf: () => ({ x: 100, y: 100, width: 320, height: 400 }), subscribeView: () => () => {}, zoom: () => 1,
    focusNode: vi.fn(), focusEpisode: vi.fn(), focusStage: vi.fn(),
  };
  const root = render(createElement("div", { className: "mj-board", style: { width: "1200px", height: "800px" } }, createElement(ProductionBoardOverlay, props)));
  await act(async () => { await Promise.resolve(); });
  return { root, props };
}

describe("what is drawn over the board", () => {
  it("is the side panel alone while nothing is open", async () => {
    const { root } = await draw(null);
    expect(root.querySelector("[data-board-room]")).not.toBeNull();
    expect(root.querySelector(".bchat")).toBeNull();
    expect(root.querySelector(".dm")).toBeNull();
  });

  it("is a bot's chat when a bot is open, and a card's details when a card is", async () => {
    expect((await draw({ kind: "bot", botId: BOARD_BOTS.lead })).root.querySelector(".bchat[data-board-chat]")).not.toBeNull();
    const details = await draw({ kind: "asset", nodeId: "brief" });
    expect(details.root.querySelector(".dm-box[data-board-asset='brief']")).not.toBeNull();
  });

  it("opens the chat of the bot a card belongs to, with the card as a reference, from the card's details", async () => {
    const snapshot = productionBoardSample({ episodes: 4 });
    const character = buildBoard(snapshot).cards.find((card) => card.kind === "character")!;
    const { root, props } = await draw({ kind: "asset", nodeId: character.nodeIds[0]! });
    click(root.querySelector(".dm-foot .btn-primary"));
    expect(props.open).toHaveBeenCalledWith({ kind: "bot", botId: expect.any(String), references: [character.nodeIds[0]] });
  });

  it("closes what is open when the bot or the card it shows is no longer there", async () => {
    const { props } = await draw({ kind: "bot", botId: "nobody" });
    expect(props.close).toHaveBeenCalled();
  });
});
