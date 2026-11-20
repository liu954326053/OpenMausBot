// The main bot makes a project when asked, on a real server: its two tools through each turn's own agents server on the
// scripted fake engine, the card, Create and Cancel, the hand-over to the project's lead, the real template library and
// the real projects. Nothing here reaches the user's data or port 8799.
import { existsSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { TeamProjectWire } from "../shared/team-projects.ts";
import type { TeamTemplateInput, TemplateRole } from "../shared/template-library.ts";
import { removeTempDir } from "./testing/cleanup.ts";
import { hostTimeout } from "./testing/host-timeout.ts";
import { launchRestartableServer, type RestartableServer } from "./testing/restartable-server.ts";
import { ownTurnText } from "./testing/room-handoff-agent.ts";

const BRIEF = "A revenge romance in sixty episodes: a bride swapped at the altar takes back her name.";
const TOOLS = ["list_team_templates", "propose_team_project"];

const role = (key: string, name: string, title: string): TemplateRole => ({
  key, name, title, description: title, soul: `You are the ${name}.`, look: { color: "red" }, ownSkills: [], memory: "", librarySkills: [],
});
const TEMPLATE: TeamTemplateInput = {
  name: "Short drama crew", genre: "Revenge and sweet romance", context: "Vertical short dramas.", lead: "director",
  roles: [role("writer", "Writer", "Writes the episodes"), role("director", "Director", "Runs the production")], skills: [],
};

const propose = (name: string, templateId: string) => ({ tool: "propose_team_project", arguments: { name, template_id: templateId, request: BRIEF } });

/** No catch-all entry: a turn of the main bot that nothing here expects, such as one after Create, fails loudly. */
const mainScript = (templateId: string) => [
  { key: "fresh", match: ["FRESH-INSTALL"], steps: [{ tool: "list_team_templates", arguments: {} }, { ...propose("Too early", "none"), expectError: true }], reply: "FRESH DONE" },
  { key: "list", match: ["LIST-TEMPLATES"], steps: [{ tool: "list_team_templates", arguments: {} }, { ...propose("No such team", "0000000000000000"), expectError: true }], reply: "LISTED" },
  { key: "first", match: ["PROPOSE-FIRST"], steps: [propose("Working title", templateId)], reply: "PROPOSED FIRST" },
  { key: "renamed", match: ["PROPOSE-RENAMED"], steps: [propose("First drama", templateId)], reply: "PROPOSED RENAMED" },
  { key: "cancelled", match: ["pressed Cancel"], reply: "HEARD CANCEL" },
  { key: "again", match: ["PROPOSE-AGAIN"], steps: [propose("First drama", templateId)], reply: "PROPOSED AGAIN" },
  { key: "taken", match: ["PROPOSE-TAKEN"], steps: [propose("First drama", templateId)], reply: "PROPOSED TAKEN" },
  { key: "refused", match: ["was not made (name_taken"], steps: [propose("Second drama", templateId)], reply: "PROPOSED UNDER ANOTHER NAME" },
  { key: "restart", match: ["PROPOSE-BEFORE-RESTART"], steps: [propose("Third drama", templateId)], reply: "PROPOSED BEFORE RESTART" },
  { key: "paused", match: ["PROPOSE-BEFORE-PAUSE"], steps: [propose("Fourth drama", templateId)], reply: "PROPOSED BEFORE PAUSE" },
];

/** A bot that is not the main bot tries both tools, then holds its turn open so its capability can be tried on the server. */
const outsiderScript = (gate: string) => [
  { key: "hold", match: ["HOLD"], gateFile: gate, reply: "RELEASED", steps: [
    { tool: "list_team_templates", arguments: {}, expectError: true }, { ...propose("Sneaked in", "0000000000000000"), expectError: true },
  ] },
  { key: "any", match: [], repeat: true, reply: "OK" },
];

type Bot = { id: string; name: string; threadId: string; busy?: boolean; defaultBot?: object; tasks: Array<{ threadId: string; title?: string; openedBy?: { botId?: string } }> };
type Line = { id: string; kind?: string; text?: string; card?: any; threadRef?: { botId: string; threadId: string; title: string } };
type Turn = { botId: string; planKey?: string; unplanned?: boolean; prompt: unknown; evidence: any[] };

describe("the main bot makes a project when asked", () => {
  let server: RestartableServer;
  let root: string;
  let main: Bot;
  let outsider: Bot;
  let templateId = "none";
  let first: TeamProjectWire;
  const outsiders = new Map<string, string>();

  const api = async (method: string, path: string, body?: unknown, options: { token?: string; fromApp?: boolean } = {}) => {
    const response = await fetch(server.url + path, {
      method,
      headers: { "content-type": "application/json", ...(options.fromApp === false ? {} : { origin: server.url }), ...(options.token ? { authorization: `Bearer ${options.token}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: await response.json() as any };
  };
  const bots = async () => (await api("GET", "/api/bots?messages=0")).body.bots as Bot[];
  const bot = async (id: string) => (await bots()).find((one) => one.id === id)!;
  const messages = async (threadId: string) => (await api("GET", `/api/threads/${threadId}/messages`)).body.messages as Line[];
  const cards = async () => (await messages(main.threadId)).filter((line) => line.card?.teamProjectProposal);
  const projects = async () => (await api("GET", "/api/team-projects")).body.projects as TeamProjectWire[];
  const say = async (to: Bot, text: string) => {
    const sent = await api("POST", `/api/bots/${to.id}/messages`, { text, threadId: to.threadId, sendId: crypto.randomUUID() });
    expect(sent.status, JSON.stringify(sent.body)).toBeLessThan(300);
  };
  const said = (threadId: string, text: string) => expect.poll(async () => (await messages(threadId)).some((line) => line.text === text), { timeout: 30_000 }).toBe(true);
  const idle = () => expect.poll(async () => (await bots()).some((one) => one.busy), { timeout: 30_000 }).toBe(false);
  const respond = (requestId: string, behavior: "allow" | "deny", fromApp = true) => api("POST", `/api/threads/${main.threadId}/respond`, { requestId, behavior }, { fromApp });
  const turns = (): Turn[] => {
    const path = `${server.planPath}.evidence.jsonl`;
    return existsSync(path) ? readFileSync(path, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line)) : [];
  };
  const turnOf = (botId: string, key: string) => {
    const turn = turns().find((one) => one.botId === botId && one.planKey === key);
    expect(turn, `${key} turn of ${botId}`).toBeDefined();
    return turn!;
  };
  const toolNames = (turn: Turn): string[] => turn.evidence[0].result.tools.map((tool: { name: string }) => tool.name);
  const called = (turn: Turn, tool: string) => turn.evidence.find((item) => item.step?.tool === tool).response as { error?: { message: string }; result?: { isError?: boolean; content: Array<{ text: string }> } };
  const answerText = (turn: Turn, tool: string) => called(turn, tool).result!.content.map((part) => part.text).join("\n");
  const mainTurns = () => turns().filter((turn) => turn.botId === main.id).length;
  /** The lead's thread named after the project, opened in the main bot's name, once the lead has answered in it. */
  const handedTo = async (leadBotId: string, project: string) => {
    let work: Bot["tasks"][number] | undefined;
    await expect.poll(async () => {
      work = (await bot(leadBotId)).tasks.find((task) => task.openedBy?.botId === main.id);
      return work?.title;
    }, { timeout: 30_000 }).toBe(project);
    await said(work!.threadId, `Result from ${leadBotId}`);
    return work!;
  };
  const waitingTurns = () => {
    const path = join(server.dataDir, "runtime.db");
    if (!existsSync(path)) return [];
    const db = new DatabaseSync(path, { readOnly: true });
    try {
      return (db.prepare("SELECT json FROM assignments ORDER BY created_at, id").all() as Array<{ json: string }>).map((row) => JSON.parse(row.json))
        .filter((node) => node.status === "needs_input" && node.assignee.destination.threadId === main.threadId).map((node) => node.cards as string[]);
    } finally { db.close(); }
  };
  const writePlan = () => writeFileSync(server.planPath, JSON.stringify({
    [main.id]: { script: mainScript(templateId) },
    ...Object.fromEntries([...outsiders].map(([id, gate]) => [id, { script: outsiderScript(gate) }])),
  }));
  /** The capability of the turn `text` started and holds open, as the engine got it. */
  const heldCapability = async (of: Bot, text: string): Promise<string> => {
    const dumpPath = join(server.dataDir, "fake-claude-dump.json");
    let token = "";
    await expect.poll(() => {
      if (!existsSync(dumpPath)) return false;
      const dump = JSON.parse(readFileSync(dumpPath, "utf8"));
      const env = dump.mcpConfig?.mcpServers?.agents?.env ?? {};
      token = env.OMB_COMMS_TOKEN ?? "";
      return env.OMB_BOT_ID === of.id && JSON.stringify(dump.prompt).includes(text) && token !== "";
    }, { timeout: 30_000 }).toBe(true);
    return token;
  };
  /** Both tools, tried by a bot that is not the main bot: through its own agents server, then straight at the server. */
  const refusedEverywhere = async (who: Bot) => {
    const gate = join(server.dataDir, `gate-${who.id}`);
    outsiders.set(who.id, gate);
    writePlan();
    await say(who, "HOLD");
    const token = await heldCapability(who, "HOLD");
    const listing = await api("GET", "/api/internal/team-templates", undefined, { token });
    expect(listing).toMatchObject({ status: 403, body: { error: expect.stringMatching(/Only the main bot proposes projects/) } });
    const proposal = await api("POST", "/api/internal/team-project-proposals", { name: "Sneaked in", templateId, request: BRIEF }, { token });
    expect(proposal).toMatchObject({ status: 403, body: { error: expect.stringMatching(/Only the main bot proposes projects/) } });
    writeFileSync(gate, "go");
    await said(who.threadId, "RELEASED");
    const turn = turnOf(who.id, "hold");
    for (const tool of TOOLS) {
      expect(toolNames(turn)).not.toContain(tool);
      expect(called(turn, tool).error?.message).toBe(`Unknown tool: ${tool}`);
    }
    await idle();
  };

  beforeAll(async () => {
    server = await launchRestartableServer({ scripted: true });
    root = realpathSync(mkdtempSync(join(tmpdir(), "omb-project-proposals-")));
    main = (await bots()).find((one) => one.defaultBot)!;
    const made = await api("POST", "/api/bots", { name: "Otto" });
    expect(made.status, JSON.stringify(made.body)).toBeLessThan(300);
    outsider = made.body.bot;
    writePlan();
  }, hostTimeout(60_000));

  afterAll(async () => {
    await server?.close();
    if (root) await removeTempDir(root);
  });

  it("is shown both tools, and is told plainly when there is no team template and no folder for projects yet", async () => {
    await say(main, "FRESH-INSTALL");
    await said(main.threadId, "FRESH DONE");
    const turn = turnOf(main.id, "fresh");
    expect(toolNames(turn)).toEqual(expect.arrayContaining(TOOLS));
    expect(answerText(turn, "list_team_templates")).toMatch(/There are no team templates yet.*You cannot make or change one/);
    expect(called(turn, "propose_team_project").result).toMatchObject({ isError: true });
    expect(answerText(turn, "propose_team_project")).toMatch(/No folder for projects is chosen yet/);
    expect(await cards()).toEqual([]);
  }, hostTimeout(60_000));

  it("reads the team templates: each one's id, name, genre and roles, and is told the ones there are when it names one that is not there", async () => {
    expect((await api("PUT", "/api/team-projects/root", { path: root })).status).toBe(200);
    const saved = await api("POST", "/api/template-library/teams", TEMPLATE);
    expect(saved.status, JSON.stringify(saved.body)).toBe(201);
    templateId = saved.body.template.id;
    writePlan();
    await idle();
    await say(main, "LIST-TEMPLATES");
    await said(main.threadId, "LISTED");
    const turn = turnOf(main.id, "list");
    const list = answerText(turn, "list_team_templates");
    expect(list).toContain(`- id ${templateId}: "Short drama crew"`);
    expect(list).toContain("Suits: Revenge and sweet romance");
    expect(list).toContain("Roles: Director (lead): Runs the production; Writer: Writes the episodes");
    expect(list).toMatch(/When none fits, do not propose: tell the person so and name the templates there are\. You cannot make or change a template/);
    expect(called(turn, "propose_team_project").result).toMatchObject({ isError: true });
    expect(answerText(turn, "propose_team_project")).toContain(`No team template has the id "0000000000000000". The ones there are:\n- id ${templateId}: "Short drama crew"`);
    expect(await cards()).toEqual([]);
  }, hostTimeout(60_000));

  it("an ordinary bot has neither tool, and the server refuses its capability", async () => {
    await refusedEverywhere(outsider);
  }, hostTimeout(60_000));

  it("a proposal puts a card in the chat and makes nothing; a second proposal replaces it, and the waiting turn follows the newer card", async () => {
    await say(main, "PROPOSE-FIRST");
    await said(main.threadId, "PROPOSED FIRST");
    await idle();
    const [card] = await cards();
    const folder = join(root, "Working title");
    expect(card).toMatchObject({ kind: "options", card: {
      title: "Create the project “Working title”?", subtitle: `${folder}\nShort drama crew: Director and Writer`, options: ["Create", "Cancel"], fixedOptions: true, tool: "propose_team_project",
      teamProjectProposal: { botId: main.id, threadId: main.threadId, name: "Working title", folder, brief: BRIEF,
        template: { id: templateId, name: "Short drama crew", genre: "Revenge and sweet romance", lead: "director", roles: [{ key: "writer", name: "Writer" }, { key: "director", name: "Director" }] } },
    } });
    expect(answerText(turnOf(main.id, "first"), "propose_team_project")).toMatch(/A card with Create and Cancel is now in the chat\. Nothing is made until the person presses Create/);
    expect(await projects()).toEqual([]);
    expect(existsSync(folder)).toBe(false);
    await expect.poll(waitingTurns, { timeout: 15_000 }).toEqual([[card!.id]]);

    await say(main, "PROPOSE-RENAMED");
    await said(main.threadId, "PROPOSED RENAMED");
    await idle();
    const [older, newer] = await cards();
    expect(older!.card).toMatchObject({ expired: true, options: [] });
    expect(newer!.card).toMatchObject({ title: "Create the project “First drama”?", options: ["Create", "Cancel"] });
    await expect.poll(waitingTurns, { timeout: 15_000 }).toEqual([[newer!.id]]);
    expect(await respond(older!.card.requestId, "allow")).toMatchObject({ status: 200, body: { alreadySettled: true, outcome: "rejected" } });
    expect(await projects()).toEqual([]);
  }, hostTimeout(90_000));

  it("Cancel makes nothing, and the main bot hears it", async () => {
    const open = (await cards()).at(-1)!;
    expect(await respond(open.card.requestId, "deny", false)).toMatchObject({ status: 200, body: { outcome: "rejected", alreadySettled: false, result: { state: "cancelled" } } });
    await said(main.threadId, "HEARD CANCEL");
    expect(ownTurnText(turnOf(main.id, "cancelled").prompt)).toContain(`MagicBot project decision ${open.card.requestId}: the person pressed Cancel, so no project was made.`);
    expect((await cards()).at(-1)!.card).toMatchObject({ answered: "deny", teamProjectProposal: { resumed: true, result: { state: "cancelled" } } });
    expect(await projects()).toEqual([]);
    expect(existsSync(join(root, "First drama"))).toBe(false);
    await idle();
    expect(waitingTurns()).toEqual([]);
  }, hostTimeout(60_000));

  it("Create is the owner's; it makes the project and hands the request to the project's lead in a thread named after it, with no turn of the main bot", async () => {
    await say(main, "PROPOSE-AGAIN");
    await said(main.threadId, "PROPOSED AGAIN");
    await idle();
    const open = (await cards()).at(-1)!;
    expect(await respond(open.card.requestId, "allow", false)).toMatchObject({ status: 403, body: { errorKey: "serverError.teamProjectProposal.ownerCreates" } });
    expect(await projects()).toEqual([]);

    const mainBefore = mainTurns();
    const answer = await respond(open.card.requestId, "allow");
    expect(answer).toMatchObject({ status: 200, body: { ok: true, outcome: "allowed-once", alreadySettled: false, result: { state: "created", leadName: "Director", missingSkills: [] } } });
    const { projectId, leadBotId } = answer.body.result as { projectId: string; leadBotId: string };
    const folder = join(root, "First drama");
    first = (await projects()).find((project) => project.id === projectId)!;
    expect(first).toMatchObject({ name: "First drama", folder, leadBotId, template: { id: templateId, name: "Short drama crew" } });
    expect(first.botIds).toHaveLength(2);
    expect(existsSync(folder)).toBe(true);

    const work = await handedTo(leadBotId, "First drama");
    expect((await messages(work.threadId))[0]).toMatchObject({ role: "bot", from: { botId: main.id, name: "MagicBot" }, text: `@Director ${BRIEF}` });
    const leadTurn = turns().find((turn) => turn.botId === leadBotId)!;
    expect(ownTurnText(leadTurn.prompt)).toContain(BRIEF);
    for (const tool of TOOLS) expect(toolNames(leadTurn)).not.toContain(tool);

    const chat = await messages(main.threadId);
    const settled = chat.find((line) => line.id === open.id)!.card;
    expect(settled).toMatchObject({ answered: "allow", teamProjectProposal: { folder, result: { state: "created", projectId, leadBotId } } });
    expect(settled).not.toHaveProperty("held");
    expect(settled.teamProjectProposal).not.toHaveProperty("resumed");
    expect(chat.filter((line) => line.threadRef).map((line) => line.threadRef)).toEqual([{ botId: leadBotId, threadId: work.threadId, title: "First drama" }]);
    await idle();
    expect(waitingTurns()).toEqual([]);
    expect(mainTurns()).toBe(mainBefore);
  }, hostTimeout(90_000));

  it("the project's lead and its members have neither tool, and the server refuses their capabilities", async () => {
    const all = await bots();
    for (const id of first.botIds) await refusedEverywhere(all.find((one) => one.id === id)!);
  }, hostTimeout(90_000));

  it("a name already taken is told to the person on the card and to the main bot, which proposes again under another name", async () => {
    await say(main, "PROPOSE-TAKEN");
    await said(main.threadId, "PROPOSED TAKEN");
    await idle();
    const taken = (await cards()).at(-1)!;
    expect(await respond(taken.card.requestId, "allow")).toMatchObject({ status: 200, body: { outcome: "rejected", alreadySettled: false, result: { state: "refused", code: "name_taken" } } });
    await said(main.threadId, "PROPOSED UNDER ANOTHER NAME");
    await idle();
    const [refused, renamed] = (await cards()).slice(-2);
    expect(refused!.card).toMatchObject({ expired: true, options: [], held: "A project or a department is already called “First drama”. Ask again with another name.",
      teamProjectProposal: { resumed: true, result: { state: "refused", code: "name_taken" } } });
    expect(ownTurnText(turnOf(main.id, "refused").prompt)).toMatch(/the person pressed Create, but the project "First drama" was not made \(name_taken: [^)]+\)\. A project or a department already has that name\. Propose again under another name/);
    expect(await projects()).toHaveLength(1);

    const answer = await respond(renamed!.card.requestId, "allow");
    expect(answer).toMatchObject({ status: 200, body: { result: { state: "created", leadName: "Director" } } });
    expect(answer.body.result.leadBotId).not.toBe(first.leadBotId);
    await handedTo(answer.body.result.leadBotId, "Second drama");
    expect((await projects()).map((project) => project.name).sort()).toEqual(["First drama", "Second drama"]);
    await idle();
  }, hostTimeout(90_000));

  it("a card still open after a restart is answered as before, and the request still goes to the lead", async () => {
    await say(main, "PROPOSE-BEFORE-RESTART");
    await said(main.threadId, "PROPOSED BEFORE RESTART");
    await idle();
    const pending = (await cards()).at(-1)!;
    await server.stop();
    await server.start();
    const kept = (await cards()).at(-1)!;
    expect(kept.id).toBe(pending.id);
    expect(kept.card).toMatchObject({ options: ["Create", "Cancel"] });
    for (const closed of ["answered", "dismissed", "expired"]) expect(kept.card).not.toHaveProperty(closed);
    await expect.poll(waitingTurns, { timeout: 30_000 }).toEqual([[pending.id]]);
    await idle();

    const answer = await respond(pending.card.requestId, "allow");
    expect(answer).toMatchObject({ status: 200, body: { result: { state: "created" } } });
    await handedTo(answer.body.result.leadBotId, "Third drama");
    expect((await projects()).map((project) => project.name).sort()).toEqual(["First drama", "Second drama", "Third drama"]);
    await idle();
  }, hostTimeout(120_000));

  it("a lead that takes no work still gets its project made; the card says why, and the main bot is not woken", async () => {
    await say(main, "PROPOSE-BEFORE-PAUSE");
    await said(main.threadId, "PROPOSED BEFORE PAUSE");
    await idle();
    const pending = (await cards()).at(-1)!;
    await server.stop();
    writeFileSync(join(server.dataDir, "paused-bots.json"), JSON.stringify({ v: 1, bots: [], departments: [], all: true }));
    await server.start();
    await expect.poll(waitingTurns, { timeout: 30_000 }).toEqual([[pending.id]]);

    const mainBefore = mainTurns();
    const answer = await respond(pending.card.requestId, "allow");
    expect(answer).toMatchObject({ status: 200, body: { result: { state: "created", leadName: "Director" } } });
    const why = "Every bot is paused, so Director takes no new work. Resume every bot from any bot’s menu in the sidebar.";
    expect((await cards()).at(-1)!.card).toMatchObject({ answered: "allow", held: `The request did not reach Director. ${why} Then open the project and tell Director what you want.`,
      teamProjectProposal: { result: { state: "created", leadBotId: answer.body.result.leadBotId } } });
    expect((await projects()).map((project) => project.name)).toContain("Fourth drama");
    expect((await bot(answer.body.result.leadBotId)).tasks.filter((task) => task.openedBy?.botId === main.id)).toEqual([]);
    expect((await messages(main.threadId)).filter((line) => line.threadRef?.title === "Fourth drama")).toEqual([]);
    expect(waitingTurns()).toEqual([]);
    expect((await api("POST", "/api/paused", { kind: "all", paused: false })).status).toBe(200);
    await idle();
    expect(mainTurns()).toBe(mainBefore);
  }, hostTimeout(120_000));

  it("ran no turn of the main bot that the flow did not call for", () => {
    expect(turns().filter((turn) => turn.unplanned).map((turn) => ownTurnText(turn.prompt).slice(0, 200))).toEqual([]);
    expect(readFileSync(server.logPath, "utf8")).not.toMatch(/ReferenceError|TypeError|change listener threw/);
  });
});
