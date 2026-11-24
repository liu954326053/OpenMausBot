// Seeds a drama of many episodes into a fixture data folder for scripts/bench-many-bots.ts while its server is stopped:
// a six-member crew, one project made from it by the app's own project service, each episode's storyboard and post bot
// made as the production makes them, the canvas a drama that size has, and a production that has run most of the way:
// the first episodes done, two generating their videos, one in its storyboard and the last ones waiting. Its pictures
// and videos are named on the canvas only. Runs only in a child whose OMB_DATA_DIR and HOME are the fixture's own
// folder; prints the ids and timings the bench needs as JSON.
//   OMB_DATA_DIR=... node --experimental-strip-types scripts/testing/bench-drama-seed.ts FOLDER [EPISODES]
import { mkdirSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { performance } from "node:perf_hooks";

const dataDir = process.env.OMB_DATA_DIR ?? "";
if (!/omb-restartable-|openmausbot-bench-/.test(dataDir)) throw new Error("bench-drama-seed runs only on a fixture folder");
const [folder = "", episodesArg = "60"] = process.argv.slice(2);
if (!folder.includes("openmausbot-bench-")) throw new Error("bench-drama-seed makes its project only in a bench folder");
const EPISODES = Number(episodesArg);
if (!Number.isInteger(EPISODES) || EPISODES < 8) throw new Error("a bench drama has at least 8 episodes");

const { Store } = await import("../../server/store.ts");
const { DATA_DIR } = await import("../../server/config.ts");
const { openTeamProjects } = await import("./bench-seed-projects.ts");
const { GenerationStore } = await import("../../server/project-generation/store.ts");
const { mergeSettings } = await import("../../server/project-generation/settings.ts");
const { ProductionFiles } = await import("../../server/production/store.ts");
const { DEFAULT_GENERATION_SETTINGS } = await import("../../shared/project-generation.ts");
const { botNodeId, CANVAS_NODE_SIZE } = await import("../../shared/project-canvas.ts");
type CanvasNode = import("../../shared/project-canvas.ts").CanvasNode;
type CanvasConnection = import("../../shared/project-canvas.ts").CanvasConnection;
type StoredProduction = import("../../server/production/store.ts").StoredProduction;
type ProductionTask = import("../../server/production/store.ts").ProductionTask;

const TEAM = "Drama crew";
const SELECTION = { instanceId: "claude", model: "claude-sonnet-5" };
const SHOTS = 5;
const DONE = EPISODES - 6;
const GENERATING = [DONE + 1, DONE + 2];
const STORYBOARDING = DONE + 3;
const CHARACTERS = ["Mei", "Lan", "Old Wu", "Captain Shen", "Ah Fu", "Madam Qiao", "Little Jade", "The Stranger"];
const SCENES = ["The harbour at night", "Tailor's shop", "Wedding hall", "Fish market", "Lighthouse", "Rain alley"];

const store = new Store(() => SELECTION);
const crew = (["Showrunner", "Screenwriter", "Character designer", "Scene designer", "Storyboard artist", "Editor"] as const).map((title, index) =>
  store.createBot({ name: ["Mo", "Ink", "Jade", "Hall", "Frame", "Cut"][index]!, title, section: TEAM, description: `The crew's ${title.toLowerCase()}.` }, { seedMessages: false }).id);

const projects = openTeamProjects(store, { team: TEAM, root: folder, selection: SELECTION });
if (!projects) throw new Error("the crew has no bot");
const made = await projects.api.create({ name: "Harbour bride", team: TEAM });
if (!("project" in made)) throw new Error(`the drama was not made: ${made.error}`);
const project = made.project;
const copyOf = (sourceId: string) => {
  const copy = store.bots.find((bot) => bot.teamProject?.id === project.id && bot.teamProject.source === sourceId);
  if (!copy) throw new Error("a crew member has no copy in the drama");
  return copy.id;
};
const [lead, writer, faces, sets, boarder, cutter] = crew.map(copyOf) as [string, string, string, string, string, string];

const creations: number[] = [];
const episodeBots = new Map<number, { storyboard: string; post: string }>();
for (let episode = 1; episode <= EPISODES; episode += 1) {
  const episodeBot = async (template: string, job: "storyboard" | "post") => {
    const at = performance.now();
    const botId = await projects.api.episodeBot(project.id, template, episode, job);
    creations.push(performance.now() - at);
    return botId;
  };
  episodeBots.set(episode, { storyboard: await episodeBot(boarder, "storyboard"), post: await episodeBot(cutter, "post") });
}
const threadOf = (botId: string) => store.bot(botId)!.threadId;

const settings = mergeSettings(DEFAULT_GENERATION_SETTINGS, {
  image: { server: "gen", defaults: { model: "pixel-1", aspect: "1:1", quality: "standard", count: 1 } },
  video: { server: "gen", defaults: { model: "motion-1", resolution: "720p", aspect: "16:9", seconds: 5 } },
  concurrency: { episodes: 3, videos: 2, images: 2 },
});
if (typeof settings === "string") throw new Error(settings);
const log = (line: string) => process.stderr.write(`${line}\n`);
new GenerationStore(join(DATA_DIR, "project-generation"), log).saveSettings(project.id, settings);

const nodes: CanvasNode[] = [];
const connections: CanvasConnection[] = [];
const add = (node: Omit<CanvasNode, "width" | "height">) => nodes.push({ ...CANVAS_NODE_SIZE[node.type], ...node });
const by = (botId: string) => ({ kind: "bot" as const, botId });
const file = (name: string, mime: string, bytes: number) => ({ path: `generated/${name}`, mime, bytes, name });
add({ id: "brief", type: "text", title: "Brief", position: { x: -2400, y: -600 }, createdBy: by(lead),
  metadata: { role: "brief", card: { rows: [["Episodes", `${EPISODES} × 1 min`], ["Style", "Period romance"], ["Audience", "Vertical short drama"]] } } });
add({ id: "plan", type: "text", title: "Who does what", position: { x: -2000, y: -600 }, createdBy: by(lead), metadata: { role: "plan" } });
[lead, writer, faces, sets, boarder, cutter].forEach((botId, index) =>
  add({ id: botNodeId(botId), type: "bot", title: store.bot(botId)!.name, position: { x: -2400 + index * 360, y: -1000 } }));
const profiles = [...CHARACTERS.map((title) => ({ title, role: "character" as const, maker: faces })), ...SCENES.map((title) => ({ title, role: "scene" as const, maker: sets }))];
profiles.forEach(({ title, role, maker }, index) => {
  const groupId = `group-${index}`, x = -2400, y = index * 700;
  add({ id: groupId, type: "group", title, position: { x: x - 40, y: y - 40 }, createdBy: by(maker) });
  add({ id: `profile-${index}`, type: "text", title, position: { x, y }, groupId, createdBy: by(maker),
    metadata: { content: `${title}: ${"a face and a manner the whole drama keeps. ".repeat(6)}`, role, card: { subtitle: role === "character" ? "Lead cast" : "Recurring set", tags: ["period"], rows: [["Look", "Muted silk"]] } } });
  for (const view of ["front", "side"]) {
    const id = `picture-${index}-${view}`;
    add({ id, type: "image", title: `${title}, ${view}`, position: { x: x + 400 + (view === "side" ? 360 : 0), y }, groupId, createdBy: by(maker),
      metadata: { prompt: `${title}, ${view} view`, file: file(`${id}.png`, "image/png", 310_000) } });
    connections.push({ id: `line-${id}`, fromNodeId: `profile-${index}`, toNodeId: id, kind: "content" });
  }
});

for (let episode = 1; episode <= EPISODES; episode += 1) {
  const x = episode * 1600, own = episodeBots.get(episode)!;
  add({ id: `episode-${episode}`, type: "text", title: `EP${String(episode).padStart(2, "0")} The swap, part ${episode}`, position: { x, y: 0 }, createdBy: by(writer),
    metadata: { content: `EXT. HARBOUR, NIGHT. Episode ${episode}. ${"Mei runs along the water while the lamps go out one by one. ".repeat(14)}`, role: "episode", episode, card: { subtitle: `Logline of episode ${episode}` } } });
  add({ id: botNodeId(own.storyboard), type: "bot", title: store.bot(own.storyboard)!.name, position: { x, y: -400 } });
  add({ id: botNodeId(own.post), type: "bot", title: store.bot(own.post)!.name, position: { x: x + 800, y: -400 } });
  const shots = episode <= GENERATING.at(-1)! ? SHOTS : episode === STORYBOARDING ? 3 : 0;
  for (let shot = 1; shot <= shots; shot += 1) {
    const shotId = `shot-${episode}-${shot}`, y = 400 + shot * 300, maker = by(own.storyboard);
    add({ id: shotId, type: "shot", title: `Shot ${shot}`, position: { x, y }, createdBy: maker,
      metadata: { episode, prompt: `Episode ${episode}, shot ${shot}: the bride runs along the water, lamps in fog`, shot: { size: "wide", move: "slow push-in", audio: "waves" }, settings: { seconds: 5 } } });
    add({ id: `creation-${episode}-${shot}`, type: "config", title: `Shot ${shot}`, position: { x: x + 400, y }, createdBy: maker,
      metadata: { generationMode: "video", role: "creation", shotId, episode, settings: { seconds: 5 } } });
    if (episode > DONE) continue;
    add({ id: `take-${episode}-${shot}`, type: "video", title: `ep${episode}-shot${shot}.mp4`, position: { x: x + 800, y }, createdBy: maker,
      metadata: { role: "take", shotId, episode, selected: true, file: file(`ep${episode}-shot${shot}.mp4`, "video/mp4", 2_400_000) } });
    connections.push({ id: `line-take-${episode}-${shot}`, fromNodeId: `creation-${episode}-${shot}`, toNodeId: `take-${episode}-${shot}`, kind: "content", pipeline: true });
  }
  if (episode <= DONE) {
    add({ id: `final-${episode}`, type: "video", title: `EP${episode} final.mp4`, position: { x: x + 1200, y: 400 }, createdBy: by(own.post),
      metadata: { role: "final", episode, file: file(`ep${episode}-final.mp4`, "video/mp4", 14_000_000) } });
  }
}
const canvases = join(DATA_DIR, "project-canvases");
mkdirSync(canvases, { recursive: true, mode: 0o700 });
writeFileSync(join(canvases, `${project.id}.json`), JSON.stringify({ version: 1, document: { projectId: project.id, revision: 1, nodes, connections, viewport: { x: 0, y: 0, k: 0.4 }, backgroundMode: "dots" }, history: [] }), { mode: 0o600 });

let clock = Date.now() - 3 * 24 * 3600_000;
const tick = () => (clock += 60_000);
const task = (job: ProductionTask["job"], botId: string, episode?: number, ended = true): ProductionTask => ({
  id: randomUUID(), job, botId, ...(episode === undefined ? {} : { episode }), threadId: threadOf(botId), at: tick(), ...(ended ? { outcome: "ok" as const, endedAt: tick() } : {}),
});
const production: StoredProduction = {
  startedAt: clock,
  plan: { assignments: { script: writer, character: faces, scene: sets, storyboard: boarder, post: cutter }, episodes: EPISODES, plannedAt: clock },
  tasks: [{ ...task("script", writer), reply: `Characters: ${CHARACTERS.join(", ")}. Scenes: ${SCENES.join(", ")}.` }, task("character", faces), task("scene", sets)],
  episodes: {},
};
for (let episode = 1; episode <= STORYBOARDING; episode += 1) {
  const own = episodeBots.get(episode)!;
  production.tasks.push(task("storyboard", own.storyboard, episode, episode !== STORYBOARDING));
  if (episode <= DONE) production.tasks.push(task("post", own.post, episode));
  production.episodes[String(episode)] = { storyboardBotId: own.storyboard, ...(episode <= DONE ? { postBotId: own.post, done: true as const } : {}) };
}
new ProductionFiles(join(DATA_DIR, "productions"), log).write(project.id, production);

await new Promise((resolve) => setTimeout(resolve, 1_500));
const sorted = [...creations].sort((a, b) => a - b);
process.stdout.write(`${JSON.stringify({
  projectId: project.id,
  roomId: project.roomId ?? null,
  crew,
  copies: { lead, writer, faces, sets, boarder, cutter },
  episodeBots: Object.fromEntries(episodeBots),
  generating: GENERATING,
  storyboarding: STORYBOARDING,
  bots: store.bots.length,
  projectBots: store.bots.filter((bot) => bot.teamProject?.id === project.id).length,
  canvas: { nodes: nodes.length, connections: connections.length, shots: nodes.filter((node) => node.type === "shot").length },
  episodeBotMs: { count: sorted.length, median: Math.round(sorted[Math.floor(sorted.length / 2)]!), p95: Math.round(sorted[Math.floor(sorted.length * 0.95)]!), total: Math.round(sorted.reduce((sum, ms) => sum + ms, 0)) },
})}\n`);
process.exit(0);
