// @vitest-environment happy-dom
import { countBy, renderMark, renderedSince } from "@/testing/render-counts";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EPISODE_JOBS } from "../../../shared/production";
import type { TeamProjectsListWire, TeamProjectWire } from "../../../shared/team-projects";
import type { AppState, Bot, Group, Message } from "@/state/store";

type Shown = Pick<AppState, "bots" | "groups" | "sections" | "selectedId" | "activeView" | "project" | "pendingQueued">;
const fixture = vi.hoisted(() => ({ dispatch: vi.fn(), state: {} as Shown }));
vi.mock("@/state/store-select", () => ({
  useStoreSelector: (selector: (state: Shown) => unknown) => selector(fixture.state),
  useStoreDispatch: () => fixture.dispatch,
}));
vi.mock("@/lib/thread-preferences", () => ({ useShowThreads: () => false }));

import { loadLocale, setLocale } from "@/lib/i18n";
import { forgetDisclosuresForTests } from "@/lib/remembered-disclosure";
import { setTeamProjects, useTeamProjectSide } from "@/state/team-projects";
import { SidebarTeamProjects } from "./SidebarTeamProjects";

const bot = (id: string, extra: Partial<Bot> = {}): Bot => ({
  id, threadId: `${id}-thread`, name: id, title: "", description: "", notifications: true,
  color: "green", unread: false, modelSelection: { instanceId: "fake", model: "m" }, messages: [], ...extra,
});
const room = (id: string, section: string): Group => ({
  id, threadId: `${id}-thread`, name: id, memberIds: [], messages: [], defaultResponder: { kind: "mentions" }, bulletin: "", unread: false, createdAt: 1, section,
});
const said = (id: string): Message => ({ id, role: "bot", kind: "text", at: 1, text: "Working on it." });

const EPISODES = 60;
const CREW = ["lead", "writer", "cast", "scenes", "storyboard", "post"].map((job) => `rain-${job}`);
const EPISODE_BOTS = Object.fromEntries(Array.from({ length: EPISODES }, (_, at) => EPISODE_JOBS.map((job) => [`rain-${job}-${at + 1}`, { number: at + 1, job }] as const)).flat());
const drama: TeamProjectWire = {
  id: "rain", name: "Rain", folder: "/dramas/rain", section: "rain", team: { key: "team:rain", name: "Rain" }, follows: {}, leadBotId: CREW[0]!,
  roomId: "rain-room", createdAt: 1, folderState: "ready", botIds: [...CREW, ...Object.keys(EPISODE_BOTS)], episodeBots: EPISODE_BOTS,
};
const list: TeamProjectsListWire = { root: "/dramas", projects: [drama] };
const team = () => [
  bot("main", { defaultBot: {}, chiefOfStaff: true }), bot("ops", { section: "Ops" }),
  ...CREW.map((id, at) => bot(id, { section: "rain", chiefOfStaff: at === 0 })),
  ...Object.keys(EPISODE_BOTS).map((id) => bot(id, { section: "rain" })),
];

let bots: Bot[] = [];
let groups: Group[] = [];
let container: HTMLDivElement, root: Root;
const q = (selector: string) => document.body.querySelector<HTMLElement>(selector);
const settle = async () => { await act(async () => { await new Promise((done) => setTimeout(done, 0)); }); };
const click = async (element: HTMLElement | null) => { expect(element).toBeTruthy(); await act(async () => element!.click()); await settle(); };
const botRows = () => document.body.querySelectorAll("[data-sidebar-project-bot]").length;
const botRow = (id: string) => q(`[data-sidebar-project-bot="${id}"]`)!;

/** As the sidebar gives it, drawn again with every change to the store: new lists, mode and handlers each time. */
function Harness() {
  const side = useTeamProjectSide();
  return createElement(SidebarTeamProjects, {
    side, all: { bots, groups }, query: "", mode: { density: "comfortable", advanced: false, tight: true, remote: false },
    onNew: () => {}, onError: () => {},
  });
}

async function draw(): Promise<void> {
  fixture.state = { bots, groups, sections: ["rain", "Ops"], selectedId: "main", activeView: "chat", pendingQueued: {} };
  await act(async () => root.render(createElement(Harness)));
  await settle();
}

const changeBot = (id: string, change: Partial<Bot>) => { bots = bots.map((one) => (one.id === id ? { ...one, ...change } : one)); };
const changeRoom = (id: string, change: Partial<Group>) => { groups = groups.map((one) => (one.id === id ? { ...one, ...change } : one)); };
const ROWS = ["SidebarProjectBot", "SidebarProjectRoom", "SectionAttention"] as const;

/** What the change draws again: the section itself, and how many times each kind of row under it. */
async function drawnBy(change: () => void): Promise<{ section: number; rows: Record<(typeof ROWS)[number], number> }> {
  const mark = renderMark();
  change();
  await draw();
  const counts = countBy(renderedSince(mark), (entry) => entry.component);
  return {
    section: counts.get("SidebarTeamProjects") ?? 0,
    rows: Object.fromEntries(ROWS.map((name) => [name, counts.get(name) ?? 0])) as Record<(typeof ROWS)[number], number>,
  };
}
const NONE = { SidebarProjectBot: 0, SidebarProjectRoom: 0, SectionAttention: 0 };

