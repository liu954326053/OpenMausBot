// A team whose data folder still holds the lines the team map drew, in team-flows.json, which nothing reads. The
// project made from the team runs from its lead's plan to every episode's film; the project's lead reaches every bot
// of the project, each episode's own bots included though they are not in its group chat; and in the team itself the
// lead and the member at the far end of the lines reach each other.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { hostTimeout } from "./testing/host-timeout.ts";
import { keep, productionPlan, startProductionFixture, TEAM, type Bot, type ProductionFixture, type Role, type StoredBot, type Turn } from "./testing/production-fixture.ts";

const said = (response: any): string => (response?.result?.content ?? []).map((part: { text?: string }) => part?.text ?? "").join("\n");
const steps = (turn: Turn): any[] => turn.evidence.filter((entry) => entry.step);
const answers = (turn: Turn): string[] => steps(turn).map((entry) => said(entry.response));
const refused = (turn: Turn): boolean[] => steps(turn).map((entry) => Boolean(entry.response.error || entry.response.result?.isError));
const receiptsOf = (answer: string | undefined) => (JSON.parse(answer ?? "{}") as { receipts?: Array<{ botId: string }> }).receipts;
const told = (turn: Turn): string => `${turn.system}\n${JSON.stringify(turn.prompt)}`;

/** A team's entry in team-flows.json as the team map wrote it (version 2): every member's stages set by hand, and the
 * lines from the lead through script, character design and storyboard to post. */
function drawnPipeline(team: Record<Role, Bot>) {
  const line = (from: Bot, to: Bot) => ({ from: from.id, to: to.id });
  return {
    stages: { [team.writer.id]: ["script"], [team.faces.id]: ["character"], [team.sets.id]: ["character"], [team.boarder.id]: ["storyboard"], [team.cutter.id]: ["post"] },
    judged: {},
    manual: [team.writer, team.faces, team.sets, team.boarder, team.cutter].map((bot) => bot.id),
    added: [line(team.lead, team.writer), line(team.writer, team.faces), line(team.writer, team.sets), line(team.faces, team.boarder), line(team.sets, team.boarder), line(team.boarder, team.cutter)],
    removed: [],
  };
}

