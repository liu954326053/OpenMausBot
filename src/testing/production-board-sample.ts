import { episodeCode, type ProductionEpisodeWire, type ProductionTaskWire, type ProductionWire } from "../../shared/production";
import { botNodeId, type CanvasBotState, type CanvasConnection, type CanvasNode, type CanvasNodeMetadata, type CanvasSnapshot } from "../../shared/project-canvas";
import type { ProjectDraftWire } from "../../shared/project-draft";
import type { FlowStage } from "../../shared/team-pipeline";
import { createMemoryCanvasBackend, type MemoryCanvasOptions } from "../lib/project-canvas/memory-backend";
import type { CanvasBotLook, CanvasExchangeMessage } from "../lib/project-canvas/types";
import { SAMPLE_MODELS, sampleGenerationSettings } from "./project-canvas-sample";

export const BOARD_PROJECT_ID = "rain-city-series";
export const BOARD_EXPORT_FOLDER = "/Users/demo/短剧/雨城/产出";

export interface ProductionBoardSampleOptions {
  /** How many episodes the script bot wrote. */
  episodes?: number;
  /** Before the lead planned anything: the team and nothing else. */
  empty?: boolean;
}

export const BOARD_BOTS = { lead: "yunzhou", writer: "yanqing", painter: "mobai", builder: "linxi", boarder: "xiaoman", editor: "qinghe", operations: "ache" } as const;
const { lead: LEAD, writer: WRITER, painter: PAINTER, builder: BUILDER, boarder: BOARDER, editor: EDITOR, operations: OPERATIONS } = BOARD_BOTS;
export const boarderOf = (episode: number) => `${BOARDER}-${episode}`;
export const editorOf = (episode: number) => `${EDITOR}-${episode}`;

/** EP01 is being cut and its film is back, EP02's videos are generating, EP03's storyboard failed; the rest wait. */
export const SAMPLE_IN_WORK = [1, 2, 3] as const;
export const SAMPLE_FAILED_EPISODE = 3;
export const SAMPLE_GENERATING_SHOT = "ep2-shot-4";

const TITLES = ["雨夜来信", "钟楼熄灯", "分拣站的旧账", "黑伞", "第二把钥匙", "老周的沉默", "天台之约", "照片里的人", "末班车", "城南旧址", "雨停之前", "回信"];
const CHARACTERS = [
  { id: "alan", name: "阿岚", badge: "主角", subtitle: "26 岁 · 夜班快递员", tags: ["倔强", "话少"], palette: ["#f2c230", "#1f2a44"], rows: [["外形", "短发，明黄雨衣"], ["声音", "低，语速快"]] as Array<[string, string]> },
  { id: "laozhou", name: "老周", badge: "配角", subtitle: "58 岁 · 分拣站站长", tags: ["守口如瓶"], palette: ["#7d7f84"], rows: [["外形", "灰工装，老花镜"]] as Array<[string, string]> },
  { id: "umbrella", name: "黑伞人", badge: "反派", subtitle: "身份不明", tags: ["神秘"], palette: ["#111111"], rows: [] as Array<[string, string]> },
  { id: "lin", name: "林警官", subtitle: "34 岁 · 刑警", tags: ["敏锐"], palette: ["#2d4b73"], rows: [["外形", "深色风衣"]] as Array<[string, string]> },
];
const SCENES = [
  { id: "rooftop", name: "老城区天台", subtitle: "夜 · 外 · 雨", cameras: 3 },
  { id: "sorting", name: "分拣站", subtitle: "日 · 内", cameras: 2 },
  { id: "clock", name: "钟楼", subtitle: "夜 · 外", cameras: 4 },
  { id: "alley", name: "雨夜街巷", subtitle: "夜 · 外 · 雨", cameras: 2 },
];
const EP1_SHOTS = ["天台全景", "阿岚上天台", "包裹特写", "钟楼熄灯", "黑伞人影", "雨幕对视"];
const EP2_SHOTS = ["分拣站清晨", "老周递包裹", "欲言又止", "钥匙特写", "林警官来访", "门外的伞"];

const at = (minute: number) => Date.UTC(2026, 10, 23, 9, minute);
const bot = (botId: string, name: string, title: string, stages: FlowStage[], extra: Partial<CanvasBotState> = {}): CanvasBotState =>
  ({ botId, name, title, lead: stages.includes("lead"), stages, status: "idle", placed: false, ...extra });
