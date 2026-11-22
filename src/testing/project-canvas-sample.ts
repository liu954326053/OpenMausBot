import { botNodeId, dispatchConnectionId, type CanvasBotState, type CanvasConnection, type CanvasNode, type CanvasSnapshot } from "../../shared/project-canvas";
import { DEFAULT_GENERATION_SETTINGS, type GenerationModel, type ProjectGenerationSettings } from "../../shared/project-generation";
import { createMemoryCanvasBackend, type MemoryCanvasOptions } from "../lib/project-canvas/memory-backend";
import { layoutPipeline } from "../lib/project-canvas/stage-layout";
import type { CanvasBotLook, CanvasExchangeMessage } from "../lib/project-canvas/types";

export const SAMPLE_PROJECT_ID = "rain-city";
export const SAMPLE_IMAGE_PATH = "素材/city-night.png";
export const SAMPLE_VIDEO_PATH = "产出/视频/rooftop-1.webm";

const bot = (botId: string, name: string, title: string, extra: Partial<CanvasBotState> = {}): CanvasBotState => ({ botId, name, title, lead: false, stages: ["other"], status: "idle", placed: false, ...extra });

export const SAMPLE_BOTS: Record<string, CanvasBotState> = {
  mira: bot("mira", "Mira", "Director", {
    lead: true,
    stages: ["lead"],
    output: {
      text: "**Episode 1 plan**\n\n- Kai writes the logline and the rooftop scene.\n- Lena boards shot 1 and generates it.\n- Otto cuts the teaser once shot 1 is in.",
      threadId: "thread-mira",
      messageId: "m-2",
      at: Date.UTC(2026, 10, 21, 9, 30),
    },
  }),
  kai: bot("kai", "Kai", "Screenwriter", { stages: ["script"], status: "working", doing: "Writing the rooftop scene" }),
  lena: bot("lena", "Lena", "Storyboard artist", {
    stages: ["storyboard"],
    status: "waiting",
    output: { text: "Shot 1 is boarded: a slow push-in on the rooftop, rain in the neon light.", threadId: "thread-lena", messageId: "l-2", at: Date.UTC(2026, 10, 21, 9, 40) },
    waiting: { threadId: "thread-lena", messageId: "l-3", card: { title: "Generate shot 1 again at 1080p?", subtitle: "The first take is 720p; 1080p takes longer.", options: ["Generate at 1080p", "Keep 720p"] } },
  }),
  otto: bot("otto", "Otto", "Editor", { stages: ["post"] }),
};

export const SAMPLE_LOOKS: Record<string, CanvasBotLook> = {
  mira: { color: "purple" },
  kai: { color: "blue" },
  lena: { color: "coral" },
  otto: { color: "teal" },
};

const botNodes = Object.values(SAMPLE_BOTS).map((state): CanvasNode => ({ id: botNodeId(state.botId), type: "bot", title: state.name, position: { x: 0, y: 0 }, width: 300, height: 180 }));

const contentNodes: CanvasNode[] = [
  {
    id: "logline",
    type: "text",
    title: "Logline",
    position: { x: 0, y: 0 },
    width: 340,
    height: 240,
    createdBy: { kind: "bot", botId: "kai" },
    metadata: { content: "A courier who delivers the city's secrets finds her own name in a package on a rain-soaked rooftop." },
  },
  {
    id: "shot-1",
    type: "shot",
    title: "Shot 1 · Rooftop",
    position: { x: 0, y: 0 },
    width: 340,
    height: 240,
    createdBy: { kind: "bot", botId: "lena" },
    metadata: { prompt: "Slow push-in on a neon-lit rooftop in heavy rain, a courier opens a package.", status: "success", settings: { seconds: 10 } },
  },
  {
    id: "shot-1-take-1",
    type: "video",
    title: "Shot 1 · Rooftop",
    position: { x: 0, y: 0 },
    width: 420,
    height: 236,
    createdBy: { kind: "person" },
    metadata: { file: { path: SAMPLE_VIDEO_PATH, mime: "video/webm", bytes: 182_000, name: "rooftop-1.webm" }, naturalWidth: 1280, naturalHeight: 720, durationMs: 10_000, prompt: "Slow push-in on a neon-lit rooftop in heavy rain, a courier opens a package.", status: "success" },
  },
  {
    id: "city-night",
    type: "image",
    title: "city-night.png",
    position: { x: 768, y: 640 },
    width: 340,
    height: 240,
    createdBy: { kind: "person" },
    metadata: { file: { path: SAMPLE_IMAGE_PATH, mime: "image/png", bytes: 96_000, name: "city-night.png" }, naturalWidth: 1536, naturalHeight: 1024 },
  },
];

