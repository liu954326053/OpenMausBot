import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { DEFAULT_PRODUCTION_CONCURRENCY, type EpisodeJob, type ProductionConcurrency } from "../../shared/production.ts";
import type { ProjectDraftWire } from "../../shared/project-draft.ts";
import type { TeamProjectWire } from "../../shared/team-projects.ts";
import type { DirectSendReceipt } from "../direct-send.ts";
import type { CanvasEpisode, CanvasProfile, PipelineShot } from "../project-canvas/pipeline-api.ts";
import { canvasRefusalOf } from "../project-canvas/service.ts";
import { serverLine } from "../server-lines.ts";
import type { Message } from "../store.ts";
import { Productions, type ProductionDeps } from "./engine.ts";
import { ProductionFiles } from "./store.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const TEAM: Record<string, { name: string; title: string }> = {
  lead: { name: "Mo", title: "Producer" },
  writer: { name: "Ink", title: "Screenwriter" },
  faces: { name: "Jade", title: "Character designer" },
  sets: { name: "Hall", title: "Scene designer" },
  boarder: { name: "Frame", title: "Storyboard artist" },
  cutter: { name: "Cut", title: "Post-production" },
};

const main = (botId: string) => `${botId}-main`;
const ROOM = "room-thread";
const BRIEF: Array<[string, string]> = [["Episodes", "3 × 2 min"], ["Style", "Period drama"]];
const flush = async () => {
  for (let tick = 0; tick < 20; tick += 1) await new Promise((resolve) => setImmediate(resolve));
};
type Row = Omit<Message, "id" | "at">;

