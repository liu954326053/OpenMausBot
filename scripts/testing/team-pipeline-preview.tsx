// The team map over a team's pipeline, served only by scripts/testing/team-pipeline-shots.ts. The map is the real one;
// the server is faked in the page and answers as shared/team-pipeline.ts says, so the map can be looked at before a
// server has the routes.
// ?team=drama|others|crowd  &skin=midnight|daylight  &lang=zh  &judging=1 (a rejudge never finishes)
import { createRoot } from "react-dom/client";
import {
  stageLines, type FlowLineWire, type FlowStage, type TeamPipelineLineInput, type TeamPipelineRejudgeResult, type TeamPipelineRestoreInput,
  type TeamPipelinesWire,
} from "../../shared/team-pipeline";
import { TeamMapPage } from "../../src/components/TeamMapPage";
import { loadLocale } from "../../src/lib/i18n";
import { applySkin, SKIN_IDS, type SkinId } from "../../src/lib/skins";
import { StoreProvider } from "../../src/state/store";
import "../../src/styles.css";

interface Member { id: string; name: string; title: string; stages: FlowStage[]; chief?: boolean }
interface Team { section: string; members: Member[]; manual?: string[]; pending?: string[]; added?: FlowLineWire[] }

const TEAMS: Record<string, Team> = {
  drama: {
    section: "漫剧工作室",
    members: [
      { id: "yunzhou", name: "云舟", title: "制片人", stages: ["lead"], chief: true },
      { id: "yanqing", name: "砚青", title: "编剧", stages: ["script"] },
      { id: "mobai", name: "墨白", title: "分镜与美术设计", stages: ["character", "storyboard"] },
      { id: "qinghe", name: "青禾", title: "后期合成", stages: ["post"] },
    ],
  },
  others: {
    section: "星河剧组",
    members: [
      { id: "yuanshan", name: "远山", title: "制片人", stages: ["lead"], chief: true },
      { id: "zhiwei", name: "知微", title: "编剧", stages: ["script"] },
      { id: "songyan", name: "松烟", title: "角色设计", stages: ["character"] },
      { id: "linchuan", name: "临川", title: "分镜", stages: ["storyboard"] },
      { id: "wanzhao", name: "晚照", title: "后期合成", stages: ["post"] },
      { id: "tinglan", name: "听澜", title: "运营", stages: ["other"] },
      { id: "luming", name: "鹿鸣", title: "配音", stages: ["other"] },
    ],
  },
  crowd: {
    section: "The Long-Running Saturday Morning Serial Writers' Room and Art Department",
    members: [
      { id: "lead", name: "Executive Producer for the Whole Saturday Morning Serial Line-Up", title: "Keeps every episode on its date", stages: ["lead"], chief: true },
      { id: "s1", name: "Head Writer", title: "Scripts, outlines and the series bible", stages: ["script"] },
      { id: "s2", name: "Dialogue Polisher With a Very Long Name Indeed", title: "Second pass on every script", stages: ["script"] },
      { id: "c1", name: "Character Designer", title: "Model sheets", stages: ["character", "storyboard", "post"] },
      { id: "c2", name: "مصمم الشخصيات", title: "أوراق النماذج", stages: ["character"] },
      { id: "p1", name: "Editor", title: "Final cut", stages: ["post"] },
      { id: "o1", name: "Community Manager", title: "Replies to viewers", stages: ["other"] },
      { id: "o2", name: "New Hire", title: "", stages: ["other"] },
    ],
    manual: ["c1", "o1"], pending: ["o2"], added: [{ from: "o1", to: "p1" }],
  },
};

const params = new URLSearchParams(location.search);
const team = TEAMS[params.get("team") ?? ""] ?? TEAMS.drama!;
const members = team.members.map((member) => member.id);
const chief = team.members.find((member) => member.chief)!;
const nameOf = (id: string) => team.members.find((member) => member.id === id)?.name ?? id;
let held = { manual: team.manual ?? [], added: team.added ?? [], removed: [] as FlowLineWire[] };
let pending = team.pending ?? [];

