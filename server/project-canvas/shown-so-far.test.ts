import { describe, expect, it } from "vitest";

import { botNodeId, type CanvasBotState, type CanvasNode, type CanvasSnapshot } from "../../shared/project-canvas.ts";
import type { PipelineRunWire } from "../../shared/pipeline-run.ts";
import { reachedBots, shownSoFar } from "./shown-so-far.ts";

const botNode = (botId: string, x: number): CanvasNode => ({ id: botNodeId(botId), type: "bot", title: botId, position: { x, y: 0 }, width: 300, height: 180 });
const state = (botId: string, extra: Partial<CanvasBotState> = {}): CanvasBotState => ({ botId, name: botId, title: "", lead: botId === "lead", stages: [], status: "idle", placed: false, ...extra });
const TEAM = ["lead", "writer", "designer", "editor"];

function snapshot(extra: Partial<CanvasSnapshot> = {}, states: Record<string, Partial<CanvasBotState>> = {}): CanvasSnapshot {
  return {
    projectId: "p1", revision: 1, viewport: { x: 0, y: 0, k: 1 }, backgroundMode: "dots",
    project: { id: "p1", name: "Drama", leadBotId: "lead", archived: false, folderState: "ready" },
    nodes: TEAM.map((botId, index) => botNode(botId, index * 420)),
    connections: [
      { id: "d1", fromNodeId: "bot:lead", toNodeId: "bot:writer", kind: "dispatch" },
      { id: "d2", fromNodeId: "bot:writer", toNodeId: "bot:designer", kind: "dispatch" },
      { id: "d3", fromNodeId: "bot:designer", toNodeId: "bot:editor", kind: "dispatch" },
    ],
    bots: Object.fromEntries(TEAM.map((botId) => [botId, state(botId, states[botId])])),
    ...extra,
  };
}
const run = (statuses: Array<PipelineRunWire["stages"][number]["status"]>): PipelineRunWire => ({
  id: "r1", startedAt: 1,
  stages: [
    { stage: "script", botIds: ["writer"], status: statuses[0]! },
    { stage: "character", botIds: ["designer"], status: statuses[1]! },
    { stage: "post", botIds: ["editor"], status: statuses[2]! },
  ],
  videos: { status: "waiting", shots: 0, ready: 0, failed: 0 },
});
const shownIds = (shown: CanvasSnapshot) => shown.nodes.map((node) => node.id);

describe("the bots the canvas shows the person", () => {
  it("is the lead alone while the work has reached nobody else, with no line", () => {
    const shown = shownSoFar(snapshot());
    expect([shownIds(shown), shown.connections]).toEqual([["bot:lead"], []]);
    expect(Object.keys(shown.bots)).toEqual(TEAM);
  });

  it("adds the bots of each stage of the run as it begins, with the lines between the bots shown", () => {
    const shown = shownSoFar(snapshot({ run: run(["done", "working", "waiting"]) }));
    expect(shownIds(shown)).toEqual(["bot:lead", "bot:writer", "bot:designer"]);
    expect(shown.connections.map((one) => one.id)).toEqual(["d1", "d2"]);
    expect(shownIds(shownSoFar(snapshot({ run: run(["done", "failed", "waiting"]) })))).toEqual(["bot:lead", "bot:writer", "bot:designer"]);
  });

  it("adds a bot that did or said something in the project, or that the person placed", () => {
    for (const [botId, extra] of [
      ["writer", { status: "working" }], ["writer", { status: "queued" }], ["writer", { status: "error" }],
      ["writer", { output: { text: "Done", threadId: "t", messageId: "m", at: 1 } }], ["designer", { placed: true }],
    ] as const) {
      expect([botId, extra, shownIds(shownSoFar(snapshot({}, { [botId]: extra })))]).toEqual([botId, extra, ["bot:lead", botNodeId(botId)]]);
    }
  });

  it("adds a bot that made something on the canvas, or that something on it is connected to", () => {
    const made: CanvasNode = { id: "script", type: "text", title: "Script", position: { x: 0, y: 400 }, width: 340, height: 240, createdBy: { kind: "bot", botId: "writer" } };
    const note: CanvasNode = { id: "note", type: "text", title: "Note", position: { x: 0, y: 800 }, width: 340, height: 240, createdBy: { kind: "person" } };
    const base = snapshot();
    expect(shownIds(shownSoFar({ ...base, nodes: [...base.nodes, made] }))).toEqual(["bot:lead", "bot:writer", "script"]);
    const connected = { ...base, nodes: [...base.nodes, note], connections: [...base.connections, { id: "c1", fromNodeId: "note", toNodeId: "bot:editor", kind: "content" as const }] };
    expect(shownIds(shownSoFar(connected))).toEqual(["bot:lead", "bot:editor", "note"]);
    expect(reachedBots(connected)).toEqual(new Set(["lead", "editor"]));
  });
});
