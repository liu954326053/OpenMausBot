import type { ProductionEpisodeWire, ProductionWire } from "../../../../../shared/production";
import {
  botNodeId,
  type CanvasBotState,
  type CanvasConnection,
  type CanvasFileRef,
  type CanvasNode,
  type CanvasNodeMetadata,
  type CanvasSnapshot,
  type CanvasTaskRequest,
  type CanvasTaskResponse,
} from "../../../../../shared/project-canvas";
import type { CanvasBackend } from "@/lib/project-canvas/backend";
import type { CanvasBotLook, CanvasExchangeMessage } from "@/lib/project-canvas/types";
import type { OverlayBackend } from "../overlay-backend";

export const SAMPLE_PROJECT_ID = "fog-harbor";
const AT = Date.UTC(2026, 10, 24, 1, 0);

interface SampleBot {
  id: string;
  name: string;
  title: string;
  stages: CanvasBotState["stages"];
  episode?: number;
  status?: CanvasBotState["status"];
  doing?: string;
  waiting?: CanvasBotState["waiting"];
}

function bot(input: SampleBot, leadBotId: string): CanvasBotState {
  return {
    botId: input.id,
    name: input.name,
    title: input.title,
    lead: input.id === leadBotId,
    stages: input.stages,
    ...(input.episode === undefined ? {} : { episode: input.episode }),
    status: input.status ?? "idle",
    ...(input.doing ? { doing: input.doing } : {}),
    ...(input.waiting ? { waiting: input.waiting } : {}),
    placed: false,
  };
}

function file(path: string, mime: string): CanvasFileRef {
  return { path, mime, bytes: 120_000, name: path.split("/").pop() ?? path };
}

function node(id: string, type: CanvasNode["type"], title: string, metadata?: CanvasNodeMetadata, extra: Partial<CanvasNode> = {}): CanvasNode {
  return { id, type, title, position: { x: 0, y: 0 }, width: 280, height: 200, ...(metadata ? { metadata } : {}), ...extra };
}

const by = (botId: string): CanvasNode["createdBy"] => ({ kind: "bot", botId });

let connectionCount = 0;
function line(fromNodeId: string, toNodeId: string, pipeline = false): CanvasConnection {
  connectionCount += 1;
  return { id: `line-${connectionCount}`, fromNodeId, toNodeId, kind: "content", ...(pipeline ? { pipeline: true } : {}) };
}

interface Profile {
  key: string;
  title: string;
  badge?: string;
  subtitle: string;
  tags?: string[];
  rows?: Array<[string, string]>;
  palette?: string[];
  prompt: string;
}

const CHARACTERS: Profile[] = [
  {
    key: "qingwu",
    title: "沈青梧",
    badge: "女主",
    subtitle: "17 岁 · 灯铺传人",
    tags: ["倔强", "心细", "怕水"],
    rows: [["造型", "青灰短袄，发间别一枚铜灯钩"], ["声线", "清亮，急了会结巴"]],
    palette: ["#3d5a6c", "#c9a227", "#e8e2d4"],
    prompt: "少女，青灰短袄，铜灯钩发饰，雾中提灯，电影感侧光",
  },
  {
    key: "chenzhou",
    title: "陆沉舟",
    badge: "男主",
    subtitle: "24 岁 · 失忆的船长",
    tags: ["沉默", "左臂有旧伤"],
    rows: [["造型", "旧呢子大衣，领口磨白"], ["声线", "低沉，说话慢"]],
    palette: ["#2b2f36", "#7a5c3e"],
    prompt: "青年船长，旧呢子大衣，雾港码头，冷色调",
  },
  {
    key: "baixiansheng",
    title: "白先生",
    badge: "反派",
    subtitle: "50 岁 · 港务局长",
    tags: ["体面", "多疑"],
    rows: [["造型", "金丝眼镜，怀表不离手"]],
    palette: ["#e5e5e5", "#8c1c13"],
    prompt: "中年男人，金丝眼镜，怀表，阴影里的半张脸",
  },
  {
    key: "aman",
    title: "阿满",
    subtitle: "9 岁 · 报童",
    tags: ["机灵"],
    prompt: "小男孩，报童帽，抱着一摞报纸，雾里奔跑",
  },
];

