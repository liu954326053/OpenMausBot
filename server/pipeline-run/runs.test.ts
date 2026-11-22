import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { ProjectDraftWire } from "../../shared/project-draft.ts";
import type { FlowStage } from "../../shared/team-pipeline.ts";
import type { TeamProjectWire } from "../../shared/team-projects.ts";
import type { DirectSendReceipt } from "../direct-send.ts";
import type { PipelineShot } from "../project-canvas/pipeline-api.ts";
import { canvasRefusalOf } from "../project-canvas/service.ts";
import { serverLine } from "../server-lines.ts";
import type { Message } from "../store.ts";
import { PipelineRuns, type PipelineRunsDeps } from "./runs.ts";
import { PipelineRunFiles } from "./store.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const NAMES: Record<string, string> = { lead: "Mo", writer: "Ink", designer: "Jade", painter: "Hue", boarder: "Frame", editor: "Cut" };
const STAGES: Record<string, FlowStage[]> = { lead: ["lead"], writer: ["script"], designer: ["character"], boarder: ["storyboard"], editor: ["post"] };

const main = (botId: string) => `${botId}-main`;
const ROOM = "room-thread";
const flush = async () => {
  for (let tick = 0; tick < 10; tick += 1) await new Promise((resolve) => setImmediate(resolve));
};

function shot(shotId: string, take: boolean, status: PipelineShot["status"] = "idle"): PipelineShot {
  return {
    shotId, title: shotId, prompt: `${shotId} prompt`, creationNodeId: `${shotId}-make`, status, takes: take ? 1 : 0,
    take: take ? { nodeId: `${shotId}-take`, title: `${shotId}.mp4`, file: { path: `${shotId}.mp4`, mime: "video/mp4", bytes: 10, name: `${shotId}.mp4` } } : null,
  };
}