const same = (a: FlowLineWire) => (b: FlowLineWire) => a.from === b.from && a.to === b.to;
const stages = () => Object.fromEntries(team.members.map((member): [string, FlowStage[]] => [member.id, pending.includes(member.id) ? ["other"] : member.stages]));
const lines = () => [...stageLines(chief.id, members, stages()).filter((line) => !held.removed.some(same(line))), ...held.added];
const pipelines = (): TeamPipelinesWire => ({
  readable: true,
  teams: [{ section: team.section, chiefId: chief.id, stages: stages(), pending, manual: held.manual, lines: lines() }],
});
const reaches = (from: string, to: string, seen = new Set<string>()): boolean =>
  from === to || lines().some((line) => line.from === from && !seen.has(line.to) && reaches(line.to, to, seen.add(line.to)));

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const refuse = (key: string, errorParams: Record<string, string> = {}) => json({ error: key, errorKey: `serverError.teamFlow.${key}`, errorParams }, 409);

function setLine({ from, to, present }: TeamPipelineLineInput): Response {
  if (!members.includes(to) || !members.includes(from)) return refuse("otherTeam", { superior: nameOf(to), team: team.section });
  if (present && from === to) return refuse("self");
  if (present && to === chief.id) return refuse("chief", { bot: nameOf(to), team: team.section });
  if (present && reaches(to, from)) return refuse("loop", { bot: nameOf(to), superior: nameOf(from) });
  const line = { from, to };
  held = {
    manual: [...new Set([...held.manual, from, to])],
    added: present && !lines().some(same(line)) ? [...held.added, line] : present ? held.added : held.added.filter((one) => !same(line)(one)),
    removed: present ? held.removed.filter((one) => !same(line)(one)) : stageLines(chief.id, members, stages()).some(same(line)) ? [...held.removed, line] : held.removed,
  };
  return json(pipelines());
}
function rejudge(): Response {
  const undo: TeamPipelineRestoreInput = { section: team.section, state: held };
  held = { manual: [], added: [], removed: [] };
  pending = members.filter((id) => id !== chief.id);
  if (!params.has("judging")) window.setTimeout(() => { pending = []; }, 3_000);
  return json({ pipelines: pipelines(), undo } satisfies TeamPipelineRejudgeResult);
}

const bots = team.members.map((member) => ({
  id: member.id, threadId: `${member.id}-thread`, name: member.name, title: member.title, description: "", notifications: true, unread: false,
  color: "green", section: team.section, chiefOfStaff: member.chief === true, modelSelection: { instanceId: "fake", model: "m" },
  tasks: [{ threadId: `${member.id}-thread`, title: "Chat", createdAt: 1 }], messages: [],
}));
const ENGINE = {
  instanceId: "fake", driverKind: "fake", displayName: "Fake", snapshot: { state: "available" },
  models: { default: "m", options: [{ id: "m", label: "Fake model" }] }, capabilities: { agentsMcp: true },
};

window.fetch = async (input, init) => {
  const path = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, location.href).pathname;
  const sent = init?.body ? JSON.parse(String(init.body)) : undefined;
  if (path === "/api/bots") return json({ bots, groups: [] });
  if (path === "/api/team-pipelines") return json(pipelines());
  if (path === "/api/team-pipelines/line") return setLine(sent);
  if (path === "/api/team-pipelines/rejudge") return rejudge();
  if (path === "/api/team-pipelines/restore") { held = (sent as TeamPipelineRestoreInput).state as typeof held; pending = []; return json(pipelines()); }
  if (path === "/.well-known/openmausbot/environment") return json({ environmentId: `pipeline-preview-${params.get("team") ?? "drama"}` });
  if (path === "/api/team-map") return json({ collaborations: [], queued: [], running: [] });
  if (path === "/api/team-projects") return json({ root: null, projects: [] });
  if (path === "/api/instances") return json({ instances: [ENGINE] });
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
await loadLocale(params.get("lang") ?? "en");
createRoot(document.getElementById("root")!).render(<StoreProvider><div className="flex h-screen"><TeamMapPage /></div></StoreProvider>);