/** `room`: the project has a group chat, with these of its bots in it. `refuse`: why no generation starts. */
function setup(options: { members?: string[]; dataDir?: string; room?: string[]; concurrency?: Partial<ProductionConcurrency>; episodeBots?: TeamProjectWire["episodeBots"] } = {}) {
  const dataDir = options.dataDir ?? mkdtempSync(join(tmpdir(), "omb-productions-"));
  if (!options.dataDir) dirs.push(dataDir);
  const episodeBots = { ...options.episodeBots };
  const project: TeamProjectWire = {
    id: "p1", name: "Bride", folder: "/projects/Bride", section: "Bride", leadBotId: "lead", createdAt: 1, folderState: "ready",
    botIds: [...(options.members ?? Object.keys(TEAM)), ...Object.keys(episodeBots)], follows: {}, episodeBots, ...(options.room ? { roomId: "room" } : {}),
  };
  let clock = 1_000;
  let ids = 0;
  const paths = new Map<string, Message[]>();
  const append = (threadId: string, message: Row): Message => {
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
    episodes: [] as CanvasEpisode[],
    shots: [] as PipelineShot[],
    profiles: [] as CanvasProfile[],
    briefs: [] as Array<{ leadBotId: string; rows: ReadonlyArray<readonly [string, string]>; titles: { brief: string; plan: string } }>,
    generated: [] as string[],
    refuse: null as string | null,
    noBots: false,
    drafted: [] as number[],
    drafts: {} as Record<number, ProjectDraftWire>,
    refreshed: 0,
    lines: [] as string[],
    reads: { episodes: 0, shots: 0, profiles: 0, view: 0 },
  };
  const episodesNow = () => state.episodes.map((one) => ({ ...one }));
  const shotsNow = () => state.shots.map((one) => ({ ...one }));
  const profilesNow = () => state.profiles.map((one) => ({ ...one, pictures: one.pictures.map((picture) => ({ ...picture })) }));
  const templateOf = (botId: string) => botId.replace(/-ep\d+$/, "");
  const botOf = (botId: string) => {
    const member = project.botIds.includes(botId) ? TEAM[templateOf(botId)] : undefined;
    return member ? { id: botId, name: member.name, title: member.title, description: "", threadId: main(botId), teamProject: { id: "p1" } } : null;
  };
  const deps: ProductionDeps = {
    projects: { list: () => [project] },
    store: {
      bot: botOf,
      botByThread: (threadId: string) => botOf(threadId.replace(/-main$/, "")),
      activePath: (threadId: string) => paths.get(threadId) ?? [],
      appendMessage: (threadId: string, message: Row) => append(threadId, message),
    } as unknown as ProductionDeps["store"],
    canvas: {
      episodes: () => {
        state.reads.episodes += 1;
        return episodesNow();
      },
      shots: () => {
        state.reads.shots += 1;
        return shotsNow();
      },
      profiles: () => {
        state.reads.profiles += 1;
        return profilesNow();
      },
      view: () => {
        state.reads.view += 1;
        return { episodes: episodesNow(), shots: shotsNow(), profiles: profilesNow() };
      },
      setBrief: (_projectId, leadBotId, rows, titles) => void state.briefs.push({ leadBotId, rows, titles }),
      taskFor: async (_project, botId, request) => `${request}\n\n[what is connected to ${botId}]`,
      generate: async (_project, nodeId) => {
        if (state.refuse) return state.refuse;
        state.generated.push(nodeId);
        state.shots = state.shots.map((one) => (one.creationNodeId === nodeId ? { ...one, status: "loading" } : one));
        for (const profile of state.profiles) for (const picture of profile.pictures) if (picture.nodeId === nodeId) picture.state = "loading";
        return null;
      },
    },
    drafts: {
      writeDraftIfReady: async (_projectId, episode) => {
        state.drafted.push(episode);
        const own = state.shots.filter((one) => one.episode === episode);
        if (own.length && own.every((one) => one.take)) state.drafts[episode] = { state: "written", name: `Bride EP0${episode}`, exportFolder: "/projects/Bride/output" };
      },
      draft: (_projectId, episode) => state.drafts[episode],
    },
    episodeBot: async (_projectId, templateBotId, episode, job: EpisodeJob) => {
      if (state.noBots) throw new Error("the template is gone");
      const botId = `${templateBotId}-ep${episode}`;
      if (!project.botIds.includes(botId)) project.botIds.push(botId);
      project.episodeBots[botId] = { number: episode, job };
      return botId;
    },
    concurrency: () => ({ ...DEFAULT_PRODUCTION_CONCURRENCY, ...options.concurrency }),
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
      const text = to.map((one) => `@${TEAM[one.botId]!.name} ${one.text}`).join("\n\n");
      return { ok: true, threadId: room.threadId, message: append(room.threadId, { role: "user", kind: "text", text }) };
    },
    mainThread: main,
    waitingOnPerson: (_botId, threadId) => waiting.has(threadId),
    language: () => undefined,
    files: new ProductionFiles(join(dataDir, "productions"), (line) => state.lines.push(line)),
    changed: () => {
      state.refreshed += 1;
    },
    now: () => clock,
    newId: () => `task-${++ids}`,
    log: (line) => state.lines.push(line),
  };
  const productions = new Productions(deps);

  const hear = async (threadId: string, message: Row) => {
    const row = append(threadId, message);
    productions.heard(threadId, row);
    await flush();
    return row;
  };
  const poke = async () => {
    productions.poke("p1");
    await flush();
  };
  const world = {
    project, productions, deps, sent, roomSent, busy, waiting, state, paths, dataDir, hear, poke,
    plan: (input: unknown = { brief: BRIEF, episodes: 3 }, botId = "lead") => productions.plan("p1", botId, input),
    /** A turn's last reply in the bot's own conversation, settled. */
    reply: (botId: string, text: string, ok = true) => hear(main(botId), { role: "bot", kind: "text", text, turnTerminal: true, turnSucceeded: ok } as Row),
    /** The row a failed turn ends with. */
    fail: (botId: string) => hear(main(botId), { role: "bot", kind: "activity", tool: { name: "error: the engine stopped answering", ok: false } } as Row),
    roomReply: (botId: string, text: string, ok = true) => hear(ROOM, { role: "bot", kind: "text", text, turnTerminal: true, turnSucceeded: ok, from: { botId } } as Row),
    /** The script bot's episodes on the canvas. */
    episodes: (count: number) => {
      state.episodes = Array.from({ length: count }, (_, index) => ({ episode: index + 1, nodeId: `ep-${index + 1}`, title: `Episode ${index + 1}` }));
    },
    /** A storyboard bot's shots of an episode on the canvas, none generated. */
    shots: (episode: number, count: number) => {
      const added = Array.from({ length: count }, (_, index): PipelineShot => {
        const shotId = `s${episode}-${index + 1}`;
        return { shotId, title: shotId, prompt: `${shotId} prompt`, episode, creationNodeId: `${shotId}-make`, status: "idle", takes: 0, take: null };
      });
      state.shots = [...state.shots.filter((one) => one.episode !== episode), ...added];
    },
    /** The generation of these shots ends: with a take, or failed. */
    taken: async (shotIds: string[], ok = true) => {
      state.shots = state.shots.map((one) => (!shotIds.includes(one.shotId) ? one : ok
        ? { ...one, status: "success", takes: 1, take: { nodeId: `${one.shotId}-take`, title: `${one.shotId}.mp4`, file: { path: `${one.shotId}.mp4`, mime: "video/mp4", bytes: 10, name: `${one.shotId}.mp4` } } }
        : { ...one, status: "error" }));
      await poke();
    },
    statuses: () => {
      const wire = productions.wire("p1");
      return wire ? [...wire.jobs.map(({ job, status }) => `${job}:${status}`), ...wire.episodes.map(({ episode, status }) => `${episode}:${status}`)] : undefined;
    },
    notes: (threadId = main("lead")) => (paths.get(threadId) ?? []).filter((row) => row.kind === "activity" && row.tool?.name.startsWith("Production")).map((row) => row.tool!.name),
    to: (botId: string) => sent.filter((one) => one.botId === botId).map((one) => one.text),
    toInRoom: (botId: string) => roomSent.flatMap((one) => one.to.filter((to) => to.botId === botId).map((to) => to.text)),
  };
  return world;
}