describe("a team with lines left in team-flows.json", () => {
  let fixture: ProductionFixture;
  let legacy = "";
  let main: StoredBot;
  const flowFile = () => join(fixture.server.dataDir, "team-flows.json");
  const since = (before: number) => fixture.turns().slice(before);
  const turnOf = (turns: Turn[], bot: { id: string }, key: string) => turns.find((turn) => turn.botId === bot.id && turn.planKey === key);
  const turnFor = async (before: number, bot: { id: string }, key: string): Promise<Turn> => {
    await expect.poll(() => Boolean(turnOf(since(before), bot, key)), { timeout: 90_000, interval: 500, message: `${bot.id}'s ${key} turn` }).toBe(true);
    return turnOf(since(before), bot, key)!;
  };
  const episodeBot = async (number: number, job: string) =>
    Object.entries((await fixture.listed()).episodeBots).find(([, own]) => own.number === number && own.job === job)![0];

  beforeAll(async () => {
    fixture = await startProductionFixture({
      concurrency: { episodes: 2, videos: 2, images: 2 },
      beforeProject: async ({ server, team, settled }) => {
        const departments = JSON.parse(readFileSync(join(server.dataDir, "section-contexts.json"), "utf8")) as { memoryKeys?: Record<string, string> };
        legacy = `${JSON.stringify({ version: 2, teams: { [departments.memoryKeys?.[TEAM] ?? TEAM]: drawnPipeline(team) } }, null, 2)}\n`;
        writeFileSync(join(server.dataDir, "team-flows.json"), legacy, { mode: 0o600 });
        await server.stop();
        await server.start();
        await settled();
      },
    });
    main = fixture.stored().find((bot) => !bot.section && !bot.teamProject)!;
    fixture.script(productionPlan(fixture.copies));
    keep("legacy-00-fixture.json", { url: fixture.server.url, dataDir: fixture.server.dataDir, logPath: fixture.server.logPath, project: fixture.project, team: fixture.team, copies: fixture.copies, main, legacy: JSON.parse(legacy) });
    await fixture.settled();
  }, hostTimeout(150_000));

  afterAll(async () => {
    await fixture?.close();
  });

  it("leaves team-flows.json in the data folder as it was, and serves none of the team map's line routes", async () => {
    expect(readFileSync(flowFile(), "utf8")).toBe(legacy);
    for (const path of ["/api/team-pipelines", "/api/team-flows"]) expect((await fixture.api("GET", path)).status, path).toBe(404);
  });

  it("runs the project's production from its lead's plan to every episode's film", async () => {
    await fixture.send(fixture.copies.lead, "MAKE-THE-DRAMA");
    await expect.poll(async () => (await fixture.production())?.endedAt, { timeout: 240_000, interval: 1_000 }).toBeTypeOf("number");
    await fixture.settled();
    const ended = (await fixture.production())!;
    keep("legacy-01-production-ended.json", ended);
    expect(fixture.turns().filter((turn) => turn.unplanned)).toEqual([]);
    expect(ended.jobs.map(({ job, status }) => [job, status])).toEqual([["script", "done"], ["character", "done"], ["scene", "done"]]);
    expect(ended.episodes.map(({ episode, status }) => [episode, status])).toEqual([[1, "done"], [2, "done"]]);
    expect(ended.tasks.filter((task) => task.status !== "done")).toEqual([]);
    expect(Object.keys((await fixture.listed()).episodeBots)).toHaveLength(4);
  }, hostTimeout(300_000));

  it("lets the project's lead reach each episode's own bots, from its group chat and from its own chat, though they are not in the group chat", async () => {
    const { copies, team } = fixture;
    const board = await episodeBot(1, "storyboard"), cut = await episodeBot(2, "post");
    const room = fixture.room();
    expect(room.memberIds).not.toContain(board);
    expect(room.memberIds).not.toContain(cut);
    const plan = productionPlan(copies);
    plan[copies.lead.id]!.script.unshift(
      { key: "ask-from-the-group-chat", match: ["ASK-EP01-STORYBOARD"], reply: "Asked Frame EP01.", steps: [
        { tool: "list_bots", arguments: {} },
        { tool: "coordinate_bots", arguments: { bot_ids: [board], consult: true, message: "CONSULT-EP01: how many shots does EP01 have?" } },
        { tool: "coordinate_bots", arguments: { bot_ids: [main.id], consult: true, message: "CONSULT-MAIN: does anything cross projects?" } },
        { tool: "coordinate_bots", arguments: { bot_ids: [team.boarder.id], consult: true, message: "CONSULT-SOURCE: are you there?" }, expectError: true },
      ] },
      { key: "hand-to-ep02-post", match: ["RECUT-EP02"], reply: "Handed to Cut EP02.", steps: [
        { tool: "coordinate_bots", arguments: { bot_ids: [cut], message: "RECUT-EP02: tighten the last shot of EP02." } },
      ] },
    );
    plan[board] = { script: [{ key: "consulted", match: ["CONSULT-EP01"], reply: "EP01 has two shots." }] };
    plan[cut] = { script: [{ key: "recut", match: ["RECUT-EP02: tighten"], reply: "EP02 is recut." }] };
    plan[main.id] = { script: [{ key: "consulted", match: ["CONSULT-MAIN"], reply: "Nothing crosses projects." }] };
    fixture.script(plan);
    const before = fixture.turns().length;

    const posted = await fixture.api("POST", `/api/groups/${room.id}/messages`, { text: "@Mo ASK-EP01-STORYBOARD", threadId: room.threadId });
    expect(posted.status, JSON.stringify(posted.body)).toBe(202);
    const fromRoom = await turnFor(before, copies.lead, "ask-from-the-group-chat");
    expect(refused(fromRoom), answers(fromRoom).join("\n---\n")).toEqual([false, false, false, true]);
    await turnFor(before, { id: board }, "consulted");
    await turnFor(before, main, "consulted");
    await fixture.settled();
    await fixture.send(copies.lead, "RECUT-EP02");
    const fromOwnChat = await turnFor(before, copies.lead, "hand-to-ep02-post");
    expect(refused(fromOwnChat), answers(fromOwnChat).join("\n---\n")).toEqual([false]);
    await turnFor(before, { id: cut }, "recut");
    await fixture.settled();

    const seen = since(before);
    keep("legacy-02-project-reach.json", seen.map(({ botId, threadId, planKey, resumed, evidence }) => ({ botId, threadId, planKey, resumed, steps: evidence.filter((entry) => entry.step) })));
    keep("legacy-02-lead-told.json", { roomTargets: JSON.parse(said(fromRoom.evidence[1])), ownChat: { system: fromOwnChat.system, prompt: fromOwnChat.prompt } });
    expect(seen.filter((turn) => turn.unplanned)).toEqual([]);
    expect(fromRoom.threadId).toBe(room.threadId);
    const [listed, asked, askedMain, source] = answers(fromRoom);
    expect(listed).toContain(`[id: ${board},`);
    expect(listed).toContain(`[id: ${cut},`);
    expect(listed).not.toMatch(/upstream|downstream|pipeline/);
    expect(receiptsOf(asked)).toMatchObject([{ botId: board }]);
    expect(receiptsOf(askedMain)).toMatchObject([{ botId: main.id }]);
    expect(source).toContain(`No bot with id or name "${team.boarder.id}"`);
    const targets = JSON.parse(said(fromRoom.evidence[1])) as { bots: Array<{ id: string }> };
    expect(targets.bots.map((bot) => bot.id)).toEqual(expect.arrayContaining([board, cut, main.id]));
    expect(fromRoom.system).not.toMatch(/upstream of you|downstream of you/);

    expect(fromOwnChat.threadId).toBe(copies.lead.threadId);
    expect(receiptsOf(answers(fromOwnChat)[0])).toMatchObject([{ botId: cut }]);
    expect(told(fromOwnChat), "the roster, at launch or as the note on a warm process's message").toContain(`[id: ${cut}]`);
    expect(told(fromOwnChat)).toContain("production_plan");
    expect(told(fromOwnChat)).not.toMatch(/upstream of you|downstream of you/);
    expect(fixture.room().memberIds).not.toContain(board);
  }, hostTimeout(240_000));

  it("lets the team's lead reach the member at the far end of the lines, and that member reach the lead", async () => {
    const { team } = fixture;
    const plan = productionPlan(fixture.copies);
    plan[team.lead.id] = { script: [
      { key: "ask-the-editor", match: ["ASK-THE-EDITOR"], reply: "Asked Cut.", steps: [
        { tool: "coordinate_bots", arguments: { bot_ids: [team.cutter.id], consult: true, message: "CONSULT-CUT: is the edit locked?" } },
      ] },
      { key: "answer-the-editor", match: ["CONSULT-MO"], reply: "Keep the long cut." },
      { key: "any", match: [""], repeat: true, reply: "Noted." },
    ] };
    plan[team.cutter.id] = { script: [
      { key: "answer-the-lead", match: ["CONSULT-CUT"], reply: "The edit is locked." },
      { key: "ask-the-lead", match: ["ASK-THE-LEAD"], reply: "Asked Mo.", steps: [
        { tool: "coordinate_bots", arguments: { bot_ids: [team.lead.id], consult: true, message: "CONSULT-MO: which cut do you want?" } },
      ] },
      { key: "any", match: [""], repeat: true, reply: "Noted." },
    ] };
    fixture.script(plan);
    const before = fixture.turns().length;

    await fixture.send(team.lead, "ASK-THE-EDITOR");
    const leadAsked = await turnFor(before, team.lead, "ask-the-editor");
    expect(refused(leadAsked), answers(leadAsked).join("\n---\n")).toEqual([false]);
    await turnFor(before, team.cutter, "answer-the-lead");
    await fixture.settled();
    await fixture.send(team.cutter, "ASK-THE-LEAD");
    const memberAsked = await turnFor(before, team.cutter, "ask-the-lead");
    expect(refused(memberAsked), answers(memberAsked).join("\n---\n")).toEqual([false]);
    await turnFor(before, team.lead, "answer-the-editor");
    await fixture.settled();

    const seen = since(before);
    keep("legacy-03-team-reach.json", seen.map(({ botId, threadId, planKey, resumed, evidence }) => ({ botId, threadId, planKey, resumed, steps: evidence.filter((entry) => entry.step) })));
    expect(seen.filter((turn) => turn.unplanned)).toEqual([]);
    expect(receiptsOf(answers(leadAsked)[0])).toMatchObject([{ botId: team.cutter.id }]);
    expect(receiptsOf(answers(memberAsked)[0])).toMatchObject([{ botId: team.lead.id }]);
    for (const turn of [leadAsked, memberAsked]) expect(told(turn)).not.toMatch(/upstream of you|downstream of you/);
    expect(readFileSync(flowFile(), "utf8")).toBe(legacy);
  }, hostTimeout(240_000));
});
