import { describe, expect, it } from "vitest";

import type { DraftShot } from "./canvas.ts";
import { draftRefusalOf } from "./refusal.ts";
import { arrangedShots, orderFrom } from "./timeline.ts";

const shot = (shotId: string): DraftShot => ({ shotId, title: `Shot ${shotId}` });
const CANVAS = ["s1", "s2", "s3", "s4"].map(shot);
const ids = (shots: DraftShot[]) => shots.map((one) => one.shotId);
const refused = (run: () => unknown) => {
  try {
    run();
  } catch (error) {
    return draftRefusalOf(error);
  }
  return null;
};

describe("the order a film plays its shots in", () => {
  it("is the canvas's own, top to bottom, until someone sets one", () => {
    const arranged = arrangedShots(CANVAS, { order: [], leftOut: [] });
    expect(ids(arranged.playing)).toEqual(["s1", "s2", "s3", "s4"]);
    expect(arranged.leftOut).toEqual([]);
  });

  it("is the order set, with a shot nobody ordered after the ordered ones, in the canvas's order", () => {
    const arranged = arrangedShots([...CANVAS, shot("s5"), shot("s6")], { order: ["s3", "s1", "s2", "s4"], leftOut: [] });
    expect(ids(arranged.playing)).toEqual(["s3", "s1", "s2", "s4", "s5", "s6"]);
  });

  it("leaves out the shots left out, and forgets ones the canvas no longer has", () => {
    const arranged = arrangedShots(CANVAS, { order: ["s4", "gone", "s1"], leftOut: ["s2", "gone-too"] });
    expect(ids(arranged.playing)).toEqual(["s4", "s1", "s3"]);
    expect(ids(arranged.leftOut)).toEqual(["s2"]);
  });
});

describe("setting the order", () => {
  it("stores the shots named in their order and the canvas's other shots as left out", () => {
    expect(orderFrom(CANVAS, { shotIds: ["s3", "s1"] })).toEqual({ order: ["s3", "s1"], leftOut: ["s2", "s4"] });
    expect(orderFrom(CANVAS, { shotIds: [] })).toEqual({ order: [], leftOut: ["s1", "s2", "s3", "s4"] });
  });

  it("refuses an id that is not a shot of the project, naming it", () => {
    expect(refused(() => orderFrom(CANVAS, { shotIds: ["s1", "s9"] }))).toMatchObject({
      status: 422, body: { errorKey: "serverError.projectDraft.unknownShot", errorParams: { shot: "s9" } },
    });
  });

  it("refuses a shot named twice and anything that is not a list of ids", () => {
    for (const body of [{ shotIds: ["s1", "s1"] }, { shotIds: "s1" }, { shotIds: [1] }, {}, null, ["s1"]]) {
      expect(refused(() => orderFrom(CANVAS, body)), JSON.stringify(body)).toMatchObject({ status: 400, body: { errorKey: "serverError.projectDraft.orderInvalid" } });
    }
  });
});
