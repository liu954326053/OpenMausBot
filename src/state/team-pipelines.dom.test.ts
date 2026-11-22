// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import type { TeamPipelineRejudgeResult, TeamPipelinesWire, TeamPipelineWire } from "../../shared/team-pipeline";

vi.mock("./store-select", () => ({ useStoreActions: () => ({ flushBotPatches: async () => {} }) }));
const { useTeamPipelineMap } = await import("./team-pipelines");
type PipelineMap = ReturnType<typeof useTeamPipelineMap>;

const bot = (id: string) => ({ id, name: id });
const SECTIONS = [{ key: "Studio", name: "Studio", chiefs: [bot("sol")], members: [bot("story"), bot("art")] }];
const studio = (extra: Partial<TeamPipelineWire> = {}): TeamPipelineWire => ({
  section: "Studio", chiefId: "sol", stages: { sol: ["lead"], story: ["script"], art: ["character"] }, pending: [], manual: [],
  lines: [{ from: "sol", to: "story" }, { from: "story", to: "art" }], ...extra,
});
const wire = (team = studio()): TeamPipelinesWire => ({ readable: true, teams: [team] });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

interface Call { path: string; method: string; body: unknown; background: boolean; answer(response: Response): void }
let calls: Call[], answers: Array<(call: Call) => Response | undefined>, root: Root, map: PipelineMap;
const sentTo = (path: string, method = "GET") => calls.filter((call) => call.path === path && call.method === method);
const settle = async () => { await act(async () => { await vi.advanceTimersByTimeAsync(0); }); };
const wait = async (ms: number) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };

