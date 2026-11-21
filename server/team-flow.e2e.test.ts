import { spawn, type ChildProcess } from "node:child_process";
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { ProjectFlowWire, TeamFlowsWire, TeamFlowWire } from "../shared/team-flow.ts";
import type { TeamProjectMembership, TeamProjectRecord, TeamProjectsListWire, TeamProjectWire } from "../shared/team-projects.ts";
import { launchVerificationServer, runControlOmb, verificationServerArgs, verificationServerEnvironment, type VerificationServer } from "../scripts/control-omb.ts";
import { waitForExit } from "./testing/cleanup.ts";
import { freePortBlock } from "./testing/ports.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const STUDIO = "Studio";
const OLD_SHOW = "Old show";

interface FixtureBot { id: string; name: string; threadId: string }
interface StoredBot { id: string; name: string; section?: string; teamProject?: TeamProjectMembership }
interface ToolAnswer { step?: { tool?: string; arguments?: Record<string, unknown> }; response?: unknown }
interface Turn { botId: string; resumed: boolean; system: string; prompt: unknown; evidence: ToolAnswer[] }

const said = (response: unknown): string =>
  ((response as { result?: { content?: Array<{ text?: string }> } })?.result?.content ?? []).map((part) => part?.text ?? "").join("\n");
const answers = (turn: Turn): string[] => turn.evidence.filter((entry) => entry.step).map((entry) => said(entry.response));
const told = (turn: Turn): string => `${turn.system}\n${JSON.stringify(turn.prompt)}`;