/** `room`: the project has a group chat, with these of its bots in it. */
function setup(options: { stages?: Record<string, FlowStage[]>; dataDir?: string; room?: string[] } = {}) {
  const dataDir = options.dataDir ?? mkdtempSync(join(tmpdir(), "omb-pipeline-runs-"));
  if (!options.dataDir) dirs.push(dataDir);
  const stages = options.stages ?? STAGES;
  const project: TeamProjectWire = {
    id: "p1", name: "Bride", folder: "/projects/Bride", leadBotId: "lead", createdAt: 1, folderState: "ready",
    botIds: Object.keys(stages), follows: {}, ...(options.room ? { roomId: "room" } : {}),
  } as unknown as TeamProjectWire;
  let clock = 1_000;
  let ids = 0;
  const paths = new Map<string, Message[]>();
  const append = (threadId: string, message: Omit<Message, "id" | "at">): Message => {
    clock += 10;
    ids += 1;
    const row = { ...message, id: `m${ids}`, at: clock } as Message;
    paths.set(threadId, [...(paths.get(threadId) ?? []), row]);
    return row;
  };
  const sent: Array<{ botId: string; threadId: string; text: string; leadBotId: string }> = [];
  const roomSent: Array<{ to: Array<{ botId: string; text: string }>; leadBotId: string }> = [];
  const busy = new Set<string>();
  const waiting = new Set<string>();
  const state = {
    shots: [] as PipelineShot[],
    texts: [] as Array<{ nodeId: string; botId?: string }>,
    scripts: [] as string[],
    added: [] as Array<{ botId: string; title: string; content: string }>,
    generated: [] as string[],
    drafted: 0,
    playOnly: [] as string[][],
    draft: undefined as ProjectDraftWire | undefined,
    refreshed: 0,
    lines: [] as string[],
  };
  const deps: PipelineRunsDeps = {
    projects: { list: () => [project] },
    store: {
      bot: (botId: string) => (NAMES[botId] ? { id: botId, name: NAMES[botId], threadId: main(botId), teamProject: { id: "p1" } } : null),
      botByThread: (threadId: string) => {
        const botId = threadId.split("-")[0]!;
        return NAMES[botId] ? { id: botId, name: NAMES[botId], threadId: main(botId), teamProject: { id: "p1" } } : null;
      },
      activePath: (threadId: string) => paths.get(threadId) ?? [],
      appendMessage: (threadId: string, message: Omit<Message, "id" | "at">) => append(threadId, message),
    } as unknown as PipelineRunsDeps["store"],
    flowOf: () => ({ botIds: project.botIds, stages }),
    canvas: {
      shots: () => state.shots.map((one) => ({ ...one })),
      textNodes: () => [...state.texts],
      addText: (_projectId, botId, title, content) => {
        state.added.push({ botId, title, content });
        state.texts.push({ nodeId: `added-${state.added.length}`, botId });
        return { nodeId: `added-${state.added.length}` };
      },
      markScript: (_projectId, nodeId) => state.scripts.push(nodeId),
      taskFor: async (_project, botId, request) => `${request}\n\n[what is connected to ${botId}]`,
      generate: async (_project, creationNodeId) => {
        state.generated.push(creationNodeId);
        state.shots = state.shots.map((one) => (one.creationNodeId === creationNodeId ? { ...one, status: "loading" } : one));
        return true;
      },
    },
    draft: {
      writeDraftIfReady: async () => {
        state.drafted += 1;
        if (state.shots.length && state.shots.every((one) => one.take)) state.draft = { state: "written", name: "Bride", exportFolder: "/projects/Bride/output" };
      },
      playOnly: async (_projectId, shotIds) => {
        state.playOnly.push([...shotIds]);
      },
      draft: () => state.draft,
    },
    deliver: async (message): Promise<DirectSendReceipt> => {
      sent.push(message);
      if (busy.has(message.threadId)) return { ok: true, queued: true, queueId: `q-${sent.length}`, threadId: message.threadId };
      return { ok: true, threadId: message.threadId, message: append(message.threadId, { role: "user", kind: "text", text: message.text }) };
    },
    room: (one) => (one.roomId && options.room ? { groupId: one.roomId, threadId: ROOM, memberIds: options.room } : undefined),
    projectOfRoom: (threadId) => (options.room && threadId === ROOM ? "p1" : undefined),
    deliverToRoom: async ({ room, to, leadBotId }): Promise<DirectSendReceipt> => {
      roomSent.push({ to, leadBotId });
      if (busy.has(room.threadId)) return { ok: true, queued: true, queueId: `rq-${roomSent.length}`, threadId: room.threadId };
      const text = to.map((one) => `@${NAMES[one.botId]} ${one.text}`).join("\n\n");
      return { ok: true, threadId: room.threadId, message: append(room.threadId, { role: "user", kind: "text", text }) };
    },
    mainThread: main,
    waitingOnPerson: (_botId, threadId) => waiting.has(threadId),
    language: () => undefined,
    files: new PipelineRunFiles(join(dataDir, "pipeline-runs"), (line) => state.lines.push(line)),
    changed: () => {
      state.refreshed += 1;
    },
    now: () => clock,
    newId: () => `run-${ids}`,
    log: (line) => state.lines.push(line),
  };
  const runs = new PipelineRuns(deps);

  const hear = async (threadId: string, message: Omit<Message, "id" | "at">) => {
    const row = append(threadId, message);
    runs.heard(threadId, row);
    await flush();
    return row;
  };
  const world = {
    project, runs, deps, sent, roomSent, busy, waiting, state, paths, dataDir,
    hear,
    /** The lead hands a bot its task with coordinate_bots: the line it leaves in the bot's new conversation. */
    handOff: (botId: string, threadId = `${botId}-handoff`) => hear(threadId, { role: "bot", kind: "text", text: "Write the script.", roomRequest: { id: `r-${botId}`, phase: "request" }, from: { botId: "lead" } } as Omit<Message, "id" | "at">),
    /** The hand-off's end, in the lead's conversation. */
    handBack: (botId: string, ok: boolean, threadId = `${botId}-handoff`) => hear(main("lead"), {
      role: "bot", kind: "activity", roomRequest: { id: `r-${botId}`, phase: "result" }, from: { botId }, tool: { name: "coordinate_bots", ok, output: "done" },
      threadRef: { botId, threadId, title: "Script" },
    } as Omit<Message, "id" | "at">),
    /** A turn's last reply, settled. */
    reply: (threadId: string, text: string, ok = true) => hear(threadId, { role: "bot", kind: "text", text, turnTerminal: true, turnSucceeded: ok } as Omit<Message, "id" | "at">),
    /** The row a failed turn ends with. */
    fail: (threadId: string) => hear(threadId, { role: "bot", kind: "activity", tool: { name: "error: the engine stopped answering", ok: false } } as Omit<Message, "id" | "at">),
    /** In the group chat: a hand-off from `from`, which runs there. */
    roomHandOff: (botIds: string[], from = "lead") => hear(ROOM, {
      role: "bot", kind: "text", text: `${botIds.map((id) => `@${NAMES[id]}`).join(" ")} Write the script.`,
      roomRequest: { id: `r-room-${botIds.join("-")}`, phase: "request", botIds }, from: { botId: from },
    } as Omit<Message, "id" | "at">),
    /** In the group chat: the last reply of `botId`'s turn, settled. */
    roomReply: (botId: string, text: string, ok = true) => hear(ROOM, { role: "bot", kind: "text", text, turnTerminal: true, turnSucceeded: ok, from: { botId } } as Omit<Message, "id" | "at">),
    roomFail: (botId: string) => hear(ROOM, { role: "bot", kind: "activity", tool: { name: "error: the engine stopped answering", ok: false }, from: { botId } } as Omit<Message, "id" | "at">),
    statuses: () => runs.wire("p1")?.stages.map(({ stage, status }) => `${stage}:${status}`),
    notes: (threadId = main("lead")) => (paths.get(threadId) ?? []).filter((row) => row.kind === "activity" && row.tool?.name.startsWith("Pipeline")).map((row) => row.tool!.name),
    toLead: () => sent.filter((one) => one.botId === "lead").map((one) => one.text),
    toLeadInRoom: () => roomSent.filter((one) => one.to.some((to) => to.botId === "lead")).map((one) => one.to.map((to) => to.text).join("\n\n")),
  };
  return world;
}

