import { describe, expect, it } from "vitest";
import { placeChat } from "./chat-placement";

const layer = { width: 1440, height: 900 };
const size = { width: 400, height: 500 };
const card = { y: 200, width: 320, height: 240 };

describe("placeChat", () => {
  it("puts the window to the right of the card, clear of the side panel", () => {
    expect(placeChat({ anchor: { ...card, x: 100 }, size, layer, panelWidth: 288 })).toEqual({ mode: "beside", side: "right", x: 436, y: 200 });
  });

  it("flips to the card's left when the right has no room", () => {
    expect(placeChat({ anchor: { ...card, x: 700 }, size, layer, panelWidth: 288 })).toEqual({ mode: "beside", side: "left", x: 284, y: 200 });
    expect(placeChat({ anchor: { ...card, x: 1000 }, size, layer, panelWidth: 0 })).toEqual({ mode: "beside", side: "left", x: 584, y: 200 });
  });

  it("stays on the screen when neither side has room", () => {
    expect(placeChat({ anchor: { x: 300, y: 200, width: 700, height: 600 }, size, layer, panelWidth: 288 })).toEqual({ mode: "beside", side: "right", x: 724, y: 200 });
    expect(placeChat({ anchor: { ...card, x: 100, y: 700 }, size, layer, panelWidth: 288 })).toMatchObject({ mode: "beside", y: 388 });
    expect(placeChat({ anchor: { ...card, x: 100, y: -100 }, size, layer, panelWidth: 288 })).toMatchObject({ mode: "beside", y: 12 });
  });

  it("docks at the top beside the side panel when the card is not on the screen", () => {
    expect(placeChat({ anchor: null, size, layer, panelWidth: 288 })).toEqual({ mode: "docked", x: 724, y: 12 });
    expect(placeChat({ anchor: null, size, layer, panelWidth: 0 })).toEqual({ mode: "docked", x: 1028, y: 12 });
  });

  it("covers the side panel rather than leave the window no room", () => {
    expect(placeChat({ anchor: null, size: { width: 440, height: 500 }, layer: { width: 760, height: 600 }, panelWidth: 288 })).toEqual({ mode: "docked", x: 308, y: 12 });
  });

  it("becomes a sheet at the bottom of a narrow board", () => {
    expect(placeChat({ anchor: { ...card, x: 100 }, size, layer: { width: 700, height: 800 }, panelWidth: 288 })).toEqual({ mode: "sheet" });
  });
});