const SCENES: Profile[] = [
  { key: "pier", title: "雾港码头", subtitle: "外景 · 夜 · 浓雾", tags: ["汽笛", "湿木板"], palette: ["#1f2a33", "#6b7f8c"], prompt: "夜晚码头，浓雾，煤气灯，远处汽笛" },
  { key: "shop", title: "青梧灯铺", subtitle: "内景 · 黄昏", tags: ["暖光", "满墙灯笼"], palette: ["#c9a227", "#5c3d2e"], prompt: "老灯铺内景，满墙灯笼，黄昏暖光" },
  { key: "lighthouse", title: "旧灯塔", subtitle: "外景 · 黎明 · 海风", palette: ["#9fb4c0"], prompt: "废弃灯塔，黎明，海风，螺旋楼梯" },
  { key: "street", title: "钟楼长街", subtitle: "外景 · 雨夜", prompt: "长街，钟楼，雨夜，石板路反光" },
];

const REFINED_SCENE: Profile = {
  key: "pier-end",
  title: "栈桥尽头",
  subtitle: "细化自雾港码头 · 低机位",
  prompt: "栈桥尽头，低机位仰拍，雾中一盏孤灯",
};

const SHOT_DESIGNS = [
  { title: "雾港全景", size: "远景", move: "缓慢推近", audio: "汽笛声，海浪", seconds: 6 },
  { title: "青梧提灯", size: "中景", move: "跟拍", audio: "脚步声", seconds: 5 },
  { title: "船影", size: "全景", move: "固定", audio: "雾中传来的钟声", seconds: 4 },
  { title: "对视", size: "近景", move: "正反打", audio: "青梧：“你是谁？”", seconds: 6 },
  { title: "怀表", size: "特写", move: "微距推近", audio: "滴答声", seconds: 3 },
  { title: "灯灭", size: "中景", move: "甩镜", audio: "风声骤起", seconds: 5 },
];

interface EpisodePlan {
  episode: number;
  title: string;
  logline: string;
  status: ProductionEpisodeWire["status"];
  /** How many of its shots have a selected take, are generating, and failed; the rest have no take yet. */
  shots: { selected: number; generating: number; failed: number; blank: number };
  /** Each made shot has one take, not up to three. */
  oneTake?: boolean;
}

const EPISODES: EpisodePlan[] = [
  { episode: 1, title: "点灯的人", logline: "雾夜，青梧在码头救起一个失忆的船长", status: "done", shots: { selected: 6, generating: 0, failed: 0, blank: 0 } },
  { episode: 2, title: "不在航表上的船", logline: "一艘不该存在的船靠了岸", status: "videos", shots: { selected: 3, generating: 1, failed: 1, blank: 0 } },
  { episode: 3, title: "灯芯里的名字", logline: "灯芯里藏着一张写了名字的纸条", status: "storyboard", shots: { selected: 0, generating: 0, failed: 0, blank: 2 } },
  { episode: 4, title: "钟楼下的账本", logline: "阿满在钟楼下捡到半本账", status: "waiting", shots: { selected: 0, generating: 0, failed: 0, blank: 0 } },
];

const QUESTION_CARD: NonNullable<CanvasBotState["waiting"]>["card"] = {
  title: "EP03 的开场用哪个视角？",
  subtitle: "两种都能接上 EP02 的结尾",
  options: ["从灯塔俯拍", "从青梧的视角"],
  requestId: "ask-ep3-opening",
  requestType: "question",
};

interface Built {
  nodes: CanvasNode[];
  connections: CanvasConnection[];
}

