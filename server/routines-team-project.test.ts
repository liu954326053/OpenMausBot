import { existsSync, mkdtempSync, readdirSync, realpathSync, renameSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import "./server-line-packs.ts";
import { createBotHolds } from "./host/bot-holds.ts";
import { withTeamProjectStops } from "./host/team-project-stops.ts";
import { RoutineManager, type RoutineManagerOptions, type RoutineRun } from "./routines.ts";
import { serverLine } from "./server-lines.ts";
import { privateBotFolder, setTeamProjectLookup, setTeamProjectMemberships } from "./workspace.ts";

const PROJECT = "project-1";
const START = Date.parse("2026-11-20T08:00:00Z");
const HOUR = 3_600_000;

describe("routines of a project bot whose project cannot be used", () => {
  let scratch: string;
  let project: string;
  let archivedAt: number | undefined;
  let now: number;
  let started: Array<{ botId: string; prompt: string }>;
  let conversations: string[];
  let failed: RoutineRun[];
  let notes: string[];
  let manager: RoutineManager;
  let writer: string;
  let plain: string;

  const hourly = (botId: string) => ({ name: "Hourly check", prompt: "Check the script", botId, schedule: { type: "interval" as const, everyMinutes: 60, anchorAt: START + HOUR } });
  const at = async (time: number) => {
    now = time;
    await manager.tick();
    await manager.tick();
  };
  const runsOf = (botId: string) => manager.listRuns().filter((run) => run.botId === botId).map((run) => [run.status, run.error]);
  const finishAll = () => {
    for (const run of manager.listRuns().filter((entry) => entry.status === "running")) {
      manager.handleRuntimeEvent({ eventId: `done-${run.id}`, provider: "fake", threadId: run.threadId!, createdAt: new Date(now).toISOString(), type: "turn.completed", ok: true });
    }
  };

  beforeEach(() => {
    scratch = realpathSync(mkdtempSync(join(tmpdir(), "omb-routines-project-")));
    project = join(scratch, "Night Shift");
    rmSync(project, { recursive: true, force: true });
    renameSync(mkdtempSync(join(scratch, "made-")), project);
    archivedAt = undefined;
    now = START;
    started = [];
    conversations = [];
    failed = [];
    notes = [];
    const suffix = Math.random().toString(36).slice(2, 10);
    writer = `writer-${suffix}`;
    plain = `plain-${suffix}`;
    const bots = [{ id: writer, name: "Writer", color: "#123456" }, { id: plain, name: "Plain", color: "#654321" }];
    setTeamProjectMemberships((botId) => (botId === writer ? { id: PROJECT, role: "writer" } : undefined));
    setTeamProjectLookup((id) => (id === PROJECT ? { folder: project, ...(archivedAt === undefined ? {} : { archivedAt }) } : undefined));
    const holds = withTeamProjectStops(
      createBotHolds({ dataDir: join(scratch, "data"), bots: () => bots, line: (language, key, params) => serverLine(language, key, params), changed: () => {} }),
      { bot: (botId) => bots.find((bot) => bot.id === botId), note: (_threadId, _bot, line) => notes.push(line) },
    );
    let task = 0;
    const options: RoutineManagerOptions = {
      file: join(scratch, "routines.json"),
      now: () => now,
      emit: () => {},
      botState: () => "ready",
      goalState: () => "ready",
      createTask: (_botId, title) => {
        conversations.push(title);
        return { threadId: `thread-${++task}` };
      },
      createGoalTask: () => ({ threadId: `goal-thread-${++task}` }),
      startTurn: async (botId, _threadId, prompt) => {
        started.push({ botId, prompt });
      },
      startGoal: async () => {},
      interruptTurn: async () => {},
      interruptGoal: async () => {},
      onRunChanged: () => {},
      onRunFailed: (run) => failed.push(run),
      onRunDeferred: () => {},
      pausedText: (botId) => holds.text(botId),
      held: (botId) => holds.held(botId),
    };
    manager = new RoutineManager(options);
  });

  afterEach(() => {
    manager.stop();
    setTeamProjectMemberships(() => undefined);
    setTeamProjectLookup(() => undefined);
    rmSync(scratch, { recursive: true, force: true });
    for (const botId of [writer, plain]) rmSync(privateBotFolder(botId), { recursive: true, force: true });
  });

  it("are let go quietly while the project folder is away, make nothing, and run again when it is back", async () => {
    const routine = manager.create(hourly(writer));
    manager.create(hourly(plain));
    const away = `Writer can't work right now: its project folder was not found at ${project}. Reconnect the drive or put the folder back, then try again.`;
    const unplugged = `${project} (unplugged)`;
    renameSync(project, unplugged);
    try {
      await at(START + HOUR);
      manager.enqueueWebhook({ webhookId: "hook", webhookName: "New draft", prompt: "Read it", botId: writer, runOn: "maus", deliveryId: "d1", receivedAt: now });
      await at(now);

      expect(runsOf(writer)).toEqual([["cancelled", away], ["cancelled", away]]);
      expect(started.map((turn) => turn.botId), "the bot in no project runs as always").toEqual([plain]);
      expect(conversations).toHaveLength(1);
      expect([failed, notes], "nobody is alerted").toEqual([[], []]);

      manager.runNow(routine.id);
      await at(now);
      expect(manager.listRuns().find((run) => run.manual)).toMatchObject({ status: "failed", error: away });
      expect(failed.map((run) => run.error), "only the run the person started by hand says why").toEqual([away]);

      expect(existsSync(project), "the project folder is never made again").toBe(false);
      expect(readdirSync(scratch).filter((entry) => entry.startsWith("Night Shift"))).toEqual(["Night Shift (unplugged)"]);
      expect(readdirSync(unplugged)).toEqual([]);
      expect(existsSync(privateBotFolder(writer))).toBe(false);
    } finally {
      renameSync(unplugged, project);
    }

    finishAll();
    await at(START + 2 * HOUR);
    expect(started.map((turn) => turn.botId).sort()).toEqual([plain, plain, writer].sort());
    expect(manager.listRuns().filter((run) => run.botId === writer && run.status === "running")).toHaveLength(1);
  });

  it("are let go quietly while the project is archived, and when nothing knows the project", async () => {
    manager.create(hourly(writer));
    archivedAt = START;
    await at(START + HOUR);
    expect(runsOf(writer)).toEqual([["cancelled", "Writer takes no new work because its project is archived. Restore the project in Settings → Data, then try again."]]);

    setTeamProjectLookup(() => undefined);
    await at(START + 2 * HOUR);
    expect(runsOf(writer).map(([, error]) => error)).toContain("Writer can't work right now: MagicBot has no record of its project. Restore projects.json in MagicBot's data folder from a backup, then try again.");
    expect([started, conversations, failed]).toEqual([[], [], []]);
    expect(readdirSync(project)).toEqual([]);
  });
});
