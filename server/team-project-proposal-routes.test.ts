import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { CreateTeamProjectInput, CreateTeamProjectResult, ProjectTeamWire, TeamProjectWire } from "../shared/team-projects.ts";
import type { OptionCardData } from "../shared/wire.ts";
import { flushDecisionLog } from "./decision-log.ts";
import { PASS } from "./routes/table.ts";
import { removeTempDir } from "./testing/cleanup.ts";
import { createTeamProjectProposals, type TeamProjectProposalsDeps } from "./team-project-proposal-routes.ts";
import type { TeamProjectBackends } from "./team-project-proposal.ts";
import { userErrorThrown } from "./user-errors.ts";

type Bot = NonNullable<ReturnType<TeamProjectProposalsDeps["store"]["bot"]>>;
type Line = { id: string; card?: OptionCardData };

const MAIN: Bot = { id: "magicbot", name: "MagicBot", defaultBot: {}, chiefOfStaff: true };
const LEAD: Bot = { id: "bot-pia", name: "Pia", chiefOfStaff: true, teamProject: { id: "project-1", role: "producer" } };
const MEMBER: Bot = { id: "bot-wen", name: "Wen", teamProject: { id: "project-1", role: "writer" } };
const ORDINARY: Bot = { id: "bot-plain", name: "Plain" };
const CHIEF: Bot = { id: "bot-chief", name: "Chief", chiefOfStaff: true };
const BOTS = [MAIN, LEAD, MEMBER, ORDINARY, CHIEF];

const TEAM: ProjectTeamWire = {
  name: "Short drama crew", context: "Revenge and romance in sixty episodes.", chief: { id: "src-pia", name: "Pia", title: "Runs the production" },
  members: [{ id: "src-pia", name: "Pia", title: "Runs the production" }, { id: "src-wen", name: "Wen", title: "Writes the episodes" }],
};

const made = (input: CreateTeamProjectInput): TeamProjectWire => ({
  id: "project-1", name: input.name, folder: `/projects/${input.name}`, section: input.name, team: { key: "team:drama", name: input.team },
  leadBotId: LEAD.id, createdAt: 1, folderState: "ready", botIds: [LEAD.id, MEMBER.id], follows: { [LEAD.id]: "src-pia", [MEMBER.id]: "src-wen" }, episodeBots: {},
});

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => removeTempDir(dir)));
});

function setup(options: { backends?: Partial<TeamProjectBackends>; rooms?: string[] } = {}) {
  const dataDir = mkdtempSync(join(tmpdir(), "omb-team-project-proposal-"));
  dirs.push(dataDir);
  const rows: Line[] = [];
  const answers: string[] = [];
  const released: Array<[string, string]> = [];
  const handOff = vi.fn(async (_from: { botId: string; threadId: string }, call: { botIds: string[] }) =>
    ({ status: 200, body: { receipts: [{ botId: call.botIds[0], botName: "Pia", outcome: "queued", detail: "queued", threadId: "pia-drama" }] } }));
  const create = vi.fn(async (input: CreateTeamProjectInput): Promise<CreateTeamProjectResult> => ({ project: made(input) }));
  const backends: TeamProjectBackends = { projects: { create, teams: () => [TEAM] }, projectsRoot: () => "/projects", ...options.backends };
  const proposals = createTeamProjectProposals({
    store: {
      messagesFor: () => rows,
      appendMessage: (_threadId, message) => { const line = { id: `m${rows.length + 1}`, card: message.card }; rows.push(line); return line; },
      patchMessage: (_threadId, messageId, patch) => { const line = rows.find((row) => row.id === messageId); if (line) line.card = patch.card; return line ?? null; },
      bot: (id) => BOTS.find((bot) => bot.id === id),
    },
    dataDir,
    backends: () => backends,
    directChat: (_botId, threadId) => !(options.rooms ?? []).includes(threadId),
    answerCardNode: (_threadId, _messageId, text) => { answers.push(text); return true; },
    followCard: () => {},
    releaseCardNode: (threadId, messageId) => { released.push([threadId, messageId]); },
    handOff,
    held: () => null,
    threadLanguage: () => undefined,
  });
  const call = async (bot: Bot, method: string, path: string, body?: unknown, extra: { threadId?: string; active?: boolean } = {}) => {
    const json = vi.fn();
    const outcome = await proposals.internal({
      method, path, res: {} as never, json, bot, threadId: extra.threadId ?? "thread-main",
      readBody: async () => {
        if (extra.active === false) throw Object.assign(new Error("the turn has ended"), { status: 401 });
        return body as Record<string, unknown>;
      },
      requireActive: () => { if (extra.active === false) throw Object.assign(new Error("the turn has ended"), { status: 401 }); },
    });
    const [, status, payload] = json.mock.calls[0] ?? [];
    return { outcome, status: status as number | undefined, payload: payload as { text?: string; error?: string; requestId?: string } | undefined };
  };
  const decisions = async () => {
    await flushDecisionLog(dataDir);
    const folder = join(dataDir, "decisions");
    return readdirSync(folder).flatMap((file) => readFileSync(join(folder, file), "utf8").trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>));
  };
  return { proposals, rows, answers, released, handOff, create, call, decisions };
}