function addProfile(built: Built, profile: Profile, role: "character" | "scene", botId: string): void {
  const group = `group-${profile.key}`;
  built.nodes.push(node(group, "group", profile.title));
  built.nodes.push(node(`profile-${profile.key}`, "text", profile.title, {
    role,
    content: `${profile.title}：${profile.subtitle}。`,
    card: {
      ...(profile.badge ? { badge: profile.badge } : {}),
      subtitle: profile.subtitle,
      ...(profile.tags ? { tags: profile.tags } : {}),
      ...(profile.rows ? { rows: profile.rows } : {}),
      ...(profile.palette ? { palette: profile.palette } : {}),
    },
  }, { groupId: group, createdBy: by(botId) }));
  built.nodes.push(node(`image-${profile.key}`, "image", profile.title, {
    file: file(`产出/${profile.key}.png`, "image/png"),
    prompt: profile.prompt,
    status: "success",
    naturalWidth: 768,
    naturalHeight: 1024,
  }, { groupId: group, createdBy: by(botId) }));
}

function addEpisodeShots(built: Built, plan: EpisodePlan, boardBotId: string, postBotId: string | undefined): number {
  const { selected, generating, failed, blank } = plan.shots;
  const total = selected + generating + failed + blank;
  for (let index = 0; index < total; index += 1) {
    const design = SHOT_DESIGNS[index % SHOT_DESIGNS.length]!;
    const shot = `shot-${plan.episode}-${index + 1}`;
    const creation = `creation-${plan.episode}-${index + 1}`;
    const status = index < selected ? "success" : index < selected + generating ? "loading" : index < selected + generating + failed ? "error" : "idle";
    built.nodes.push(node(shot, "shot", design.title, {
      episode: plan.episode,
      prompt: `${design.title}：雾中的码头，${design.size}，${design.move}`,
      shot: { size: design.size, move: design.move, audio: design.audio },
      settings: { seconds: design.seconds },
    }, { createdBy: by(boardBotId) }));
    built.nodes.push(node(creation, "config", "", {
      role: "creation",
      shotId: shot,
      episode: plan.episode,
      generationMode: "video",
      status,
      ...(status === "error" ? { errorDetails: "The video service refused the prompt." } : {}),
    }, { createdBy: by(boardBotId) }));
    built.connections.push(line(shot, creation, true));
    const character = CHARACTERS[index % 2]!;
    built.connections.push(line(`image-${character.key}`, shot));
    built.connections.push(line(plan.episode === 1 && index === 5 ? `image-${REFINED_SCENE.key}` : `image-${SCENES[index % SCENES.length]!.key}`, shot));
    if (status !== "success") continue;
    const takes = plan.oneTake ? 1 : index === 2 ? 3 : 1 + (index % 2);
    for (let take = 1; take <= takes; take += 1) {
      const id = `take-${plan.episode}-${index + 1}-${take}`;
      built.nodes.push(node(id, "video", design.title, {
        role: "take",
        shotId: shot,
        episode: plan.episode,
        file: file(`产出/ep${plan.episode}-sh${index + 1}-v${take}.mp4`, "video/mp4"),
        durationMs: design.seconds * 1000,
        naturalWidth: 1280,
        naturalHeight: 720,
        ...(take === takes ? { selected: true } : {}),
      }, { createdBy: by(boardBotId) }));
      built.connections.push(line(creation, id, true));
      if (take === takes && postBotId) built.connections.push(line(id, botNodeId(postBotId), true));
    }
  }
  return total;
}

interface SampleShape {
  episodes: EpisodePlan[];
  /** Episodes whose storyboard bot asks the person a question. */
  waitingEpisodes?: number[];
  withoutPublicist?: boolean;
}

