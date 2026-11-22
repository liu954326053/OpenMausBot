import type { PipelineRunWire } from "../../shared/pipeline-run";
import { botNodeId, dispatchConnectionId, type CanvasBotState, type CanvasConnection, type CanvasNode, type CanvasNodeMetadata, type CanvasSnapshot } from "../../shared/project-canvas";
import type { ProjectDraftWire } from "../../shared/project-draft";
import type { FlowStage } from "../../shared/team-pipeline";
import { createMemoryCanvasBackend, type MemoryCanvasOptions } from "../lib/project-canvas/memory-backend";
import { layoutPipeline } from "../lib/project-canvas/stage-layout";
import type { CanvasBotLook } from "../lib/project-canvas/types";
import { SAMPLE_MODELS, sampleGenerationSettings } from "./project-canvas-sample";

export const DRAMA_PROJECT_ID = "rain-city-drama";
export const DRAMA_EXPORT_FOLDER = "/Users/demo/短剧/雨城 · 第一集/产出";

/** Where the run stands: waiting for the person before the videos, part-way through them, ended with two shots that
 * have none, or through to the draft. */
export type DramaMoment = "confirm" | "generating" | "failed" | "finished";

export interface DramaSampleOptions {
  moment?: DramaMoment;
  /** The draft the post bot's panel shows; by default written once the run is through, and not yet before. */
  draft?: Omit<ProjectDraftWire, "exportFolder">;
  /** The finished film is back on the canvas. */
  film?: boolean;
}

const LEAD = "yunzhou";
const WRITER = "yanqing";
const DESIGNER = "mobai";
const BOARDER = "xiaoman";
const EDITOR = "qinghe";
const OPERATIONS = "ache";

const SHOTS = [
  ["天台全景", "雨夜的天台全景，霓虹在积水里晃动，镜头缓慢推近。"],
  ["阿岚上天台", "快递员阿岚推开天台的铁门，雨衣滴着水，怀里抱着一个包裹。"],
  ["包裹特写", "特写：包裹的收件人一栏，写着她自己的名字。"],
  ["钟楼熄灯", "阿岚抬头，远处钟楼的灯忽然熄灭。"],
  ["分拣站回忆", "回忆：白天的分拣站，老周把同一个包裹递到她手里，欲言又止。"],
  ["黑伞人影", "天台边缘，一个撑着黑伞的人影背对着她。"],
  ["拆开包裹", "阿岚撕开包裹，里面是一把旧钥匙和一张泛黄的照片。"],
  ["雨幕对视", "俯拍：两人隔着雨幕对视，镜头拉远，整座城市的灯火铺开。"],
] as const;

/** The shots, counted from 1, that have no video in the `failed` moment. */
const FAILED_SHOTS = [4, 7];
const takesOf = (shot: number) => 1 + (shot % 3);

const bot = (botId: string, name: string, title: string, stages: FlowStage[], extra: Partial<CanvasBotState> = {}): CanvasBotState => ({ botId, name, title, lead: stages.includes("lead"), stages, status: "idle", placed: false, ...extra });
const said = (botId: string, text: string, minute: number) => ({ text, threadId: `thread-${botId}`, messageId: `${botId}-1`, at: Date.UTC(2026, 10, 22, 9, minute) });

function dramaBots(moment: DramaMoment): Record<string, CanvasBotState> {
  const through = moment === "finished";
  return {
    [LEAD]: bot(LEAD, "云舟", "制片人", ["lead"], { output: said(LEAD, "**第一集《雨夜来信》**\n\n- 砚青写剧本\n- 墨白定角色\n- 小满拆镜头\n- 视频齐了交给青禾", 0) }),
    [WRITER]: bot(WRITER, "砚青", "编剧", ["script"], { output: said(WRITER, "剧本写好了：阿岚在雨夜的天台收到一个写着自己名字的包裹。", 12) }),
    [DESIGNER]: bot(DESIGNER, "墨白", "角色与美术设计", ["character"], { output: said(DESIGNER, "阿岚和老周的设定、参考图都放好了。", 25) }),
    [BOARDER]: bot(BOARDER, "小满", "分镜师", ["storyboard"], { output: said(BOARDER, "拆成 8 个镜头，每个都配好了视频创作节点。", 40) }),
    [EDITOR]: bot(EDITOR, "青禾", "后期合成", ["post"], through ? { output: said(EDITOR, "时间线核对过了：8 个镜头按顺序排好，草稿已更新。", 58) } : {}),
    [OPERATIONS]: bot(OPERATIONS, "阿澈", "运营", ["other"]),
  };
}

export const DRAMA_LOOKS: Record<string, CanvasBotLook> = {
  [LEAD]: { color: "purple" },
  [WRITER]: { color: "blue" },
  [DESIGNER]: { color: "coral" },
  [BOARDER]: { color: "teal" },
  [EDITOR]: { color: "green" },
  [OPERATIONS]: { color: "yellow" },
};