/** The run of `world` up to the stage after the script, the script bot having written its script node. */
async function pastScript(world: ReturnType<typeof setup>) {
  await world.handOff("writer");
  world.state.texts.push({ nodeId: "script-1", botId: "writer" });
  await world.reply("writer-handoff", "The script is on the canvas.");
  await world.handBack("writer", true);
}

describe("a pipeline run", () => {
  it("starts when the lead hands the first stage its task, and each stage's end gives the next one its task, up to the draft", async () => {
    const world = setup();
    await world.handOff("writer");
    expect(world.statuses()).toEqual(["script:working", "character:waiting", "storyboard:waiting", "post:waiting"]);
    expect(world.runs.wire("p1")?.videos).toEqual({ status: "waiting", shots: 0, ready: 0, failed: 0 });

    world.state.texts.push({ nodeId: "script-1", botId: "writer" });
    await world.reply("writer-handoff", "The script is on the canvas.");
    expect(world.statuses()?.[0]).toBe("script:working");
    await world.handBack("writer", true);
    expect(world.state.scripts).toEqual(["script-1"]);
    expect(world.statuses()).toEqual(["script:done", "character:working", "storyboard:waiting", "post:waiting"]);
    const character = world.sent.at(-1)!;
    expect(character).toMatchObject({ botId: "designer", threadId: "designer-main", leadBotId: "lead" });
    expect(character.text).toBe(`${serverLine(undefined, "server.pipelineRun.task.character", { project: "Bride", lead: "Mo" })}\n\n[what is connected to designer]`);

    await world.reply("designer-main", "Three characters are on the canvas.");
    expect(world.statuses()).toEqual(["script:done", "character:done", "storyboard:working", "post:waiting"]);
    expect(world.sent.at(-1)).toMatchObject({ botId: "boarder", threadId: "boarder-main" });

    world.state.shots = [shot("s1", false), shot("s2", false)];
    await world.reply("boarder-main", "Two shots.");
    expect(world.statuses()).toEqual(["script:done", "character:done", "storyboard:done", "post:waiting"]);
    expect(world.runs.wire("p1")?.videos).toEqual({ status: "confirm", shots: 2, ready: 0, failed: 0 });

    const answered = await world.runs.answerVideos("p1", { action: "start" });
    expect(world.state.generated).toEqual(["s1-make", "s2-make"]);
    expect(answered.videos.status).toBe("working");

    world.state.shots = [shot("s1", true), shot("s2", true)];
    world.runs.canvasEvent({ kind: "take", projectId: "p1", shotId: "s2", creationNodeId: "s2-make", jobId: "j2", ok: true, nodeId: "s2-take" });
    await flush();
    expect(world.runs.wire("p1")?.videos).toEqual({ status: "done", shots: 2, ready: 2, failed: 0 });
    expect(world.statuses()?.[3]).toBe("post:working");
    expect(world.state.drafted).toBe(1);
    expect(world.sent.at(-1)!.text).toContain(serverLine(undefined, "server.pipelineRun.task.post", { project: "Bride", lead: "Mo", draft: "Bride" }));

    await world.reply("editor-main", "The order is right.");
    expect(world.statuses()).toEqual(["script:done", "character:done", "storyboard:done", "post:done"]);
    expect(world.runs.wire("p1")?.endedAt).toBeTypeOf("number");
    expect(world.state.drafted).toBe(2);
    expect(world.toLead()).toEqual([serverLine(undefined, "server.pipelineRun.lead.done", { project: "Bride", draft: "Bride" })]);
    expect(world.notes()).toEqual([
      serverLine(undefined, "server.pipelineRun.note.stageDone", { stage: "script" }),
      serverLine(undefined, "server.pipelineRun.note.started", { stage: "character design", bots: "Jade" }),
      serverLine(undefined, "server.pipelineRun.note.stageDone", { stage: "character design" }),
      serverLine(undefined, "server.pipelineRun.note.started", { stage: "storyboard", bots: "Frame" }),
      serverLine(undefined, "server.pipelineRun.note.stageDone", { stage: "storyboard" }),
      "Pipeline: 2 shots are ready to generate. Confirm on the canvas to start.",
      serverLine(undefined, "server.pipelineRun.note.videosDone"),
      serverLine(undefined, "server.pipelineRun.note.started", { stage: "post-production", bots: "Cut" }),
      serverLine(undefined, "server.pipelineRun.note.stageDone", { stage: "post-production" }),
    ]);
  });

  it("makes the script bot's reply the script when it added no text node during the stage", async () => {
    const world = setup();
    world.state.texts.push({ nodeId: "older", botId: "writer" });
    await world.handOff("writer");
    await world.reply("writer-handoff", "EXT. HARBOUR — NIGHT. The bride runs.");
    await world.handBack("writer", true);
    expect(world.state.added).toEqual([{ botId: "writer", title: "Script", content: "EXT. HARBOUR — NIGHT. The bride runs." }]);
    expect(world.state.scripts).toEqual(["added-1"]);
  });

  it("stops at a stage whose turn failed and goes back to the lead; a later good turn in that conversation goes on", async () => {
    const world = setup();
    await pastScript(world);
    await world.fail("designer-main");
    expect(world.statuses()).toEqual(["script:done", "character:failed", "storyboard:waiting", "post:waiting"]);
    expect(world.toLead()).toEqual([serverLine(undefined, "server.pipelineRun.lead.stageFailed", { project: "Bride", stage: "character design", bots: "Jade" })]);

    await world.reply("designer-main", "Done after all.");
    expect(world.statuses()).toEqual(["script:done", "character:done", "storyboard:working", "post:waiting"]);
  });

  it("counts a stopped turn's end, and a reply that ended badly, as the task not done", async () => {
    const world = setup();
    await pastScript(world);
    await world.reply("designer-main", "I could not finish.", false);
    expect(world.statuses()?.[1]).toBe("character:failed");
  });

  it("waits while the bot's turn ended asking the person, and goes on with the turn after the answer", async () => {
    const world = setup();
    await pastScript(world);
    world.waiting.add("designer-main");
    await world.reply("designer-main", "Should the bride be older?");
    expect(world.statuses()?.[1]).toBe("character:working");
    world.waiting.delete("designer-main");
    await world.reply("designer-main", "Three characters are on the canvas.");
    expect(world.statuses()?.[1]).toBe("character:done");
  });

  it("starts counting a task that waited behind a running turn once it joins the conversation", async () => {
    const world = setup();
    world.busy.add("designer-main");
    await pastScript(world);
    expect(world.statuses()?.[1]).toBe("character:working");
    await world.reply("designer-main", "The earlier task is done.");
    expect(world.statuses()?.[1]).toBe("character:working");

    expect(world.sent.map((one) => one.botId)).toEqual(["designer"]);
    await world.hear("designer-main", { role: "user", kind: "text", text: "the task", queueId: "q-1" } as Omit<Message, "id" | "at">);
    await world.reply("designer-main", "Three characters are on the canvas.");
    expect(world.statuses()?.[1]).toBe("character:done");
  });

  it("retries the shots whose video failed, or goes on without them and leaves them out of the film", async () => {
    const world = setup();
    await pastScript(world);
    await world.reply("designer-main", "Characters done.");
    world.state.shots = [shot("s1", false), shot("s2", false)];
    await world.reply("boarder-main", "Two shots.");
    await world.runs.answerVideos("p1", { action: "start" });

    world.state.shots = [shot("s1", true), shot("s2", false, "error")];
    world.runs.canvasEvent({ kind: "take", projectId: "p1", shotId: "s2", creationNodeId: "s2-make", jobId: "j2", ok: false, cancelled: false });
    await flush();
    expect(world.runs.wire("p1")?.videos).toEqual({ status: "failed", shots: 2, ready: 1, failed: 1 });
    expect(world.notes().at(-1)).toBe("Pipeline: 1 shot has no video. Retry it on the canvas, or go on without it.");

    world.state.generated = [];
    await world.runs.answerVideos("p1", { action: "retry" });
    expect(world.state.generated).toEqual(["s2-make"]);
    world.state.shots = [shot("s1", true), shot("s2", false, "error")];
    world.runs.canvasEvent({ kind: "take", projectId: "p1", shotId: "s2", creationNodeId: "s2-make", jobId: "j3", ok: false, cancelled: false });
    await flush();
    expect(world.runs.wire("p1")?.videos.status).toBe("failed");

    const skipped = await world.runs.answerVideos("p1", { action: "skip" });
    expect(world.state.playOnly).toEqual([["s1"]]);
    expect(skipped.videos.status).toBe("done");
    expect(world.statuses()?.[3]).toBe("post:working");
  });

  it("goes on when the person generated every shot themselves while it asked", async () => {
    const world = setup();
    await pastScript(world);
    await world.reply("designer-main", "Characters done.");
    world.state.shots = [shot("s1", false)];
    await world.reply("boarder-main", "One shot.");
    world.state.shots = [shot("s1", true)];
    world.runs.canvasEvent({ kind: "selected", projectId: "p1", shotId: "s1", nodeId: "s1-take" });
    await flush();
    expect(world.runs.wire("p1")?.videos.status).toBe("done");
    expect(world.statuses()?.[3]).toBe("post:working");
  });

  it("goes back to the lead when the storyboard ends with no shot on the canvas", async () => {
    const world = setup();
    await pastScript(world);
    await world.reply("designer-main", "Characters done.");
    await world.reply("boarder-main", "Done.");
    expect(world.statuses()?.[2]).toBe("storyboard:failed");
    expect(world.toLead().at(-1)).toBe(serverLine(undefined, "server.pipelineRun.lead.noShots", { project: "Bride", bots: "Frame" }));
  });

  it("refuses an answer it is not waiting for, one it does not know, and any for an archived project", async () => {
    const world = setup();
    const refused = async (body: unknown) => canvasRefusalOf(await world.runs.answerVideos("p1", body).then(() => null, (error: unknown) => error));
    expect(await refused({ action: "start" })).toMatchObject({ status: 409, body: { errorKey: "serverError.pipelineRun.notWaiting" } });
    expect(await refused({ action: "go" })).toMatchObject({ status: 400, body: { errorKey: "serverError.pipelineRun.actionInvalid" } });
    await pastScript(world);
    expect(await refused({ action: "skip" })).toMatchObject({ status: 409 });
    (world.project as { archivedAt?: number }).archivedAt = 5;
    expect(await refused({ action: "start" })).toMatchObject({ status: 409, body: { code: "canvas_read_only" } });
  });

  it("starts nothing for a hand-off from another bot, or to a bot outside the first stage", async () => {
    const world = setup();
    await world.hear("designer-handoff", { role: "bot", kind: "text", text: "x", roomRequest: { id: "r", phase: "request" }, from: { botId: "lead" } } as Omit<Message, "id" | "at">);
    await world.hear("writer-handoff", { role: "bot", kind: "text", text: "x", roomRequest: { id: "r", phase: "request" }, from: { botId: "designer" } } as Omit<Message, "id" | "at">);
    expect(world.runs.wire("p1")).toBeUndefined();
  });

  it("starts again when the lead hands the first stage a task after a stage failed", async () => {
    const world = setup();
    await pastScript(world);
    await world.fail("designer-main");
    const first = world.runs.wire("p1")!.id;
    await world.handOff("writer", "writer-again");
    expect(world.runs.wire("p1")!.id).not.toBe(first);
    expect(world.statuses()).toEqual(["script:working", "character:waiting", "storyboard:waiting", "post:waiting"]);
  });

  it("starts again when the lead hands the first stage a task while the run waits for the person about the videos, and not while a stage works", async () => {
    const world = setup();
    await pastScript(world);
    const first = world.runs.wire("p1")!.id;
    await world.handOff("writer", "writer-meanwhile");
    expect(world.runs.wire("p1")!.id).toBe(first);

    await world.reply("designer-main", "Characters done.");
    world.state.shots = [shot("s1", false)];
    await world.reply("boarder-main", "One shot.");
    expect(world.runs.wire("p1")?.videos.status).toBe("confirm");
    await world.handOff("writer", "writer-again");
    expect(world.runs.wire("p1")!.id).not.toBe(first);
    expect(world.statuses()?.[0]).toBe("script:working");
  });

  it("goes from the stages before post straight to it when the team has no storyboard, and ends without a draft", async () => {
    const world = setup({ stages: { lead: ["lead"], writer: ["script"], editor: ["post"] } });
    await pastScript(world);
    expect(world.statuses()).toEqual(["script:done", "post:working"]);
    expect(world.sent.at(-1)!.text).toContain(serverLine(undefined, "server.pipelineRun.task.postNoDraft", { project: "Bride", lead: "Mo" }));
    await world.reply("editor-main", "Done.");
    expect(world.toLead()).toEqual([serverLine(undefined, "server.pipelineRun.lead.doneNoDraft", { project: "Bride" })]);
  });

  it("is kept across a restart, and a turn that ended while the server was down ends its task", async () => {
    const world = setup();
    await pastScript(world);
    const row = { id: "late", at: 99_999, role: "bot", kind: "text", text: "Characters done.", turnTerminal: true, turnSucceeded: true } as Message;
    world.paths.set("designer-main", [...(world.paths.get("designer-main") ?? []), row]);

    const again = new PipelineRuns(world.deps);
    expect(again.wire("p1")?.stages.map(({ status }) => status)).toEqual(["done", "working", "waiting", "waiting"]);
    await again.resume();
    expect(again.wire("p1")?.stages.map(({ status }) => status)).toEqual(["done", "done", "working", "waiting"]);
  });
});