const line = (key: Parameters<typeof serverLine>[1], params: Record<string, string | number> = {}) => serverLine(undefined, key, { project: "Bride", lead: "Mo", ...params });

/** The production of `world` planned, its script written as `episodes` episodes, and its characters and scenes done. */
async function library(world: ReturnType<typeof setup>, episodes = 3) {
  await world.plan();
  world.episodes(episodes);
  await world.reply("writer", "Characters: Mei, the bride. Scenes: the wedding hall.");
  await world.reply("faces", "Mei is on the canvas.");
  await world.reply("sets", "The hall is on the canvas.");
}

describe("the lead's plan", () => {
  it("puts the brief on the canvas, gives the script bot its task, and says who does each job by the members' titles", async () => {
    const world = setup();
    const answer = await world.plan();
    expect(world.state.briefs).toEqual([{ leadBotId: "lead", rows: BRIEF, titles: { brief: "Brief", plan: "Task split" } }]);
    expect(answer).toContain("script: Ink; character: Jade; scene: Hall; storyboard: Frame; post: Cut");
    expect(world.sent).toEqual([{ botId: "writer", threadId: "writer-main", leadBotId: "lead", text: `${line("server.production.task.script", { count: 3 })}\n\n[what is connected to writer]` }]);
    expect(world.statuses()).toEqual(["script:working", "character:waiting", "scene:waiting"]);
    expect(world.notes()).toEqual(["Production: the plan is set.", "Production: script goes to Ink."]);
    expect(world.productions.wire("p1")).toMatchObject({
      plan: { assignments: { script: "writer", character: "faces", scene: "sets", storyboard: "boarder", post: "cutter" }, episodes: 3 },
      ready: false, episodes: [], tasks: [{ job: "script", botId: "writer", status: "working" }],
    });
  });

  it("asks for as many episodes as the source needs when the lead names no number", async () => {
    const world = setup();
    await world.plan({ brief: BRIEF });
    expect(world.to("writer")[0]).toContain(line("server.production.task.scriptAny"));
  });

  it("takes the bots the lead names, by node id or id, over the titles", async () => {
    const world = setup();
    await world.plan({ brief: BRIEF, assignments: { character: "bot:sets", scene: "sets" } });
    expect(world.productions.wire("p1")?.plan.assignments).toMatchObject({ script: "writer", character: "sets", scene: "sets" });
  });

  it("is the lead's alone, and is refused with what is wrong with it", async () => {
    const world = setup();
    const refused = async (input: unknown, botId = "lead") => canvasRefusalOf(await world.plan(input, botId).catch((error: unknown) => error));
    expect(await refused({ brief: BRIEF }, "writer")).toMatchObject({ status: 403 });
    expect(await refused({})).toMatchObject({ status: 400 });
    expect(await refused({ brief: [["Only a label"]] })).toMatchObject({ status: 400 });
    expect(await refused({ brief: BRIEF, episodes: 0 })).toMatchObject({ status: 400 });
    expect(await refused({ brief: BRIEF, assignments: { lighting: "writer" } })).toMatchObject({ status: 400 });
    expect(await refused({ brief: BRIEF, assignments: { script: "lead" } })).toMatchObject({ status: 400, body: { error: expect.stringContaining("bot:writer (Ink)") } });
    expect(world.sent).toEqual([]);
    world.project.archivedAt = 5;
    expect(await refused({ brief: BRIEF })).toMatchObject({ status: 409 });
  });

  it("is refused in a project where nobody writes scripts", async () => {
    const world = setup({ members: ["lead", "faces"] });
    expect(canvasRefusalOf(await world.plan().catch((error: unknown) => error))).toMatchObject({ status: 400, body: { error: expect.stringContaining("assignments.script") } });
  });

  it("made again while the production runs changes the brief and who does a job, and gives no task twice", async () => {
    const world = setup();
    await world.plan();
    await world.plan({ brief: [["Episodes", "2"]], episodes: 2, assignments: { scene: "faces" } });
    expect(world.state.briefs).toHaveLength(2);
    expect(world.sent).toHaveLength(1);
    expect(world.productions.wire("p1")?.plan).toMatchObject({ episodes: 2, assignments: { scene: "faces" } });
  });
});

