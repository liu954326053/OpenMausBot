import { spawn, type ChildProcess } from "node:child_process";
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { TeamProjectMembership, TeamProjectRecord } from "../shared/team-projects.ts";
import { launchVerificationServer, runControlOmb, verificationServerArgs, verificationServerEnvironment, type VerificationServer } from "../scripts/control-omb.ts";
import { waitForExit } from "./testing/cleanup.ts";
import { freePortBlock } from "./testing/ports.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MIDNIGHT = "Midnight Train";
const PAPER = "Paper Moon";
const NOBODY = "ffffffff-0000-4000-8000-000000000000";
/** What each project's team is told through its department: the person's brief and one accepted team note. */
const KNOWN = {
  [MIDNIGHT]: { brief: "A noir on a night train, working title Sablewood.", ending: "Zephyrine leaves on the last train." },
  [PAPER]: { brief: "A seaside comedy, working title Marigold Lane.", ending: "Quillon stays in the lighthouse." },
};
const MIDNIGHT_ONLY = ["Sablewood", "Zephyrine"];
const PAPER_ONLY = ["Marigold", "Quillon"];
/** A bot of the person's that lives in another place of theirs, as the app tells this one. */
const ELSEWHERE = { bot: "Ledger", place: "Garage server" };
const tableRead = (botIds: string[]) => ({ name: "Table read", botIds, schedule: { type: "once", at: Date.now() + 3_600_000 }, durationMinutes: 10 });

interface FixtureBot { id: string; name: string; threadId: string; modelSelection: { instanceId: string; model: string } }
interface ToolAnswer { step?: { tool?: string; arguments?: Record<string, unknown> }; response?: unknown }
interface Turn { botId: string; resumed: boolean; system: string; prompt: unknown; evidence: ToolAnswer[] }

/** The text of a tool's answer, as the engine would read it. */
const said = (response: unknown): string =>
  ((response as { result?: { content?: Array<{ text?: string }> } })?.result?.content ?? []).map((part) => part?.text ?? "").join("\n");

/** Every turn asks for its room targets before its scripted calls; the tool list comes first. */
const roomTargets = (turn: Turn): string => said(turn.evidence[1]);
const answers = (turn: Turn): string[] => turn.evidence.filter((entry) => entry.step).map((entry) => said(entry.response));
const told = (turn: Turn): string => `${turn.system}\n${JSON.stringify(turn.prompt)}`;

