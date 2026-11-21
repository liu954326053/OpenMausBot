import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { TeamProjectsListWire, TeamProjectWire } from "../shared/team-projects.ts";
import { launchVerificationServer, runControlOmb, type VerificationServer } from "../scripts/control-omb.ts";

const MIDNIGHT = "Midnight Train";
const PAPER = "Paper Moon";
const CREW = "Drama crew";
const NOBODY = "ffffffff-0000-4000-8000-000000000000";

interface FixtureBot { id: string; name: string; threadId: string; section?: string; chiefOfStaff?: boolean }
interface ToolAnswer { step?: { tool?: string; arguments?: Record<string, unknown> }; response?: unknown }
interface Turn { botId: string; resumed: boolean; system: string; prompt: unknown; evidence: ToolAnswer[] }

const said = (response: unknown): string =>
  ((response as { result?: { content?: Array<{ text?: string }> } })?.result?.content ?? []).map((part) => part?.text ?? "").join("\n");
const answers = (turn: Turn): string[] => turn.evidence.filter((entry) => entry.step).map((entry) => said(entry.response));
const told = (turn: Turn): string => `${turn.system}\n${JSON.stringify(turn.prompt)}`;

describe("the wall between two projects that the project code itself made from one team", () => {
  let session: VerificationServer;
  let url = "";
  const projectsRoot = mkdtempSync(join(tmpdir(), "omb-two-real-projects-"));
  let main: FixtureBot, oswald: FixtureBot, crewLead: FixtureBot, crewWriter: FixtureBot;
  let directorA: FixtureBot, writerA: FixtureBot, directorB: FixtureBot, writerB: FixtureBot;
  let midnight: TeamProjectWire, paper: TeamProjectWire;
  const record: Record<string, unknown> = {};

  const call = async (method: string, path: string, body?: unknown): Promise<{ status: number; body: any }> => {
    const response = await fetch(`${url}${path}`, {
      method,
      headers: { "content-type": "application/json", origin: url },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: await response.json().catch(() => ({})) };
  };
  const cli = (...args: string[]) => runControlOmb(args, { env: { OPENMAUSBOT_URL: url } }) as Promise<{ status?: string }>;
  const planPath = () => join(session.info.dataDir, "room-plan.json");
  const turns = (): Turn[] => existsSync(`${planPath()}.evidence.jsonl`)
    ? readFileSync(`${planPath()}.evidence.jsonl`, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as Turn)
    : [];
  const bots = async (): Promise<FixtureBot[]> => (await call("GET", "/api/bots?messages=0")).body.bots as FixtureBot[];
  const projects = async (): Promise<TeamProjectsListWire> => (await call("GET", "/api/team-projects")).body as TeamProjectsListWire;

  async function personAsks(what: string, bot: FixtureBot, text: string, plan: Record<string, unknown>): Promise<Turn[]> {
    const before = turns().length;
    writeFileSync(planPath(), JSON.stringify(plan));
    await cli("send", "--bot", bot.id, "--task", bot.threadId, "--text", text);
    const { status } = await cli("wait", "--bot", bot.id, "--task", bot.threadId, "--timeout", "60");
    const seen = turns().slice(before);
    record[what] = seen.map((turn) => ({
      bot: turn.botId, resumed: turn.resumed, told: told(turn),
      calls: turn.evidence.filter((entry) => entry.step).map((entry) => ({ ...entry.step, answer: said(entry.response) })),
    }));
    expect(status, JSON.stringify(seen.at(-1)?.evidence.at(-1))).toBe("settled");
    return seen;
  }
  const firstTurn = (seen: Turn[], bot: FixtureBot): Turn => {
    const turn = seen.find((one) => one.botId === bot.id && !one.resumed);
    expect(turn, `${bot.name} (${bot.section}) had a turn`).toBeDefined();
    return turn!;
  };
  const ran = (seen: Turn[]): string[] => [...new Set(seen.map((turn) => turn.botId))].sort();

  async function makeBot(name: string, title: string, section: string): Promise<{ id: string }> {
    const made = await call("POST", "/api/bots", { name, title, section });
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    return made.body.bot as { id: string };
  }

  beforeAll(async () => {
    session = await launchVerificationServer(process.env, undefined, undefined, undefined, undefined, { scripted: true });
    url = session.info.url;
    const health = await fetch(`${url}/api/health`, { headers: { origin: url } });
    expect(((await health.json()) as { pid?: number }).pid, "the server on this suite's port is the one it started").toBe(session.info.pid);
    const starter = (await bots())[0]!;
    expect((await call("PATCH", `/api/bots/${starter.id}/profile`, { name: "MagicBot" })).status).toBe(200);
    const made = {
      oswald: await makeBot("Oswald", "Researcher", "Studio"),
      crewLead: await makeBot("Director", "Showrunner", CREW),
      crewWriter: await makeBot("Writer", "Screenwriter", CREW),
    };
    expect((await call("PATCH", `/api/bots/${made.crewLead.id}`, { chiefOfStaff: true })).status).toBe(200);

    const root = await call("PUT", "/api/team-projects/root", { path: projectsRoot });
    expect(root.status, JSON.stringify(root.body)).toBe(200);
    for (const name of [MIDNIGHT, PAPER]) {
      const project = await call("POST", "/api/team-projects", { name, team: CREW });
      expect(project.status, JSON.stringify(project.body)).toBe(201);
    }

    const listed = await projects();
    midnight = listed.projects.find((project) => project.name === MIDNIGHT)!;
    paper = listed.projects.find((project) => project.name === PAPER)!;
    const all = await bots();
    const one = (id: string) => all.find((bot) => bot.id === id)!;
    const member = (project: TeamProjectWire) => one(project.botIds.find((id) => id !== project.leadBotId)!);
    main = one(starter.id); oswald = one(made.oswald.id); crewLead = one(made.crewLead.id); crewWriter = one(made.crewWriter.id);
    directorA = one(midnight.leadBotId); writerA = member(midnight);
    directorB = one(paper.leadBotId); writerB = member(paper);
    record.projects = listed;
    record.bots = all.map(({ id, name, section, chiefOfStaff }) => ({ id, name, section, chiefOfStaff }));
  }, 180_000);

  afterAll(async () => {
    rmSync(projectsRoot, { recursive: true, force: true });
    if (!session) return;
    const evidencePath = `${session.info.logPath}.two-real-projects.json`;
    writeFileSync(evidencePath, JSON.stringify(record, null, 2));
    console.info(JSON.stringify({ evidencePath }));
    await session.close();
  });

  it("makes two teams with the same names, each with its own lead that is its department's Chief", () => {
    for (const project of [midnight, paper]) {
      expect(project).toMatchObject({ folderState: "ready", section: project.name });
      expect(project.botIds).toHaveLength(2);
    }
    expect([directorA, directorB].map((bot) => [bot.name, bot.chiefOfStaff, bot.section])).toEqual([["Director", true, MIDNIGHT], ["Director", true, PAPER]]);
    expect([writerA, writerB].map((bot) => [bot.name, Boolean(bot.chiefOfStaff), bot.section])).toEqual([["Writer", false, MIDNIGHT], ["Writer", false, PAPER]]);
    expect(main.chiefOfStaff).toBe(true);
    expect(crewLead.chiefOfStaff).toBe(true);
  });

  it("tells a project's member of its own lead and the main bot alone, and answers every other bot as one that does not exist", async () => {
    const seen = await personAsks("a member of Midnight Train", writerA, "Where does the script stand?", {
      [writerA.id]: {
        steps: [
          { tool: "list_bots", arguments: {} },
          { arguments: { bot_ids: [NOBODY], message: "Anyone there?" }, expectError: true },
          { arguments: { bot_ids: [writerB.id], message: "Send me your outline." }, expectError: true },
          { arguments: { bot_ids: [directorB.id], message: "Send me your outline.", consult: true }, expectError: true },
          { arguments: { bot_ids: [crewWriter.id], message: "Send me your outline.", consult: true }, expectError: true },
          { arguments: { bot_ids: [oswald.id], message: "Send me your notes.", consult: true }, expectError: true },
          { arguments: { bot_ids: ["Director"], message: "Which scene is next?", consult: true } },
        ],
        reply: "Asked my Director",
        resumeReply: "The Director says scene 3 is next",
      },
      [directorA.id]: { reply: "Scene 3 is next" },
    });
    const turn = firstTurn(seen, writerA);
    const heard = told(turn);
    expect(heard).toContain("You work inside one team project.");
    expect(heard).toContain(`[id: ${directorA.id}]`);
    expect(heard).toContain(`[id: ${main.id}]`);
    for (const beyond of [directorB.id, writerB.id, crewLead.id, crewWriter.id, oswald.id, PAPER, CREW, "Oswald", "Studio"]) expect(heard, beyond).not.toContain(beyond);
    const [listed, nobody, otherWriter, otherLead, sourceWriter, outside, ownLead] = answers(turn);
    for (const reached of [directorA.id, main.id]) expect(listed, reached).toContain(reached);
    for (const beyond of [directorB.id, writerB.id, crewLead.id, crewWriter.id, oswald.id]) expect(listed, beyond).not.toContain(beyond);
    expect(nobody).toContain(`No bot with id or name "${NOBODY}"`);
    for (const [answer, asked] of [[otherWriter, writerB.id], [otherLead, directorB.id], [sourceWriter, crewWriter.id], [outside, oswald.id]] as const) {
      expect(answer!.replaceAll(asked, NOBODY), asked).toBe(nobody);
    }
    expect(JSON.parse(ownLead!).receipts).toMatchObject([{ botId: directorA.id, botName: "Director" }]);
    expect(ran(seen)).toEqual([directorA.id, writerA.id].sort());
  }, 120_000);

  it("gives the main bot each project's lead and no member, and its work reaches a member only through the lead", async () => {
    const seen = await personAsks("the main bot", main, "Have Midnight Train rewrite scene 2.", {
      [main.id]: {
        timeoutMs: 60_000,
        steps: [
          { tool: "list_bots", arguments: {} },
          { tool: "list_team_setup", arguments: {} },
          { arguments: { bot_ids: [NOBODY], message: "Rewrite scene 2." }, expectError: true },
          { arguments: { bot_ids: [writerA.id], message: "Rewrite scene 2." }, expectError: true },
          { tool: "propose_profile", arguments: { for_bot_id: directorA.id, title: "Head of story", reason: "The person asked." }, expectError: true },
          { arguments: { bot_ids: [directorA.id], message: "Have scene 2 rewritten and tell me when it is done." } },
        ],
        reply: "Handed to the project's lead",
        resumeReply: "Midnight Train reports scene 2 is rewritten",
      },
      [directorA.id]: { steps: [{ arguments: { bot_ids: ["Writer"], message: "Rewrite scene 2." } }], reply: "Assigned to my Writer", resumeReply: "Scene 2 is rewritten" },
      [writerA.id]: { reply: "Scene 2 rewritten" },
    });
    const turn = firstTurn(seen, main);
    const heard = told(turn);
    expect(heard).toContain("A bot marked Project lead in your roster leads a team project");
    for (const lead of [directorA, directorB]) expect(heard).toContain(`(${lead.section}) [Project lead] [id: ${lead.id}]`);
    for (const outside of [oswald.id, crewLead.id, crewWriter.id]) expect(heard, outside).toContain(`[id: ${outside}]`);
    for (const member of [writerA.id, writerB.id]) expect(heard, member).not.toContain(member);
    const [listed, setup, nobody, member, leadProfile, handed] = answers(turn);
    for (const reached of [directorA.id, directorB.id, oswald.id, crewLead.id, crewWriter.id]) expect(listed, reached).toContain(reached);
    for (const beyond of [writerA.id, writerB.id]) expect(listed, beyond).not.toContain(beyond);
    for (const inside of [writerA.id, writerB.id, directorA.id, directorB.id, MIDNIGHT, PAPER]) expect(setup, inside).not.toContain(inside);
    expect(member!.replaceAll(writerA.id, NOBODY)).toBe(nobody);
    expect(leadProfile).toContain("leads a team project, and what is inside a project is set up only from inside it");
    expect(JSON.parse(handed!).receipts).toMatchObject([{ botId: directorA.id }]);
    expect(ran(seen)).toEqual([directorA.id, main.id, writerA.id].sort());
    expect(JSON.stringify(firstTurn(seen, writerA).prompt)).toContain("Rewrite scene 2.");
    expect(told(seen.find((one) => one.botId === main.id && one.resumed)!)).toContain("Scene 2 is rewritten");
  }, 180_000);

  it("takes a bot added to a project's department later, by the person or by its lead, into that project and into no other", async () => {
    const editor = await makeBot("Editor", "Script editor", MIDNIGHT);
    const seen = await personAsks("the lead of Midnight Train adds to its team", directorA, "Add a composer and brief the editor.", {
      [directorA.id]: {
        timeoutMs: 60_000,
        steps: [
          { tool: "create_bot", arguments: { name: "Composer", role: "Score composer", instructions: "Write the score for every episode." } },
          { tool: "list_bots", arguments: {} },
          { arguments: { bot_ids: [editor.id], message: "Welcome. Read the outline.", consult: true } },
        ],
        reply: "Asked the Editor",
        resumeReply: "The Editor has read it",
      },
      [editor.id]: { reply: "Read it" },
    });
    const [created, listed, reached] = answers(firstTurn(seen, directorA));
    const composer = (await bots()).find((bot) => bot.name === "Composer");
    expect(composer, created).toMatchObject({ section: MIDNIGHT });
    const now = (await projects()).projects;
    expect(now.find((project) => project.id === midnight.id)!.botIds.sort()).toEqual([directorA.id, writerA.id, editor.id, composer!.id].sort());
    expect(now.find((project) => project.id === paper.id)!.botIds.sort()).toEqual([directorB.id, writerB.id].sort());
    for (const own of [writerA.id, editor.id, composer!.id, main.id]) expect(listed, own).toContain(own);
    expect(JSON.parse(reached!).receipts).toMatchObject([{ botId: editor.id }]);

    const beyond = await personAsks("a member of Paper Moon and the later bots", writerB, "Ask the other show's editor and composer.", {
      [writerB.id]: {
        steps: [
          { tool: "list_bots", arguments: {} },
          { arguments: { bot_ids: [NOBODY], message: "Anyone there?" }, expectError: true },
          { arguments: { bot_ids: [editor.id], message: "Send me your notes.", consult: true }, expectError: true },
          { arguments: { bot_ids: [composer!.id], message: "Send me your score.", consult: true }, expectError: true },
          { arguments: { bot_ids: ["Editor"], message: "Send me your notes.", consult: true }, expectError: true },
          { arguments: { bot_ids: ["Composer"], message: "Send me your score.", consult: true }, expectError: true },
        ],
        reply: "Nobody by that name here",
      },
    });
    const turn = firstTurn(beyond, writerB);
    for (const later of [editor.id, composer!.id, "Editor", "Composer"]) expect(told(turn), later).not.toContain(later);
    const [otherList, nobody, editorById, composerById, editorByName, composerByName] = answers(turn);
    for (const later of [editor.id, composer!.id]) expect(otherList, later).not.toContain(later);
    expect(editorById!.replaceAll(editor.id, NOBODY)).toBe(nobody);
    expect(composerById!.replaceAll(composer!.id, NOBODY)).toBe(nobody);
    expect(editorByName!.replaceAll('"Editor"', `"${NOBODY}"`)).toBe(nobody);
    expect(composerByName!.replaceAll('"Composer"', `"${NOBODY}"`)).toBe(nobody);
  }, 180_000);

  it("tells the team the projects were made from, and a bot outside every project, of no project's bot", async () => {
    for (const [what, bot] of [["the team's own Director", crewLead], ["a bot outside every project", oswald]] as const) {
      const seen = await personAsks(what, bot, "What are the shows about?", {
        [bot.id]: {
          steps: [
            { tool: "list_bots", arguments: {} },
            { arguments: { bot_ids: [NOBODY], message: "Anyone there?" }, expectError: true },
            { arguments: { bot_ids: [directorA.id], message: "What is your show about?", consult: true }, expectError: true },
            { arguments: { bot_ids: [writerB.id], message: "What are you writing?", consult: true }, expectError: true },
          ],
          reply: "Nobody to ask",
        },
      });
      const turn = firstTurn(seen, bot);
      const heard = told(turn);
      for (const beyond of [directorA.id, writerA.id, directorB.id, writerB.id, MIDNIGHT, PAPER, "team project"]) expect(heard, `${what}: ${beyond}`).not.toContain(beyond);
      const [listed, nobody, lead, member] = answers(turn);
      for (const beyond of [directorA.id, writerA.id, directorB.id, writerB.id]) expect(listed, `${what}: ${beyond}`).not.toContain(beyond);
      expect(nobody).not.toMatch(/project/i);
      expect(lead!.replaceAll(directorA.id, NOBODY)).toBe(nobody);
      expect(member!.replaceAll(writerB.id, NOBODY)).toBe(nobody);
    }
  }, 180_000);

  it("keeps a room to one project's bots", async () => {
    const mixed = await call("POST", "/api/groups", { name: "Both shows", memberIds: [directorA.id, directorB.id] });
    expect(mixed).toMatchObject({ status: 400, body: {
      errorKey: "serverError.room.projectsMixed", errorParams: { bot: `Director (${MIDNIGHT})`, other: `Director (${PAPER})` },
    } });
    expect((await call("POST", "/api/groups", { name: "Main bot and a lead", memberIds: [main.id, directorA.id] })).body.errorKey).toBe("serverError.room.projectsMixed");
    expect((await call("POST", "/api/groups", { name: "A guest in the project", memberIds: [oswald.id], section: MIDNIGHT })).body.errorKey).toBe("serverError.room.projectDepartment");
    const own = await call("POST", "/api/groups", { name: "Midnight writers' room", memberIds: [directorA.id, writerA.id], section: MIDNIGHT });
    expect(own.status, JSON.stringify(own.body)).toBe(201);
  });
});