function dramaRun(moment: DramaMoment): PipelineRunWire {
  const through = moment === "finished";
  return {
    id: "run-1",
    startedAt: Date.UTC(2026, 10, 22, 9, 0),
    ...(through ? { endedAt: Date.UTC(2026, 10, 22, 10, 0) } : {}),
    stages: [
      { stage: "script", botIds: [WRITER], status: "done" },
      { stage: "character", botIds: [DESIGNER], status: "done" },
      { stage: "storyboard", botIds: [BOARDER], status: "done" },
      { stage: "post", botIds: [EDITOR], status: through ? "done" : "waiting" },
    ],
    videos: {
      confirm: { status: "confirm" as const, shots: SHOTS.length, ready: 0, failed: 0 },
      generating: { status: "working" as const, shots: SHOTS.length, ready: 3, failed: 0 },
      failed: { status: "failed" as const, shots: SHOTS.length, ready: SHOTS.length - FAILED_SHOTS.length, failed: FAILED_SHOTS.length },
      finished: { status: "done" as const, shots: SHOTS.length, ready: SHOTS.length, failed: 0 },
    }[moment],
  };
}

const TEXT = { width: 340, height: 240 };
const PICTURE = { width: 340, height: 240 };
const CLIP = { width: 420, height: 236 };
const GROUP_INSET = 24;
const GROUP_TOP = 52;

/** The drama project's canvas at `moment`, laid out as Tidy lays it. Its files are named, not there: a page that draws
 * it gives each a picture or a clip. */
