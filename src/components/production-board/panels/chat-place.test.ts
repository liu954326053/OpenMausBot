import { describe, expect, it } from "vitest";
import { placeChat } from "./chat-place";

const STAGE = { width: 1200, height: 800 };
const SIZE = { width: 420, height: 480 };

describe("where a bot's chat stands", () => {
  it("is to the right of its card, level with it, its arrow at the card's head", () => {
    expect(placeChat({ x: 100, y: 100, width: 320, height: 400 }, SIZE, STAGE, 0, 1)).toEqual({ sheet: false, left: 436, top: 100, arrowY: 36, side: "r" });
  });

  it("goes to the left when the right has no room, and keeps clear of the side panel", () => {
    expect(placeChat({ x: 800, y: 100, width: 320, height: 400 }, SIZE, STAGE, 0, 1)).toMatchObject({ left: 364, side: "l" });
    expect(placeChat({ x: 500, y: 100, width: 320, height: 400 }, SIZE, STAGE, 320, 1)).toMatchObject({ left: 64, side: "l" });
  });

  it("stays on the stage, without an arrow once it is no longer beside the card", () => {
    expect(placeChat({ x: 100, y: 760, width: 320, height: 400 }, SIZE, STAGE, 0, 1)).toMatchObject({ top: 308, side: "none" });
    expect(placeChat({ x: 100, y: 20, width: 320, height: 400 }, SIZE, STAGE, 0, 1)).toMatchObject({ top: 60 });
  });

  it("is a sheet at the bottom of a narrow stage, and docks at the right without a card in view", () => {
    expect(placeChat({ x: 0, y: 0, width: 320, height: 400 }, SIZE, { width: 700, height: 800 }, 0, 1)).toEqual({ sheet: true });
    expect(placeChat(null, SIZE, STAGE, 0, 1)).toEqual({ sheet: false, left: 768, top: 60, arrowY: 0, side: "none" });
  });
});
