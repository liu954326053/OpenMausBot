import { describe, expect, it } from "vitest";
import type { BoardCard } from "@/lib/production-board/types";
import { ESTIMATED_HEIGHT } from "../engine/layout";
import { Heights } from "./heights";

const card = (id: string, kind: BoardCard["kind"]) => ({ id, kind, nodeIds: [id] }) as unknown as BoardCard;

describe("the heights the board measured", () => {
  it("are a card's own, else the last of its kind, else the mockup's", () => {
    const heights = new Heights();
    expect(heights.of(card("a", "shot"))).toBe(ESTIMATED_HEIGHT.shot);
    expect(heights.set("a", "shot", 301)).toBe(true);
    expect(heights.set("a", "shot", 301)).toBe(false);
    expect(heights.of(card("a", "shot"))).toBe(301);
    expect(heights.of(card("b", "shot"))).toBe(301);
    expect(heights.of(card("c", "scene"))).toBe(ESTIMATED_HEIGHT.scene);
  });
});
