import type { ServerResponse } from "node:http";
import { afterEach, describe, expect, it } from "vitest";

import type { FlowStage } from "../../shared/team-pipeline.ts";
import { PASS } from "../routes/table.ts";
import { draftsHarness } from "./testing.ts";
import { createProjectTimelineToolRoutes, PROJECT_TIMELINE_TOOL_PATHS } from "./tools.ts";

const made: Array<{ cleanup(): void }> = [];
afterEach(() => {
  for (const one of made.splice(0)) one.cleanup();
});

function tools(stages: Record<string, FlowStage[]> = { post: ["post"], lead: ["lead"], writer: ["script"], both: ["storyboard", "post"] }) {
  const harness = draftsHarness();
  made.push(harness);
  harness.project.botIds = ["lead", "post", "writer", "both"];
  const route = createProjectTimelineToolRoutes({
    drafts: harness.drafts,
    canvas: harness.canvas,
    projectOfBot: (botId) => (harness.project.botIds.includes(botId) ? harness.project : undefined),
    stagesOf: (botId) => stages[botId] ?? [],
  });
  const call = async (botId: string, path: string, body: unknown = {}, method = "POST") => {
    let answered: { status: number; body: Record<string, any> } | undefined;
    const out = await route({
      method, path, botId, threadId: "thread-1", res: {} as ServerResponse, readBody: async () => body, folders: { roots: [], vmWorkspace: null },
      json: ((_res: ServerResponse, status: number, sent: Record<string, any>) => { answered = { status, body: sent }; }) as never,
    });
    return out === PASS ? PASS : answered!;
  };
  const read = async (botId = "post") => {
    const answer = await call(botId, PROJECT_TIMELINE_TOOL_PATHS.read);
    return answer === PASS ? answer : { status: answer.status, state: JSON.parse(answer.body.text) };
  };
  return { ...harness, call, read };
}

describe("the post bot's timeline tools", () => {
  it("read the clips in order with titles and lengths, and the shots that have no video", async () => {
    const { read, canvas, shot, drafts } = tools();
    await drafts.refreshJianying();
    canvas.set("p1", [shot("s1", { seconds: 4 }, "开场"), shot("s2", null, "对峙"), shot("s3", { seconds: 2.5 }, "结尾")]);
    expect(await read()).toEqual({
      status: 200,
      state: {
        project: { id: "p1", name: "Stand-in bride" },
        clips: [
          { position: 1, shot_id: "s1", title: "开场", seconds: 4, file: "产出/视频/s1.mp4" },
          { position: 2, shot_id: "s3", title: "结尾", seconds: 2.5, file: "产出/视频/s3.mp4" },
        ],
        total_seconds: 6.5,
        shots_without_video: [{ shot_id: "s2", title: "对峙" }],
        shots_left_out: [],
        draft: { state: "none" },
      },
    });
  });

  it("set the order and leave shots out, then say how the timeline stands and what the draft is called", async () => {
    const { call, read, canvas, shot, paths, folder } = tools();
    canvas.set("p1", [shot("s1"), shot("s2"), shot("s3", {}, "多余的")]);
    const set = await call("post", PROJECT_TIMELINE_TOOL_PATHS.setOrder, { shot_ids: ["s2", "s1"] });
    expect(set).toMatchObject({ status: 200 });
    const state = JSON.parse((set as { body: { text: string } }).body.text);
    expect(state.clips.map((clip: { shot_id: string }) => clip.shot_id)).toEqual(["s2", "s1"]);
    expect(state.shots_left_out).toEqual([{ shot_id: "s3", title: "多余的" }]);
    expect(state.draft).toEqual({ state: "written", name: "Stand-in bride" });
    expect(paths("Stand-in bride")).toEqual([`${folder}/产出/视频/s2.mp4`, `${folder}/产出/视频/s1.mp4`]);
    expect((await read() as { state: { clips: unknown[] } }).state.clips).toHaveLength(2);
  });

  it("tell the bot what is wrong with an order in words it can act on", async () => {
    const { call, canvas, shot } = tools();
    canvas.set("p1", [shot("s1")]);
    expect(await call("post", PROJECT_TIMELINE_TOOL_PATHS.setOrder, { shot_ids: ["s1", "ghost"] })).toEqual({ status: 422, body: { error: "ghost isn't a shot of this project." } });
    expect(await call("post", PROJECT_TIMELINE_TOOL_PATHS.setOrder, { shot_ids: "s1" })).toMatchObject({ status: 400 });
  });

  it("serve a bot whose stages include post among others", async () => {
    const { read, canvas, shot } = tools();
    canvas.set("p1", [shot("s1")]);
    expect(await read("both")).toMatchObject({ status: 200 });
  });

  it("are refused to a project's other bots, to a bot in no project, and change nothing for them", async () => {
    const { call, canvas, shot, drafts } = tools();
    canvas.set("p1", [shot("s1"), shot("s2")]);
    for (const botId of ["lead", "writer", "stranger"]) {
      for (const path of Object.values(PROJECT_TIMELINE_TOOL_PATHS)) {
        const answer = await call(botId, path, { shot_ids: ["s2"] });
        expect(answer, `${botId} ${path}`).toMatchObject({ status: 403 });
        expect((answer as { body: { error: string } }).body.error).toMatch(/post/);
      }
    }
    expect((await drafts.timeline("p1")).clips.map((clip) => clip.shotId)).toEqual(["s1", "s2"]);
  });

  it("pass on every other internal path and method", async () => {
    const { call } = tools();
    expect(await call("post", "/api/internal/project-canvas/read")).toBe(PASS);
    expect(await call("post", PROJECT_TIMELINE_TOOL_PATHS.read, {}, "GET")).toBe(PASS);
  });
});