const LIST = "/api/internal/project-teams";
const PROPOSE = "/api/internal/team-project-proposals";
const ASK = { name: "The Swapped Bride", team: "Short drama crew", request: "Twelve episodes about a bride swapped at the altar." };

describe("the main bot's project routes", () => {
  it("give the main bot the teams", async () => {
    const { call } = setup();
    const listed = await call(MAIN, "GET", LIST);
    expect(listed.status).toBe(200);
    expect(listed.payload?.text).toContain('"Short drama crew"');
    expect(listed.payload?.text).toContain("Chief of Staff: Pia (Runs the production)");
  });

  it("stage a proposal as a card in the main bot's chat, and say what happens next", async () => {
    const { call, rows, decisions } = setup();
    const proposed = await call(MAIN, "POST", PROPOSE, ASK);
    expect(proposed.status).toBe(201);
    expect(proposed.payload?.text).toMatch(/card with Create and Cancel/);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.card).toMatchObject({
      requestId: proposed.payload!.requestId, tool: "propose_team_project", options: ["Create", "Cancel"],
      teamProjectProposal: { botId: MAIN.id, threadId: "thread-main", name: "The Swapped Bride", folder: "/projects/The Swapped Bride", brief: ASK.request },
    });
    expect(await decisions()).toMatchObject([{ threadId: "thread-main", botId: MAIN.id, botName: "MagicBot", tool: "propose_team_project", decision: "card-shown", source: "question" }]);
  });

  it.each([["a project's lead", LEAD], ["a project's member", MEMBER], ["an ordinary bot", ORDINARY], ["a department's Chief", CHIEF]])("refuse %s both tools, whatever its tool list says", async (_who, bot) => {
    const { call, rows, create } = setup();
    const listed = await call(bot, "GET", LIST);
    expect(listed.status).toBe(403);
    expect(listed.payload?.error).toMatch(/only the main bot/i);
    expect((await call(bot, "POST", PROPOSE, ASK)).status).toBe(403);
    expect(rows).toEqual([]);
    expect(create).not.toHaveBeenCalled();
  });

  it("refuse the main bot in a room: a project is proposed in its own chat", async () => {
    const { call, rows } = setup({ rooms: ["room-1"] });
    const refused = await call(MAIN, "POST", PROPOSE, ASK, { threadId: "room-1" });
    expect(refused.status).toBe(403);
    expect(refused.payload?.error).toMatch(/your own chat/i);
    expect((await call(MAIN, "GET", LIST, undefined, { threadId: "room-1" })).status).toBe(403);
    expect(rows).toEqual([]);
  });

  it("name what is wrong with a call's arguments", async () => {
    const { call, rows } = setup();
    for (const body of [null, {}, { name: "A" }, { ...ASK, team: 7 }, { ...ASK, request: undefined }, { ...ASK, extra: true }, { name: "A", templateId: "short-drama", request: "x" }]) {
      const refused = await call(MAIN, "POST", PROPOSE, body);
      expect(refused.status, JSON.stringify(body)).toBe(400);
      expect(refused.payload?.error).toMatch(/name.*team.*request/);
    }
    expect(rows).toEqual([]);
  });

  it("take the ids the tools' client adds, which the harness has already checked", async () => {
    const { call } = setup();
    expect((await call(MAIN, "POST", PROPOSE, { ...ASK, fromBotId: MAIN.id, fromThreadId: "thread-main" })).status).toBe(201);
  });

  it("pass on why a proposal was refused, with the teams there are", async () => {
    const { call, rows } = setup();
    const unknown = await call(MAIN, "POST", PROPOSE, { ...ASK, team: "nope" });
    expect(unknown.status).toBe(404);
    expect(unknown.payload?.error).toContain('"Short drama crew"');
    expect((await call(MAIN, "POST", PROPOSE, { ...ASK, name: "a/b" })).status).toBe(400);
    const { call: noRoot } = setup({ backends: { projectsRoot: () => null } });
    const refused = await noRoot(MAIN, "POST", PROPOSE, ASK);
    expect(refused.status).toBe(409);
    expect(refused.payload?.error).toMatch(/Settings/);
    expect(rows).toEqual([]);
  });

  it("say so when there is no team, and that the main bot proposes one first", async () => {
    const { call } = setup({ backends: { projects: { create: vi.fn(), teams: () => [] } } });
    const listed = await call(MAIN, "GET", LIST);
    expect(listed.status).toBe(200);
    expect(listed.payload?.text).toMatch(/no team a project can be made from/i);
    expect(listed.payload?.text).toMatch(/propose_team_setup/);
    const refused = await call(MAIN, "POST", PROPOSE, ASK);
    expect(refused.status).toBe(404);
    expect(refused.payload?.error).toMatch(/propose_team_setup/);
  });

  it("answer nothing once the turn has ended", async () => {
    const { call, rows } = setup();
    await expect(call(MAIN, "GET", LIST, undefined, { active: false })).rejects.toMatchObject({ status: 401 });
    await expect(call(MAIN, "POST", PROPOSE, ASK, { active: false })).rejects.toMatchObject({ status: 401 });
    expect(rows).toEqual([]);
  });

  it("leave every other path and method to the next routes", async () => {
    const { call } = setup();
    expect((await call(MAIN, "POST", LIST)).outcome).toBe(PASS);
    expect((await call(MAIN, "GET", PROPOSE)).outcome).toBe(PASS);
    expect((await call(MAIN, "GET", "/api/internal/project-teams/short-drama")).outcome).toBe(PASS);
    expect((await call(LEAD, "GET", "/api/internal/agents")).outcome).toBe(PASS);
  });
});

