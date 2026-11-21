import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { TeamProjectWire } from "../../shared/team-projects";
import { teamProjectSide } from "@/lib/team-projects";
import type { Bot, Group } from "@/state/store";

const bot = (id: string, name: string, extra: Partial<Bot> = {}): Bot => ({
  id, threadId: `thread-${id}`, name, title: "", description: "", notifications: false, color: "green", unread: false,
  modelSelection: { instanceId: "fixture", model: "fixture-model" }, tasks: [], messages: [], ...extra,
});
const room = (id: string, name: string, extra: Partial<Group> = {}): Group => ({
  id, threadId: `thread-${id}`, name, memberIds: [], defaultResponder: { kind: "member", botId: "pepper" }, bulletin: "", unread: false,
  createdAt: 1, messages: [], ...extra,
});
const bots = [
  bot("main", "MagicBot", { defaultBot: {} }),
  bot("pepper", "Pepper", { unread: true }),
  bot("ops-writer", "Quill", { section: "Ops" }),
  bot("lead", "Lead", { section: "Launch", chiefOfStaff: true }),
];
const groups = [room("lobby", "Lobby", { unread: true }), room("launch-room", "Launch chat", { section: "Launch" })];
const launch = { id: "p1", name: "Launch", section: "Launch", folder: "/work/launch", leadBotId: "lead", botIds: ["lead"], follows: {}, createdAt: 1 } as unknown as TeamProjectWire;
const side = teamProjectSide({ root: "/work", projects: [launch] });

vi.mock("@/state/store", async (original) => {
  const actual = await original<typeof import("@/state/store")>();
  return { ...actual, useStore: () => ({ state: { ...actual.initialState, bots, groups, sections: ["Ops", "Launch"] }, dispatch: vi.fn() }) };
});
vi.mock("@/state/team-projects", async (original) => ({ ...await original<object>(), useTeamProjectSide: () => side }));
vi.mock("@/lib/use-owner-or-admin", () => ({ useOwnerOrAdmin: () => true }));
vi.mock("./DesktopCapabilities", () => ({
  useDesktopCapabilities: () => ({ capabilities: { dictation: { available: false } } }),
  useCaptionChrome: () => ({}),
}));
vi.mock("react-dom", async (original) => ({ ...await original<object>(), createPortal: (children: unknown) => children }));
const { TeamMapPage } = await import("./TeamMapPage");
const { TeamMapNote } = await import("./TeamMapDepartment");

const render = (component: Parameters<typeof renderToStaticMarkup>[0]) => {
  vi.stubGlobal("window", { ogb: undefined });
  vi.stubGlobal("document", { body: {} });
  return renderToStaticMarkup(component);
};
afterEach(() => vi.unstubAllGlobals());

describe("the team map as the place teams are managed", () => {
  const html = () => render(createElement(TeamMapPage));

  it("draws the teams outside projects and leaves a project's team to the project view", () => {
    const page = html();
    expect(page).toContain('data-team-key="Ops"');
    expect(page).not.toContain('data-team-key="Launch"');
    expect(page).toContain('data-bot-id="pepper"');
    expect(page).not.toContain('data-bot-id="lead"');
  });

  it("marks a bot with unread output on its card", () => {
    const cards = html().split("<article").slice(1);
    expect(cards.find((card) => card.includes('data-bot-id="pepper"'))).toContain("data-card-unread");
    expect(cards.find((card) => card.includes('data-bot-id="ops-writer"'))).not.toContain("data-card-unread");
  });

  it("offers a new bot, Templates and Import in the Add menu", () => {
    const page = html();
    expect(page).toContain("data-team-map-new-bot");
    expect(page).toContain(">Templates<");
    expect(page).toContain(">Import…<");
  });

  it("lists the group chats outside projects, with their unread", () => {
    const page = html();
    expect(page).toContain('data-team-map-room="lobby"');
    expect(page).not.toContain('data-team-map-room="launch-room"');
    expect(page).toContain("data-team-map-rooms-unread");
    expect(page).toContain(">New group chat<");
  });

  it("keeps the department actions the sidebar menu had", () => {
    const ops = html().split("<section").find((section) => section.includes('data-team-key="Ops"'));
    expect(ops).toContain(">Pause department<");
    expect(ops).toContain(">Set for all bots in this department…<");
    expect(ops).toContain(">Share<");
  });
});

describe("TeamMapNote", () => {
  it("says a department has no Chief, with the server's full reason", () => {
    const note = render(createElement(TeamMapNote, { reason: "no_chief" }));
    expect(note).toContain("No Chief of Staff");
    expect(note).toContain('title="It has no Chief of Staff to lead a project yet."');
  });

  it("says nothing for a department a project can be made from", () => {
    expect(render(createElement(TeamMapNote, { reason: undefined }))).toBe("");
  });
});