const connections: CanvasConnection[] = [
  { id: dispatchConnectionId("mira", "kai"), fromNodeId: botNodeId("mira"), toNodeId: botNodeId("kai"), kind: "dispatch" },
  { id: dispatchConnectionId("kai", "lena"), fromNodeId: botNodeId("kai"), toNodeId: botNodeId("lena"), kind: "dispatch" },
  { id: dispatchConnectionId("lena", "otto"), fromNodeId: botNodeId("lena"), toNodeId: botNodeId("otto"), kind: "dispatch" },
  { id: "c-kai-logline", fromNodeId: botNodeId("kai"), toNodeId: "logline", kind: "content" },
  { id: "c-lena-shot", fromNodeId: botNodeId("lena"), toNodeId: "shot-1", kind: "content" },
  { id: "c-city-shot", fromNodeId: "city-night", toNodeId: "shot-1", kind: "content" },
  { id: "c-shot-take", fromNodeId: "shot-1", toNodeId: "shot-1-take-1", kind: "content" },
];

/** The sample canvas, with bots and what they made where the server's default layout puts them. */
export function sampleCanvasSnapshot(): CanvasSnapshot {
  const base: CanvasSnapshot = {
    projectId: SAMPLE_PROJECT_ID,
    revision: 1,
    nodes: [...botNodes, ...contentNodes],
    connections,
    viewport: { x: 0, y: 0, k: 1 },
    backgroundMode: "dots",
    project: { id: SAMPLE_PROJECT_ID, name: "Rain City", leadBotId: "mira", archived: false, folderState: "ready" },
    bots: SAMPLE_BOTS,
  };
  const positions = layoutPipeline(base);
  return structuredClone({ ...base, nodes: base.nodes.map((node) => ({ ...node, position: positions.get(node.id) ?? node.position })) });
}

export const SAMPLE_MODELS: Record<string, GenerationModel[]> = {
  "studio-images": [
    { id: "flux-pro", name: "Flux Pro", kind: "image", aspects: ["1:1", "3:4", "4:3", "9:16", "16:9"], qualities: ["auto", "high"], maxCount: 4, referenceImages: true, referenceAudio: false },
    { id: "sketch-fast", name: "Sketch Fast", kind: "image", aspects: ["1:1", "16:9"], maxCount: 2, referenceImages: false, referenceAudio: false },
  ],
  "studio-video": [
    { id: "kling-2", name: "Kling 2", kind: "video", resolutions: ["720p", "1080p"], aspects: ["16:9", "9:16", "1:1"], durations: [5, 10], referenceImages: true, referenceAudio: true },
    { id: "veo-lite", name: "Veo Lite", kind: "video", resolutions: ["480p", "720p"], aspects: ["16:9"], durations: [5], referenceImages: true, referenceAudio: false },
  ],
};

export function sampleGenerationSettings(): ProjectGenerationSettings {
  const { image, video } = DEFAULT_GENERATION_SETTINGS;
  return {
    image: { server: "studio-images", tools: { ...image.tools }, defaults: { ...image.defaults, model: "flux-pro", aspect: "16:9" } },
    video: { server: "studio-video", tools: { ...video.tools }, defaults: { ...video.defaults, model: "kling-2" } },
  };
}

export const SAMPLE_EXCHANGES: Record<string, CanvasExchangeMessage[]> = {
  mira: [
    { id: "m-1", role: "person", text: "Plan episode 1 with the team: logline, the rooftop shot and a teaser.", at: Date.UTC(2026, 10, 21, 9, 28) },
    { id: "m-2", role: "bot", text: SAMPLE_BOTS.mira!.output!.text, at: Date.UTC(2026, 10, 21, 9, 30) },
  ],
  lena: [
    { id: "l-1", role: "person", text: "Board shot 1 and generate a first take.", at: Date.UTC(2026, 10, 21, 9, 35) },
    { id: "l-2", role: "bot", text: SAMPLE_BOTS.lena!.output!.text, at: Date.UTC(2026, 10, 21, 9, 40) },
  ],
};

/** The sample project on the in-memory backend. */
export function sampleCanvasBackend(overrides: Partial<MemoryCanvasOptions> = {}) {
  return createMemoryCanvasBackend({
    snapshot: sampleCanvasSnapshot(),
    looks: SAMPLE_LOOKS,
    generation: { settings: sampleGenerationSettings(), servers: ["studio-images", "studio-video", "local-comfy"], models: SAMPLE_MODELS },
    exchanges: SAMPLE_EXCHANGES,
    ...overrides,
  });
}