function buildDrama(shape: SampleShape): CanvasSnapshot {
  connectionCount = 0;
  const leadBotId = "lead";
  const bots: SampleBot[] = [
    { id: "lead", name: "阿策", title: "制片统筹", stages: ["lead"], status: "idle" },
    { id: "writer", name: "墨白", title: "编剧", stages: ["script"] },
    { id: "designer", name: "画眉", title: "角色设计师", stages: ["character"] },
    { id: "scenery", name: "砚山", title: "场景设计师", stages: ["scene"] },
    { id: "board", name: "镜川", title: "分镜脚本设计师", stages: ["storyboard"] },
    { id: "post", name: "剪秋", title: "后期制作", stages: ["post"] },
    ...(shape.withoutPublicist ? [] : [{ id: "publicist", name: "青禾", title: "宣发", stages: ["other"] } satisfies SampleBot]),
  ];
  const built: Built = { nodes: [], connections: [] };
  built.nodes.push(node("brief", "text", "创作需求单", {
    role: "brief",
    content: "把《雾港灯语》改成竖屏漫剧，每集约 40 秒。",
    card: { rows: [["项目", "《雾港灯语》漫剧化"], ["集数", `全 ${shape.episodes.length} 集 · 单集约 40 秒`], ["画风", "冷色调电影感"]] },
  }, { createdBy: by(leadBotId) }));
  built.nodes.push(node("plan", "text", "任务拆分", { role: "plan", content: "编剧、角色、场景，再每集分镜和后期。" }, { createdBy: by(leadBotId) }));
  built.connections.push(line("brief", botNodeId("writer"), true));
  for (const character of CHARACTERS) addProfile(built, character, "character", "designer");
  for (const scene of SCENES) addProfile(built, scene, "scene", "scenery");
  const episodes: ProductionEpisodeWire[] = [];
  for (const plan of shape.episodes) {
    const episodeNode = `episode-${plan.episode}`;
    built.nodes.push(node(episodeNode, "text", plan.title, {
      role: "episode",
      episode: plan.episode,
      content: `第 ${plan.episode} 集《${plan.title}》\n${plan.logline}。`,
      card: { subtitle: plan.logline },
    }, { createdBy: by("writer") }));
    const started = plan.status !== "waiting";
    const boardBotId = `board-${plan.episode}`;
    const postBotId = plan.status === "post" || plan.status === "done" ? `post-${plan.episode}` : undefined;
    if (started) {
      const waiting = shape.waitingEpisodes?.includes(plan.episode);
      bots.push({
        id: boardBotId,
        name: `镜川 EP${String(plan.episode).padStart(2, "0")}`,
        title: "分镜脚本设计师",
        stages: ["storyboard"],
        episode: plan.episode,
        status: waiting ? "waiting" : plan.status === "storyboard" || plan.status === "videos" ? "working" : "idle",
        ...(plan.status === "videos" ? { doing: "等视频生成" } : plan.status === "storyboard" && !waiting ? { doing: "写分镜" } : {}),
        ...(waiting ? { waiting: { threadId: `thread-${boardBotId}`, messageId: `ask-${boardBotId}`, card: QUESTION_CARD } } : {}),
      });
      built.connections.push(line(episodeNode, botNodeId(boardBotId), true));
    }
    if (postBotId) {
      bots.push({ id: postBotId, name: `剪秋 EP${String(plan.episode).padStart(2, "0")}`, title: "后期制作", stages: ["post"], episode: plan.episode });
    }
    if (plan.episode === 1) addProfile(built, REFINED_SCENE, "scene", boardBotId);
    const shots = started ? addEpisodeShots(built, plan, boardBotId, postBotId) : 0;
    if (plan.status === "done" && postBotId) {
      const final = `final-${plan.episode}`;
      built.nodes.push(node(final, "video", `${plan.title} 成片`, {
        role: "final",
        episode: plan.episode,
        file: file(`成片/EP${String(plan.episode).padStart(2, "0")}.mp4`, "video/mp4"),
        durationMs: 29_000,
        naturalWidth: 720,
        naturalHeight: 1280,
      }, { createdBy: by(postBotId) }));
      built.connections.push(line(botNodeId(postBotId), final, true));
    }
    episodes.push({
      episode: plan.episode,
      nodeId: episodeNode,
      title: plan.title,
      status: plan.status,
      ...(started ? { storyboardBotId: boardBotId } : {}),
      ...(postBotId ? { postBotId } : {}),
      shots,
      ready: plan.shots.selected,
      generating: plan.shots.generating,
      failed: plan.shots.failed,
    });
  }
  const production: ProductionWire = {
    plan: {
      assignments: { script: "writer", character: "designer", scene: "scenery", storyboard: "board", post: "post" },
      episodes: shape.episodes.length,
      plannedAt: AT,
    },
    jobs: [
      { job: "script", botId: "writer", status: "done" },
      { job: "character", botId: "designer", status: "done" },
      { job: "scene", botId: "scenery", status: "done" },
    ],
    ready: true,
    episodes,
    tasks: [],
    startedAt: AT,
  };
  const states = bots.map((each) => bot(each, leadBotId));
  for (const state of states) built.nodes.push(node(botNodeId(state.botId), "bot", state.name, undefined, { width: 320, height: 240 }));
  return {
    projectId: SAMPLE_PROJECT_ID,
    revision: 7,
    nodes: built.nodes,
    connections: built.connections,
    viewport: { x: 0, y: 0, k: 1 },
    backgroundMode: "blank",
    project: { id: SAMPLE_PROJECT_ID, name: "雾港灯语", leadBotId, archived: false, folderState: "ready" },
    bots: Object.fromEntries(states.map((state) => [state.botId, state])),
    production,
    drafts: {
      1: { state: "written", name: "雾港灯语 EP01", writtenAt: AT, exportFolder: "/tmp/board-panels/成片" },
    },
  };
}

