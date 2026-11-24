import { join, resolve } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { liveCardKind, liveDecisionRefusal } from "../shared/live-approval.ts";
import type { TeamProjectProposal } from "../shared/team-project-proposal.ts";
import type { CreateTeamProjectInput, CreateTeamProjectResult, ProjectTeamWire, TeamProjectRefusal, TeamProjectWire } from "../shared/team-projects.ts";
import type { OptionCardData } from "../shared/wire.ts";
import { closedByStop, resumableCards } from "./host/resumable-cards.ts";
import "./server-line-packs.ts";
import type { Store } from "./store.ts";
import { TEAM_PROJECT_BRIEF_MAX, TeamProjectProposalError, TeamProjectProposalService, type TeamProjectProposalOptions } from "./team-project-proposal.ts";

const MAIN = "magicbot";
const THREAD = "thread-main";
const ROOT = resolve("/projects");
const BRIEF = "Make a 60-episode revenge drama about a bride who was swapped at the altar. Keep each episode under two minutes.";

const PIA = { id: "src-pia", name: "Pia", title: "Runs the production" };
const URBAN: ProjectTeamWire = {
  name: "Urban romance crew", context: "CEO romance, revenge, sweet romance. Every episode ends on a hook.", chief: PIA,
  members: [PIA, { id: "src-wen", name: "Wen", title: "Writes the episodes" }, { id: "src-sol", name: "Sol", title: "Draws the shots" }],
};
const PERIOD: ProjectTeamWire = {
  name: "Period drama crew", context: "Palace intrigue, time travel", chief: { id: "src-dee", name: "Dee", title: "Directs" },
  members: [{ id: "src-dee", name: "Dee", title: "Directs" }],
};
const LEADERLESS: ProjectTeamWire = { name: "Loose ends", context: "", chief: null, members: [{ id: "src-lou", name: "Lou", title: "" }], unusable: "no_chief" };

type Row = { id: string; at: number; role: "bot"; kind: "options"; card: OptionCardData };

function cardStore() {
  const rows: Row[] = [];
  return {
    rows,
    messagesFor: (threadId: string) => (threadId === THREAD ? rows : []),
    activePath: (threadId: string) => (threadId === THREAD ? rows : []),
    appendMessage(_threadId: string, message: Omit<Row, "id" | "at">) {
      const row = { ...message, id: `m${rows.length + 1}`, at: rows.length + 1 };
      rows.push(row);
      return row;
    },
    patchMessage(_threadId: string, messageId: string, patch: { card: OptionCardData }) {
      const row = rows.find((item) => item.id === messageId);
      if (row) row.card = patch.card;
    },
  };
}

const madeProject = (input: CreateTeamProjectInput): TeamProjectWire => ({
  id: "project-1", name: input.name, folder: join(ROOT, input.name), section: input.name,
  team: { key: "team:urban", name: input.team }, leadBotId: "bot-pia", createdAt: 5,
  folderState: "ready", botIds: ["bot-pia", "bot-wen", "bot-sol"], follows: { "bot-pia": "src-pia", "bot-wen": "src-wen", "bot-sol": "src-sol" }, episodeBots: {},
});

interface Setup {
  store?: ReturnType<typeof cardStore>;
  teams?: ProjectTeamWire[];
  root?: string | null;
  language?: string;
  create?: (input: CreateTeamProjectInput) => Promise<CreateTeamProjectResult>;
  handOff?: TeamProjectProposalOptions["handOff"];
  /** Why the lead takes no work, in the person's words. */
  held?: string;
}

const delivered: TeamProjectProposalOptions["handOff"] = async (_from, call) =>
  ({ status: 200, body: { receipts: [{ botId: call.botIds[0], botName: "Pia", outcome: "queued", detail: "queued", threadId: "pia-drama" }] } });
const refusedHandOff = (detail: string): TeamProjectProposalOptions["handOff"] => async (_from, call) =>
  ({ status: 409, body: { error: detail, receipts: [{ botId: call.botIds[0], botName: "Pia", outcome: "failed", detail }] } });