describe("who does what in a project", () => {
  it("is told from the members' titles before a plan and from the plan after it, an episode's own bots having their job", async () => {
    const world = setup({ episodeBots: { "boarder-ep1": { number: 1, job: "storyboard" }, "cutter-ep1": { number: 1, job: "post" } } });
    const before = world.productions.pipeline(world.project);
    expect(before.stages).toEqual({ writer: ["script"], faces: ["character"], sets: ["scene"], boarder: ["storyboard"], cutter: ["post"], "boarder-ep1": ["storyboard"], "cutter-ep1": ["post"] });
    expect(before.lines).toEqual([{ from: "lead", to: "writer" }, { from: "writer", to: "faces" }, { from: "writer", to: "sets" }]);
    await world.plan({ brief: BRIEF, assignments: { character: "sets" } });
    const after = world.productions.pipeline(world.project);
    expect(after.stages).toMatchObject({ writer: ["script"], sets: ["character", "scene"] });
    expect(after.stages).not.toHaveProperty("faces");
    expect(after.lines).toEqual([{ from: "lead", to: "writer" }, { from: "writer", to: "sets" }]);
  });
});

describe("a production", () => {
  it("goes from the script to the characters and scenes side by side, each given what the script bot listed", async () => {
    const world = setup();
    await world.plan();
    world.episodes(3);
    await world.reply("writer", "Characters: Mei, the bride. Scenes: the wedding hall.");
    expect(world.statuses()).toEqual(["script:done", "character:working", "scene:working", "1:waiting", "2:waiting", "3:waiting"]);
    const list = "Characters: Mei, the bride. Scenes: the wedding hall.";
    expect(world.to("faces")).toEqual([`${line("server.production.task.character", { list })}\n\n[what is connected to faces]`]);
    expect(world.to("sets")).toEqual([`${line("server.production.task.scene", { list })}\n\n[what is connected to sets]`]);
  });

  it("tells the lead once when the script bot's turn ends and the canvas has no episode, and goes on when the episodes are there and the person retries", async () => {
    const world = setup();
    await world.plan();
    await world.reply("writer", "Done.");
    await world.poke();
    expect(world.statuses()).toEqual(["script:failed", "character:waiting", "scene:waiting"]);
    expect(world.to("lead")).toEqual([line("server.production.lead.noEpisodes", { bots: "Ink" })]);
    world.episodes(2);
    await world.productions.retry("p1", { job: "script" });
    expect(world.statuses()).toEqual(["script:done", "character:working", "scene:working", "1:waiting", "2:waiting"]);
  });

  it("generates the pictures of characters and scenes as many at once as the project allows, and the episodes wait for them", async () => {
    const world = setup({ concurrency: { images: 2 } });
    await world.plan();
    world.episodes(1);
    await world.reply("writer", "Mei. The hall.");
    world.state.profiles = [
      { nodeId: "mei", role: "character", title: "Mei", pictures: [{ nodeId: "mei-1", state: "empty" }, { nodeId: "mei-2", state: "empty" }, { nodeId: "mei-3", state: "empty" }] },
      { nodeId: "hall", role: "scene", title: "Hall", pictures: [{ nodeId: "hall-1", state: "ready" }] },
    ];
    await world.poke();
    expect(world.state.generated).toEqual(["mei-1", "mei-2"]);
    await world.poke();
    expect(world.state.generated).toEqual(["mei-1", "mei-2"]);
    await world.reply("faces", "Mei is on the canvas.");
    await world.reply("sets", "The hall is on the canvas.");
    expect(world.statuses()).toEqual(["script:done", "character:working", "scene:done", "1:waiting"]);
    world.state.profiles[0]!.pictures[0]!.state = "ready";
    world.state.profiles[0]!.pictures[1]!.state = "error";
    await world.poke();
    expect(world.state.generated).toEqual(["mei-1", "mei-2", "mei-3"]);
    expect(world.productions.wire("p1")?.ready).toBe(false);
    world.state.profiles[0]!.pictures[2]!.state = "ready";
    await world.poke();
    expect(world.statuses()).toEqual(["script:done", "character:done", "scene:done", "1:storyboard"]);
  });

  it("tells the lead once why pictures do not generate, waits, and tries them again when the person retries", async () => {
    const world = setup();
    await world.plan();
    world.episodes(1);
    await world.reply("writer", "Mei.");
    world.state.profiles = [{ nodeId: "mei", role: "character", title: "Mei", pictures: [{ nodeId: "mei-1", state: "empty" }] }];
    world.state.refuse = "Choose an MCP server for images in this project's settings first.";
    await world.reply("faces", "Mei is on the canvas.");
    await world.reply("sets", "No scene needs a picture.");
    await world.poke();
    expect(world.to("lead")).toEqual([line("server.production.lead.picturesRefused", { why: world.state.refuse })]);
    expect(world.statuses()).toEqual(["script:done", "character:failed", "scene:done", "1:waiting"]);
    world.state.refuse = null;
    await world.productions.retry("p1", { job: "character" });
    expect(world.state.generated).toEqual(["mei-1"]);
    expect(world.statuses()?.[1]).toBe("character:working");
  });

  it("opens as many episodes at once as the project allows, each with a storyboard bot of its own given the drama's characters and scenes", async () => {
    const world = setup({ concurrency: { episodes: 2 } });
    await world.plan();
    world.episodes(3);
    await world.reply("writer", "Mei. The hall.");
    world.state.profiles = [
      { nodeId: "mei", role: "character", title: "Mei", subtitle: "24, seamstress", pictures: [{ nodeId: "mei-1", state: "ready" }, { nodeId: "mei-2", state: "error" }] },
      { nodeId: "hall", role: "scene", title: "Hall", pictures: [] },
    ];
    await world.reply("faces", "Mei is on the canvas.");
    await world.reply("sets", "The hall is on the canvas.");
    expect(world.statuses()).toEqual(["script:done", "character:done", "scene:done", "1:storyboard", "2:storyboard", "3:waiting"]);
    expect(world.project.episodeBots).toEqual({ "boarder-ep1": { number: 1, job: "storyboard" }, "boarder-ep2": { number: 2, job: "storyboard" } });
    const text = `${line("server.production.task.storyboard", { episode: "EP01", library: "- mei · Mei (24, seamstress) · mei-1\n- hall · Hall" })}\n\n[what is connected to boarder-ep1]`;
    expect(world.sent.find((one) => one.botId === "boarder-ep1")).toEqual({ botId: "boarder-ep1", threadId: "boarder-ep1-main", leadBotId: "lead", text });
    expect(world.productions.wire("p1")?.episodes[0]).toMatchObject({ episode: 1, nodeId: "ep-1", title: "Episode 1", storyboardBotId: "boarder-ep1" });
    expect(world.notes()).toContain("Production: EP02 storyboard goes to Frame.");
  });

  it("generates an episode's videos as many at once as the project allows, then gives its post bot the draft, and the next episode opens when it is done", async () => {
    const world = setup({ concurrency: { episodes: 1, videos: 2 } });
    await library(world, 2);
    world.shots(1, 4);
    await world.reply("boarder-ep1", "Four shots.");
    expect(world.state.generated).toEqual(["s1-1-make", "s1-2-make"]);
    expect(world.productions.wire("p1")?.episodes[0]).toMatchObject({ status: "videos", shots: 4, ready: 0, generating: 2, failed: 0 });
    await world.poke();
    expect(world.state.generated).toEqual(["s1-1-make", "s1-2-make"]);

    await world.taken(["s1-1"]);
    expect(world.state.generated).toEqual(["s1-1-make", "s1-2-make", "s1-3-make"]);
    await world.taken(["s1-2", "s1-3"]);
    expect(world.state.generated).toEqual(["s1-1-make", "s1-2-make", "s1-3-make", "s1-4-make"]);
    expect(world.statuses()?.[3]).toBe("1:videos");
    await world.taken(["s1-4"]);
    expect(world.statuses()).toEqual(["script:done", "character:done", "scene:done", "1:post", "2:waiting"]);
    expect(world.state.drafted).toEqual([1]);
    expect(world.to("cutter-ep1")).toEqual([`${line("server.production.task.post", { episode: "EP01", draft: "Bride EP01" })}\n\n[what is connected to cutter-ep1]`]);

    await world.reply("cutter-ep1", "The cut is ready.");
    expect(world.statuses()).toEqual(["script:done", "character:done", "scene:done", "1:done", "2:storyboard"]);
    expect(world.state.drafted).toEqual([1, 1]);
    expect(world.notes()).toContain("Production: EP01 is done.");
    expect(world.productions.wire("p1")?.endedAt).toBeUndefined();

    world.shots(2, 1);
    await world.reply("boarder-ep2", "One shot.");
    await world.taken(["s2-1"]);
    await world.reply("cutter-ep2", "The cut is ready.");
    expect(world.statuses()?.slice(3)).toEqual(["1:done", "2:done"]);
    expect(world.productions.wire("p1")?.endedAt).toBeGreaterThan(0);
    expect(world.notes().at(-1)).toBe("Production: every episode is done.");
    expect(world.to("lead")).toEqual([line("server.production.lead.done")]);
    await world.poke();
    expect(world.to("lead")).toHaveLength(1);
  });

  it("shares the videos' places between the episodes that run at once", async () => {
    const world = setup({ concurrency: { episodes: 2, videos: 2 } });
    await library(world, 2);
    world.shots(1, 2);
    world.shots(2, 2);
    await world.reply("boarder-ep1", "Two shots.");
    await world.reply("boarder-ep2", "Two shots.");
    expect(world.state.generated).toEqual(["s1-1-make", "s1-2-make"]);
    await world.taken(["s1-1", "s1-2"]);
    expect(world.state.generated).toEqual(["s1-1-make", "s1-2-make", "s2-1-make", "s2-2-make"]);
  });

  it("tells a post bot to check the canvas when its episode has no draft, and an episode is done with its videos in a project without a post bot", async () => {
    const world = setup();
    await library(world, 1);
    world.shots(1, 1);
    await world.reply("boarder-ep1", "One shot.");
    world.deps.drafts.writeDraftIfReady = async () => undefined;
    await world.taken(["s1-1"]);
    expect(world.to("cutter-ep1")[0]).toContain(line("server.production.task.postNoDraft", { episode: "EP01" }));

    const bare = setup({ members: ["lead", "writer", "boarder"] });
    await bare.plan();
    bare.episodes(1);
    await bare.reply("writer", "No characters.");
    bare.shots(1, 1);
    await bare.reply("boarder-ep1", "One shot.");
    await bare.taken(["s1-1"]);
    expect(bare.statuses()).toEqual(["script:done", "1:done"]);
    expect(bare.productions.wire("p1")?.endedAt).toBeGreaterThan(0);
  });

  it("waits for an episode's shots in a project without a storyboard bot", async () => {
    const world = setup({ members: ["lead", "writer"] });
    await world.plan();
    world.episodes(1);
    await world.reply("writer", "Done.");
    expect(world.statuses()).toEqual(["script:done", "1:videos"]);
    expect(world.to("lead")).toEqual([]);
    world.shots(1, 1);
    await world.poke();
    expect(world.state.generated).toEqual(["s1-1-make"]);
  });
});

