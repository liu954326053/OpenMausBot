import type { ServerResponse } from "node:http";
import { describe, expect, it } from "vitest";

import { botNodeId, type CanvasNode, type CanvasSnapshot } from "../../shared/project-canvas.ts";
import type { GenerationFailure, GenerationJob } from "../../shared/project-generation.ts";
import type { HelperToolContext } from "../routes/helper-tools.ts";
import { PASS } from "../routes/table.ts";
import { canvasStateText, createProjectCanvasToolRoutes, PROJECT_CANVAS_TOOL_PATHS } from "./agent-tools.ts";
import { CanvasRefusal, type ProjectCanvasService } from "./service.ts";

const node = (id: string, patch: Partial<CanvasNode> = {}): CanvasNode => ({ id, type: "text", title: id, position: { x: 0, y: 0 }, width: 340, height: 240, ...patch });

function snapshot(): CanvasSnapshot {
  return {
    projectId: "p1", revision: 7, viewport: { x: 0, y: 0, k: 1 }, backgroundMode: "dots",
    project: { id: "p1", name: "Stand-in bride", leadBotId: "lead", archived: false, folderState: "ready" },
    bots: {
      lead: { botId: "lead", name: "Lead", title: "Producer", lead: true, status: "working", placed: false },
      writer: { botId: "writer", name: "Writer", title: "Writes", lead: false, status: "idle", placed: true },
    },
    nodes: [
      node(botNodeId("lead"), { type: "bot", title: "Lead" }),
      node(botNodeId("writer"), { type: "bot", title: "Writer", position: { x: 880, y: 0 } }),
      node("brief", { title: "Brief", metadata: { content: "x".repeat(300) }, createdBy: { kind: "person" } }),
      node("outline", { title: "Outline", metadata: { content: "Act one" }, createdBy: { kind: "bot", botId: "writer" } }),
      node("shot", { type: "shot", title: "Shot", metadata: { prompt: "A bride" }, createdBy: { kind: "bot", botId: "lead" } }),
    ],
    connections: [
      { id: "dispatch:lead:writer", fromNodeId: botNodeId("lead"), toNodeId: botNodeId("writer"), kind: "dispatch" },
      { id: "c1", fromNodeId: "brief", toNodeId: botNodeId("writer"), kind: "content" },
      { id: "c2", fromNodeId: botNodeId("writer"), toNodeId: "outline", kind: "content" },
    ],
  };
}

describe("what a bot reads of its project's canvas", () => {
  it("is every bot and node in brief, long text shortened, who made each named from the bot's side", () => {
    const read = JSON.parse(canvasStateText(snapshot(), "writer", {}));
    expect(read.project).toEqual({ id: "p1", name: "Stand-in bride", revision: 7 });
    expect(read.you).toBe(botNodeId("writer"));
    expect(read.bots).toEqual([
      { id: botNodeId("lead"), name: "Lead", title: "Producer", lead: true, status: "working" },
      { id: botNodeId("writer"), name: "Writer", title: "Writes", status: "idle" },
    ]);
    expect(read.nodes.map((one: { id: string; createdBy: string }) => [one.id, one.createdBy])).toEqual([["brief", "person"], ["outline", "you"], ["shot", botNodeId("lead")]]);
    expect(read.nodes[0].metadata.content).toBe(`${"x".repeat(120)}...`);
    expect(read.connections).toHaveLength(3);
  });

  it("is one node in full with its connections, or in full what is connected to the bot's own node", () => {
    const one = JSON.parse(canvasStateText(snapshot(), "writer", { node_id: "brief" }));
    expect(one.node.metadata.content).toBe("x".repeat(300));
    expect(one.connections).toEqual([{ id: "c1", from: "brief", to: botNodeId("writer"), kind: "content" }]);
    const bot = JSON.parse(canvasStateText(snapshot(), "writer", { node_id: botNodeId("lead") }));
    expect(bot.node).toMatchObject({ id: botNodeId("lead"), name: "Lead", lead: true, status: "working" });
    const mine = JSON.parse(canvasStateText(snapshot(), "writer", { connected: true }));
    expect(mine.nodes.map((entry: { id: string }) => entry.id)).toEqual(["brief", "outline"]);
    expect(mine.nodes[0].metadata.content).toBe("x".repeat(300));
    expect(() => canvasStateText(snapshot(), "writer", { node_id: "gone" })).toThrow(CanvasRefusal);
  });

  it("says when the project is archived", () => {
    expect(JSON.parse(canvasStateText({ ...snapshot(), readOnly: "archived" }, "writer", {})).readOnly).toMatch(/archived/);
  });
});

