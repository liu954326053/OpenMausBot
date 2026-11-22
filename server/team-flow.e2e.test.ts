import { spawn, type ChildProcess } from "node:child_process";
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { ProjectFlowWire, TeamFlowsWire } from "../shared/team-flow.ts";
import type { FlowLineWire, FlowStage, ProjectPipelineWire, TeamPipelineRejudgeResult, TeamPipelinesWire, TeamPipelineWire } from "../shared/team-pipeline.ts";
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

interface StoredTeam { stages: Record<string, FlowStage[]>; judged: Record<string, string>; manual: string[]; added: FlowLineWire[]; removed: FlowLineWire[] }
interface StoredFile { version: number; teams: Record<string, StoredTeam> }

describe("a team's pipeline on the real server", () => {
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
  const pipelines = async (): Promise<TeamPipelinesWire> => (await call("GET", "/api/team-pipelines")).body as TeamPipelinesWire;
  const studio = async (): Promise<TeamPipelineWire> => (await pipelines()).teams.find((team) => team.section === STUDIO)!;
  const projectPipeline = async (id: string): Promise<ProjectPipelineWire> => (await call("GET", `/api/team-pipelines/projects/${id}`)).body as ProjectPipelineWire;
  const line = (from: FixtureBot, to: FixtureBot, present: boolean) => call("PUT", "/api/team-pipelines/line", { from: from.id, to: to.id, present });
  const oldFlows = async (): Promise<TeamFlowsWire> => (await call("GET", "/api/team-flows")).body as TeamFlowsWire;
  const oldLine = (bot: FixtureBot, superior: FixtureBot | null) => call("PUT", "/api/team-flows/line", { botId: bot.id, superiorId: superior?.id ?? null });
  const fileNow = (): StoredFile => JSON.parse(readFileSync(flowFile(), "utf8")) as StoredFile;
  /** The key team-flows.json files Studio under, which a rename of the department keeps. */
  const studioKey = (): string => {
    const departments = JSON.parse(readFileSync(join(session.info.dataDir, "section-contexts.json"), "utf8")) as { memoryKeys?: Record<string, string> };
    return departments.memoryKeys?.[STUDIO] ?? STUDIO;
  };
  const arrows = (lines: readonly FlowLineWire[]): string[] => lines.map(({ from, to }) => `${nameOf(from)}>${nameOf(to)}`);
  const DRAMA = ["Sol>Story", "Story>Board", "Board>Video"];
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
    writeFileSync(flowFile(), JSON.stringify({ version: 1, teams: { [studioKey()]: { [made.video.id]: made.board.id } } }, null, 2));
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
    const evidencePath = `${session.info.logPath}.team-pipeline.json`;
    writeFileSync(evidencePath, JSON.stringify(record, null, 2));
    console.info(JSON.stringify({ evidencePath }));
    await session.close();
  });

  it("upgrades a version 1 file: a member placed under a superior keeps that line as one drawn by hand and is manual", async () => {
    const all = await pipelines();
    record.afterUpgrade = { pipelines: all, file: fileNow() };
    expect(all.readable).toBe(true);
    expect(all.teams.map((team) => team.section)).toEqual([STUDIO]);
    const team = all.teams[0]!;
    expect(team.chiefId).toBe(sol.id);
    expect(team.manual).toEqual([video.id]);
    expect(team.stages[sol.id]).toEqual(["lead"]);
    expect(team.stages[video.id]).toEqual(["other"]);
    expect(arrows(team.lines)).toEqual(expect.arrayContaining(["Sol>Video", "Board>Video"]));
    expect(team.lines.every((drawn) => drawn.to !== sol.id)).toBe(true);
    const file = fileNow();
    expect(file.version).toBe(2);
    expect(file.teams[studioKey()]).toMatchObject({ manual: [video.id], added: [{ from: board.id, to: video.id }], removed: [] });
  });

  it("judges a team again: what was set by hand is forgotten, and the undo puts it back", async () => {
    const again = await call("POST", "/api/team-pipelines/rejudge", { section: STUDIO });
    expect(again.status, JSON.stringify(again.body)).toBe(200);
    const { pipelines: meanwhile, undo } = again.body as TeamPipelineRejudgeResult;
    const cleared = meanwhile.teams.find((team) => team.section === STUDIO)!;
    expect(cleared.manual).toEqual([]);
    expect(arrows(cleared.lines)).not.toContain("Board>Video");
    expect(undo.section).toBe(STUDIO);

    const undone = await call("PUT", "/api/team-pipelines/restore", undo);
    expect(undone.status, JSON.stringify(undone.body)).toBe(200);
    const restored = (undone.body as TeamPipelinesWire).teams.find((team) => team.section === STUDIO)!;
    expect(restored.manual).toEqual([video.id]);
    expect(arrows(restored.lines)).toContain("Board>Video");

    const refusals = {
      noTeam: await call("POST", "/api/team-pipelines/rejudge", { section: "Nowhere" }),
      noChief: await call("POST", "/api/team-pipelines/rejudge", { section: "Sales" }),
      project: await call("POST", "/api/team-pipelines/rejudge", { section: seasons[0]!.section }),
      noSection: await call("POST", "/api/team-pipelines/rejudge", {}),
      strangeState: await call("PUT", "/api/team-pipelines/restore", { section: STUDIO, state: { stages: { [story.id]: ["director"] } } }),
    };
    record.rejudge = { meanwhile, undo, restored, refusals };
    expect(refusals.noTeam).toMatchObject({ status: 404, body: { errorKey: "serverError.teamFlow.noTeam" } });
    expect(refusals.noChief).toMatchObject({ status: 409, body: { errorKey: "serverError.teamFlow.noChief", errorParams: { team: "Sales" } } });
    expect(refusals.project).toMatchObject({ status: 404, body: { errorKey: "serverError.teamFlow.noTeam" } });
    expect(refusals.noSection.status).toBe(422);
    expect(refusals.strangeState.status).toBe(422);
  });

  it("runs the team in one line once its members have stages, in the team and in both projects made from it", async () => {
    const stages: Record<string, FlowStage[]> = { [story.id]: ["script"], [board.id]: ["character", "storyboard"], [video.id]: ["post"] };
    const set: StoredFile = { version: 2, teams: { [studioKey()]: { stages, judged: {}, manual: [story.id, board.id, video.id], added: [], removed: [] } } };
    writeFileSync(flowFile(), JSON.stringify(set, null, 2));
    const deadline = Date.now() + 15_000;
    while ((await studio()).stages[video.id]?.[0] !== "post" && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 250));

    const team = await studio();
    record.staged = team;
    expect(team.stages).toEqual({ [sol.id]: ["lead"], ...stages });
    expect(arrows(team.lines)).toEqual(DRAMA);
    expect(team.pending).toEqual([]);

    const mapped = await Promise.all(seasons.map((project) => projectPipeline(project.id)));
    record.projectPipelines = mapped;
    expect(seasons.map((project) => copyIn(project, sol))).toEqual(seasons.map((project) => project.leadBotId));
    expect(mapped).toEqual(seasons.map((project) => ({
      projectId: project.id, leadId: project.leadBotId,
      stages: { [project.leadBotId]: ["lead"], [copyIn(project, story)]: ["script"], [copyIn(project, board)]: ["character", "storyboard"], [copyIn(project, video)]: ["post"] },
      lines: [
        { from: project.leadBotId, to: copyIn(project, story) },
        { from: copyIn(project, story), to: copyIn(project, board) },
        { from: copyIn(project, board), to: copyIn(project, video) },
      ],
    })));
    expect((await call("GET", "/api/team-pipelines/projects/no-such-project")).body).toEqual({ projectId: "no-such-project", leadId: null, stages: {}, lines: [] });
  });

  it("draws a line and takes it away, marks both ends manual, shows it in both projects at once, and refuses a loop, the Chief and the main bot with the reason", async () => {
    const drawn = await line(sol, video, true);
    expect(drawn.status, JSON.stringify(drawn.body)).toBe(200);
    const team = (drawn.body as TeamPipelinesWire).teams.find((one) => one.section === STUDIO)!;
    expect(arrows(team.lines)).toEqual([...DRAMA, "Sol>Video"]);
    expect([...team.manual].sort()).toEqual([story.id, board.id, video.id].sort());
    for (const project of seasons) {
      expect((await projectPipeline(project.id)).lines).toContainEqual({ from: project.leadBotId, to: copyIn(project, video) });
    }

    const refusals = {
      loop: await line(video, story, true),
      chief: await line(story, sol, true),
      mainBot: await line(main, story, true),
      noChief: await line(sol, scout, true),
      otherTeam: await line(scout, story, true),
      self: await line(story, story, true),
      project: await call("PUT", "/api/team-pipelines/line", { from: copyIn(seasons[0]!, story), to: copyIn(seasons[0]!, video), present: true }),
    };
    const incomplete = await call("PUT", "/api/team-pipelines/line", { from: story.id, to: video.id });
    record.refusals = Object.fromEntries(Object.entries({ ...refusals, incomplete }).map(([key, { status, body }]) => [key, { status, body }]));
    expect(refusals.loop).toEqual({ status: 409, body: { error: "Story's work already reaches Video, so a line from Video to Story would make a loop.", errorKey: "serverError.teamFlow.loop", errorParams: { from: "Video", to: "Story" } } });
    expect(refusals.chief.body).toMatchObject({ errorKey: "serverError.teamFlow.chief", error: "Sol is the Chief of Staff of Studio and leads its pipeline, so no line can go into it." });
    expect(refusals.mainBot.body).toMatchObject({ errorKey: "serverError.teamFlow.mainBot" });
    expect(refusals.noChief.body).toMatchObject({ errorKey: "serverError.teamFlow.noChief", errorParams: { team: "Sales" } });
    expect(refusals.otherTeam.body).toMatchObject({ errorKey: "serverError.teamFlow.otherTeam", errorParams: { bot: "Scout", team: STUDIO } });
    expect(refusals.self.body).toMatchObject({ errorKey: "serverError.teamFlow.self" });
    expect(refusals.project.body).toMatchObject({ errorKey: "serverError.teamFlow.project", errorParams: { bot: "Video", team: STUDIO } });
    for (const { status } of Object.values(refusals)) expect(status).toBe(409);
    expect(incomplete.status).toBe(422);
    expect(arrows((await studio()).lines)).toEqual([...DRAMA, "Sol>Video"]);

    const file = fileNow();
    record.fileAfterLines = file;
    expect(file.version).toBe(2);
    expect(Object.values(file.teams)).toMatchObject([{ added: [{ from: sol.id, to: video.id }], removed: [] }]);

    const gone = await line(sol, video, false);
    expect(gone.status, JSON.stringify(gone.body)).toBe(200);
    expect(arrows((await studio()).lines)).toEqual(DRAMA);
    for (const project of seasons) {
      expect((await projectPipeline(project.id)).lines).not.toContainEqual({ from: project.leadBotId, to: copyIn(project, video) });
    }
  });

  it("lets the lead hand work only to its downstream, and a member only ask the bots upstream and downstream of it, with the result back to the lead", async () => {
    const seen = await personAsks("the lead hands work to its downstream", sol, "Make a trailer.", {
      [sol.id]: {
        steps: [
          { tool: "list_bots", arguments: {} },
          { arguments: { bot_ids: [video.id], message: "Cut the trailer." }, expectError: true },
          { arguments: { bot_ids: [story.id], message: "Write the trailer's script." } },
        ],
        reply: "Story is writing it",
        resumeReply: "Story wrote the script",
      },
      [story.id]: {
        steps: [
          { tool: "list_bots", arguments: {} },
          { arguments: { bot_ids: [board.id], message: "Draw my script." }, expectError: true },
          { arguments: { bot_ids: [sol.id], message: "Here is my script." }, expectError: true },
          { arguments: { bot_ids: [video.id], message: "How long is the cut?", consult: true }, expectError: true },
          { arguments: { bot_ids: [scout.id], message: "Who buys trailers?", consult: true }, expectError: true },
          { arguments: { bot_ids: ["MagicBot"], message: "What do you think?", consult: true }, expectError: true },
          { arguments: { bot_ids: [board.id], message: "How many shots can you draw?", consult: true } },
        ],
        reply: "Asked Board",
        resumeReply: "Script: three scenes",
      },
      [board.id]: { reply: "Twelve shots" },
    });

    const leadTurn = firstTurn(seen, sol);
    const leadHeard = told(leadTurn);
    expect(leadHeard).toContain([
      "The bots downstream of you, the ones you hand work to, in the Studio team's pipeline:",
      `- Story — Story editor [downstream of you]: Picks the stories worth telling. [id: ${story.id}]`,
    ].join("\n"));
    expect(leadHeard).toContain("In the Studio team's pipeline you are the lead: inside the team you reach only the bots downstream of you");
    expect(leadHeard).toContain("Outside the Studio team, every other bot, in any department, is reachable too");
    expect(leadHeard).toContain("Other bots you can reach, in other departments:");
    expect(leadHeard).toContain(`- Scout — Researcher (Sales) [id: ${scout.id}]`);
    for (const further of [board.id, video.id]) expect(leadHeard, nameOf(further)).not.toContain(further);

    const [listed, further, handed] = answers(leadTurn);
    expect(listed).toContain("Bots you can reach: in your own team only the bots downstream of you, marked so, and every other bot listed outside your team:");
    expect(listed).toContain(`[id: ${story.id}, model:`);
    expect(listed).toContain("downstream of you");
    for (const outside of [scout.id, main.id]) expect(listed, nameOf(outside)).toContain(`[id: ${outside}, model:`);
    for (const beyond of [board.id, video.id]) expect(listed, nameOf(beyond)).not.toContain(beyond);
    expect(further).toBe(`Video is not directly downstream of you: work comes to it along the pipeline from Board. Hand work only to the bots downstream of you. You can hand work to your downstream: Story (id ${story.id}). Nothing was sent.`);
    expect(JSON.parse(handed!).receipts).toMatchObject([{ botId: story.id, botName: "Story" }]);

    const memberTurn = firstTurn(seen, story);
    const memberHeard = told(memberTurn);
    expect(memberHeard).toContain("Do your stage's work yourself: you cannot hand it, or any part of it, to another bot.");
    expect(memberHeard).toContain("attach every file you made for it with attach_file");
    expect(memberHeard).toContain(`- Sol — Showrunner [Chief of Staff] [upstream of you]: Runs the studio. [id: ${sol.id}]`);
    expect(memberHeard).toContain(`- Board — Storyboard artist [downstream of you]: Draws every shot. [id: ${board.id}]`);
    expect(memberHeard).toContain("Write the trailer's script.");
    for (const beyond of [video.id, scout.id]) expect(memberHeard, nameOf(beyond)).not.toContain(beyond);
    const [reach, down, up, twoDown, otherTeam, mainBot, asked] = answers(memberTurn);
    expect(reach).toContain("Bots you can reach in your team's pipeline (the ones upstream and downstream of you, and no other bot):");
    expect(reach).toContain("upstream of you");
    expect(reach).toContain("You cannot hand your work to another bot.");
    for (const next of [sol.id, board.id]) expect(reach, nameOf(next)).toContain(`[id: ${next}, model:`);
    for (const beyond of [video.id, scout.id, main.id]) expect(reach, nameOf(beyond)).not.toContain(beyond);
    const memberReach = `You can ask a question with consult: true: upstream of you, Sol (id ${sol.id}); downstream of you, Board (id ${board.id}). Nothing was sent.`;
    expect(down).toBe(`Board is downstream of you in your team's pipeline, and you cannot hand your work to another bot: do it yourself. Ask Board a question with consult: true instead. ${memberReach}`);
    expect(up).toBe(`Sol is upstream of you in your team's pipeline, and you cannot hand your work to another bot: do it yourself. Ask Sol a question with consult: true instead. ${memberReach}`);
    expect(twoDown).toBe(`Video is not upstream or downstream of you in your team's pipeline, so it cannot be reached from here. ${memberReach}`);
    expect(otherTeam).toBe(`Scout is not upstream or downstream of you in your team's pipeline, so it cannot be reached from here. ${memberReach}`);
    expect(mainBot).toBe(`MagicBot is not upstream or downstream of you in your team's pipeline, so it cannot be reached from here. ${memberReach}`);
    expect(JSON.parse(asked!).receipts).toMatchObject([{ botId: board.id, botName: "Board" }]);

    expect(told(firstTurn(seen, board))).toContain("How many shots can you draw?");
    expect(told(resumedTurn(seen, story))).toContain("Twelve shots");
    expect(seen.filter((turn) => turn.botId === sol.id && turn.resumed).map(told).join("\n")).toContain("Script: three scenes");
    expect([...new Set(seen.map((turn) => nameOf(turn.botId)))].sort()).toEqual(["Board", "Sol", "Story"]);
  }, 120_000);

  it("lets the lead reach outside its team as before: it consults the main bot and hands work to a bot in no pipeline", async () => {
    const seen = await personAsks("the lead reaches outside its team", sol, "Find buyers for the trailer.", {
      [sol.id]: {
        steps: [
          { arguments: { bot_ids: ["MagicBot"], message: "Which buyers did we pitch last year?", consult: true } },
          { arguments: { bot_ids: [scout.id], message: "Find three buyers for the trailer." } },
        ],
        reply: "Asked MagicBot and Scout",
        resumeReply: "Scout found the buyers",
      },
      [main.id]: { reply: "Last year: Northwind and Contoso" },
      [scout.id]: { reply: "Buyers: Northwind, Contoso, Fabrikam" },
    });
    const [consulted, handed] = answers(firstTurn(seen, sol));
    expect(JSON.parse(consulted!).receipts).toMatchObject([{ botId: main.id }]);
    expect(JSON.parse(handed!).receipts).toMatchObject([{ botId: scout.id, botName: "Scout" }]);
    expect(told(firstTurn(seen, main))).toContain("Which buyers did we pitch last year?");
    expect(told(firstTurn(seen, scout))).toContain("Find three buyers for the trailer.");
    const resumed = seen.filter((turn) => turn.botId === sol.id && turn.resumed).map(told).join("\n");
    expect(resumed).toContain("Last year: Northwind and Contoso");
    expect(resumed).toContain("Buyers: Northwind, Contoso, Fabrikam");
  }, 120_000);

  it("lets the member at the end of the line, asked by the person, ask its upstream a question and hand it nothing", async () => {
    const seen = await personAsks("a member asks upstream", video, "Cut the film.", {
      [video.id]: {
        steps: [
          { arguments: { bot_ids: [board.id], message: "Redraw shot four." }, expectError: true },
          { arguments: { bot_ids: ["Board"], message: "Which shot opens the film?", consult: true } },
        ],
        reply: "Asked Board",
        resumeReply: "The film opens on shot one",
      },
      [board.id]: { reply: "Shot one" },
    });
    const turn = firstTurn(seen, video);
    const heard = told(turn);
    expect(heard).toContain(`[TEAM ROSTER]\n- Board — Storyboard artist [upstream of you]: Draws every shot. [id: ${board.id}]\n[/TEAM ROSTER]`);
    const [refused, asked] = answers(turn);
    expect(refused).toBe(`Board is upstream of you in your team's pipeline, and you cannot hand your work to another bot: do it yourself. Ask Board a question with consult: true instead. You can ask a question with consult: true: upstream of you, Board (id ${board.id}). Nothing was sent.`);
    expect(JSON.parse(asked!).receipts).toMatchObject([{ botId: board.id, botName: "Board" }]);
    expect(told(firstTurn(seen, board))).toContain("Which shot opens the film?");
    expect(told(resumedTurn(seen, video))).toContain("Shot one");
    expect([...new Set(seen.map((one) => nameOf(one.botId)))].sort()).toEqual(["Board", "Video"]);
  }, 120_000);

  it("holds a project's bots to the team's pipeline mapped onto their copies", async () => {
    const [season] = seasons;
    const lead = (await call("GET", "/api/bots?messages=0")).body.bots.find((bot: FixtureBot) => bot.id === season!.leadBotId) as FixtureBot;
    const storyCopy = copyIn(season!, story);
    const seen = await personAsks("a project's lead", lead, "Cut a teaser.", {
      [lead.id]: {
        steps: [
          { tool: "list_bots", arguments: {} },
          { arguments: { bot_ids: [copyIn(season!, video)], message: "Cut a teaser." }, expectError: true },
          { arguments: { bot_ids: [video.id], message: "Cut a teaser." }, expectError: true },
          { arguments: { bot_ids: ["MagicBot"], message: "How long should a teaser run?", consult: true } },
          { arguments: { bot_ids: [storyCopy], message: "Write the teaser's script." } },
        ],
        reply: "Asked the right bots",
        resumeReply: "Story wrote the script",
      },
      [main.id]: { reply: "Fifteen seconds" },
      [storyCopy]: {
        steps: [{ arguments: { bot_ids: ["MagicBot"], message: "Which beats sell?", consult: true }, expectError: true }],
        reply: "Script: hook, twist, title",
      },
    });
    const [listed, further, team, consulted, handed] = answers(firstTurn(seen, lead));
    expect(listed).toContain(storyCopy);
    expect(listed).toContain(`[id: ${main.id}, model:`);
    for (const beyond of [copyIn(season!, board), copyIn(season!, video), sol.id, story.id, board.id, video.id]) expect(listed, beyond).not.toContain(beyond);
    expect(further).toBe(`Video is not directly downstream of you: work comes to it along the pipeline from Board. Hand work only to the bots downstream of you. You can hand work to your downstream: Story (id ${storyCopy}). Nothing was sent.`);
    expect(team).toContain(`No bot with id or name "${video.id}"`);
    expect(team).toContain("In your team project you lead its pipeline: there you can reach only the bots downstream of you");
    expect(JSON.parse(consulted!).receipts).toMatchObject([{ botId: main.id }]);
    expect(JSON.parse(handed!).receipts).toMatchObject([{ botId: storyCopy }]);
    const [memberAsked] = answers(firstTurn(seen, { id: storyCopy }));
    expect(memberAsked).toContain("MagicBot is not upstream or downstream of you in your team's pipeline, so it cannot be reached from here.");
    const resumed = seen.filter((turn) => turn.botId === lead.id && turn.resumed).map(told).join("\n");
    expect(resumed).toContain("Fifteen seconds");
    expect(resumed).toContain("Script: hook, twist, title");
  }, 120_000);

  it("puts every bot of a project made before projects had a source team under its lead as other", async () => {
    const old = await projectPipeline("project-old");
    record.oldProjectPipeline = old;
    expect(old).toEqual({
      projectId: "project-old", leadId: oldLead.id,
      stages: { [oldLead.id]: ["lead"], [oldWriter.id]: ["other"], [oldEditor.id]: ["other"] },
      lines: expect.arrayContaining([{ from: oldLead.id, to: oldWriter.id }, { from: oldLead.id, to: oldEditor.id }]),
    });
    expect(old.lines).toHaveLength(2);
  });

  it("still answers the old tree's routes from the pipeline: a member's first upstream is its superior", async () => {
    const tree = await oldFlows();
    expect(tree.teams).toEqual([{
      section: STUDIO, chiefId: sol.id,
      parents: { [story.id]: sol.id, [board.id]: story.id, [video.id]: board.id },
      placed: expect.arrayContaining([board.id, video.id]),
    }]);
    const [season] = seasons;
    const projectTree = (await call("GET", `/api/team-flows/projects/${season!.id}`)).body as ProjectFlowWire;
    expect(projectTree).toEqual({
      projectId: season!.id, leadId: season!.leadBotId,
      parents: { [copyIn(season!, story)]: season!.leadBotId, [copyIn(season!, board)]: copyIn(season!, story), [copyIn(season!, video)]: copyIn(season!, board) },
    });

    const moved = await oldLine(video, story);
    expect(moved.status, JSON.stringify(moved.body)).toBe(200);
    expect((moved.body as TeamFlowsWire).teams[0]!.parents[video.id]).toBe(story.id);
    expect(arrows((await studio()).lines)).toEqual(["Sol>Story", "Story>Board", "Story>Video"]);
    const looped = await oldLine(story, video);
    expect(looped).toMatchObject({ status: 409, body: { errorKey: "serverError.teamFlow.loop", errorParams: { from: "Video", to: "Story" } } });

    const back = await oldLine(video, null);
    expect(back.status, JSON.stringify(back.body)).toBe(200);
    record.oldRoutes = { tree, projectTree, moved: moved.body, looped: looped.body, back: back.body };
    expect(arrows((await studio()).lines)).toEqual(DRAMA);
  });

  it("joins the stages on either side of a deleted member, which takes its stages and lines with it", async () => {
    expect((await line(sol, board, true)).status).toBe(200);
    expect((await call("DELETE", `/api/bots/${board.id}`)).status).toBe(200);
    const after = await studio();
    record.afterDeletingBoard = { pipeline: after, file: fileNow() };
    expect(arrows(after.lines)).toEqual(["Sol>Story", "Story>Video"]);
    expect(after.stages).toEqual({ [sol.id]: ["lead"], [story.id]: ["script"], [video.id]: ["post"] });
    expect(readFileSync(flowFile(), "utf8")).not.toContain(board.id);
  });

  it("keeps the server up and the file as it was when team-flows.json cannot be read, and takes it back once it can", async () => {
    expect((await line(sol, video, true)).status).toBe(200);
    const good = readFileSync(flowFile(), "utf8");
    const broken = `${good.slice(0, 20)} <- cut short`;
    writeFileSync(flowFile(), broken);

    const refused = await line(sol, video, false);
    expect(refused).toMatchObject({ status: 503, body: { errorKey: "serverError.teamFlow.unreadable" } });
    expect(await call("POST", "/api/team-pipelines/rejudge", { section: STUDIO })).toMatchObject({ status: 503, body: { errorKey: "serverError.teamFlow.unreadable" } });
    const unreadable = await pipelines();
    expect(unreadable.readable).toBe(false);
    const meanwhile = unreadable.teams.find((team) => team.section === STUDIO)!;
    expect(meanwhile).toMatchObject({ pending: [], manual: [], stages: { [sol.id]: ["lead"], [story.id]: ["other"], [video.id]: ["other"] } });
    expect(arrows(meanwhile.lines).sort()).toEqual(["Sol>Story", "Sol>Video"]);
    expect(readFileSync(flowFile(), "utf8")).toBe(broken);
    expect(readFileSync(session.info.logPath, "utf8")).toContain("team flows: team-flows.json cannot be read");

    writeFileSync(flowFile(), good);
    const deadline = Date.now() + 15_000;
    while (!(await pipelines()).readable && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 250));
    const restored = await pipelines();
    record.unreadable = { refused: refused.body, whileUnreadable: unreadable, restored };
    expect(restored.readable).toBe(true);
    expect(arrows(restored.teams.find((team) => team.section === STUDIO)!.lines)).toEqual(["Sol>Story", "Story>Video", "Sol>Video"]);
  }, 30_000);
});