const said = (botId: string, text: string, minute: number) => ({ text, threadId: `thread-${botId}`, messageId: `${botId}-out`, at: at(minute) });
const by = (botId: string) => ({ createdBy: { kind: "bot" as const, botId } });
const frame = { position: { x: 0, y: 0 }, width: 340, height: 240 };
const png = (name: string) => ({ path: `产出/图片/${name}.png`, mime: "image/png", bytes: 1_200_000, name: `${name}.png` });
const webm = (name: string, seconds: number): CanvasNodeMetadata => ({ file: { path: `产出/视频/${name}.webm`, mime: "video/webm", bytes: 2_400_000, name: `${name}.webm` }, naturalWidth: 1280, naturalHeight: 720, durationMs: seconds * 1000, status: "success" });
const titleOf = (episode: number) => TITLES[episode - 1] ?? `第 ${episode} 集`;

function sampleBots(empty: boolean): Record<string, CanvasBotState> {
  const bots = [
    bot(LEAD, "云舟", "制片人", ["lead"], empty ? {} : { output: said(LEAD, "计划定好了：60 集，砚青写分集，墨白和林夕同时做角色和场景。", 2) }),
    bot(WRITER, "砚青", "编剧", ["script"], { steps: [{ text: "读完原著", at: at(4) }, { text: "写完 60 集分集大纲", at: at(9) }] }),
    bot(PAINTER, "墨白", "角色设计", ["character"]),
    bot(BUILDER, "林夕", "场景设计", ["scene"]),
    bot(BOARDER, "小满", "分镜", ["storyboard"]),
    bot(EDITOR, "青禾", "后期", ["post"]),
    bot(OPERATIONS, "阿澈", "运营", ["other"]),
  ];
  if (!empty) {
    bots.push(
      bot(boarderOf(1), "小满 · EP01", "分镜", ["storyboard"], { episode: 1, output: said(boarderOf(1), "EP01 的 6 个镜头都选好了版本。", 30) }),
      bot(editorOf(1), "青禾 · EP01", "后期", ["post"], { episode: 1, status: "working", doing: "核对时间线", steps: [{ text: "收到 6 段视频", at: at(41) }, { text: "写好剪映草稿", at: at(44) }, { text: "核对时间线", at: at(46) }] }),
      bot(boarderOf(2), "小满 · EP02", "分镜", ["storyboard"], { episode: 2, status: "working", doing: "生成 SH04 的视频", steps: [{ text: "拆成 6 个镜头", at: at(35) }, { text: "生成 SH04 的视频", at: at(47) }] }),
      bot(boarderOf(3), "小满 · EP03", "分镜", ["storyboard"], { episode: 3 }),
    );
  }
  return Object.fromEntries(bots.map((one) => [one.botId, one]));
}

export const PRODUCTION_BOARD_LOOKS: Record<string, CanvasBotLook> = {
  [LEAD]: { color: "purple" },
  [WRITER]: { color: "blue" },
  [PAINTER]: { color: "coral" },
  [BUILDER]: { color: "yellow" },
  [BOARDER]: { color: "teal" },
  [EDITOR]: { color: "green" },
  [OPERATIONS]: { color: "pink" },
  [boarderOf(1)]: { color: "teal" },
  [boarderOf(2)]: { color: "teal" },
  [boarderOf(3)]: { color: "teal" },
  [editorOf(1)]: { color: "green" },
};

function sampleProduction(count: number): ProductionWire {
  const status = (episode: number): ProductionEpisodeWire["status"] => (episode === 1 ? "post" : episode === 2 ? "videos" : episode === SAMPLE_FAILED_EPISODE ? "failed" : "waiting");
  const episodes = Array.from({ length: count }, (_, index): ProductionEpisodeWire => {
    const episode = index + 1;
    const shots = episode === 1 ? EP1_SHOTS.length : episode === 2 ? EP2_SHOTS.length : 0;
    return {
      episode, nodeId: `ep${episode}`, title: titleOf(episode), status: status(episode), shots,
      ready: episode === 1 ? shots : episode === 2 ? 3 : 0, generating: episode === 2 ? 1 : 0, failed: 0,
      ...(episode <= 3 ? { storyboardBotId: boarderOf(episode) } : {}),
      ...(episode === 1 ? { postBotId: editorOf(1) } : {}),
    };
  });
  const tasks: ProductionTaskWire[] = [
    { id: "t-script", job: "script", botId: WRITER, status: "done", at: at(3), endedAt: at(10) },
    { id: "t-character", job: "character", botId: PAINTER, status: "done", at: at(11), endedAt: at(20) },
    { id: "t-scene", job: "scene", botId: BUILDER, status: "done", at: at(11), endedAt: at(18) },
    { id: "t-board-1", job: "storyboard", botId: boarderOf(1), episode: 1, status: "done", at: at(21), endedAt: at(30) },
    { id: "t-board-2", job: "storyboard", botId: boarderOf(2), episode: 2, status: "done", at: at(31), endedAt: at(36) },
    { id: "t-board-3", job: "storyboard", botId: boarderOf(3), episode: 3, status: "failed", at: at(37), endedAt: at(39) },
    { id: "t-post-1", job: "post", botId: editorOf(1), episode: 1, status: "working", at: at(40) },
  ];
  return {
    plan: {
      assignments: { script: WRITER, character: PAINTER, scene: BUILDER, storyboard: BOARDER, post: EDITOR },
      episodes: count,
      source: { title: "雨城", author: "南渡", tags: ["都市悬疑", "46 章", "38.6 万字"], quote: "雨城的灯，十年没亮过了。", from: "你上传的 TXT" },
      plannedAt: at(2),
    },
    jobs: [{ job: "script", botId: WRITER, status: "done" }, { job: "character", botId: PAINTER, status: "done" }, { job: "scene", botId: BUILDER, status: "done" }],
    ready: true,
    episodes,
    tasks,
    startedAt: at(2),
  };
}