/** Another bot at work, as a reply streams into its conversation and its group chat: busy, a message, done and unread.
 * What the four changes draw again, all told. */
async function replyElsewhere(): Promise<Awaited<ReturnType<typeof drawnBy>>> {
  const steps = [
    () => changeBot("ops", { busy: true }),
    () => changeBot("ops", { messages: [said("ops-1")] }),
    () => changeRoom("ops-room", { busyBotId: "ops" }),
    () => { changeBot("ops", { busy: false, unread: true }); changeRoom("ops-room", { busyBotId: null, unread: true }); },
  ];
  const total = { section: 0, rows: { ...NONE } };
  for (const step of steps) {
    const drawn = await drawnBy(step);
    total.section += drawn.section;
    for (const name of ROWS) total.rows[name] += drawn.rows[name];
  }
  return total;
}

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  setLocale("en");
  localStorage.clear();
  forgetDisclosuresForTests();
  bots = team();
  groups = [room("rain-room", "rain"), room("ops-room", "Ops")];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const body = String(input) === "/api/team-projects/teams" ? { teams: [] } : list;
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  }));
  setTeamProjects(list);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await draw();
  await click(q('[data-sidebar-project-row="rain"]'));
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  setTeamProjects(null);
  vi.unstubAllGlobals();
});

describe("a drama of 60 episodes open in the sidebar", () => {
  it("draws no bot row and no mark again while a reply streams in a conversation outside it, folded or unfolded", async () => {
    expect(botRows()).toBe(CREW.length);
    const episodesFolded = await replyElsewhere();

    await click(q("[data-sidebar-project-episodes-row]"));
    const episodesUnfolded = await replyElsewhere();

    for (let number = 1; number <= EPISODES; number++) await click(q(`[data-sidebar-project-episode-row="${number}"]`));
    expect(botRows()).toBe(CREW.length + 2 * EPISODES);
    const everyEpisodeUnfolded = await replyElsewhere();

    const quiet = { section: 4, rows: NONE };
    expect({ episodesFolded, episodesUnfolded, everyEpisodeUnfolded }).toEqual({ episodesFolded: quiet, episodesUnfolded: quiet, everyEpisodeUnfolded: quiet });
  });

  it("draws no row again when its lists come again equal, and no mark whose counts stay the same", async () => {
    await click(q("[data-sidebar-project-episodes-row]"));
    for (let number = 1; number <= EPISODES; number++) await click(q(`[data-sidebar-project-episode-row="${number}"]`));
    changeBot("rain-writer", { busy: true });
    await draw();

    const copied = await drawnBy(() => { bots = [...bots]; groups = [...groups]; });
    const ownMessage = await drawnBy(() => changeBot("rain-post-7", { messages: [said("cut-1")] }));
    expect({ copied, ownMessage }).toEqual({ copied: { section: 1, rows: NONE }, ownMessage: { section: 1, rows: { ...NONE, SidebarProjectBot: 1 } } });
  });

  it("draws a bot's row again, and that row alone, when its name, its status or its unread changes", async () => {
    await click(q("[data-sidebar-project-episodes-row]"));
    await click(q('[data-sidebar-project-episode-row="30"]'));

    const renamed = await drawnBy(() => changeBot("rain-post-30", { name: "Cutter EP30" }));
    expect(renamed.rows.SidebarProjectBot).toBe(1);
    expect(botRow("rain-post-30").textContent).toContain("Cutter EP30");

    const working = await drawnBy(() => changeBot("rain-post-30", { busy: true }));
    expect(working.rows.SidebarProjectBot).toBe(1);
    expect(working.rows.SectionAttention).toBeGreaterThan(0);
    expect(botRow("rain-post-30").querySelector("[data-section-mark]")?.getAttribute("data-section-mark")).toBe("working");

    const unread = await drawnBy(() => changeBot("rain-post-30", { busy: false, unread: true }));
    expect(unread.rows.SidebarProjectBot).toBe(1);
    expect(unread.rows.SectionAttention).toBeGreaterThan(0);
    expect(botRow("rain-post-30").querySelector("[data-section-mark]")?.getAttribute("data-section-mark")).toBe("unread");
    expect(q('[data-sidebar-project-row="rain"] [data-section-mark]')?.getAttribute("data-section-mark")).toBe("unread");
  });

  it("draws its rows again in a new language", async () => {
    changeBot("rain-cast", { unread: true });
    changeRoom("rain-room", { unread: true });
    await draw();
    await loadLocale("zh");
    await draw();
    expect(botRow(CREW[0]!).querySelector("[data-sidebar-project-bot-lead]")?.textContent).toBe("负责人");
    expect(botRow("rain-cast").textContent).toContain("1 项未读");
    expect(q('[data-sidebar-project-room="rain-room"]')!.textContent).toContain("1 项未读");
  });

  it("draws the group chat's row again when the group chat changes", async () => {
    const drawn = await drawnBy(() => changeRoom("rain-room", { unread: true }));
    expect(drawn.rows.SidebarProjectRoom).toBe(1);
    expect(drawn.rows.SidebarProjectBot).toBe(0);
    expect(q('[data-sidebar-project-room="rain-room"] [data-section-mark]')?.getAttribute("data-section-mark")).toBe("unread");
  });
});