export function dramaCanvasSnapshot({ moment = "finished", draft, film = false }: DramaSampleOptions = {}): CanvasSnapshot {
  const bots = dramaBots(moment);
  const nodes: CanvasNode[] = Object.values(bots).map((state) => ({ id: botNodeId(state.botId), type: "bot", title: state.name, position: { x: 0, y: 0 }, width: 300, height: 180 }));
  const connections: CanvasConnection[] = [];
  const dispatch = (from: string, to: string) => connections.push({ id: dispatchConnectionId(from, to), fromNodeId: botNodeId(from), toNodeId: botNodeId(to), kind: "dispatch" });
  const link = (fromNodeId: string, toNodeId: string, pipeline = true) => connections.push({ id: `${fromNodeId}>${toNodeId}`, fromNodeId, toNodeId, kind: "content", ...(pipeline ? { pipeline: true as const } : {}) });
  const by = (botId: string) => ({ createdBy: { kind: "bot" as const, botId } });
  let order = 0;
  const next = () => ({ x: 0, y: (order += 1) * 1000 });

  dispatch(LEAD, WRITER);
  dispatch(WRITER, DESIGNER);
  dispatch(DESIGNER, BOARDER);
  dispatch(WRITER, BOARDER);
  dispatch(BOARDER, EDITOR);
  dispatch(LEAD, OPERATIONS);

  nodes.push({ id: "script", type: "text", title: "第一集 · 雨夜来信", position: next(), ...TEXT, height: 320, ...by(WRITER), metadata: { role: "script", content: "【第一集 雨夜来信】\n\n雨夜，快递员阿岚把最后一个包裹送上老城区的天台。收件人一栏，写着她自己的名字。\n\n钟楼的灯灭了。天台边缘，一个撑黑伞的人背对着她。\n\n包裹里是一把旧钥匙，和一张她从没见过的合影。" } });
  link(botNodeId(WRITER), "script");
  link("script", botNodeId(DESIGNER));
  link("script", botNodeId(BOARDER));

  const character = (id: string, name: string, profile: string, pictures: string[]) => {
    const at = next();
    const width = GROUP_INSET + (pictures.length + 1) * (TEXT.width + GROUP_INSET);
    nodes.push({ id, type: "group", title: name, position: at, width, height: GROUP_TOP + TEXT.height + GROUP_INSET, ...by(DESIGNER) });
    nodes.push({ id: `${id}-profile`, type: "text", title: `${name} · 设定`, position: { x: at.x + GROUP_INSET, y: at.y + GROUP_TOP }, ...TEXT, groupId: id, ...by(DESIGNER), metadata: { role: "character", content: profile } });
    link(botNodeId(DESIGNER), `${id}-profile`);
    link(`${id}-profile`, botNodeId(BOARDER));
    pictures.forEach((title, index) => {
      const picture = `${id}-picture-${index + 1}`;
      nodes.push({ id: picture, type: "image", title, position: { x: at.x + GROUP_INSET + (index + 1) * (TEXT.width + GROUP_INSET), y: at.y + GROUP_TOP }, ...PICTURE, groupId: id, createdBy: { kind: "person" }, metadata: { file: { path: `产出/图片/${title}.png`, mime: "image/png", bytes: 1_240_000, name: `${title}.png` }, naturalWidth: 1536, naturalHeight: 1024, status: "success" } });
      link(`${id}-profile`, picture, false);
    });
  };
  character("alan", "阿岚", "阿岚，26 岁，夜班快递员。\n短发，明黄色雨衣，左手腕有一道旧疤。\n话少，走路很快，习惯先看收件人再敲门。", ["阿岚 · 正面", "阿岚 · 雨衣"]);
  character("laozhou", "老周", "老周，58 岁，分拣站站长。\n灰色工装，老花镜挂在胸前。\n知道包裹的来历，但不肯说。", ["老周 · 半身"]);

  const withVideos = (shot: number) => moment === "finished" || (moment === "generating" && shot <= 3) || (moment === "failed" && !FAILED_SHOTS.includes(shot));
  /** The person went back to an earlier take of shot 2. */
  const selectedTake = (shot: number) => (shot === 2 ? 1 : takesOf(shot));
  /** The script changed after shot 5 was made. */
  const stale = (shot: number): CanvasNodeMetadata => (moment === "finished" && shot === 5 ? { stale: true } : {});
  SHOTS.forEach(([name, prompt], index) => {
    const shot = index + 1;
    const id = `shot-${shot}`;
    const title = `镜头 ${shot} · ${name}`;
    const state: CanvasNodeMetadata = withVideos(shot)
      ? { status: "success" }
      : moment === "generating" && shot === 4
        ? { status: "loading", jobId: "job-shot-4" }
        : moment === "failed" ? { status: "error", errorDetails: "生成服务没能完成这段视频：画面里的人物对不上参考图。" } : {};
    nodes.push({ id, type: "shot", title, position: next(), width: 340, height: 240, ...by(BOARDER), metadata: { prompt, ...stale(shot) } });
    nodes.push({ id: `${id}-creation`, type: "config", title, position: { x: 0, y: 0 }, width: 340, height: 240, ...by(BOARDER), metadata: { role: "creation", shotId: id, generationMode: "video", ...(shot === 8 ? { settings: { seconds: 10 } } : {}), ...state, ...stale(shot) } });
    link(botNodeId(BOARDER), id);
    link(id, `${id}-creation`);
    if (shot !== 1) link(shot === 5 ? "laozhou-picture-1" : "alan-picture-1", `${id}-creation`);
    if (shot === 5) link("alan-picture-2", `${id}-creation`);
    if (!withVideos(shot)) return;
    for (let take = 1; take <= takesOf(shot); take += 1) {
      const takeId = `${id}-take-${take}`;
      const selected = take === selectedTake(shot);
      nodes.push({
        id: takeId,
        type: "video",
        title: `${title} · 视频 ${take}`,
        position: { x: 0, y: 0 },
        ...CLIP,
        createdBy: { kind: "person" },
        metadata: { role: "take", shotId: id, ...(selected ? { selected: true } : {}), file: { path: `产出/视频/镜头${shot}-${take}.webm`, mime: "video/webm", bytes: 2_400_000, name: `镜头${shot}-${take}.webm` }, naturalWidth: 1280, naturalHeight: 720, durationMs: shot === 8 ? 10_000 : 5_000, status: "success", ...stale(shot) },
      });
      link(`${id}-creation`, takeId);
      if (selected) link(takeId, botNodeId(EDITOR));
    }
  });

  if (film) {
    nodes.push({ id: "film", type: "video", title: "雨城 · 第一集.mp4", position: next(), ...CLIP, createdBy: { kind: "person" }, metadata: { role: "final", file: { path: "产出/雨城 · 第一集.mp4", mime: "video/mp4", bytes: 48_000_000, name: "雨城 · 第一集.mp4" }, naturalWidth: 1920, naturalHeight: 1080, durationMs: 45_000 } });
    link(botNodeId(EDITOR), "film");
  }

  const base: CanvasSnapshot = {
    projectId: DRAMA_PROJECT_ID,
    revision: 1,
    nodes,
    connections,
    viewport: { x: 0, y: 0, k: 1 },
    backgroundMode: "dots",
    project: { id: DRAMA_PROJECT_ID, name: "雨城 · 第一集", leadBotId: LEAD, archived: false, folderState: "ready" },
    bots,
    run: dramaRun(moment),
    draft: { ...(draft ?? (moment === "finished" ? { state: "written", name: "雨城 · 第一集", writtenAt: Date.UTC(2026, 10, 22, 9, 58) } : { state: "none" })), exportFolder: DRAMA_EXPORT_FOLDER },
  };
  const positions = layoutPipeline(base);
  return structuredClone({ ...base, nodes: base.nodes.map((node) => ({ ...node, position: positions.get(node.id) ?? node.position })) });
}

/** The drama project on the in-memory backend. */
export function dramaCanvasBackend(sample: DramaSampleOptions = {}, overrides: Partial<MemoryCanvasOptions> = {}) {
  return createMemoryCanvasBackend({
    snapshot: dramaCanvasSnapshot(sample),
    looks: DRAMA_LOOKS,
    generation: { settings: sampleGenerationSettings(), servers: ["studio-images", "studio-video"], models: SAMPLE_MODELS },
    exchanges: { [LEAD]: [{ id: `${LEAD}-0`, role: "person", text: "做一集三分钟的悬疑短剧：雨夜，一个快递员收到写着自己名字的包裹。", at: Date.UTC(2026, 10, 22, 8, 58) }, { id: `${LEAD}-1`, role: "bot", text: dramaBots("finished")[LEAD]!.output!.text, at: Date.UTC(2026, 10, 22, 9, 0) }] },
    ...overrides,
  });
}