describe("a pipeline run in the project's group chat", () => {
  const ALL = Object.keys(STAGES);

  it("starts at the lead's hand-off there, and gives each next stage its task there, with the run's lines", async () => {
    const world = setup({ room: ALL });
    await world.roomHandOff(["writer"]);
    expect(world.statuses()).toEqual(["script:working", "character:waiting", "storyboard:waiting", "post:waiting"]);

    await world.roomReply("lead", "I asked Ink for the script.");
    expect(world.statuses()?.[0]).toBe("script:working");
    world.state.texts.push({ nodeId: "script-1", botId: "writer" });
    await world.roomReply("writer", "The script is on the canvas.");
    expect(world.statuses()).toEqual(["script:done", "character:working", "storyboard:waiting", "post:waiting"]);
    expect(world.state.scripts).toEqual(["script-1"]);
    expect(world.sent).toEqual([]);
    const task = serverLine(undefined, "server.pipelineRun.task.character", { project: "Bride", lead: "Mo" });
    expect(world.roomSent).toEqual([{ to: [{ botId: "designer", text: `${task}\n\n[what is connected to designer]` }], leadBotId: "lead" }]);

    await world.roomReply("designer", "Three characters are on the canvas.");
    expect(world.statuses()?.[1]).toBe("character:done");
    expect(world.roomSent.at(-1)!.to.map((one) => one.botId)).toEqual(["boarder"]);
    expect(world.notes(ROOM)).toEqual([
      serverLine(undefined, "server.pipelineRun.note.stageDone", { stage: "script" }),
      serverLine(undefined, "server.pipelineRun.note.started", { stage: "character design", bots: "Jade" }),
      serverLine(undefined, "server.pipelineRun.note.stageDone", { stage: "character design" }),
      serverLine(undefined, "server.pipelineRun.note.started", { stage: "storyboard", bots: "Frame" }),
    ]);
    expect(world.notes()).toEqual([]);
  });

  it("starts nothing for a hand-off there from a bot other than the lead", async () => {
    const world = setup({ room: ALL });
    await world.roomHandOff(["writer"], "designer");
    expect(world.runs.wire("p1")).toBeUndefined();
  });

  it("gives a stage's bots their tasks in one line, and ends the stage once each has answered", async () => {
    const stages: Record<string, FlowStage[]> = { lead: ["lead"], writer: ["script"], designer: ["character"], painter: ["character"], boarder: ["storyboard"] };
    const world = setup({ stages, room: Object.keys(stages) });
    await world.roomHandOff(["writer"]);
    await world.roomReply("writer", "The script.");
    expect(world.roomSent.at(-1)!.to.map((one) => one.botId)).toEqual(["designer", "painter"]);
    await world.roomReply("designer", "Jade's characters.");
    expect(world.statuses()?.[1]).toBe("character:working");
    await world.roomReply("painter", "Hue's characters.");
    expect(world.statuses()?.[1]).toBe("character:done");
  });

  it("counts a task that waited in the room's queue from the moment it joins the room", async () => {
    const world = setup({ room: ALL });
    world.busy.add(ROOM);
    await world.roomHandOff(["writer"]);
    await world.roomReply("writer", "The script.");
    expect(world.statuses()?.[1]).toBe("character:working");
    await world.roomReply("designer", "An answer to something else.");
    expect(world.statuses()?.[1]).toBe("character:working");
    await world.hear(ROOM, { role: "user", kind: "text", text: "@Jade the task", queueId: "rq-1" } as Omit<Message, "id" | "at">);
    await world.roomReply("designer", "Three characters are on the canvas.");
    expect(world.statuses()?.[1]).toBe("character:done");
  });

  it("gives a bot that is not in the group chat its task in its own conversation", async () => {
    const world = setup({ room: ["lead", "writer", "boarder", "editor"] });
    await world.roomHandOff(["writer"]);
    await world.roomReply("writer", "The script.");
    expect(world.roomSent).toEqual([]);
    expect(world.sent.map((one) => [one.botId, one.threadId])).toEqual([["designer", "designer-main"]]);
    await world.reply("designer-main", "Characters done.");
    expect(world.roomSent.at(-1)!.to.map((one) => one.botId)).toEqual(["boarder"]);
  });

  it("asks the lead there when a stage failed, and tells it there when the run is complete", async () => {
    const world = setup({ room: ALL, stages: { lead: ["lead"], writer: ["script"], designer: ["character"], editor: ["post"] } });
    await world.roomHandOff(["writer"]);
    await world.roomReply("writer", "The script.");
    await world.roomFail("designer");
    expect(world.statuses()?.[1]).toBe("character:failed");
    expect(world.toLeadInRoom()).toEqual([serverLine(undefined, "server.pipelineRun.lead.stageFailed", { project: "Bride", stage: "character design", bots: "Jade" })]);
    await world.roomReply("designer", "Done after all.");
    await world.roomReply("editor", "Cut.");
    expect(world.toLeadInRoom().at(-1)).toBe(serverLine(undefined, "server.pipelineRun.lead.doneNoDraft", { project: "Bride" }));
    expect(world.toLead()).toEqual([]);
  });

  it("ends a hand-off that ran in the bot's own thread at its result in the group chat", async () => {
    const world = setup({ room: ALL });
    await world.handOff("writer", "writer-job");
    await world.hear(ROOM, {
      role: "bot", kind: "activity", roomRequest: { id: "r-writer", phase: "result" }, from: { botId: "writer" }, tool: { name: "coordinate_bots", ok: true, output: "done" },
      comm: { groupId: "room", threadId: "writer-job", withBotId: "writer", withName: "Ink", withColor: "blue" },
    } as Omit<Message, "id" | "at">);
    expect(world.statuses()?.slice(0, 2)).toEqual(["script:done", "character:working"]);
  });

  it("after a restart, ends a task at its own bot's turn that ended in the group chat while the server was down", async () => {
    const world = setup({ room: ALL });
    await world.roomHandOff(["writer"]);
    await world.roomReply("writer", "The script.");
    const late = (id: string, at: number, botId: string) => ({ id, at, role: "bot", kind: "text", text: "Done.", turnTerminal: true, turnSucceeded: true, from: { botId } }) as Message;
    world.paths.set(ROOM, [...(world.paths.get(ROOM) ?? []), late("other", 99_998, "boarder")]);
    const again = new PipelineRuns(world.deps);
    await again.resume();
    expect(again.wire("p1")?.stages[1]?.status).toBe("working");
    world.paths.set(ROOM, [...(world.paths.get(ROOM) ?? []), late("mine", 99_999, "designer")]);
    const third = new PipelineRuns(world.deps);
    await third.resume();
    expect(third.wire("p1")?.stages[1]?.status).toBe("done");
  });
});

describe("a project's stored run", () => {
  it("is null for a project that never ran and for a file that is not a run, which is left as it is", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "omb-pipeline-files-"));
    dirs.push(dataDir);
    const lines: string[] = [];
    const files = new PipelineRunFiles(join(dataDir, "pipeline-runs"), (line) => lines.push(line));
    expect(files.read("p1")).toBeNull();
    expect(files.read("../p1")).toBeNull();
    files.write("p1", { id: "r1", startedAt: 1, stages: [{ stage: "script", botIds: ["w"], status: "working", tasks: [] }], videos: { status: "waiting" } });
    expect(files.read("p1")).toMatchObject({ id: "r1" });
    writeFileSync(join(dataDir, "pipeline-runs", "p2.json"), "{ not json");
    expect(files.read("p2")).toBeNull();
    expect(lines).toEqual(["[pipeline-run] the run of project p2 is not a run; it is left as it is"]);
  });
});
