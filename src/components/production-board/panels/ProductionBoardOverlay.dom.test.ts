// @vitest-environment happy-dom
import { act } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { renderOverlay, type OverlayHarness } from "./testing/render-overlay";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let harness: OverlayHarness;

afterEach(() => {
  harness.unmount();
});

const poke = (element: Element) => act(async () => {
  element.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
  element.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
  element.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
  element.dispatchEvent(new WheelEvent("wheel", { bubbles: true }));
});

describe("the board's overlay", () => {
  it("keeps pointers, double and right clicks and the wheel on its panel, chat and details from the board under it", async () => {
    harness = await renderOverlay();
    await poke(harness.board);
    expect(harness.boardHeard.splice(0)).toEqual(["pointerdown", "dblclick", "contextmenu", "wheel"]);

    await poke(harness.host.querySelector("[role=tab]")!);
    await harness.update({ opened: { kind: "bot", botId: "writer" } });
    await poke(harness.host.querySelector("[data-board-chat] textarea")!);
    await harness.update({ opened: { kind: "asset", nodeId: "profile-qingwu" } });
    await poke(document.querySelector("[data-board-asset] h2")!);
    expect(harness.boardHeard).toEqual([]);
  });
});