describe("a task that fails", () => {
  it("of a whole-drama job stops what waits on it and goes to the lead once; the bot ending a later turn well in that conversation takes it up again", async () => {
    const world = setup();
    await world.plan();
    await world.fail("writer");
    await world.poke();
    expect(world.statuses()).toEqual(["script:failed", "character:waiting", "scene:waiting"]);
    expect(world.to("lead")).toEqual([line("server.production.lead.jobFailed", { job: "script", bots: "Ink" })]);
    world.episodes(1);
    await world.reply("writer", "Mei. The hall.");
    expect(world.statuses()).toEqual(["script:done", "character:working", "scene:working", "1:waiting"]);
  });

  it("is given again when the person retries the job", async () => {
    const world = setup();
    await world.plan();
    await world.reply("writer", "I can't.", false);
    const wire = await world.productions.retry("p1", { job: "script" });
    expect(wire.jobs[0]).toEqual({ job: "script", botId: "writer", status: "working" });
    expect(world.to("writer")).toHaveLength(2);
    expect(canvasRefusalOf(await world.productions.retry("p1", {}).catch((error: unknown) => error))).toMatchObject({ status: 400 });
    expect(canvasRefusalOf(await world.productions.retry("p1", { job: "script", episode: 1 }).catch((error: unknown) => error))).toMatchObject({ status: 400 });
  });

  it("of an episode stops that episode alone, tells the lead why, and the episode takes up where it stopped when the person retries it", async () => {
    const world = setup({ concurrency: { episodes: 2 } });
    await library(world, 2);
    await world.fail("boarder-ep1");
    expect(world.statuses()?.slice(3)).toEqual(["1:failed", "2:storyboard"]);
    expect(world.to("lead")).toEqual([line("server.production.lead.episodeFailed", { episode: "EP01", reason: "its storyboard bot didn't finish the storyboard" })]);
    await world.poke();
    expect(world.to("lead")).toHaveLength(1);

    await world.productions.retry("p1", { episode: 1 });
    expect(world.statuses()?.slice(3)).toEqual(["1:storyboard", "2:storyboard"]);
    expect(world.to("boarder-ep1")).toHaveLength(2);
  });

  it("is an episode whose storyboard left no shot, and one whose videos do not generate, with what the generation said", async () => {
    const world = setup();
    await library(world, 2);
    await world.reply("boarder-ep1", "Done.");
    expect(world.statuses()?.[3]).toBe("1:failed");
    expect(world.to("lead")[0]).toContain("the canvas has no shot for it");

    world.shots(2, 2);
    world.state.refuse = "Choose an MCP server for videos in this project's settings first.";
    await world.reply("boarder-ep2", "Two shots.");
    expect(world.statuses()?.[4]).toBe("2:failed");
    expect(world.to("lead")[1]).toBe(line("server.production.lead.episodeFailed", { episode: "EP02", reason: `the videos of its shots could not be generated (${world.state.refuse})` }));

    world.state.refuse = null;
    await world.productions.retry("p1", { episode: 2 });
    expect(world.state.generated).toEqual(["s2-1-make", "s2-2-make"]);
    await world.taken(["s2-1"]);
    await world.taken(["s2-2"], false);
    expect(world.productions.wire("p1")?.episodes[1]).toMatchObject({ status: "failed", shots: 2, ready: 1, failed: 1 });
    await world.productions.retry("p1", { episode: 2 });
    expect(world.state.generated).toEqual(["s2-1-make", "s2-2-make", "s2-2-make"]);
  });

  it("is an episode no bot could be made for", async () => {
    const world = setup();
    world.state.noBots = true;
    await library(world, 1);
    expect(world.statuses()?.[3]).toBe("1:failed");
    expect(world.to("lead")).toEqual([line("server.production.lead.episodeFailed", { episode: "EP01", reason: "no bot could be made for it" })]);
  });

  it("is a task that never reached its bot", async () => {
    const world = setup();
    world.deps.deliver = async () => { throw new Error("the bot is archived"); };
    await world.plan();
    expect(world.statuses()?.[0]).toBe("script:failed");
    expect(world.state.lines).toContainEqual(expect.stringContaining("the script task did not reach writer"));
  });
});