describe("answering the card through the host", () => {
  it("makes the project on Create, hands the request to its lead as the main bot's coordinate_bots, lets the waiting turn go, and logs who decided", async () => {
    const { proposals, call, create, answers, released, handOff, decisions, rows } = setup();
    const { payload } = await call(MAIN, "POST", PROPOSE, ASK);
    const answered = await proposals.respond({ threadId: "thread-main", requestId: payload!.requestId!, behavior: "allow" }, true);
    expect(answered).toMatchObject({ status: 200, body: { ok: true, outcome: "allowed-once", result: { state: "created", leadBotId: LEAD.id, leadName: "Pia" } } });
    expect(create).toHaveBeenCalledExactlyOnceWith({ name: "The Swapped Bride", team: "Short drama crew" });
    expect(handOff).toHaveBeenCalledExactlyOnceWith({ botId: MAIN.id, threadId: "thread-main" }, expect.objectContaining({ botIds: [LEAD.id], message: ASK.request, thread: "new", title: "The Swapped Bride", reply: "none" }));
    expect(released).toEqual([["thread-main", rows[0]!.id]]);
    expect(answers).toEqual([]);
    expect((await decisions()).map((row) => [row.decision, row.source])).toEqual([["card-shown", "question"], ["user-approved", "user"]]);
    expect(proposals.decided("thread-main", rows[0]!.id)).toBe(false);
  });

  it("is not its card: null, so the next resolver takes the answer", async () => {
    const { proposals } = setup();
    expect(await proposals.respond({ threadId: "thread-main", requestId: "someone-else's", behavior: "allow" }, true)).toBeNull();
  });
});

describe("while the list of projects cannot be read", () => {
  const unreadable = () => { throw Object.assign(userErrorThrown("serverError.teamProject.unreadable"), { status: 500 }); };

  it("shows no card, and leaves the reason in plain words to the server's own answer", async () => {
    const { call, rows } = setup({ backends: { projectsRoot: unreadable } });
    await expect(call(MAIN, "POST", PROPOSE, ASK)).rejects.toMatchObject({ status: 500, message: expect.stringMatching(/list of projects couldn't be read/) });
    expect(rows).toEqual([]);
    expect((await call(MAIN, "GET", LIST)).status).toBe(200);
  });

  it("lets Create's own refusal say why, for a card made before", async () => {
    let broken = false;
    const create = vi.fn(async (): Promise<CreateTeamProjectResult> => ({ error: "The list of projects couldn't be read, so nothing was changed.", code: "failed" }));
    const { proposals, call, rows } = setup({ backends: { projectsRoot: () => (broken ? unreadable() : "/projects"), projects: { create, teams: () => [TEAM] } } });
    const { payload } = await call(MAIN, "POST", PROPOSE, ASK);
    broken = true;
    const answered = await proposals.respond({ threadId: "thread-main", requestId: payload!.requestId!, behavior: "allow" }, true);
    expect(answered).toMatchObject({ status: 200, body: { outcome: "rejected", result: { state: "refused", code: "failed", error: expect.stringMatching(/couldn't be read/) } } });
    expect(create).toHaveBeenCalledOnce();
    expect(rows[0]!.card).toMatchObject({ expired: true, held: "The project couldn't be made. Ask again to try once more." });
  });
});