describe("two team projects made from one team, on the real server", () => {
  let session: VerificationServer;
  let second: ChildProcess | undefined;
  let url = "";
  const projectsRoot = mkdtempSync(join(tmpdir(), "omb-team-project-wall-"));
  let main: FixtureBot, oswald: FixtureBot, directorA: FixtureBot, writerA: FixtureBot, directorB: FixtureBot, writerB: FixtureBot;
  let tableReadFromBeforeTheProjects = "";
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

  /** The person writes to `bot`, whose turn plays `plan`; back when that turn and everything it started has settled. */
  async function personAsks(what: string, bot: FixtureBot, text: string, plan: Record<string, unknown>): Promise<Turn[]> {
    const before = turns().length;
    writeFileSync(planPath(), JSON.stringify(plan));
    await cli("send", "--bot", bot.id, "--task", bot.threadId, "--text", text);
    const { status } = await cli("wait", "--bot", bot.id, "--task", bot.threadId, "--timeout", "60");
    const seen = turns().slice(before);
    record[what] = seen.map((turn) => ({
      bot: nameOf(turn.botId), resumed: turn.resumed, told: told(turn), roomTargets: roomTargets(turn),
      calls: turn.evidence.filter((entry) => entry.step).map((entry) => ({ ...entry.step, answer: said(entry.response) })),
    }));
    expect(status, JSON.stringify(seen.at(-1)?.evidence.at(-1))).toBe("settled");
    return seen;
  }

  const nameOf = (id: string): string => {
    const bot = [main, oswald, directorA, writerA, directorB, writerB].find((one) => one.id === id);
    return bot === main || bot === oswald ? bot.name : bot ? `${bot.name} of ${bot === directorA || bot === writerA ? MIDNIGHT : PAPER}` : id;
  };
  const firstTurn = (seen: Turn[], bot: FixtureBot): Turn => {
    const turn = seen.find((one) => one.botId === bot.id && !one.resumed);
    expect(turn, `${nameOf(bot.id)} had a turn`).toBeDefined();
    return turn!;
  };
  const ran = (seen: Turn[]): string[] => [...new Set(seen.map((turn) => nameOf(turn.botId)))].sort();

  async function makeBot(name: string, title: string, section: string): Promise<{ id: string }> {
    const made = await call("POST", "/api/bots", { name, title, section });
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    return made.body.bot as { id: string };
  }

  function projectOnDisk(id: string, name: string, lead: { id: string }): TeamProjectRecord {
    const folder = join(projectsRoot, name);
    mkdirSync(folder);
    return { id, name, folder, section: name, template: { id: "one-team-template", name: "Short drama crew", version: 1 }, leadBotId: lead.id, createdAt: Date.now() };
  }

  /** A port is probed, never reserved, and other suites start servers on this machine at the same time: whatever
   * answers on this suite's port counts only when it is the process this suite started. */
  const answeringPid = (): Promise<number | undefined> =>
    fetch(`${url}/api/health`, { headers: { origin: url }, signal: AbortSignal.timeout(2_000) })
      .then(async (response) => (response.ok ? ((await response.json()) as { pid?: number }).pid : undefined), () => undefined);

  async function startAgain(): Promise<void> {
    for (let attempt = 0; attempt < 5; attempt++) {
      const port = await freePortBlock([0, 1]);
      const env = verificationServerEnvironment(process.env, session.info.dataDir, port);
      const log = openSync(session.info.logPath, "a", 0o600);
      const child = spawn(process.execPath, verificationServerArgs(env), { cwd: ROOT, env, stdio: ["ignore", log, log] });
      closeSync(log);
      second = child;
      url = `http://127.0.0.1:${port}`;
      const deadline = Date.now() + 30_000;
      while (child.exitCode === null && child.signalCode === null && Date.now() < deadline) {
        const pid = await answeringPid();
        if (pid === child.pid) return;
        if (pid !== undefined) break;
        await new Promise((resolve) => setTimeout(resolve, 150));
      }
      await waitForExit(child, { signal: "SIGTERM" });
    }
    throw new Error(`the second start never held a port of its own; see ${session.info.logPath}`);
  }

  beforeAll(async () => {
    session = await launchVerificationServer(process.env, undefined, undefined, undefined, undefined, { scripted: true });
    url = session.info.url;
    expect(await answeringPid(), "the server on this suite's port is the one it started").toBe(session.info.pid);
    const starter = (await call("GET", "/api/bots?messages=0")).body.bots[0] as { id: string };
    expect((await call("PATCH", `/api/bots/${starter.id}/profile`, { name: "MagicBot" })).status).toBe(200);
    const made = {
      oswald: await makeBot("Oswald", "Researcher", "Studio"),
      directorA: await makeBot("Director", "Showrunner", MIDNIGHT),
      writerA: await makeBot("Writer", "Screenwriter", MIDNIGHT),
      directorB: await makeBot("Director", "Showrunner", PAPER),
      writerB: await makeBot("Writer", "Screenwriter", PAPER),
    };
    for (const chief of [made.directorA, made.directorB]) {
      const appointed = await call("PATCH", `/api/bots/${chief.id}`, { chiefOfStaff: true });
      expect(appointed.status, JSON.stringify(appointed.body)).toBe(200);
    }
    const scheduled = await call("POST", "/api/calendar-calls", tableRead([made.directorA.id, made.directorB.id]));
    expect(scheduled.status, JSON.stringify(scheduled.body)).toBe(201);
    tableReadFromBeforeTheProjects = scheduled.body.call.id as string;

    await waitForExit(session.child, { signal: "SIGTERM" });
    const projects = [
      projectOnDisk("project-midnight", MIDNIGHT, made.directorA),
      projectOnDisk("project-paper", PAPER, made.directorB),
    ];
    writeFileSync(join(session.info.dataDir, "projects.json"), JSON.stringify({ version: 1, projects }, null, 2));
    const botsFile = join(session.info.dataDir, "bots.json");
    const stored = JSON.parse(readFileSync(botsFile, "utf8")) as Array<Record<string, unknown>>;
    const stamp = (bot: { id: string }, id: string, role: string) => { stored.find((one) => one.id === bot.id)!.teamProject = { id, role } satisfies TeamProjectMembership; };
    stamp(made.directorA, "project-midnight", "director");
    stamp(made.writerA, "project-midnight", "writer");
    stamp(made.directorB, "project-paper", "director");
    stamp(made.writerB, "project-paper", "writer");
    writeFileSync(botsFile, JSON.stringify(stored, null, 2));
    record.bots = stored.map(({ id, name, section, chiefOfStaff, defaultBot, managedSections, teamProject }) => ({ id, name, section, chiefOfStaff, defaultBot, managedSections, teamProject }));
    await startAgain();

    const listed = (await call("GET", "/api/bots?messages=0")).body.bots as FixtureBot[];
    const again = (bot: { id: string }) => listed.find((one) => one.id === bot.id)!;
    main = again(starter); oswald = again(made.oswald);
    directorA = again(made.directorA); writerA = again(made.writerA);
    directorB = again(made.directorB); writerB = again(made.writerB);

    for (const [department, { brief, ending }] of Object.entries(KNOWN)) {
      const about = `?section=${encodeURIComponent(department)}`;
      const briefed = await call("PUT", `/api/section-context${about}`, { text: brief });
      expect(briefed.status, JSON.stringify(briefed.body)).toBe(200);
      const noted = await call("POST", `/api/team-memory${about}`, { kind: "decision", name: "Ending", detail: ending });
      expect(noted.status, JSON.stringify(noted.body)).toBe(201);
    }
    const otherPlace = await call("PUT", "/api/places/elsewhere", {
      v: 1, self: { name: "this computer", kind: "computer" }, places: [{ name: ELSEWHERE.place, kind: "server", bots: [ELSEWHERE.bot] }],
    });
    expect(otherPlace.status, JSON.stringify(otherPlace.body)).toBe(200);
  }, 120_000);

  afterAll(async () => {
    if (second) await waitForExit(second, { signal: "SIGTERM" });
    rmSync(projectsRoot, { recursive: true, force: true });
    if (!session) return;
    const evidencePath = `${session.info.logPath}.team-project-wall.json`;
    writeFileSync(evidencePath, JSON.stringify(record, null, 2));
    console.info(JSON.stringify({ evidencePath }));
    await session.close();
  });

  it("starts from a main bot above two projects that each have their own lead", () => {
    const stored = record.bots as Array<{ id: string; chiefOfStaff?: boolean; defaultBot?: unknown; teamProject?: { id: string } }>;
    const kept = (bot: FixtureBot) => stored.find((one) => one.id === bot.id)!;
    expect(kept(main)).toMatchObject({ chiefOfStaff: true, defaultBot: {}, managedSections: ["Studio", MIDNIGHT, PAPER] });
    expect(kept(main).teamProject).toBeUndefined();
    expect(kept(directorA)).toMatchObject({ chiefOfStaff: true, section: MIDNIGHT, teamProject: { id: "project-midnight" } });
    expect(kept(directorB)).toMatchObject({ chiefOfStaff: true, section: PAPER, teamProject: { id: "project-paper" } });
  });

  it("tells a project's member of its own lead alone, and answers its reach past the wall as a bot that does not exist", async () => {
    const seen = await personAsks("a member of Midnight Train", writerA, `Where does the script stand? @${ELSEWHERE.bot} has the budget.`, {
      [writerA.id]: {
        steps: [
          { tool: "list_bots", arguments: {} },
          { arguments: { bot_ids: [NOBODY], message: "Anyone there?" }, expectError: true },
          { arguments: { bot_ids: [writerB.id], message: "Send me your outline." }, expectError: true },
          { arguments: { bot_ids: [directorB.id], message: "Send me your outline.", consult: true }, expectError: true },
          { arguments: { bot_ids: [oswald.id], message: "Send me your notes.", consult: true }, expectError: true },
          { arguments: { bot_ids: ["Oswald"], message: "Send me your notes.", consult: true }, expectError: true },
          { tool: "start_thread", arguments: { title: "Their outline", message: "Send me your outline.", bot_id: NOBODY }, expectError: true },
          { tool: "start_thread", arguments: { title: "Their outline", message: "Send me your outline.", bot_id: writerB.id }, expectError: true },
          { tool: "post_to_thread", arguments: { thread_id: NOBODY, message: "Send me your outline." }, expectError: true },
          { tool: "post_to_thread", arguments: { thread_id: writerB.threadId, message: "Send me your outline." }, expectError: true },
          { tool: "wait_until", arguments: { label: "the other show", kind: "bot_idle", bot: NOBODY }, expectError: true },
          { tool: "wait_until", arguments: { label: "the other show", kind: "bot_idle", bot: writerB.id }, expectError: true },
          { tool: "wait_until", arguments: { label: "the other show", kind: "bot_idle", bot: ELSEWHERE.bot }, expectError: true },
          { arguments: { bot_ids: [ELSEWHERE.bot], message: "Check this month's numbers." }, expectError: true },
          { tool: "session_search", arguments: { query: "Ending", scope: "team" } },
          { arguments: { bot_ids: ["Director"], message: "Which scene is next?", consult: true } },
        ],
        reply: "Asked my Director",
        resumeReply: "The Director says scene 3 is next",
      },
      [directorA.id]: { reply: "Scene 3 is next" },
    });

    const turn = firstTurn(seen, writerA);
    const heard = told(turn);
    expect(heard).toContain("You work in your team's pipeline");
    expect(heard).toContain(`- Director — Showrunner [Project lead] [leads the pipeline] [upstream of you] [id: ${directorA.id}]`);
    expect(heard, "the main bot is not on a project member's lines").not.toContain(main.id);
    for (const own of MIDNIGHT_ONLY) expect(heard, own).toContain(own);
    for (const beyond of [directorB.id, writerB.id, oswald.id, PAPER, "Oswald", "Studio", ELSEWHERE.place, ...PAPER_ONLY]) expect(heard, beyond).not.toContain(beyond);

    const [listed, nobody, otherWriter, otherLead, outsideById, outsideByName, noThread, otherThread, noPost, otherPost, noWait, otherWait, elsewhereWait, elsewhereReach, teamNotes, ownLead] = answers(turn);
    expect(noThread).toContain("no such bot");
    expect(otherThread).toBe(noThread);
    expect(noPost).toContain("No open thread with that id");
    expect(otherPost).toBe(noPost);
    expect(noWait).toContain("No bot you can reach goes by that name");
    for (const wait of [otherWait, elsewhereWait]) expect(wait).toBe(noWait);
    expect(elsewhereReach!.replaceAll(`"${ELSEWHERE.bot}"`, `"${NOBODY}"`)).toBe(nobody);
    expect(teamNotes).toContain(KNOWN[MIDNIGHT].ending);
    expect(teamNotes).not.toContain(KNOWN[PAPER].ending);
    expect(listed).toContain(directorA.id);
    for (const beyond of [main.id, directorB.id, writerB.id, oswald.id, PAPER, "Oswald"]) expect(listed, beyond).not.toContain(beyond);
    expect(nobody).toContain(`No bot with id or name "${NOBODY}"`);
    expect(nobody).toContain("You work in your team's pipeline");
    const asUnknown = (answer: string, asked: string) => expect(answer.replaceAll(asked, NOBODY)).toBe(nobody);
    asUnknown(otherWriter!, writerB.id);
    asUnknown(otherLead!, directorB.id);
    asUnknown(outsideById!, oswald.id);
    asUnknown(outsideByName!, "Oswald");
    expect(JSON.parse(ownLead!).receipts).toMatchObject([{ botId: directorA.id, botName: "Director" }]);

    expect(ran(seen)).toEqual([`Director of ${MIDNIGHT}`, `Writer of ${MIDNIGHT}`]);
    expect(JSON.stringify(firstTurn(seen, directorA).prompt)).toContain("Which scene is next?");
    const resumed = told(seen.find((one) => one.botId === writerA.id && one.resumed)!);
    expect(resumed).toContain("Scene 3 is next");
    expect(resumed).not.toContain(ELSEWHERE.place);
  }, 120_000);

  it("gives the main bot each project's lead and none of its members, and no say inside a project", async () => {
    const seen = await personAsks("the main bot", main, "Have Midnight Train rewrite scene 2.", {
      [main.id]: {
        timeoutMs: 60_000,
        steps: [
          { tool: "list_bots", arguments: {} },
          { tool: "list_team_setup", arguments: {} },
          { arguments: { bot_ids: [NOBODY], message: "Rewrite scene 2." }, expectError: true },
          { arguments: { bot_ids: [writerA.id], message: "Rewrite scene 2." }, expectError: true },
          { arguments: { bot_ids: ["Writer"], message: "Rewrite scene 2." }, expectError: true },
          { arguments: { bot_ids: ["Director"], message: "Have scene 2 rewritten." }, expectError: true },
          { tool: "propose_profile", arguments: { for_bot_id: writerA.id, title: "Junior writer", reason: "The person asked." }, expectError: true },
          { tool: "propose_profile", arguments: { for_bot_id: directorA.id, title: "Head of story", reason: "The person asked." }, expectError: true },
          { tool: "propose_team_setup", arguments: { reason: "The person asked.", operations: [{ action: "update", botId: writerA.id, fields: { title: "Junior writer" } }] }, expectError: true },
          { tool: "propose_team_setup", arguments: { reason: "The person asked.", operations: [{ action: "update", botId: directorA.id, fields: { title: "Head of story" } }] }, expectError: true },
          { tool: "propose_team_setup", arguments: { reason: "The person asked.", operations: [{ action: "create", key: "extra", fields: { name: "Extra", title: "Second writer", soul: "Write scenes.", section: MIDNIGHT, modelSelection: main.modelSelection } }] }, expectError: true },
          { tool: "retry_thread", arguments: { bot_id: writerA.id, thread_id: writerA.threadId }, expectError: true },
          { tool: "retry_thread", arguments: { bot_id: directorA.id, thread_id: directorA.threadId }, expectError: true },
          { tool: "trigger_info", arguments: { action: "list", for_bot_id: writerA.id }, expectError: true },
          { tool: "trigger_info", arguments: { action: "list", for_bot_id: directorA.id }, expectError: true },
          { tool: "manage_room", arguments: { action: "create", name: "Leads", member_bot_ids: [directorA.id] }, expectError: true },
          { tool: "start_thread", arguments: { title: "Scene 2", message: "Rewrite scene 2.", bot_id: NOBODY }, expectError: true },
          { tool: "start_thread", arguments: { title: "Scene 2", message: "Rewrite scene 2.", bot_id: writerA.id }, expectError: true },
          { tool: "wait_until", arguments: { label: "the rewrite", kind: "bot_idle", bot: NOBODY }, expectError: true },
          { tool: "wait_until", arguments: { label: "the rewrite", kind: "bot_idle", bot: writerA.id }, expectError: true },
          { tool: "session_search", arguments: { query: "Ending", scope: "team" } },
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
    expect(heard).toContain(`- Director — Showrunner (${MIDNIGHT}) [Project lead] [id: ${directorA.id}]`);
    expect(heard).toContain(`- Director — Showrunner (${PAPER}) [Project lead] [id: ${directorB.id}]`);
    expect(heard).toContain(`[id: ${oswald.id}]`);
    for (const inside of [writerA.id, writerB.id, "Screenwriter", ...MIDNIGHT_ONLY, ...PAPER_ONLY]) expect(heard, inside).not.toContain(inside);

    const [listed, setup, nobody, memberById, memberByName, sharedName, memberProfile, leadProfile, memberSetup, leadSetup, newMember, retry, leadRetry, memberTriggers, leadTriggers, room,
      noThread, memberThread, noWait, memberWait, teamNotes, handed] = answers(turn);
    expect(noThread).toContain("no such bot");
    expect(memberThread).toBe(noThread);
    const toolList = JSON.stringify(turn.evidence[0]);
    expect(toolList).toContain("list_team_setup");
    expect(toolList, "the main bot copies no bot: it has no create_bot").not.toContain("create_bot");
    expect(noWait).toContain("No bot you can reach goes by that name");
    expect(memberWait).toBe(noWait);
    for (const ending of [KNOWN[MIDNIGHT].ending, KNOWN[PAPER].ending]) expect(teamNotes).not.toContain(ending);
    for (const reached of [directorA.id, directorB.id, oswald.id]) expect(listed, reached).toContain(reached);
    for (const member of [writerA.id, writerB.id]) expect(listed, member).not.toContain(member);
    for (const inside of [writerA.id, writerB.id, directorA.id, directorB.id, MIDNIGHT, PAPER]) expect(setup, inside).not.toContain(inside);
    expect(setup).toContain(oswald.id);

    expect(nobody).toContain("reached only through its lead");
    expect(memberById!.replaceAll(writerA.id, NOBODY)).toBe(nobody);
    expect(memberByName!.replaceAll('"Writer"', `"${NOBODY}"`)).toBe(nobody);
    expect(sharedName).toContain(`Director, Project lead of ${MIDNIGHT} (id ${directorA.id}); Director, Project lead of ${PAPER} (id ${directorB.id})`);

    expect(memberProfile).toContain("that bot no longer exists");
    expect(leadProfile).toContain("leads a team project, and what is inside a project is set up only from inside it");
    for (const refused of [memberSetup, leadSetup]) expect(refused).toContain("outside this Chief's authorized team");
    expect(newMember).toContain(`The ${MIDNIGHT} department belongs to a team project, and only that project's own lead changes its team`);
    expect(retry).toContain("no such teammate");
    expect(leadRetry).toContain("not on this Chief's team");
    expect(memberTriggers).toContain("no bot with that id");
    expect(leadTriggers).not.toContain("no bot with that id");
    expect(room).toContain(`MagicBot and Director (${MIDNIGHT}) are not in the same project`);
    for (const refusal of [memberById, memberByName, memberProfile, memberSetup, retry, memberTriggers]) expect(refusal).not.toContain("Screenwriter");

    expect(JSON.parse(handed!).receipts).toMatchObject([{ botId: directorA.id }]);
    expect(ran(seen)).toEqual([`Director of ${MIDNIGHT}`, "MagicBot", `Writer of ${MIDNIGHT}`]);
    expect(JSON.stringify(firstTurn(seen, writerA).prompt)).toContain("Rewrite scene 2.");
    expect(told(seen.find((one) => one.botId === main.id && one.resumed)!)).toContain("Scene 2 is rewritten");
  }, 180_000);

  it("tells a bot outside every project of no project's bot, its lead included", async () => {
    const seen = await personAsks("a bot outside every project", oswald, `What are the shows about? @${ELSEWHERE.bot} has the budget.`, {
      [oswald.id]: {
        steps: [
          { tool: "list_bots", arguments: {} },
          { arguments: { bot_ids: [NOBODY], message: "Anyone there?" }, expectError: true },
          { arguments: { bot_ids: [directorA.id], message: "What is your show about?", consult: true }, expectError: true },
          { arguments: { bot_ids: ["Director"], message: "What is your show about?", consult: true }, expectError: true },
          { arguments: { bot_ids: [writerB.id], message: "What are you writing?", consult: true }, expectError: true },
          { tool: "wait_until", arguments: { label: "the show", kind: "bot_idle", bot: NOBODY }, expectError: true },
          { tool: "wait_until", arguments: { label: "the show", kind: "bot_idle", bot: writerB.id }, expectError: true },
          { arguments: { bot_ids: [ELSEWHERE.bot], message: "Check this month's numbers." }, expectError: true },
          { tool: "wait_until", arguments: { label: "the books", kind: "bot_idle", bot: ELSEWHERE.bot }, expectError: true },
          { tool: "session_search", arguments: { query: "Ending", scope: "team" } },
          { arguments: { bot_ids: ["MagicBot"], message: "What is on today?", consult: true } },
        ],
        reply: "Asked MagicBot",
        resumeReply: "MagicBot says nothing is urgent",
      },
      [main.id]: { reply: "Nothing urgent" },
    });

    const turn = firstTurn(seen, oswald);
    const heard = told(turn);
    expect(heard).toContain(`[id: ${main.id}]`);
    for (const beyond of [directorA.id, writerA.id, directorB.id, writerB.id, MIDNIGHT, PAPER, "Director", "Showrunner", "team project", ...MIDNIGHT_ONLY, ...PAPER_ONLY]) expect(heard, beyond).not.toContain(beyond);

    const [listed, nobody, leadById, leadByName, memberById, noWait, memberWait, elsewhereReach, elsewhereWait, teamNotes, mainBot] = answers(turn);
    expect(noWait).toContain("No bot you can reach goes by that name");
    expect(memberWait).toBe(noWait);
    for (const told of [heard, elsewhereReach, elsewhereWait]) {
      expect(told, "a bot outside projects is told where the person's other bots live; a project's bot is not").toContain(`${ELSEWHERE.bot} lives on ${ELSEWHERE.place}`);
    }
    for (const ending of [KNOWN[MIDNIGHT].ending, KNOWN[PAPER].ending]) expect(teamNotes).not.toContain(ending);
    expect(listed).toContain(main.id);
    for (const beyond of [directorA.id, writerA.id, directorB.id, writerB.id, "Director", MIDNIGHT, PAPER]) expect(listed, beyond).not.toContain(beyond);
    expect(nobody).not.toMatch(/project/i);
    expect(leadById!.replaceAll(directorA.id, NOBODY)).toBe(nobody);
    expect(leadByName!.replaceAll('"Director"', `"${NOBODY}"`)).toBe(nobody);
    expect(memberById!.replaceAll(writerB.id, NOBODY)).toBe(nobody);
    expect(JSON.parse(mainBot!).receipts).toMatchObject([{ botId: main.id }]);
    expect(ran(seen)).toEqual(["MagicBot", "Oswald"]);
  }, 120_000);

  it("keeps a room to one project's bots, for the person and for the bots", async () => {
    const mixed = await call("POST", "/api/groups", { name: "Both shows", memberIds: [directorA.id, directorB.id] });
    expect(mixed).toMatchObject({ status: 400, body: {
      errorKey: "serverError.room.projectsMixed", errorParams: { bot: `Director (${MIDNIGHT})`, other: `Director (${PAPER})` },
    } });
    expect((await call("POST", "/api/groups", { name: "Main bot and a lead", memberIds: [main.id, directorA.id] })).body.errorKey).toBe("serverError.room.projectsMixed");
    expect((await call("POST", "/api/groups", { name: "A guest in the project", memberIds: [oswald.id], section: MIDNIGHT })).body)
      .toMatchObject({ errorKey: "serverError.room.projectDepartment", errorParams: { department: MIDNIGHT, bot: "Oswald" } });

    const midnightRoom = await call("POST", "/api/groups", { name: "Midnight writers' room", memberIds: [directorA.id, writerA.id], section: MIDNIGHT });
    const paperRoom = await call("POST", "/api/groups", { name: "Paper writers' room", memberIds: [directorB.id, writerB.id], section: PAPER });
    expect([midnightRoom.status, paperRoom.status]).toEqual([201, 201]);
    const midnight = midnightRoom.body.group.id as string, paper = paperRoom.body.group.id as string;
    for (const room of [midnight, paper]) expect((await call("PATCH", `/api/groups/${room}/setup`, { action: "skip" })).status).toBe(200);
    expect((await call("PATCH", `/api/groups/${midnight}`, { memberIds: [directorA.id, writerA.id, writerB.id] })).body.errorKey).toBe("serverError.room.projectsMixed");
    expect((await call("PATCH", `/api/groups/${midnight}`, { section: PAPER })).body.errorKey).toBe("serverError.room.projectDepartment");
    const rooms = (await call("GET", "/api/bots?messages=0")).body.groups as Array<{ id: string; memberIds: string[]; section?: string }>;
    expect(rooms.find((room) => room.id === midnight)).toMatchObject({ memberIds: [directorA.id, writerA.id], section: MIDNIGHT });

    const mixedTableRead = await call("POST", "/api/calendar-calls", tableRead([directorA.id, directorB.id]));
    expect(mixedTableRead).toMatchObject({ status: 400, body: { errorKey: "serverError.room.projectsMixed" } });
    const ownTableRead = await call("POST", "/api/calendar-calls", tableRead([directorA.id, writerA.id]));
    expect(ownTableRead.status, JSON.stringify(ownTableRead.body)).toBe(201);
    const widened = await call("PATCH", `/api/calendar-calls/${ownTableRead.body.call.id}`, { botIds: [directorA.id, writerB.id] });
    expect(widened).toMatchObject({ status: 400, body: { errorKey: "serverError.room.projectsMixed" } });
    const earlierRoom = await call("POST", `/api/calendar-calls/${tableReadFromBeforeTheProjects}/room`);
    expect(earlierRoom).toMatchObject({ status: 400, body: { errorKey: "serverError.room.projectsMixed" } });
    expect((await call("POST", `/api/calendar-calls/${ownTableRead.body.call.id}/room`)).status).toBe(200);
    record.rooms = { mixed: mixed.body, midnight, paper, mixedTableRead: mixedTableRead.body, widened: widened.body, earlierRoom: earlierRoom.body };

    const seen = await personAsks("a member of Paper Moon and the rooms", writerB, "Tell the other show's room we are done.", {
      [writerB.id]: {
        steps: [
          { tool: "list_rooms", arguments: {} },
          { arguments: { group_id: NOBODY, bot_ids: [directorB.id], message: "We are done." }, expectError: true },
          { arguments: { group_id: midnight, bot_ids: [writerA.id], message: "We are done." }, expectError: true },
          { arguments: { group_id: midnight, bot_ids: [directorB.id], message: "We are done." }, expectError: true },
          { tool: "post_to_room", arguments: { group_id: NOBODY, message: "We are done." }, expectError: true },
          { tool: "post_to_room", arguments: { group_id: midnight, message: "We are done." }, expectError: true },
          { tool: "session_search", arguments: { query: "Ending", scope: "team" } },
          { tool: "post_to_room", arguments: { group_id: paper, message: "We are done." } },
        ],
        reply: "Posted in our own room",
      },
    });
    const turn = firstTurn(seen, writerB);
    const heard = told(turn);
    for (const own of PAPER_ONLY) expect(heard, own).toContain(own);
    for (const beyond of [midnight, "Midnight", directorA.id, writerA.id, ...MIDNIGHT_ONLY]) expect(heard, beyond).not.toContain(beyond);
    expect(roomTargets(turn)).toContain(paper);
    for (const beyond of [midnight, "Midnight"]) expect(roomTargets(turn), beyond).not.toContain(beyond);
    const [ownRooms, noRoom, otherRoom, otherRoomOwnLead, postedNowhere, postedBeyond, teamNotes] = answers(turn);
    expect(ownRooms).toContain(paper);
    for (const beyond of [midnight, "Midnight"]) expect(ownRooms, beyond).not.toContain(beyond);
    expect(noRoom).toContain("No such room");
    expect(otherRoom).toBe(noRoom);
    expect(otherRoomOwnLead).toBe(noRoom);
    expect(postedNowhere).toContain("no such room");
    expect(postedBeyond).toBe(postedNowhere);
    expect(teamNotes).toContain(KNOWN[PAPER].ending);
    expect(teamNotes).not.toContain(KNOWN[MIDNIGHT].ending);
    expect(ran(seen)).toEqual([`Writer of ${PAPER}`]);
    const posted = (await call("GET", `/api/threads/${midnightRoom.body.group.threadId}/messages`)).body.messages as Array<{ text?: string }>;
    expect(posted.some((message) => message.text?.includes("We are done."))).toBe(false);
  }, 120_000);

  it("leaves a project's lead in charge inside its project, and with the main bot alone beyond it", async () => {
    const seen = await personAsks("the lead of Midnight Train", directorA, "Set up the writers' room and check with MagicBot.", {
      [directorA.id]: {
        timeoutMs: 60_000,
        steps: [
          { tool: "list_bots", arguments: {} },
          { tool: "list_team_setup", arguments: {} },
          { arguments: { bot_ids: [NOBODY], message: "Anyone there?" }, expectError: true },
          { arguments: { bot_ids: [directorB.id], message: "Compare notes?", consult: true }, expectError: true },
          { arguments: { bot_ids: [oswald.id], message: "Research this.", consult: true }, expectError: true },
          { tool: "propose_team_setup", arguments: { reason: "The person asked.", operations: [{ action: "update", botId: writerB.id, fields: { title: "Borrowed writer" } }] }, expectError: true },
          { tool: "propose_team_setup", arguments: { reason: "The person asked.", operations: [{ action: "create", key: "extra", fields: { name: "Extra", title: "Second writer", soul: "Write scenes.", section: PAPER, modelSelection: main.modelSelection } }] }, expectError: true },
          { tool: "propose_team_setup", arguments: { reason: "The person asked.", newTeams: ["Spin-off"], operations: [{ action: "create", key: "extra", fields: { name: "Extra", title: "Second writer", soul: "Write scenes.", section: "Spin-off", modelSelection: main.modelSelection } }] }, expectError: true },
          { tool: "start_thread", arguments: { title: "Their outline", message: "Send me your outline.", bot_id: NOBODY }, expectError: true },
          { tool: "start_thread", arguments: { title: "Their outline", message: "Send me your outline.", bot_id: writerB.id }, expectError: true },
          { tool: "create_bot", arguments: { name: "Understudy", copy_from_bot_id: NOBODY }, expectError: true },
          { tool: "create_bot", arguments: { name: "Understudy", copy_from_bot_id: writerB.id }, expectError: true },
          { tool: "manage_room", arguments: { action: "create", name: "With the main bot", member_bot_ids: [main.id] }, expectError: true },
          { tool: "manage_room", arguments: { action: "create", name: "Scene work", member_bot_ids: [writerA.id] } },
          { tool: "propose_profile", arguments: { for_bot_id: writerA.id, title: "Head writer", reason: "The person asked." } },
          { arguments: { bot_ids: ["MagicBot"], message: "Anything across projects I should know?", consult: true } },
        ],
        reply: "Asked MagicBot",
        resumeReply: "MagicBot has nothing across projects",
      },
      [main.id]: { reply: "Nothing across projects" },
    });

    const turn = firstTurn(seen, directorA);
    const heard = told(turn);
    expect(heard).toContain(`You lead one team project, filed as the ${MIDNIGHT} department`);
    expect(heard).toContain(`[id: ${writerA.id}]`);
    expect(heard).toContain(`[id: ${main.id}]`);
    for (const own of MIDNIGHT_ONLY) expect(heard, own).toContain(own);
    for (const beyond of [directorB.id, writerB.id, oswald.id, PAPER, "Oswald", "Studio", ...PAPER_ONLY]) expect(heard, beyond).not.toContain(beyond);

    const [listed, setup, nobody, otherLead, outsideBot, otherMember, otherDepartment, newDepartment, noThread, otherThread, noCopy, otherCopy, roomWithMain, ownRoom, ownMember, mainBot] = answers(turn);
    expect(noThread).toContain("no such bot");
    expect(otherThread).toBe(noThread);
    expect(noCopy).toContain("copy_from_bot_id must be the exact id of a bot you look after");
    expect(otherCopy).toBe(noCopy);
    for (const reached of [writerA.id, main.id]) expect(listed, reached).toContain(reached);
    for (const beyond of [directorB.id, writerB.id, oswald.id]) expect(listed, beyond).not.toContain(beyond);
    expect(setup).toContain(writerA.id);
    for (const beyond of [directorB.id, writerB.id, oswald.id, PAPER, "Studio"]) expect(setup, beyond).not.toContain(beyond);
    expect(otherLead!.replaceAll(directorB.id, NOBODY)).toBe(nobody);
    expect(outsideBot!.replaceAll(oswald.id, NOBODY)).toBe(nobody);
    expect(otherMember).toContain("outside this Chief's authorized team");
    for (const refused of [otherDepartment, newDepartment]) expect(refused).toContain(`leads one team project and sets up bots only in its own department, ${MIDNIGHT}`);
    expect(roomWithMain).toContain(`Director (${MIDNIGHT}) and MagicBot are not in the same project`);
    expect(ownRoom).toContain(`in section “${MIDNIGHT}”`);
    expect(ownMember).not.toContain("no longer exists");
    expect(JSON.parse(mainBot!).receipts).toMatchObject([{ botId: main.id }]);
    expect(ran(seen)).toEqual([`Director of ${MIDNIGHT}`, "MagicBot"]);
  }, 180_000);
});