/** A sixty-episode drama part-way through its production. Its files are named, not there: a page that draws it gives
 * each a picture or a clip. */
export function productionBoardSample({ episodes: count = 60, empty = false }: ProductionBoardSampleOptions = {}): CanvasSnapshot {
  const bots = sampleBots(empty);
  const nodes: CanvasNode[] = Object.values(bots).map((state) => ({ id: botNodeId(state.botId), type: "bot", title: state.name, ...frame, width: 300, height: 180 }));
  const connections: CanvasConnection[] = [];
  const link = (fromNodeId: string, toNodeId: string) => connections.push({ id: `${fromNodeId}>${toNodeId}`, fromNodeId, toNodeId, kind: "content", pipeline: true });
  const base: CanvasSnapshot = {
    projectId: BOARD_PROJECT_ID,
    revision: 1,
    nodes,
    connections,
    viewport: { x: 0, y: 0, k: 1 },
    backgroundMode: "dots",
    project: { id: BOARD_PROJECT_ID, name: "雨城", leadBotId: LEAD, archived: false, folderState: "ready" },
    bots,
  };
  if (empty) return structuredClone(base);

  nodes.push(
    { id: "brief", type: "text", title: "需求单", ...frame, ...by(LEAD), metadata: { role: "brief", version: 2, card: { rows: [["类型", "悬疑短剧"], ["集数", String(count)], ["每集", "约 1 分钟"], ["画幅", "9:16 竖屏"], ["风格", "雨夜霓虹，冷色调"]] } } },
    { id: "plan", type: "text", title: "任务拆分", ...frame, ...by(LEAD), metadata: { role: "plan", version: 1, content: "砚青写分集；墨白、林夕同时做角色和场景；每集一位分镜、一位后期。" } },
  );
  for (let episode = 1; episode <= count; episode += 1) {
    nodes.push({ id: `ep${episode}`, type: "text", title: `${episodeCode(episode)} · ${titleOf(episode)}`, ...frame, ...by(WRITER), metadata: { role: "episode", episode, card: { subtitle: episode === 1 ? "雨夜，快递员阿岚收到写着自己名字的包裹。" : `第 ${episode} 集的梗概` }, content: `【${episodeCode(episode)} ${titleOf(episode)}】\n\n雨还在下。` } });
  }
  for (const one of CHARACTERS) {
    nodes.push({ id: `g-${one.id}`, type: "group", title: one.name, ...frame, ...by(PAINTER) });
    nodes.push({ id: one.id, type: "text", title: one.name, ...frame, groupId: `g-${one.id}`, ...by(PAINTER), metadata: { role: "character", version: 1, content: `${one.name}的设定。`, card: { ...(one.badge ? { badge: one.badge } : {}), subtitle: one.subtitle, tags: one.tags, palette: one.palette, rows: one.rows } } });
    nodes.push({ id: `${one.id}-1`, type: "image", title: `${one.name} · 定妆`, ...frame, groupId: `g-${one.id}`, ...by(PAINTER), metadata: { file: png(one.name), naturalWidth: 1024, naturalHeight: 1536, status: "success", selected: true } });
  }
  for (const one of SCENES) {
    nodes.push({ id: `g-${one.id}`, type: "group", title: one.name, ...frame, ...by(BUILDER) });
    nodes.push({ id: one.id, type: "text", title: one.name, ...frame, groupId: `g-${one.id}`, ...by(BUILDER), metadata: { role: "scene", version: 2, content: `${one.name}。`, card: { subtitle: one.subtitle, cameras: one.cameras } } });
    nodes.push({ id: `${one.id}-1`, type: "image", title: one.name, ...frame, groupId: `g-${one.id}`, ...by(BUILDER), metadata: { file: png(one.name), naturalWidth: 1536, naturalHeight: 1024, status: "success" } });
  }
  nodes.push({ id: "sorting-dawn", type: "text", title: "分拣站 · 清晨", ...frame, ...by(boarderOf(2)), metadata: { role: "scene", content: "清晨的分拣站，传送带还没开。", card: { subtitle: "晨 · 内" } } });
  link("sorting", "sorting-dawn");

  const shots = (episode: number, names: readonly string[], take: (shot: number) => { takes: number; status?: "loading" } | undefined) => {
    names.forEach((name, index) => {
      const shot = index + 1;
      const id = `ep${episode}-shot-${shot}`;
      const seconds = shot % 3 === 0 ? 8 : 5;
      const made = take(shot);
      nodes.push({ id, type: "shot", title: name, ...frame, ...by(boarderOf(episode)), metadata: { episode, prompt: `${name}：雨夜，霓虹在积水里晃动。`, shot: { size: shot % 2 ? "全景" : "特写", move: shot % 2 ? "缓慢推近" : "固定", audio: shot === 2 ? "阿岚：“谁寄的？”" : "雨声" }, settings: { seconds } } });
      nodes.push({ id: `${id}-creation`, type: "config", title: name, ...frame, ...by(boarderOf(episode)), metadata: { role: "creation", shotId: id, episode, generationMode: "video", settings: { seconds }, ...(made?.status ? { status: made.status, jobId: `job-${id}` } : made?.takes ? { status: "success" } : {}) } });
      link(id, `${id}-creation`);
      link(shot % 2 ? (episode === 1 ? "rooftop-1" : "sorting-dawn") : "alan-1", `${id}-creation`);
      if (shot === 2) link("laozhou-1", `${id}-creation`);
      for (let version = 1; version <= (made?.takes ?? 0); version += 1) {
        const takeId = `${id}-take-${version}`;
        nodes.push({ id: takeId, type: "video", title: `${name} · ${version}`, ...frame, createdBy: { kind: "person" }, metadata: { role: "take", shotId: id, episode, ...(version === made!.takes ? { selected: true } : {}), ...webm(`${episodeCode(episode)}-${shot}-${version}`, seconds) } });
        link(`${id}-creation`, takeId);
      }
    });
  };
  shots(1, EP1_SHOTS, (shot) => ({ takes: shot === 3 ? 2 : 1 }));
  shots(2, EP2_SHOTS, (shot) => (shot <= 3 ? { takes: shot === 1 ? 3 : 1 } : shot === 4 ? { takes: 0, status: "loading" } : undefined));
  nodes.push({ id: "film-1", type: "video", title: `${episodeCode(1)} · ${titleOf(1)}.mp4`, ...frame, createdBy: { kind: "person" }, metadata: { role: "final", episode: 1, ...webm("雨城-EP01", 38) } });
  nodes.push({ id: "note", type: "text", title: "宣传语", ...frame, createdBy: { kind: "person" }, metadata: { content: "这座城，每个雨夜都有一封信。" } });

  const drafts: Record<number, ProjectDraftWire> = {
    1: {
      state: "written", name: `雨城 · ${episodeCode(1)}`, writtenAt: at(44), exportFolder: BOARD_EXPORT_FOLDER,
      tracks: [{ kind: "voice", segments: [{ startMs: 1000, durationMs: 3000 }] }, { kind: "music", segments: [{ startMs: 0, durationMs: 20000 }] }],
    },
  };
  return structuredClone({ ...base, production: sampleProduction(count), drafts });
}

export const PRODUCTION_BOARD_EXCHANGES: Record<string, CanvasExchangeMessage[]> = {
  [LEAD]: [
    { id: `${LEAD}-0`, role: "person", text: "做一部 60 集的悬疑短剧：雨夜，一个快递员收到写着自己名字的包裹。", at: at(0) },
    { id: `${LEAD}-1`, role: "bot", text: "计划定好了：60 集，砚青写分集，墨白和林夕同时做角色和场景。", at: at(2) },
  ],
};

/** The sample drama on the in-memory backend. */
export function productionBoardBackend(sample: ProductionBoardSampleOptions = {}, overrides: Partial<MemoryCanvasOptions> = {}) {
  return createMemoryCanvasBackend({
    snapshot: productionBoardSample(sample),
    looks: PRODUCTION_BOARD_LOOKS,
    generation: { settings: sampleGenerationSettings(), servers: ["studio-images", "studio-video"], models: SAMPLE_MODELS },
    exchanges: PRODUCTION_BOARD_EXCHANGES,
    ...overrides,
  });
}