describe("the bots' canvas routes", () => {
  function call(path: string, refuse: boolean, generated: Awaited<ReturnType<ProjectCanvasService["generate"]>> = { refused: failure("no_server") }) {
    const answers: Array<{ status: number; body: unknown }> = [];
    const asked: unknown[] = [];
    const service = {
      projectOfBot: () => {
        if (refuse) throw new CanvasRefusal(403, { error: "Only the bots of a project have its canvas." });
        return { id: "p1" };
      },
      botView: () => snapshot(),
      generate: async () => generated,
      nodeOf: (_projectId: string, nodeId: string) => snapshot().nodes.find((one) => one.id === nodeId),
    } as unknown as ProjectCanvasService;
    const cards = { ask: (request: unknown) => { asked.push(request); return { requestId: "r1", already: asked.length > 1 }; } };
    const ctx = {
      method: "POST", path, res: {} as ServerResponse, botId: "writer", threadId: "t1", readBody: async () => ({ node_id: "shot" }), folders: {},
      json: (_res: ServerResponse, status: number, body: unknown) => { answers.push({ status, body }); },
    } as unknown as HelperToolContext & { threadId: string };
    return { run: () => createProjectCanvasToolRoutes(service, cards)(ctx), answers, asked };
  }
  const failure = (code: GenerationFailure["code"]): GenerationFailure => ({ code, error: `Refused: ${code}.`, errorKey: `serverError.projectGeneration.${code}` });

  it("start a bot's generation, answer a refusal with generation's words and status, and put one past the ceiling on a card", async () => {
    const started = call(PROJECT_CANVAS_TOOL_PATHS.generate, false, { job: { id: "job-1" } as GenerationJob });
    await started.run();
    expect(started.answers).toEqual([{ status: 202, body: { text: expect.stringContaining("started (job job-1)") } }]);
    const refused = call(PROJECT_CANVAS_TOOL_PATHS.generate, false);
    await refused.run();
    expect(refused.answers).toEqual([{ status: 422, body: { error: "Refused: no_server." } }]);
    expect(refused.asked).toEqual([]);
    const past = call(PROJECT_CANVAS_TOOL_PATHS.generate, false, { refused: failure("confirmation_needed") });
    await past.run();
    await past.run();
    const asked = { projectId: "p1", botId: "writer", threadId: "t1", nodeId: "shot", title: "Shot", failure: failure("confirmation_needed") };
    expect(past.asked).toEqual([asked, asked]);
    expect(past.answers.map((one) => one.status)).toEqual([200, 200]);
    expect(past.answers[0]!.body).toEqual({ text: expect.stringMatching(/^Refused: confirmation_needed\. A card now asks the person to confirm it/) });
    expect(past.answers[1]!.body).toEqual({ text: expect.stringMatching(/^A card already asks the person/) });
  });

  it("refuse a bot that is not one of a project's bots in words, and pass every other path on", async () => {
    const refused = call(PROJECT_CANVAS_TOOL_PATHS.read, true);
    await refused.run();
    expect(refused.answers).toEqual([{ status: 403, body: { error: "Only the bots of a project have its canvas." } }]);
    const read = call(PROJECT_CANVAS_TOOL_PATHS.read, false);
    await read.run();
    expect(read.answers[0]!.status).toBe(200);
    expect(await call("/api/internal/helpers/decide", false).run()).toBe(PASS);
  });
});
