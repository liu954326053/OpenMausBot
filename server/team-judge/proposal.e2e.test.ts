// The main bot proposes a drama team with its stages, on a real server: propose_team_setup through the turn's own
// agents server on the scripted fake engine, the card with the pipeline, and the team once the person confirms.
// Nothing here reaches the user's data or port 8799.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { hostTimeout } from "../testing/host-timeout.ts";
import { launchRestartableServer, type RestartableServer } from "../testing/restartable-server.ts";

const TEAM = "漫剧工作室";

type Bot = { id: string; name: string; title: string; section?: string; threadId: string; busy?: boolean; defaultBot?: object; chiefOfStaff?: boolean };
type Line = { id: string; kind?: string; text?: string; card?: any };
type Turn = { botId: string; planKey?: string; evidence: any[] };

describe("the main bot proposes a drama team with its stages", () => {
  let server: RestartableServer;
  let main: Bot;

  const api = async (method: string, path: string, body?: unknown) => {
    const response = await fetch(server.url + path, {
      method, headers: { "content-type": "application/json", origin: server.url }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: await response.json() as any };
  };
  const bots = async () => (await api("GET", "/api/bots?messages=0")).body.bots as Bot[];
  const messages = async () => (await api("GET", `/api/threads/${main.threadId}/messages`)).body.messages as Line[];
  const said = (text: string) => expect.poll(async () => (await messages()).some((line) => line.text === text), { timeout: 30_000 }).toBe(true);
  const idle = () => expect.poll(async () => (await bots()).some((one) => one.busy), { timeout: 30_000 }).toBe(false);
  const turns = (): Turn[] => {
    const path = `${server.planPath}.evidence.jsonl`;
    return existsSync(path) ? readFileSync(path, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line)) : [];
  };

  beforeAll(async () => {
    server = await launchRestartableServer({ scripted: true });
    main = (await bots()).find((one) => one.defaultBot)!;
  }, hostTimeout(60_000));

  afterAll(async () => {
    await server?.close();
  });

  it("shows the pipeline on the card, and makes the team with nothing of the stages on its bots once the person confirms", async () => {
    const claude = (await api("GET", "/api/instances")).body.instances.find((instance: any) => instance.instanceId === "claude");
    const modelSelection = { instanceId: "claude", model: claude.models.default };
    const member = (name: string, title: string, stages?: string[], extra: Record<string, unknown> = {}) => ({ action: "create", key: name,
      fields: { name, title, soul: `你是${title}。`, section: TEAM, modelSelection, ...(stages ? { stages } : {}), ...extra } });
    const plan = { reason: "The person asked for a short-drama team.", newTeams: [TEAM], operations: [
      member("云舟", "制片人", undefined, { chiefOfStaff: true }), member("砚青", "编剧", ["script"]),
      member("墨白", "分镜与美术设计", ["storyboard", "character"]), member("青禾", "后期合成", ["post"]),
    ] };
    writeFileSync(server.planPath, JSON.stringify({ [main.id]: { script: [
      { key: "drama", match: ["DRAMA-TEAM"], steps: [{ tool: "propose_team_setup", arguments: plan }], reply: "PROPOSED" },
      { key: "decided", match: ["team setup decision"], reply: "HEARD" },
    ] } }));
    const before = new Set((await bots()).map((bot) => bot.id));

    const sent = await api("POST", `/api/bots/${main.id}/messages`, { text: "DRAMA-TEAM", threadId: main.threadId, sendId: crypto.randomUUID() });
    expect(sent.status, JSON.stringify(sent.body)).toBeLessThan(300);
    await said("PROPOSED");
    await idle();

    const turn = turns().find((one) => one.botId === main.id && one.planKey === "drama")!;
    const offered = turn.evidence[0].result.tools.find((tool: { name: string }) => tool.name === "propose_team_setup");
    expect(offered.inputSchema.properties.operations.items.properties.fields.properties.stages.items.enum).toEqual(["script", "character", "storyboard", "post", "other"]);
    const answer = turn.evidence.find((item) => item.step?.tool === "propose_team_setup").response;
    expect(answer.result?.isError, JSON.stringify(answer)).not.toBe(true);

    const card = (await messages()).find((line) => line.card?.teamSetupRequest)!.card;
    expect(card.subtitle).toContain(`\nPipeline of “${TEAM}”: 云舟 → 砚青 → 墨白 → 青禾\n`);
    expect(card.teamSetupRequest.operations.map((operation: { stages?: string[] }) => operation.stages)).toEqual([undefined, ["script"], ["character", "storyboard"], ["post"]]);
    expect((await bots()).filter((bot) => !before.has(bot.id))).toEqual([]);

    const confirmed = await api("POST", `/api/threads/${main.threadId}/respond`, { requestId: card.requestId, behavior: "allow" });
    expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(200);
    await said("HEARD");
    await idle();

    const made = (await bots()).filter((bot) => !before.has(bot.id));
    expect(made.map((bot) => [bot.name, bot.title, bot.section, Boolean(bot.chiefOfStaff)]).sort()).toEqual([
      ["云舟", "制片人", TEAM, true], ["墨白", "分镜与美术设计", TEAM, false], ["砚青", "编剧", TEAM, false], ["青禾", "后期合成", TEAM, false],
    ].sort());
    for (const bot of made) expect(bot).not.toHaveProperty("stages");
    const settled = (await messages()).find((line) => line.card?.requestId === card.requestId)!.card;
    expect(settled).toMatchObject({ answered: "allow", teamSetupRequest: { result: { state: "applied" } } });
    expect(readFileSync(server.logPath, "utf8")).not.toContain("[team-judge]");

    const evidence = process.env.OMB_TEAM_JUDGE_EVIDENCE;
    if (evidence) {
      mkdirSync(evidence, { recursive: true });
      writeFileSync(join(evidence, "proposal-card.txt"), `${card.title}\n\n${card.subtitle}\n`);
      writeFileSync(join(evidence, "proposal-team.json"), JSON.stringify({ request: settled.teamSetupRequest, bots: made }, null, 2));
    }
  }, hostTimeout(120_000));
});