/** Four episodes: the first finished, the second making its videos, the third's storyboard bot asking a question,
 * the fourth not started. */
export function boardSnapshot(): CanvasSnapshot {
  return buildDrama({ episodes: EPISODES, waitingEpisodes: [3] });
}

/** A drama of `count` episodes, each with its own storyboard and post bot and six shots. */
export function bigBoardSnapshot(count: number): CanvasSnapshot {
  const episodes: EpisodePlan[] = Array.from({ length: count }, (_, index) => ({
    episode: index + 1,
    title: `第 ${index + 1} 集`,
    logline: "雾里又亮起一盏灯",
    status: "done",
    shots: { selected: 6, generating: 0, failed: 0, blank: 0 },
  }));
  return buildDrama({ episodes });
}

/** The owner's drama as pb-bench measured it: 60 finished episodes, 126 bots in the project, 283 shots with a take each,
 * 1124 nodes (pb-bench's had 1134). */
export function dramaScaleSnapshot(): CanvasSnapshot {
  const episodes: EpisodePlan[] = Array.from({ length: 60 }, (_, index) => ({
    episode: index + 1,
    title: `第 ${index + 1} 集`,
    logline: "雾里又亮起一盏灯",
    status: "done",
    shots: { selected: index < 43 ? 5 : 4, generating: 0, failed: 0, blank: 0 },
    oneTake: true,
  }));
  return buildDrama({ episodes, withoutPublicist: true });
}

/** What `readBotLooks` answers in a workspace of `total` bots: every bot's look, not only the project's. */
export function workspaceLooks(snapshot: CanvasSnapshot, total: number): Record<string, CanvasBotLook> {
  const looks: Record<string, CanvasBotLook> = Object.fromEntries(Object.keys(snapshot.bots).map((botId) => [botId, SAMPLE_LOOKS[botId] ?? { color: "blue" }]));
  for (let other = 1; Object.keys(looks).length < total; other += 1) looks[`elsewhere-${other}`] = { color: "green" };
  return looks;
}

export const SAMPLE_LOOKS: Record<string, CanvasBotLook> = {
  lead: { color: "orange" },
  writer: { color: "purple" },
  designer: { color: "pink" },
  scenery: { color: "teal" },
  board: { color: "blue" },
  post: { color: "green" },
  publicist: { color: "yellow" },
  "board-1": { color: "blue" },
  "board-2": { color: "blue", unread: true },
  "board-3": { color: "blue" },
  "post-1": { color: "green" },
};