describe("a production's tasks in the conversations", () => {
  it("go to the whole-drama bots in the project's group chat and to an episode's bots in their own conversation, the notes and the lead's turns in the group chat", async () => {
    const world = setup({ room: ["lead", "writer", "faces", "sets"] });
    await world.plan();
    expect(world.toInRoom("writer")).toHaveLength(1);
    expect(world.sent).toEqual([]);
    world.episodes(1);
    await world.roomReply("faces", "Not mine.");
    expect(world.statuses()?.[0]).toBe("script:working");
    await world.roomReply("writer", "Mei. The hall.");
    expect(world.toInRoom("faces")).toHaveLength(1);
    expect(world.toInRoom("sets")).toHaveLength(1);
    await world.roomReply("faces", "Mei is on the canvas.");
    await world.roomReply("sets", "The hall is on the canvas.");
    expect(world.sent.map((one) => one.threadId)).toEqual(["boarder-ep1-main"]);
    expect(world.notes(ROOM)).toEqual([
      "Production: the plan is set.", "Production: script goes to Ink.", "Production: character design goes to Jade.", "Production: scene design goes to Hall.",
      "Production: EP01 storyboard goes to Frame.",
    ]);
    await world.fail("boarder-ep1");
    expect(world.toInRoom("lead")).toEqual([line("server.production.lead.episodeFailed", { episode: "EP01", reason: "its storyboard bot didn't finish the storyboard" })]);
  });

  it("wait in a busy bot's queue, and are the bot's once their line joins its conversation", async () => {
    const world = setup();
    world.busy.add("writer-main");
    await world.plan();
    await world.reply("writer", "An answer to something else.");
    expect(world.statuses()?.[0]).toBe("script:working");
    await world.hear("writer-main", { role: "user", kind: "text", text: "the task", queueId: "q-1" } as Row);
    world.episodes(1);
    await world.reply("writer", "Mei. The hall.");
    expect(world.statuses()?.[0]).toBe("script:done");
  });

  it("do not end while the bot waits for the person's answer", async () => {
    const world = setup();
    await world.plan();
    world.waiting.add("writer-main");
    world.episodes(1);
    await world.reply("writer", "Which ending do you want?");
    expect(world.statuses()?.[0]).toBe("script:working");
    world.waiting.clear();
    await world.reply("writer", "Mei. The hall.");
    expect(world.statuses()?.[0]).toBe("script:done");
  });
});