function service(setup: Setup = {}) {
  const store = setup.store ?? cardStore();
  const world = { teams: setup.teams ?? [URBAN, PERIOD, LEADERLESS], root: setup.root === undefined ? ROOT : setup.root };
  const create = vi.fn(setup.create ?? (async (input: CreateTeamProjectInput): Promise<CreateTeamProjectResult> => ({ project: madeProject(input) })));
  const steps: string[] = [];
  const handOff = vi.fn<TeamProjectProposalOptions["handOff"]>(async (from, call) => { steps.push("hand off"); return (setup.handOff ?? delivered)(from, call); });
  const answers: string[] = [];
  const followed: Array<{ from: string; to: string }> = [];
  let parked = true;
  const decisions: Array<{ decision: string; requestId: string }> = [];
  const proposals = new TeamProjectProposalService({
    store,
    language: () => setup.language,
    backends: { projects: { create, teams: () => world.teams }, projectsRoot: () => world.root },
    botName: (botId) => (botId === "bot-pia" ? "Pia" : undefined),
    answer: (_threadId, _messageId, text) => { answers.push(text); return parked; },
    follow: (_threadId, from, to) => { followed.push({ from, to }); },
    release: (threadId, messageId) => { steps.push(`release ${threadId} ${messageId}`); },
    handOff,
    held: () => setup.held ?? null,
    decide: (row) => { decisions.push(row); },
  });
  const propose = (over: Partial<{ name: string; team: string; brief: string; botId: string }> = {}) =>
    proposals.propose({ botId: MAIN, threadId: THREAD, name: "The Swapped Bride", team: URBAN.name, brief: BRIEF, ...over });
  const respond = (requestId: string, behavior: string, ownerReview = true) => proposals.respond({ threadId: THREAD, requestId, behavior }, ownerReview);
  const waiting = () => resumableCards(store as unknown as Pick<Store, "activePath">, THREAD, 0);
  return { store, proposals, create, handOff, steps, answers, followed, decisions, propose, respond, waiting, world, noTurnParked: () => { parked = false; }, turnParked: () => { parked = true; } };
}

const refusal = (work: () => unknown): TeamProjectProposalError => {
  try {
    work();
  } catch (error) {
    if (error instanceof TeamProjectProposalError) return error;
    throw error;
  }
  throw new Error("the proposal was not refused");
};