const SAMPLE_EXCHANGES: Record<string, CanvasExchangeMessage[]> = {
  lead: [
    { id: "lead-1", role: "person", text: "我想把《雾港灯语》做成漫剧，先做前四集看效果。", at: AT },
    { id: "lead-2", role: "bot", text: "需求单写好了。编剧墨白、角色画眉、场景砚山，**分镜和后期每集各一位**。", at: AT + 60_000 },
  ],
  "board-2": [
    { id: "board-2-1", role: "person", text: "追逐那场节奏再快一点。", at: AT },
    { id: "board-2-2", role: "bot", text: "收到，SH03 拆成两个 3 秒的镜头，正在重新生成。", at: AT + 60_000 },
  ],
};

/** Every call the overlay made, in order. */
export interface BackendCalls {
  sent: CanvasTaskRequest[];
  stopped: string[];
  chats: Array<{ botId: string; threadId?: string }>;
  read: Array<{ botId: string; threadId?: string }>;
  exchanges: string[];
}

export interface FakeBackend {
  backend: CanvasBackend;
  calls: BackendCalls;
  /** The next `sendTask` rejects with this message. */
  failNextSend(message: string): void;
  /** The next task waits in the bot's queue. */
  queueNextSend(): void;
  /** `sendTask` waits until this is called. */
  holdSends(): () => void;
}

/** The backend the overlay sees: the calls it makes are recorded, the rest reject. */
export function fakeBackend(options: { exchanges?: Record<string, CanvasExchangeMessage[]>; looks?: Record<string, CanvasBotLook>; fileUrl?: OverlayBackend["fileUrl"] } = {}): FakeBackend {
  const exchanges = new Map(Object.entries(options.exchanges ?? SAMPLE_EXCHANGES).map(([botId, list]) => [botId, [...list]]));
  const calls: BackendCalls = { sent: [], stopped: [], chats: [], read: [], exchanges: [] };
  let failure: string | null = null;
  let queueNext = false;
  let hold: Promise<void> | null = null;
  let sentCount = 0;
  const used: OverlayBackend = {
    fileUrl: options.fileUrl ?? ((_projectId, ref) => `/__board-panels/files/${encodeURIComponent(ref.path)}`),
    readBotLooks: async () => ({ ...(options.looks ?? SAMPLE_LOOKS) }),
    readExchange: async (_projectId, botId) => {
      calls.exchanges.push(botId);
      return [...(exchanges.get(botId) ?? [])];
    },
    sendTask: async (_projectId, task): Promise<CanvasTaskResponse> => {
      calls.sent.push(task);
      if (hold) await hold;
      if (failure) {
        const message = failure;
        failure = null;
        throw new Error(message);
      }
      if (queueNext) {
        queueNext = false;
        return { threadId: `thread-${task.botId}`, queued: true, references: 0 };
      }
      sentCount += 1;
      const messageId = `sent-${sentCount}`;
      exchanges.set(task.botId, [...(exchanges.get(task.botId) ?? []), { id: messageId, role: "person", text: task.text, at: AT + sentCount }]);
      return { threadId: `thread-${task.botId}`, messageId, references: 0 };
    },
    stopBot: async (_projectId, botId) => {
      calls.stopped.push(botId);
    },
    openChat: (_projectId, botId, threadId) => {
      calls.chats.push({ botId, ...(threadId ? { threadId } : {}) });
    },
    readConversation: (_projectId, botId, threadId) => {
      calls.read.push({ botId, ...(threadId ? { threadId } : {}) });
    },
  };
  const backend = new Proxy(used, {
    get: (target, key) => key in target
      ? target[key as keyof OverlayBackend]
      : () => Promise.reject(new Error(`The board's overlay does not call ${String(key)}.`)),
  }) as unknown as CanvasBackend;
  return {
    backend,
    calls,
    failNextSend: (message) => {
      failure = message;
    },
    queueNextSend: () => {
      queueNext = true;
    },
    holdSends: () => {
      let release = (): void => undefined;
      hold = new Promise<void>((resolve) => {
        release = () => {
          hold = null;
          resolve();
        };
      });
      return release;
    },
  };
}