describe("a production after a restart", () => {
  it("is read again, ends the tasks whose turns ended meanwhile, and goes on", async () => {
    const world = setup();
    await world.plan();
    world.episodes(1);
    const again = setup({ dataDir: world.dataDir });
    again.episodes(1);
    again.paths.set("writer-main", [...world.paths.get("writer-main")!, { id: "late", at: 5_000, role: "bot", kind: "text", text: "Mei. The hall.", turnTerminal: true, turnSucceeded: true } as Message]);
    expect(again.statuses()?.[0]).toBe("script:working");
    await again.productions.resume();
    await flush();
    expect(again.statuses()).toEqual(["script:done", "character:working", "scene:working", "1:waiting"]);
    expect(again.to("faces")[0]).toContain("Mei. The hall.");
  });

  it("is nothing for a project nobody planned, and a file that is no production is left as it is", async () => {
    const world = setup();
    expect(world.productions.wire("p1")).toBeUndefined();
    await world.productions.resume();
    world.productions.poke("p1");
    await flush();
    expect(world.sent).toEqual([]);
    expect(canvasRefusalOf(await world.productions.retry("p1", { job: "script" }).catch((error: unknown) => error))).toMatchObject({ status: 409 });
  });
});

describe("what a production reads of the canvas", () => {
  /** Two episodes in their videos, one of them with a failed shot, and one waiting. */
  async function midway() {
    const world = setup({ concurrency: { episodes: 2, videos: 2 } });
    await library(world, 3);
    world.state.profiles = [{ nodeId: "mei", role: "character", title: "Mei", pictures: [{ nodeId: "mei-1", state: "ready" }] }];
    world.shots(1, 3);
    await world.reply("boarder-ep1", "Three shots.");
    await world.taken(["s1-1"]);
    await world.taken(["s1-2"], false);
    world.shots(2, 1);
    await world.reply("boarder-ep2", "One shot.");
    return world;
  }

  it("draws the production from one reading", async () => {
    const world = await midway();
    world.state.reads = { episodes: 0, shots: 0, profiles: 0, view: 0 };
    const wire = world.productions.wire("p1");
    expect(world.state.reads).toEqual({ episodes: 0, shots: 0, profiles: 0, view: 1 });
    const ended = (id: string, job: string, botId: string, at: number, endedAt: number, episode?: number) => ({ id, job, botId, ...(episode ? { episode } : {}), status: "done", at, endedAt });
    expect(wire).toEqual({
      plan: { assignments: { script: "writer", character: "faces", scene: "sets", storyboard: "boarder", post: "cutter" }, episodes: 3, plannedAt: 1000 },
      jobs: [{ job: "script", botId: "writer", status: "done" }, { job: "character", botId: "faces", status: "done" }, { job: "scene", botId: "sets", status: "done" }],
      ready: true,
      episodes: [
        { episode: 1, nodeId: "ep-1", title: "Episode 1", status: "videos", storyboardBotId: "boarder-ep1", shots: 3, ready: 1, generating: 1, failed: 1 },
        { episode: 2, nodeId: "ep-2", title: "Episode 2", status: "videos", storyboardBotId: "boarder-ep2", shots: 1, ready: 0, generating: 1, failed: 0 },
        { episode: 3, nodeId: "ep-3", title: "Episode 3", status: "waiting", shots: 0, ready: 0, generating: 0, failed: 0 },
      ],
      tasks: [
        ended("task-2", "script", "writer", 1020, 1040), ended("task-6", "character", "faces", 1050, 1090), ended("task-9", "scene", "sets", 1070, 1100),
        ended("task-14", "storyboard", "boarder-ep1", 1110, 1150, 1), ended("task-17", "storyboard", "boarder-ep2", 1130, 1160, 2),
      ],
      startedAt: 1000,
    });
  });

  it("reads an episode's shots once in an advance that starts nothing", async () => {
    const world = await midway();
    expect(world.state.generated).toEqual(["s1-1-make", "s1-2-make", "s1-3-make", "s2-1-make"]);
    world.state.reads = { episodes: 0, shots: 0, profiles: 0, view: 0 };
    await world.poke();
    expect(world.state.generated).toEqual(["s1-1-make", "s1-2-make", "s1-3-make", "s2-1-make"]);
    expect(world.state.reads.shots).toBe(2);
  });
});