function Probe({ canManage }: { canManage: boolean }) {
  map = useTeamPipelineMap(SECTIONS, canManage, {});
  return null;
}
async function mount(canManage = true) {
  root = createRoot(document.body.appendChild(document.createElement("div")));
  await act(async () => root.render(createElement(Probe, { canManage })));
  await settle();
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  calls = [];
  answers = [];
  vi.stubGlobal("fetch", (path: string, init?: RequestInit) => new Promise<Response>((resolve) => {
    const call: Call = {
      path, method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : undefined,
      background: new Headers(init?.headers).has("x-omb-background"), answer: resolve,
    };
    calls.push(call);
    const ready = answers.map((answer) => answer(call)).find(Boolean);
    if (ready) resolve(ready);
  }));
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = "";
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("reads the pipelines when the map opens and again every 15 seconds, in the background", async () => {
  answers.push((call) => call.path === "/api/team-pipelines" ? json(wire()) : undefined);
  await mount();
  expect(sentTo("/api/team-pipelines")).toHaveLength(1);
  expect(map.pipelineOf("Studio")?.lines).toHaveLength(2);
  expect(map.layouts[0]?.cards.map((card) => card.column)).toEqual(["lead", "script", "character"]);
  expect(map.sizes?.sizes[0]).toMatchObject({ width: map.layouts[0]!.width, height: map.layouts[0]!.height });
  await wait(14_000);
  expect(sentTo("/api/team-pipelines")).toHaveLength(1);
  await wait(1_000);
  expect(sentTo("/api/team-pipelines")).toHaveLength(2);
  expect(calls.at(-1)!.background).toBe(true);
});

it("reads every 2 seconds while members are being placed, so their lines appear when they are, and settles back after", async () => {
  let judged = false;
  answers.push((call) => call.path === "/api/team-pipelines"
    ? json(wire(judged ? studio() : studio({ stages: { sol: ["lead"], story: ["other"], art: ["other"] }, pending: ["story", "art"], lines: [] }))) : undefined);
  await mount();
  expect(map.pipelineOf("Studio")?.pending).toEqual(["story", "art"]);
  await wait(2_000);
  expect(sentTo("/api/team-pipelines")).toHaveLength(2);
  judged = true;
  await wait(2_000);
  expect(map.pipelineOf("Studio")?.pending).toEqual([]);
  expect(map.pipelineOf("Studio")?.lines).toHaveLength(2);
  const reads = sentTo("/api/team-pipelines").length;
  await wait(10_000);
  expect(sentTo("/api/team-pipelines")).toHaveLength(reads);
});

it("sends a line as the contract writes it and shows the pipelines the server answers, never an older read that lands later", async () => {
  answers.push((call) => call.path === "/api/team-pipelines" && calls.length === 1 ? json(wire()) : undefined);
  await mount();
  await wait(15_000);
  const slowRead = calls.at(-1)!;
  const after = wire(studio({ lines: [...studio().lines, { from: "sol", to: "art" }], manual: ["sol", "art"] }));
  answers.push((call) => call.path === "/api/team-pipelines/line" ? json(after) : undefined);
  await act(async () => { await map.setLine({ from: "sol", to: "art", present: true }); });
  expect(sentTo("/api/team-pipelines/line", "PUT").map((call) => call.body)).toEqual([{ from: "sol", to: "art", present: true }]);
  expect(map.pipelineOf("Studio")?.manual).toEqual(["sol", "art"]);
  slowRead.answer(json(wire()));
  await settle();
  expect(map.pipelineOf("Studio")?.lines).toHaveLength(3);
});

it("refuses a line in the server's words and leaves the pipelines as they were", async () => {
  answers.push((call) => call.path === "/api/team-pipelines" ? json(wire()) : undefined);
  answers.push((call) => call.path === "/api/team-pipelines/line" ? json({ error: "Sol leads Studio, so no line can go into it." }, 409) : undefined);
  await mount();
  await expect(map.setLine({ from: "art", to: "sol", present: true })).rejects.toThrow("Sol leads Studio, so no line can go into it.");
  expect(map.pipelineOf("Studio")?.lines).toHaveLength(2);
});

it("judges a team again, and Undo gives the server back the `undo` it answered and reads the pipelines again", async () => {
  const undo = { section: "Studio", state: { manual: ["art"], opaque: [1, 2] } };
  let restored = false;
  const cleared = studio({ stages: { sol: ["lead"], story: ["other"], art: ["other"] }, pending: ["story", "art"], lines: [] });
  answers.push((call) => call.path === "/api/team-pipelines" ? json(wire(restored ? studio({ manual: ["art"] }) : studio())) : undefined);
  answers.push((call) => call.path === "/api/team-pipelines/rejudge" ? json({ pipelines: wire(cleared), undo } satisfies TeamPipelineRejudgeResult) : undefined);
  answers.push((call) => { if (call.path !== "/api/team-pipelines/restore") return undefined; restored = true; return json({}); });
  await mount();
  expect(map.rejudged).toBeNull();
  await act(async () => { await map.rejudge("Studio"); });
  expect(sentTo("/api/team-pipelines/rejudge", "POST").map((call) => call.body)).toEqual([{ section: "Studio" }]);
  expect(map.pipelineOf("Studio")?.pending).toEqual(["story", "art"]);
  expect(map.rejudged?.section).toBe("Studio");

  const reads = sentTo("/api/team-pipelines").length;
  await act(async () => { await map.undoRejudge(); });
  expect(sentTo("/api/team-pipelines/restore", "PUT").map((call) => call.body)).toEqual([undo]);
  expect(sentTo("/api/team-pipelines")).toHaveLength(reads + 1);
  expect(map.pipelineOf("Studio")?.manual).toEqual(["art"]);
  await act(async () => map.forgetRejudge());
  expect(map.rejudged).toBeNull();
});

it("says Undo failed when the server refuses to restore", async () => {
  answers.push((call) => call.path === "/api/team-pipelines" ? json(wire()) : undefined);
  answers.push((call) => call.path === "/api/team-pipelines/rejudge" ? json({ pipelines: wire(), undo: { section: "Studio", state: null } }) : undefined);
  answers.push((call) => call.path === "/api/team-pipelines/restore" ? json({ error: "The pipeline couldn't be saved." }, 500) : undefined);
  await mount();
  await act(async () => { await map.rejudge("Studio"); });
  await expect(map.undoRejudge()).rejects.toThrow("The pipeline couldn't be saved.");
});

it("reads nothing, and draws no pipeline, for a person who can't manage teams", async () => {
  await mount(false);
  await wait(20_000);
  expect(calls).toEqual([]);
  expect(map.layouts).toEqual([null]);
  expect(map.sizes).toBeUndefined();
});