describe("a team's flow on the real server", () => {
  let session: VerificationServer;
  let second: ChildProcess | undefined;
  let url = "";
  const projectsRoot = mkdtempSync(join(tmpdir(), "omb-team-flow-"));
  let sol: FixtureBot, story: FixtureBot, board: FixtureBot, video: FixtureBot, scout: FixtureBot, main: FixtureBot;
  let oldLead: FixtureBot, oldWriter: FixtureBot, oldEditor: FixtureBot;
  let seasons: TeamProjectWire[] = [];
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
  const flowFile = () => join(session.info.dataDir, "team-flows.json");
  const turns = (): Turn[] => existsSync(`${planPath()}.evidence.jsonl`)
    ? readFileSync(`${planPath()}.evidence.jsonl`, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as Turn)
    : [];
  const stored = (): StoredBot[] => JSON.parse(readFileSync(join(session.info.dataDir, "bots.json"), "utf8")) as StoredBot[];
  const flows = async (): Promise<TeamFlowsWire> => (await call("GET", "/api/team-flows")).body as TeamFlowsWire;
  const studio = async (): Promise<TeamFlowWire> => (await flows()).teams.find((team) => team.section === STUDIO)!;
  const projectFlow = async (id: string): Promise<ProjectFlowWire> => (await call("GET", `/api/team-flows/projects/${id}`)).body as ProjectFlowWire;
  const line = (bot: FixtureBot, superior: FixtureBot | null) => call("PUT", "/api/team-flows/line", { botId: bot.id, superiorId: superior?.id ?? null });
  /** The copy of a team member in a project, as the project's own bot. */
  const copyIn = (project: TeamProjectWire, source: FixtureBot): string => stored().find((bot) => bot.teamProject?.id === project.id && bot.teamProject.source === source.id)!.id;

  async function personAsks(what: string, bot: FixtureBot, text: string, plan: Record<string, unknown>): Promise<Turn[]> {
    const before = turns().length;
    writeFileSync(planPath(), JSON.stringify(plan));
    await cli("send", "--bot", bot.id, "--task", bot.threadId, "--text", text);
    const { status } = await cli("wait", "--bot", bot.id, "--task", bot.threadId, "--timeout", "60");
    const seen = turns().slice(before);
    record[what] = seen.map((turn) => ({
      bot: nameOf(turn.botId), resumed: turn.resumed, told: told(turn),
      calls: turn.evidence.filter((entry) => entry.step).map((entry) => ({ ...entry.step, answer: said(entry.response) })),
    }));
    expect(status, JSON.stringify(seen.at(-1)?.evidence.at(-1))).toBe("settled");
    return seen;
  }

  const nameOf = (id: string): string => [sol, story, board, video, scout, main].find((bot) => bot?.id === id)?.name ?? id;
  const firstTurn = (seen: Turn[], bot: { id: string }): Turn => {
    const turn = seen.find((one) => one.botId === bot.id && !one.resumed);
    expect(turn, `${nameOf(bot.id)} had a turn`).toBeDefined();
    return turn!;
  };
  const resumedTurn = (seen: Turn[], bot: FixtureBot): Turn => {
    const turn = seen.find((one) => one.botId === bot.id && one.resumed);
    expect(turn, `${bot.name} was resumed`).toBeDefined();
    return turn!;
  };

  async function makeBot(name: string, title: string, section: string, description: string): Promise<{ id: string }> {
    const made = await call("POST", "/api/bots", { name, title, section, description });
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    return made.body.bot as { id: string };
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
      sol: await makeBot("Sol", "Showrunner", STUDIO, "Runs the studio."),
      story: await makeBot("Story", "Story editor", STUDIO, "Picks the stories worth telling."),
      board: await makeBot("Board", "Storyboard artist", STUDIO, "Draws every shot."),
      video: await makeBot("Video", "Video editor", STUDIO, "Cuts the boards into a video."),
      scout: await makeBot("Scout", "Researcher", "Sales", "Finds new buyers."),
      oldLead: await makeBot("Director", "Showrunner", OLD_SHOW, "Leads the old show."),
      oldWriter: await makeBot("Writer", "Screenwriter", OLD_SHOW, "Writes the old show."),
      oldEditor: await makeBot("Editor", "Video editor", OLD_SHOW, "Cuts the old show."),
    };
    for (const chief of [made.sol, made.oldLead]) {
      const appointed = await call("PATCH", `/api/bots/${chief.id}`, { chiefOfStaff: true });
      expect(appointed.status, JSON.stringify(appointed.body)).toBe(200);
    }

    await waitForExit(session.child, { signal: "SIGTERM" });
    const folder = join(projectsRoot, OLD_SHOW);
    mkdirSync(folder);
    const old: TeamProjectRecord = { id: "project-old", name: OLD_SHOW, folder, section: OLD_SHOW, template: { id: "one-team-template", name: "Short drama crew", version: 1 }, leadBotId: made.oldLead.id, createdAt: Date.now() };
    writeFileSync(join(session.info.dataDir, "projects.json"), JSON.stringify({ version: 1, projects: [old] }, null, 2));
    const botsFile = join(session.info.dataDir, "bots.json");
    const onDisk = JSON.parse(readFileSync(botsFile, "utf8")) as StoredBot[];
    for (const [bot, role] of [[made.oldLead, "director"], [made.oldWriter, "writer"], [made.oldEditor, "editor"]] as const) {
      onDisk.find((one) => one.id === bot.id)!.teamProject = { id: old.id, role };
    }
    writeFileSync(botsFile, JSON.stringify(onDisk, null, 2));
    await startAgain();

    expect((await call("PUT", "/api/team-projects/root", { path: projectsRoot })).status).toBe(200);
    for (const name of ["Season one", "Season two"]) {
      const project = await call("POST", "/api/team-projects", { name, team: STUDIO });
      expect(project.status, JSON.stringify(project.body)).toBe(201);
    }
    seasons = ((await call("GET", "/api/team-projects")).body as TeamProjectsListWire).projects.filter((project) => project.name.startsWith("Season"));
    const listed = (await call("GET", "/api/bots?messages=0")).body.bots as FixtureBot[];
    const again = (bot: { id: string }) => listed.find((one) => one.id === bot.id)!;
    main = again(starter);
    sol = again(made.sol); story = again(made.story); board = again(made.board); video = again(made.video); scout = again(made.scout);
    oldLead = again(made.oldLead); oldWriter = again(made.oldWriter); oldEditor = again(made.oldEditor);
    record.projects = seasons;
    record.bots = stored().map(({ id, name, section, teamProject }) => ({ id, name, section, teamProject }));
  }, 180_000);

  afterAll(async () => {
    if (second) await waitForExit(second, { signal: "SIGTERM" });
    rmSync(projectsRoot, { recursive: true, force: true });
    if (!session) return;
    const evidencePath = `${session.info.logPath}.team-flow.json`;
    writeFileSync(evidencePath, JSON.stringify(record, null, 2));
    console.info(JSON.stringify({ evidencePath }));
    await session.close();
  });

  it("starts every member of a team under its Chief, and gives a team without a Chief, and a project, no team flow", async () => {
    const all = await flows();
    record.firstFlows = all;
    expect(all.readable).toBe(true);
    expect(all.teams.map((team) => team.section)).toEqual([STUDIO]);
    expect(all.teams[0]).toEqual({ section: STUDIO, chiefId: sol.id, parents: { [story.id]: sol.id, [board.id]: sol.id, [video.id]: sol.id }, placed: [] });
  });

  it("gives a member a second superior in place of the first, and refuses a loop, the Chief and the main bot with the reason", async () => {
    expect((await line(video, story)).status).toBe(200);
    const replaced = await line(video, board);
    expect(replaced.status, JSON.stringify(replaced.body)).toBe(200);
    expect(replaced.body.teams[0].parents).toEqual({ [story.id]: sol.id, [board.id]: sol.id, [video.id]: board.id });
    expect(replaced.body.teams[0].placed).toEqual([video.id]);

    const refusals = {
      loop: await line(board, video),
      chief: await line(sol, board),
      mainBot: await line(main, sol),
      noChief: await line(scout, sol),
      otherTeam: await line(story, scout),
      self: await line(story, story),
    };
    record.refusals = Object.fromEntries(Object.entries(refusals).map(([key, { status, body }]) => [key, { status, body }]));
    expect(refusals.loop).toEqual({ status: 409, body: { error: "Video is already below Board, so Board can't go under Video: that would make a loop.", errorKey: "serverError.teamFlow.loop", errorParams: { superior: "Video", bot: "Board" } } });
    expect(refusals.chief.body).toMatchObject({ errorKey: "serverError.teamFlow.chief", error: "Sol is the Chief of Staff of Studio, at the top of its flow, so it can't be anyone's subordinate." });
    expect(refusals.mainBot.body).toMatchObject({ errorKey: "serverError.teamFlow.mainBot" });
    expect(refusals.noChief.body).toMatchObject({ errorKey: "serverError.teamFlow.noChief", errorParams: { team: "Sales" } });
    expect(refusals.otherTeam.body).toMatchObject({ errorKey: "serverError.teamFlow.otherTeam", errorParams: { superior: "Scout", team: STUDIO } });
    expect(refusals.self.body).toMatchObject({ errorKey: "serverError.teamFlow.self" });
    for (const { status } of Object.values(refusals)) expect(status).toBe(409);
    expect((await studio()).parents[video.id]).toBe(board.id);

    const file = JSON.parse(readFileSync(flowFile(), "utf8")) as { version: number; teams: Record<string, Record<string, string>> };
    record.fileAfterLines = file;
    expect(file.version).toBe(1);
    expect(Object.values(file.teams)).toEqual([{ [video.id]: board.id }]);
  });

  it("hands work only to a direct subordinate, says whom the bot can hand it to instead, and returns the result to the superior", async () => {
    const seen = await personAsks("the Chief hands work down", sol, "Make a trailer storyboard.", {
      [sol.id]: {
        steps: [
          { tool: "list_bots", arguments: {} },
          { arguments: { bot_ids: [video.id], message: "Cut the trailer." }, expectError: true },
          { arguments: { bot_ids: [scout.id], message: "Find buyers for the trailer." }, expectError: true },
          { arguments: { bot_ids: ["MagicBot"], message: "What do you think?", consult: true }, expectError: true },
          { arguments: { bot_ids: [board.id], message: "Draw the storyboard for the trailer." } },
        ],
        reply: "Board is drawing it",
        resumeReply: "Board drew the storyboard",
      },
      [board.id]: {
        steps: [
          { arguments: { bot_ids: [sol.id], message: "Here is my storyboard." }, expectError: true },
          { arguments: { bot_ids: [story.id], message: "Which story is it?", consult: true }, expectError: true },
        ],
        reply: "Storyboard: twelve frames",
      },
    });

    const chiefTurn = firstTurn(seen, sol);
    const chiefHeard = told(chiefTurn);
    expect(chiefHeard).toContain([
      "Your direct subordinates in the Studio team's flow, in the order to hand work down to them:",
      `- Board — Storyboard artist [your subordinate]: Draws every shot. [id: ${board.id}]`,
      `- Story — Story editor [your subordinate]: Picks the stories worth telling. [id: ${story.id}]`,
    ].join("\n"));
    expect(chiefHeard).toContain("In the Studio team's flow you are at the top");
    for (const beyond of [video.id, scout.id]) expect(chiefHeard, nameOf(beyond)).not.toContain(beyond);

    const [listed, further, otherTeam, mainBot, handed] = answers(chiefTurn);
    expect(listed).toContain("Bots you can reach in your team's flow");
    expect(listed).toContain(`[id: ${story.id}, model:`);
    expect(listed).toContain(`[id: ${board.id}, model:`);
    expect(listed).toContain("your subordinate");
    for (const beyond of [video.id, scout.id, main.id]) expect(listed, nameOf(beyond)).not.toContain(beyond);
    const reachable = `You can hand work to your direct subordinates: Board (id ${board.id}), Story (id ${story.id}). Nothing was sent.`;
    expect(further).toBe(`Video is not your direct subordinate: it works under Board. Hand the work to Board, who can pass it on. ${reachable}`);
    expect(otherTeam).toBe(`Scout is not on your lines in your team's flow, so it cannot be reached from here. ${reachable}`);
    expect(mainBot).toBe(`MagicBot is not on your lines in your team's flow, so it cannot be reached from here. ${reachable}`);
    expect(JSON.parse(handed!).receipts).toMatchObject([{ botId: board.id, botName: "Board" }]);

    const memberTurn = firstTurn(seen, board);
    const memberHeard = told(memberTurn);
    expect(memberHeard).toContain("Hand work only to your direct subordinates");
    expect(memberHeard).toContain("attach every file you made for it with attach_file");
    expect(memberHeard).toContain(`- Sol — Showrunner [Chief of Staff] [your superior] [id: ${sol.id}]`);
    expect(memberHeard).toContain(`- Video — Video editor [your subordinate]: Cuts the boards into a video. [id: ${video.id}]`);
    expect(memberHeard).toContain("Draw the storyboard for the trailer.");
    const [up, sideways] = answers(memberTurn);
    expect(up).toContain("Sol is your superior in your team's flow, and work goes only down it");
    expect(up).toContain("Ask it a question with consult: true");
    expect(sideways).toContain("Story is not on your lines in your team's flow");

    expect(told(resumedTurn(seen, sol))).toContain("Storyboard: twelve frames");
    expect([...new Set(seen.map((turn) => nameOf(turn.botId)))].sort()).toEqual(["Board", "Sol"]);
  }, 120_000);

  it("lets a subordinate hand work on to its own subordinate, and the result comes back up to it", async () => {
    const seen = await personAsks("a member hands work down", board, "Turn the storyboard into a trailer.", {
      [board.id]: {
        steps: [{ arguments: { bot_ids: [video.id], message: "Cut a trailer from the twelve frames." } }],
        reply: "Video is cutting it",
        resumeReply: "Video cut the trailer",
      },
      [video.id]: { reply: "Trailer cut: thirty seconds" },
    });
    const [handed] = answers(firstTurn(seen, board));
    expect(JSON.parse(handed!).receipts).toMatchObject([{ botId: video.id, botName: "Video" }]);
    const lowest = told(firstTurn(seen, video));
    expect(lowest).toContain("You have no subordinates in the flow: do the work yourself.");
    expect(lowest).toContain(`- Board — Storyboard artist [your superior] [id: ${board.id}]`);
    expect(told(resumedTurn(seen, board))).toContain("Trailer cut: thirty seconds");
  }, 120_000);

  it("maps the team's flow onto both projects made from it, and a change to it shows in both at once", async () => {
    const mapped = async () => Promise.all(seasons.map((project) => projectFlow(project.id)));
    const expected = (project: TeamProjectWire, videoUnder: FixtureBot) => ({
      projectId: project.id,
      leadId: project.leadBotId,
      parents: { [copyIn(project, story)]: project.leadBotId, [copyIn(project, board)]: project.leadBotId, [copyIn(project, video)]: copyIn(project, videoUnder) },
    });
    expect(seasons.map((project) => copyIn(project, sol))).toEqual(seasons.map((project) => project.leadBotId));
    const before = await mapped();
    expect(before).toEqual(seasons.map((project) => expected(project, board)));

    expect((await line(video, story)).status).toBe(200);
    const after = await mapped();
    record.projectFlows = { before, after };
    expect(after).toEqual(seasons.map((project) => expected(project, story)));
    expect((await call("GET", "/api/team-flows/projects/no-such-project")).body).toEqual({ projectId: "no-such-project", leadId: null, parents: {} });
  });

  it("holds a project's bots to the team's flow mapped onto their copies", async () => {
    const [season] = seasons;
    const lead = (await call("GET", "/api/bots?messages=0")).body.bots.find((bot: FixtureBot) => bot.id === season!.leadBotId) as FixtureBot;
    const seen = await personAsks("a project's lead", lead, "Cut a teaser.", {
      [lead.id]: {
        steps: [
          { tool: "list_bots", arguments: {} },
          { arguments: { bot_ids: [copyIn(season!, video)], message: "Cut a teaser." }, expectError: true },
          { arguments: { bot_ids: [video.id], message: "Cut a teaser." }, expectError: true },
        ],
        reply: "Asked the right bot",
      },
    });
    const [listed, further, team] = answers(firstTurn(seen, lead));
    expect(listed).toContain(copyIn(season!, story));
    expect(listed).toContain(copyIn(season!, board));
    for (const beyond of [copyIn(season!, video), main.id, sol.id, story.id, board.id, video.id]) expect(listed, beyond).not.toContain(beyond);
    expect(further).toContain("Video is not your direct subordinate: it works under Story. Hand the work to Story, who can pass it on. You can hand work to your direct subordinates: ");
    for (const subordinate of [`Story (id ${copyIn(season!, story)})`, `Board (id ${copyIn(season!, board)})`]) expect(further).toContain(subordinate);
    expect(team).toContain(`No bot with id or name "${video.id}"`);
    expect(team).toContain("You work in your team's flow: you can reach your superior and your direct subordinates and no other bot");
  }, 120_000);

  it("puts every bot of a project made before projects had a source team under its lead", async () => {
    const old = await projectFlow("project-old");
    record.oldProjectFlow = old;
    expect(old).toEqual({ projectId: "project-old", leadId: oldLead.id, parents: { [oldWriter.id]: oldLead.id, [oldEditor.id]: oldLead.id } });
  });

  it("moves a deleted member's subordinates up to its superior", async () => {
    expect((await line(video, board)).status).toBe(200);
    expect((await call("DELETE", `/api/bots/${board.id}`)).status).toBe(200);
    const after = await studio();
    record.afterDeletingBoard = { flow: after, file: JSON.parse(readFileSync(flowFile(), "utf8")) };
    expect(after.parents).toEqual({ [story.id]: sol.id, [video.id]: sol.id });
    expect(readFileSync(flowFile(), "utf8")).not.toContain(board.id);
  });

  it("keeps the server up and the file as it was when team-flows.json cannot be read, and takes it back once it can", async () => {
    expect((await line(video, story)).status).toBe(200);
    const good = readFileSync(flowFile(), "utf8");
    const broken = `${good.slice(0, 20)} <- cut short`;
    writeFileSync(flowFile(), broken);

    const refused = await line(video, null);
    expect(refused).toMatchObject({ status: 503, body: { errorKey: "serverError.teamFlow.unreadable" } });
    const unreadable = await flows();
    expect(unreadable.readable).toBe(false);
    expect(unreadable.teams.find((team) => team.section === STUDIO)!.parents).toEqual({ [story.id]: sol.id, [video.id]: sol.id });
    expect(readFileSync(flowFile(), "utf8")).toBe(broken);
    expect(readFileSync(session.info.logPath, "utf8")).toContain("team flows: team-flows.json cannot be read");

    writeFileSync(flowFile(), good);
    const deadline = Date.now() + 15_000;
    while (!(await flows()).readable && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 250));
    const restored = await flows();
    record.unreadable = { refused: refused.body, whileUnreadable: unreadable, restored };
    expect(restored.readable).toBe(true);
    expect(restored.teams.find((team) => team.section === STUDIO)!.parents[video.id]).toBe(story.id);
  }, 30_000);
});