describe("the teams the main bot is shown", () => {
  it("lists each one's name, context, Chief of Staff and members with their titles", () => {
    const text = service().proposals.teamsText();
    expect(text).toContain('"Urban romance crew"');
    expect(text).toContain("Context: CEO romance, revenge, sweet romance. Every episode ends on a hook.");
    expect(text).toContain("Chief of Staff: Pia (Runs the production)");
    expect(text).toContain("Members: Pia: Runs the production; Wen: Writes the episodes; Sol: Draws the shots");
    expect(text).toContain('"Period drama crew"');
    expect(text).toContain("Chief of Staff: Dee (Directs)");
  });

  it("lists a team no project can be made from with the reason, and how to make it usable", () => {
    const text = service().proposals.teamsText();
    expect(text).toContain('"Loose ends": cannot be used.');
    expect(text).toMatch(/Loose ends.*no Chief of Staff.*propose_team_setup/);
  });

  it("tells the main bot to propose a new team first when none fits, with a Chief of Staff, and never to make bots itself", () => {
    const text = service().proposals.teamsText();
    expect(text).toMatch(/When no team fits, do not propose a project yet: propose a new team with propose_team_setup first, with one of its bots appointed Chief of Staff/);
    expect(text).toMatch(/once the person has confirmed that team/);
    expect(text).toMatch(/Never make bots for it with create_bot/);
  });

  it("shortens a long context to a line", () => {
    const text = service({ teams: [{ ...URBAN, context: `${"word ".repeat(200)}\n\nmore` }] }).proposals.teamsText();
    const line = text.split("\n").find((each) => each.startsWith("  Context: "))!;
    expect(line.length).toBeLessThan(420);
    expect(line.endsWith("…")).toBe(true);
  });

  it("says there is no team to use, and to propose one, when there is none or none can be used", () => {
    for (const teams of [[], [LEADERLESS]]) {
      const text = service({ teams }).proposals.teamsText();
      expect(text).toMatch(/no team a project can be made from yet/i);
      expect(text).toMatch(/propose_team_setup/);
      expect(text).toMatch(/Chief of Staff/);
      expect(text).not.toMatch(/^Teams \(/);
    }
  });
});

describe("proposing a project", () => {
  it("puts a card in the conversation with the name, the folder, the team and its members, and Create and Cancel", () => {
    const { store, propose, decisions, waiting } = service();
    const proposed = propose();
    expect(store.rows).toHaveLength(1);
    const card = store.rows[0]!.card;
    expect(card).toMatchObject({
      title: "Create the project “The Swapped Bride”?", options: ["Create", "Cancel"], fixedOptions: true,
      requestId: proposed.requestId, tool: "propose_team_project",
    });
    expect(card.subtitle).toBe(`${join(ROOT, "The Swapped Bride")}\nUrban romance crew: Pia, Wen, and Sol`);
    expect(card.teamProjectProposal).toEqual({
      requestId: proposed.requestId, botId: MAIN, threadId: THREAD, name: "The Swapped Bride", folder: join(ROOT, "The Swapped Bride"),
      team: { name: "Urban romance crew", chief: PIA, members: URBAN.members, revision: expect.stringMatching(/^[0-9a-f]{16}$/) },
      brief: BRIEF, createdAt: expect.any(Number),
    });
    expect(card).not.toHaveProperty("answered");
    expect(card).not.toHaveProperty("autoApplied");
    expect(proposed.messageId).toBe(store.rows[0]!.id);
    expect(proposed.text).toMatch(/end (this|your) turn/i);
    expect(decisions).toEqual([expect.objectContaining({ decision: "card-shown", requestId: proposed.requestId })]);
    expect(waiting()).toEqual([{ id: proposed.messageId, waits: "project decision: Create the project “The Swapped Bride”?" }]);
  });

  it("writes the card's lines in the person's language", () => {
    const { store, propose } = service({ language: "zh" });
    propose({ name: "替嫁新娘" });
    expect(store.rows[0]!.card).toMatchObject({
      title: "创建项目“替嫁新娘”？", subtitle: `${join(ROOT, "替嫁新娘")}\nUrban romance crew：Pia、Wen和Sol`,
    });
  });

  it("trims the name and the request", () => {
    const { store, propose } = service();
    propose({ name: "  Second Chance  ", brief: `\n${BRIEF}  ` });
    expect(store.rows[0]!.card.teamProjectProposal).toMatchObject({ name: "Second Chance", folder: join(ROOT, "Second Chance"), brief: BRIEF });
  });

  it("makes no card while no folder for projects is chosen", () => {
    const { store, propose } = service({ root: null });
    const refused = refusal(() => propose());
    expect(refused.status).toBe(409);
    expect(refused.message).toMatch(/Settings/);
    expect(store.rows).toHaveLength(0);
  });

  it("makes no card for a team that is not there, and names the ones there are", () => {
    const { store, propose } = service();
    const refused = refusal(() => propose({ team: "Western crew" }));
    expect(refused.status).toBe(404);
    expect(refused.message).toContain('No team is called "Western crew"');
    expect(refused.message).toContain("Period drama crew");
    expect(store.rows).toHaveLength(0);
  });

  it("finds the team whatever the case it is written in", () => {
    const { store, propose } = service();
    propose({ team: "urban ROMANCE crew" });
    expect(store.rows[0]!.card.teamProjectProposal!.team!.name).toBe("Urban romance crew");
  });

  it("makes no card for a team no project can be made from, and says why", () => {
    const { store, propose } = service();
    const refused = refusal(() => propose({ team: "Loose ends" }));
    expect(refused.status).toBe(409);
    expect(refused.message).toMatch(/no Chief of Staff/);
    expect(refused.message).toMatch(/propose_team_setup/);
    expect(store.rows).toHaveLength(0);
  });

  it.each(["", "   ", ".", "..", "a/b", "../escape", "/abs", "a\\b", "Act 1: Dawn", "Why?", ".hidden", "Ends with a dot.", "CON", "n".repeat(61)])(
    "makes no card for the name %j, which projects would not take as a folder's name", (name) => {
      const { store, propose } = service();
      const refused = refusal(() => propose({ name }));
      expect(refused.status).toBe(400);
      expect(refused.message).toMatch(/at most 60 characters/);
      expect(store.rows).toHaveLength(0);
    });

  it("takes a name of sixty characters, and one in Chinese", () => {
    const { store, propose } = service();
    propose({ name: "n".repeat(60) });
    propose({ name: "替嫁新娘" });
    expect(store.rows.map((row) => row.card.teamProjectProposal?.folder)).toEqual([join(ROOT, "n".repeat(60)), join(ROOT, "替嫁新娘")]);
  });

  it("shows the name as projects will write it: composed characters, as the folder is named", () => {
    const { store, propose } = service();
    propose({ name: "Cafe\u0301 Noir" });
    expect(store.rows[0]!.card.teamProjectProposal).toMatchObject({ name: "Café Noir", folder: join(ROOT, "Café Noir") });
    expect(store.rows[0]!.card.title).toBe("Create the project “Café Noir”?");
  });

  it("makes no card without a request, or with one too long to hand over", () => {
    const { store, propose } = service();
    expect(refusal(() => propose({ brief: "  " })).status).toBe(400);
    expect(refusal(() => propose({ brief: "x".repeat(TEAM_PROJECT_BRIEF_MAX + 1) })).status).toBe(400);
    expect(TEAM_PROJECT_BRIEF_MAX).toBeGreaterThanOrEqual(4000);
    expect(store.rows).toHaveLength(0);
  });
});

describe("answering the card", () => {
  it("Create makes the project as a person would and hands the request to its lead itself, waking no turn of the main bot", async () => {
    const { store, propose, respond, create, handOff, steps, answers, decisions, waiting } = service();
    const { requestId, messageId } = propose();
    const answered = await respond(requestId, "allow");
    expect(create).toHaveBeenCalledExactlyOnceWith({ name: "The Swapped Bride", team: "Urban romance crew" });
    expect(handOff).toHaveBeenCalledExactlyOnceWith({ botId: MAIN, threadId: THREAD },
      { botIds: ["bot-pia"], message: BRIEF, thread: "new", title: "The Swapped Bride", reply: "none", rework: false, consult: false });
    expect(steps).toEqual([`release ${THREAD} ${messageId}`, "hand off"]);
    const result = { state: "created", projectId: "project-1", leadBotId: "bot-pia", leadName: "Pia" };
    expect(answered).toEqual({ status: 200, body: { ok: true, outcome: "allowed-once", result, alreadySettled: false } });
    const card = store.rows[0]!.card;
    expect(card).toMatchObject({ answered: "allow", teamProjectProposal: { result } });
    for (const closed of ["expired", "held"]) expect(card).not.toHaveProperty(closed);
    expect(answers).toEqual([]);
    expect(decisions.map((row) => row.decision)).toEqual(["card-shown", "user-approved"]);
    expect(waiting()).toEqual([]);
  });

  it("hands over under the name and in the folder projects made", async () => {
    const elsewhere = join(resolve("/moved"), "The Swapped Bride");
    const { store, propose, respond, handOff } = service({ create: async (input) => ({ project: { ...madeProject(input), folder: elsewhere } }) });
    await respond(propose({ name: "  The Swapped Bride " }).requestId, "allow");
    expect(store.rows[0]!.card.teamProjectProposal).toMatchObject({ name: "The Swapped Bride", folder: elsewhere, result: { state: "created" } });
    expect(store.rows[0]!.card.teamProjectProposal!.result).not.toHaveProperty("missingSkills");
    expect(handOff.mock.calls[0]![1]).toMatchObject({ title: "The Swapped Bride" });
  });

  it("a lead that takes no work keeps the project made, and the card says why in the person's words", async () => {
    const why = "Every bot is paused, so Pia takes no new work. Resume every bot from any bot’s menu in the sidebar.";
    const { store, propose, respond, answers, waiting } = service({ handOff: refusedHandOff("@Pia is paused by the person"), held: why });
    const answered = await respond(propose().requestId, "allow");
    expect(answered).toMatchObject({ status: 200, body: { outcome: "allowed-once", result: { state: "created", leadBotId: "bot-pia" } } });
    expect(store.rows[0]!.card).toMatchObject({ answered: "allow", held: `The request did not reach Pia. ${why} Then open the project and tell Pia what you want.` });
    expect(store.rows[0]!.card).not.toHaveProperty("expired");
    expect(answers).toEqual([]);
    expect(waiting()).toEqual([]);
  });

  it("a hand-off refused for any other reason, or that fails, says plainly that the request did not reach the lead", async () => {
    for (const handOff of [refusedHandOff("not sent"), async () => { throw new Error("down"); }]) {
      const { store, propose, respond } = service({ handOff, language: "zh" });
      expect(await respond(propose().requestId, "allow")).toMatchObject({ status: 200, body: { result: { state: "created" } } });
      expect(store.rows[0]!.card.held).toBe("需求没能交给Pia。请打开项目，直接把需求告诉Pia。");
    }
  });

  it("Cancel makes nothing and tells the main bot not to propose it again", async () => {
    const { store, propose, respond, create, answers, decisions } = service();
    const { requestId } = propose();
    expect(await respond(requestId, "deny")).toEqual({ status: 200, body: { ok: true, outcome: "rejected", result: { state: "cancelled" }, alreadySettled: false } });
    expect(create).not.toHaveBeenCalled();
    expect(store.rows[0]!.card).toMatchObject({ answered: "deny", teamProjectProposal: { result: { state: "cancelled" }, resumed: true } });
    expect(answers).toHaveLength(1);
    expect(answers[0]).toMatch(/Cancel/);
    expect(answers[0]).toMatch(/no project was made/i);
    expect(answers[0]).not.toContain("coordinate_bots");
    expect(decisions.map((row) => row.decision)).toEqual(["card-shown", "user-denied"]);
  });

  it("Create counts only from the owner; Cancel from anyone who may answer cards", async () => {
    const { store, propose, respond, create } = service();
    const { requestId } = propose();
    expect(await respond(requestId, "allow", false)).toMatchObject({ status: 403, body: { errorKey: "serverError.teamProjectProposal.ownerCreates" } });
    expect(create).not.toHaveBeenCalled();
    expect(store.rows[0]!.card).not.toHaveProperty("answered");
    expect(await respond(requestId, "deny", false)).toMatchObject({ status: 200, body: { result: { state: "cancelled" } } });
  });

  it("refuses an answer that is neither Create nor Cancel, and leaves other cards to their own services", async () => {
    const { propose, respond, create, store } = service();
    const { requestId } = propose();
    expect(await respond(requestId, "answer")).toMatchObject({ status: 400 });
    expect(await respond("some-other-card", "allow")).toBeNull();
    store.rows.push({ id: "other", at: 9, role: "bot", kind: "options", card: { title: "Other", subtitle: "", options: ["Allow", "Deny"], requestId: "plain", tool: "Bash" } });
    expect(await respond("plain", "allow")).toBeNull();
    expect(create).not.toHaveBeenCalled();
  });

  it("a second proposal replaces the first, which can no longer be answered", async () => {
    const { store, propose, respond, create, waiting } = service();
    const older = propose();
    const newer = propose({ name: "The Returned Heiress", team: PERIOD.name });
    expect(store.rows[0]!.card).toMatchObject({ expired: true, options: [] });
    expect(store.rows[0]!.card.teamProjectProposal).not.toHaveProperty("result");
    expect(waiting().map((card) => card.id)).toEqual([newer.messageId]);
    expect(await respond(older.requestId, "allow")).toMatchObject({ status: 200, body: { alreadySettled: true, outcome: "rejected" } });
    expect(create).not.toHaveBeenCalled();
    expect(await respond(newer.requestId, "allow")).toMatchObject({ body: { alreadySettled: false, result: { state: "created" } } });
    expect(create).toHaveBeenCalledExactlyOnceWith({ name: "The Returned Heiress", team: "Period drama crew" });
  });

  it("the turn that waits on the replaced card waits on the newer one, so the main bot still hears the decision", () => {
    const { propose, followed } = service();
    const first = propose();
    const second = propose({ name: "The Returned Heiress" });
    const third = propose({ name: "The Heiress Returns" });
    expect(followed).toEqual([{ from: first.messageId, to: second.messageId }, { from: second.messageId, to: third.messageId }]);
  });

  it("a card that was answered is not replaced by a later proposal: nothing waits on it any more", async () => {
    const { store, propose, respond, followed } = service();
    const first = propose();
    await respond(first.requestId, "deny");
    propose({ name: "The Returned Heiress" });
    expect(followed).toEqual([]);
    expect(store.rows[0]!.card).toMatchObject({ answered: "deny" });
    expect(store.rows[0]!.card).not.toHaveProperty("expired");
  });

  it("answers a card once: a second press while the project is being made is refused, a later one changes nothing", async () => {
    let finish = () => {};
    const { propose, respond, create, handOff, answers } = service({ create: (input) => new Promise((done) => { finish = () => done({ project: madeProject(input) }); }) });
    const { requestId } = propose();
    const first = respond(requestId, "allow");
    expect(await respond(requestId, "allow")).toMatchObject({ status: 409, body: { errorKey: "serverError.teamProjectProposal.beingCreated" } });
    expect(await respond(requestId, "deny")).toMatchObject({ status: 409 });
    finish();
    expect(await first).toMatchObject({ status: 200, body: { alreadySettled: false } });
    expect(await respond(requestId, "allow")).toMatchObject({ status: 200, body: { alreadySettled: true, result: { state: "created" } } });
    expect(await respond(requestId, "deny")).toMatchObject({ status: 200, body: { alreadySettled: true, outcome: "allowed-once" } });
    expect(create).toHaveBeenCalledOnce();
    expect(handOff).toHaveBeenCalledOnce();
    expect(answers).toEqual([]);
  });
});

describe("a project that could not be made", () => {
  const REFUSALS: Array<[TeamProjectRefusal, RegExp]> = [
    ["no_root", /Settings/],
    ["root_missing", /drive/i],
    ["bad_name", /at most 60 characters.*Propose again under such a name/],
    ["name_taken", /another name/i],
    ["folder_exists", /another name/i],
    ["no_team", /list_project_teams/],
    ["team_unusable", /list_project_teams/],
    ["failed", /what went wrong/i],
  ];

  it.each(REFUSALS)("%s: the person reads why on the card, and the main bot is told so it can propose again", async (code, hint) => {
    const { store, propose, respond, answers, decisions, waiting } = service({ create: async () => ({ error: `refused as ${code}`, code }) });
    const { requestId } = propose();
    const answered = await respond(requestId, "allow");
    expect(answered).toMatchObject({ status: 200, body: { ok: true, outcome: "rejected", result: { state: "refused", code, error: `refused as ${code}` }, alreadySettled: false } });
    const card = store.rows[0]!.card;
    expect(card).toMatchObject({ expired: true, options: [], teamProjectProposal: { result: { state: "refused", code }, resumed: true } });
    expect(card).not.toHaveProperty("answered");
    expect(card.held).toBeTruthy();
    expect(card.held).not.toContain(code);
    expect(answers).toHaveLength(1);
    expect(answers[0]).toContain(code);
    expect(answers[0]).toMatch(hint);
    expect(answers[0]).toMatch(/was not made/i);
    expect(answers[0]).not.toMatch(/Hand the person's request to the lead/);
    expect(decisions.map((row) => row.decision)).toEqual(["card-shown", "user-approved"]);
    expect(waiting()).toEqual([]);
  });

  it("a name already in use is told to the person in plain words that name it", async () => {
    const { store, propose, respond } = service({ create: async () => ({ error: "taken", code: "name_taken" }) });
    await respond(propose().requestId, "allow");
    expect(store.rows[0]!.card.held).toBe("A project or a department is already called “The Swapped Bride”. Ask again with another name.");
  });

  it("a failure does not promise that nothing was left behind: the main bot passes on what went wrong", async () => {
    const { store, propose, respond, answers } = service({ create: async () => ({ error: "part of it could not be removed again", code: "failed" }) });
    await respond(propose().requestId, "allow");
    expect(store.rows[0]!.card.held).toBe("The project couldn't be made. Ask again to try once more.");
    expect(answers[0]).toContain("part of it could not be removed again");
    expect(answers[0]).not.toMatch(/card already tells/i);
  });

  it("an error while making it reads as a failure, never as a project", async () => {
    const { store, propose, respond, answers } = service({ create: async () => { throw new Error("disk full"); } });
    expect(await respond(propose().requestId, "allow")).toMatchObject({ status: 200, body: { result: { state: "refused", code: "failed", error: "disk full" } } });
    expect(store.rows[0]!.card).toMatchObject({ expired: true, options: [] });
    expect(answers[0]).toContain("disk full");
  });

  it.each<[string, ProjectTeamWire]>([
    ["a member left", { ...URBAN, members: URBAN.members.slice(0, 2) }],
    ["a member's title changed", { ...URBAN, members: [PIA, { ...URBAN.members[1]!, title: "Rewrites the episodes" }, URBAN.members[2]!] }],
    ["another bot became its Chief", { ...URBAN, chief: URBAN.members[1]!, members: [URBAN.members[1]!, PIA, URBAN.members[2]!] }],
  ])("does not make a team the person did not see: a team whose %s after the card was made is refused", async (_change, changed) => {
    const setup = service();
    const { requestId } = setup.propose();
    setup.world.teams = [changed, PERIOD];
    expect(await setup.respond(requestId, "allow")).toMatchObject({ body: { outcome: "rejected", result: { state: "refused", code: "team_changed" } } });
    expect(setup.create).not.toHaveBeenCalled();
    expect(setup.store.rows[0]!.card).toMatchObject({
      expired: true, options: [], held: "This team changed after this card was made. Ask again to see the team as it is now.",
    });
    expect(setup.answers[0]).toMatch(/list_project_teams/);
  });

  it("a team that changed only its context is the team the person saw", async () => {
    const setup = service();
    const { requestId } = setup.propose();
    setup.world.teams = [{ ...URBAN, context: "Sweet romance only." }, PERIOD];
    expect(await setup.respond(requestId, "allow")).toMatchObject({ body: { result: { state: "created" } } });
  });

  it("a team deleted or renamed after the card was made is refused as no_team", async () => {
    for (const teams of [[PERIOD], [{ ...URBAN, name: "City romance crew" }, PERIOD]]) {
      const setup = service();
      const { requestId } = setup.propose();
      setup.world.teams = teams;
      expect(await setup.respond(requestId, "allow")).toMatchObject({ body: { result: { state: "refused", code: "no_team" } } });
      expect(setup.create).not.toHaveBeenCalled();
      expect(setup.store.rows[0]!.card.held).toBe("This team is no longer there. Ask again to pick another one.");
    }
  });

  it("a card that names a team template instead of a team is refused, and makes nothing", async () => {
    const setup = service();
    const old: TeamProjectProposal = {
      requestId: "old-card", botId: MAIN, threadId: THREAD, name: "The Swapped Bride", folder: join(ROOT, "The Swapped Bride"),
      template: { id: "tpl-urban", name: "Urban romance crew", version: 3, genre: "CEO romance", lead: "producer", roles: [{ key: "producer", name: "Pia", title: "Runs the production" }] },
      brief: BRIEF, createdAt: 1,
    };
    setup.store.rows.push({ id: "m1", at: 1, role: "bot", kind: "options", card: { title: "Create the project “The Swapped Bride”?", subtitle: "", options: ["Create", "Cancel"], requestId: "old-card", tool: "propose_team_project", fixedOptions: true, teamProjectProposal: old } });
    expect(await setup.respond("old-card", "allow")).toMatchObject({ body: { outcome: "rejected", result: { state: "refused", code: "team_changed" } } });
    expect(setup.create).not.toHaveBeenCalled();
    expect(setup.answers[0]).toMatch(/list_project_teams/);
  });

  it("does not make a folder the person did not see: another folder for projects chosen after the card was made is refused", async () => {
    const setup = service();
    const { requestId } = setup.propose();
    setup.world.root = resolve("/elsewhere");
    expect(await setup.respond(requestId, "allow")).toMatchObject({ body: { outcome: "rejected", result: { state: "refused", code: "root_changed" } } });
    expect(setup.create).not.toHaveBeenCalled();
    expect(setup.store.rows[0]!.card).toMatchObject({
      expired: true, options: [], held: "The folder for new projects changed after this card was made. Ask again to see where the project will go.",
      teamProjectProposal: { folder: join(ROOT, "The Swapped Bride") },
    });
    expect(setup.answers[0]).toMatch(/root_changed/);
    expect(setup.answers[0]).toMatch(/Propose once more/);
  });

  it("the same folder for projects written another way is the same folder", async () => {
    const setup = service();
    const { requestId } = setup.propose();
    setup.world.root = `${ROOT}/`;
    expect(await setup.respond(requestId, "allow")).toMatchObject({ body: { result: { state: "created" } } });
  });

  it("a folder for projects that is no longer chosen, or cannot be read, is left to projects to refuse", async () => {
    const unset = service({ create: async () => ({ error: "no folder for projects", code: "no_root" }) });
    const first = unset.propose();
    unset.world.root = null;
    expect(await unset.respond(first.requestId, "allow")).toMatchObject({ body: { result: { state: "refused", code: "no_root" } } });
    expect(unset.create).toHaveBeenCalledOnce();
    expect(unset.store.rows[0]!.card.held).toBe("The folder for new projects isn't set yet. Choose it in Settings → Data, then ask again.");
  });
});

describe("a restart with a card pending", () => {
  it("the card can still be answered: everything Create needs is on it", async () => {
    const before = service();
    const { requestId } = before.propose();
    const after = service({ store: before.store });
    expect(after.waiting()).toHaveLength(1);
    expect(await after.respond(requestId, "allow")).toMatchObject({ status: 200, body: { result: { state: "created", leadBotId: "bot-pia" } } });
    expect(after.create).toHaveBeenCalledExactlyOnceWith({ name: "The Swapped Bride", team: "Urban romance crew" });
    expect(before.create).not.toHaveBeenCalled();
    expect(after.handOff.mock.calls[0]![1]).toMatchObject({ message: BRIEF });
  });

  it("a decision no turn could take is kept, and handed over once a turn is parked on the card again", async () => {
    const setup = service();
    const { requestId, messageId } = setup.propose();
    expect(setup.proposals.decided(THREAD, messageId)).toBe(false);
    setup.noTurnParked();
    await setup.respond(requestId, "deny");
    const kept = setup.store.rows[0]!.card.teamProjectProposal!;
    expect(kept.result).toEqual({ state: "cancelled" });
    expect(kept).not.toHaveProperty("resumed");
    expect(setup.waiting().map((card) => card.id)).toEqual([messageId]);

    const restarted = service({ store: setup.store });
    expect(restarted.proposals.decided(THREAD, messageId)).toBe(true);
    const heard: string[] = [];
    expect(restarted.proposals.resume(THREAD, messageId, (text) => { heard.push(text); return true; })).toBe(true);
    expect(heard).toEqual([`MagicBot project decision ${requestId}: the person pressed Cancel, so no project was made. Do not propose it again unless they ask. If they tell you what to change, call propose_team_project again with the change.`]);
    expect(setup.store.rows[0]!.card.teamProjectProposal).toMatchObject({ resumed: true });
    expect(restarted.waiting()).toEqual([]);
    expect(restarted.create).not.toHaveBeenCalled();
  });

  it("a made project leaves nothing for the main bot to hear, before a restart or after it", async () => {
    const setup = service();
    const { requestId, messageId } = setup.propose();
    await setup.respond(requestId, "allow");
    const restarted = service({ store: setup.store });
    const answer = vi.fn(() => true);
    expect(restarted.proposals.decided(THREAD, messageId)).toBe(false);
    expect(restarted.proposals.resume(THREAD, messageId, answer)).toBe(false);
    expect(answer).not.toHaveBeenCalled();
    expect(restarted.waiting()).toEqual([]);
    expect(restarted.handOff).not.toHaveBeenCalled();
  });

  it("resume hands nothing over for a card nobody answered", () => {
    const { propose, proposals } = service();
    const { messageId } = propose();
    const answer = vi.fn(() => true);
    expect(proposals.resume(THREAD, messageId, answer)).toBe(false);
    expect(answer).not.toHaveBeenCalled();
  });
});

describe("a Live call", () => {
  it("never answers the card by voice: making a project is reviewed on screen", async () => {
    const { store, propose, respond } = service();
    const { requestId } = propose();
    expect(liveCardKind(store.rows[0]!.card)).toBe("review");
    expect(liveDecisionRefusal(store.rows[0]!.card)).toBe("This request is reviewed on screen.");
    await respond(requestId, "deny");
    expect(liveCardKind(store.rows[0]!.card)).toBeNull();
  });
});

describe("Stop while the main bot waits on the card", () => {
  it("closes the card, and it cannot be answered afterwards", async () => {
    const { store, propose, respond, create } = service();
    const { requestId } = propose();
    const closed = closedByStop(store.rows[0]!.card);
    expect(closed).toMatchObject({ answered: "unavailable", dismissed: true });
    store.rows[0]!.card = closed!;
    expect(await respond(requestId, "allow")).toMatchObject({ status: 200, body: { alreadySettled: true, outcome: "rejected" } });
    expect(create).not.toHaveBeenCalled();
  });
});
