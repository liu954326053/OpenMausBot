// The sidebar over dramas of 60 episodes and about 300 bots, served only by scripts/testing/sidebar-episodes-shots.ts.
// The sidebar is the real one; the server is faked in the page.
// ?skin=midnight|daylight  &lang=zh  &mode=simple|advanced
import { createRoot } from "react-dom/client";
import { episodeCode, EPISODE_JOBS } from "../../shared/production";
import type { TeamProjectsListWire, TeamProjectWire } from "../../shared/team-projects";
import { Sidebar } from "../../src/components/Sidebar";
import { loadLocale } from "../../src/lib/i18n";
import { setAdvancedMode } from "../../src/lib/interface-mode";
import { applySkin, SKIN_IDS, type SkinId } from "../../src/lib/skins";
import { StoreProvider } from "../../src/state/store";
import "../../src/styles.css";

interface Drama { id: string; name: string; crew: Array<[name: string, title: string]>; episodes: number; storyboard: string; post: string }

const DRAMAS: Drama[] = [
  { id: "rain", name: "雨夜新娘", crew: [["云舟", "负责人"], ["砚青", "编剧"], ["墨白", "角色设计"], ["青禾", "场景设计"]], episodes: 60, storyboard: "临川", post: "晚照" },
  { id: "star", name: "星河往事", crew: [["远山", "负责人"], ["知微", "编剧"], ["松烟", "角色设计"], ["听澜", "场景设计"]], episodes: 60, storyboard: "鹿鸣", post: "南星" },
  { id: "street", name: "长街旧梦", crew: [["归帆", "负责人"], ["疏影", "编剧"], ["半夏", "角色设计"], ["白露", "场景设计"]], episodes: 0, storyboard: "", post: "" },
];
const UNREAD = new Set(["rain-post-2", "rain-storyboard-3", "star-1"]);
const WORKING = new Set(["rain-storyboard-5", "rain-post-4"]);

const bot = (id: string, name: string, title: string, section: string | undefined, extra: Record<string, unknown> = {}) => ({
  id, threadId: `${id}-thread`, name, title, description: "", notifications: true, unread: UNREAD.has(id), busy: WORKING.has(id),
  color: "green", ...(section ? { section } : {}), modelSelection: { instanceId: "fake", model: "m" },
  tasks: [{ threadId: `${id}-thread`, title: "Chat", createdAt: 1 }], messages: [], ...extra,
});
const crewIds = (drama: Drama) => drama.crew.map((_, index) => `${drama.id}-${index}`);
const episodeIds = (drama: Drama) => Array.from({ length: drama.episodes }, (_, index) => EPISODE_JOBS.map((job) => [`${drama.id}-${job}-${index + 1}`, job, index + 1] as const)).flat();

const bots = [
  bot("magic", "MagicBot", "", undefined, { defaultBot: {} }),
  ...DRAMAS.flatMap((drama) => [
    ...drama.crew.map(([name, title], index) => bot(`${drama.id}-${index}`, name, title, drama.name, index === 0 ? { chiefOfStaff: true } : {})),
    ...episodeIds(drama).map(([id, job, number]) => bot(id, `${job === "storyboard" ? drama.storyboard : drama.post} ${episodeCode(number)}`, job === "storyboard" ? "分镜" : "", drama.name)),
  ]),
  ...Array.from({ length: 50 }, (_, index) => bot(`ops-${index + 1}`, `运营 ${index + 1}`, "运营", "运营部")),
];
const groups = DRAMAS.map((drama) => ({
  id: `${drama.id}-room`, threadId: `${drama.id}-room-thread`, name: `${drama.name} 群聊`, memberIds: crewIds(drama), messages: [],
  defaultResponder: { kind: "member", botId: crewIds(drama)[0] }, bulletin: "", unread: false, createdAt: 1, section: drama.name,
}));
const projects: TeamProjectsListWire = {
  root: "/dramas",
  projects: DRAMAS.map((drama, index): TeamProjectWire => ({
    id: drama.id, name: drama.name, folder: `/dramas/${drama.name}`, section: drama.name, team: { key: `team:${drama.id}`, name: drama.name },
    leadBotId: crewIds(drama)[0]!, roomId: `${drama.id}-room`, createdAt: index + 1, folderState: "ready", follows: {},
    botIds: [...crewIds(drama), ...episodeIds(drama).map(([id]) => id)],
    episodeBots: Object.fromEntries(episodeIds(drama).map(([id, job, number]) => [id, { number, job }])),
  })),
};
const ENGINE = {
  instanceId: "fake", driverKind: "fake", displayName: "Fake", snapshot: { state: "available" },
  models: { default: "m", options: [{ id: "m", label: "Fake model" }] }, capabilities: { agentsMcp: true },
};

const params = new URLSearchParams(location.search);
const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
window.fetch = async (input) => {
  const path = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, location.href).pathname;
  if (path === "/api/bots") return json({ bots, groups, sections: [...DRAMAS.map((drama) => drama.name), "运营部"] });
  if (path === "/api/team-projects") return json(projects);
  if (path === "/.well-known/openmausbot/environment") return json({ environmentId: "sidebar-episodes-preview" });
  if (path === "/api/instances") return json({ instances: [ENGINE] });
  if (path === "/api/team-map") return json({ collaborations: [], queued: [], running: [] });
  if (path === "/api/routines") return json({ routines: [], runs: [] });
  if (path === "/api/webhooks") return json({ webhooks: [], attempts: [] });
  if (path === "/api/team-computers") return json({ computers: [] });
  if (path === "/api/computers/frames") return json({ computers: [], now: Date.now() });
  return json({});
};
class PreviewEventSource {
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  constructor(readonly url: string) {
    window.setTimeout(() => { this.onopen?.(); this.onmessage?.({ data: JSON.stringify({ kind: "hello", resumed: false, cursor: "run:0" }) }); }, 0);
  }
  close() {}
  addEventListener() {}
  removeEventListener() {}
}
Object.assign(window, { EventSource: PreviewEventSource });

const skin = params.get("skin");
applySkin((SKIN_IDS as readonly string[]).includes(skin ?? "") ? skin as SkinId : "midnight");
setAdvancedMode(params.get("mode") !== "simple");
await loadLocale(params.get("lang") ?? "zh");
createRoot(document.getElementById("root")!).render(
  <StoreProvider>
    <div className="flex h-screen">
      <Sidebar open onClose={() => {}} />
      <main className="min-w-0 flex-1 bg-app" />
    </div>
  </StoreProvider>,
);
