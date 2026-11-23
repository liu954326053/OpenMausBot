// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { TeamProjectWire } from "../../../shared/team-projects";
import type { Bot, Group, Message } from "@/state/store";

const fixture = vi.hoisted(() => ({ dispatch: vi.fn(), state: { bots: [] as unknown[], groups: [] as unknown[], pendingQueued: {} }, shownGroup: null as unknown }));
vi.mock("@/state/store-select", () => ({
  useStoreSelector: (selector: (state: typeof fixture.state) => unknown) => selector(fixture.state),
  useStoreDispatch: () => fixture.dispatch,
}));
vi.mock("@/lib/thread-preferences", () => ({ useShowThreads: () => false }));
vi.mock("@/lib/default-bot", async (original) => ({ ...(await original<typeof import("@/lib/default-bot")>()), useViewerEmail: () => null }));
vi.mock("@/components/ChatView", async () => {
  const { createElement: element } = await import("react");
  return { ChatView: ({ bot }: { bot: Bot }) => element("main", { "data-chat-view": bot.id }) };
});
vi.mock("@/components/GroupView", async () => {
  const { createElement: element } = await import("react");
  return {
    GroupView: ({ group }: { group: Group }) => {
      fixture.shownGroup = group;
      return element("main", { "data-group-view": group.id });
    },
  };
});

import { setLocale } from "@/lib/i18n";
import { setTeamProjects } from "@/state/team-projects";
import { ProjectChat, ProjectGroup } from "./ProjectChat";

const bot = (id: string, extra: Partial<Bot> = {}): Bot => ({
  id, threadId: `${id}-thread`, name: id, title: "", description: "", notifications: true,
  color: "green", unread: false, modelSelection: { instanceId: "fake", model: "m" }, messages: [], ...extra,
});
const bride: TeamProjectWire = {
  id: "p-bride", name: "The bride", folder: "/dramas/The bride", section: "The bride", team: { key: "team:urban", name: "Urban" }, follows: {},
  leadBotId: "lead", createdAt: 1, folderState: "ready", botIds: ["lead", "writer"], episodeBots: {},
};
const main = bot("main", { defaultBot: {} });
const lead = bot("lead", { section: "The bride", chiefOfStaff: true });
const writer = bot("writer", { section: "The bride" });

let container: HTMLDivElement, root: Root;
const q = (selector: string) => document.body.querySelector<HTMLElement>(selector);
const draw = async (shown: Bot) => {
  await act(async () => root.render(createElement(ProjectChat, { bot: shown })));
};
const options = () => [...document.body.querySelectorAll<HTMLElement>("[data-project-chat] [data-project-mode-option]")];

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  setLocale("en");
  fixture.state = { bots: [main, lead, writer], groups: [], pendingQueued: {} };
  fixture.dispatch.mockClear();
  setTeamProjects({ root: "/dramas", projects: [bride] });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  setTeamProjects(null);
  vi.unstubAllGlobals();
});

describe("a conversation in a project", () => {
  it("is under the project's top bar: its name, the switch on Chat, and its folder", async () => {
    await draw(lead);
    expect(q("[data-project-chat]")?.dataset.projectChat).toBe("p-bride");
    expect(q("[data-project-chat] h1")?.textContent).toBe("The bride");
    expect(options().map((one) => [one.textContent, one.getAttribute("aria-pressed")])).toEqual([["Chat", "true"], ["Canvas", "false"]]);
    expect(q("[data-project-chat] [data-project-folder]")?.textContent).toBe("/dramas/The bride");
    expect(q("[data-project-chat] [data-chat-view]")?.dataset.chatView).toBe("lead");
  });

  it("goes to the project's canvas from the switch, from the lead's conversation and from another member's", async () => {
    for (const shown of [lead, writer]) {
      fixture.dispatch.mockClear();
      await draw(shown);
      await act(async () => options()[0]!.click());
      expect(fixture.dispatch).not.toHaveBeenCalled();
      await act(async () => options()[1]!.click());
      expect([shown.id, fixture.dispatch.mock.calls]).toEqual([shown.id, [[{ type: "showProject", projectId: "p-bride" }]]]);
    }
  });

  it("leaves a conversation outside the projects as it is, and one opened once its project was archived", async () => {
    await draw(main);
    expect([q("[data-project-chat]"), q("[data-chat-view]")?.dataset.chatView]).toEqual([null, "main"]);
    setTeamProjects({ root: "/dramas", projects: [{ ...bride, archivedAt: 5 }] });
    await draw(lead);
    expect([q("[data-project-chat]"), q("[data-chat-view]")?.dataset.chatView]).toEqual([null, "lead"]);
    expect(fixture.dispatch).not.toHaveBeenCalled();
  });

  it("gives way to MagicBot when the project is archived while its conversation is open", async () => {
    await draw(writer);
    expect(fixture.dispatch).not.toHaveBeenCalled();
    await act(async () => setTeamProjects({ root: "/dramas", projects: [{ ...bride, archivedAt: 5 }] }));
    expect(fixture.dispatch.mock.calls).toEqual([[{ type: "select", id: "main" }]]);
  });
});

describe("a group chat in a project", () => {
  const room = (id: string, section: string): Group => ({
    id, threadId: `${id}-thread`, name: `${id} chat`, memberIds: ["lead", "writer"], messages: [], defaultResponder: { kind: "member", botId: "lead" }, bulletin: "", unread: false, createdAt: 1, section,
  });
  const drawRoom = async (shown: Group) => {
    await act(async () => root.render(createElement(ProjectGroup, { group: shown })));
  };

  it("is under the project's top bar, whose Chat it is and whose Canvas goes to the project's canvas", async () => {
    setTeamProjects({ root: "/dramas", projects: [{ ...bride, roomId: "bride-room" }] });
    await drawRoom(room("bride-room", "The bride"));
    expect([q("[data-project-chat]")?.dataset.projectChat, q("[data-project-chat] h1")?.textContent, q("[data-project-chat] [data-group-view]")?.dataset.groupView])
      .toEqual(["p-bride", "The bride", "bride-room"]);
    expect(options().map((one) => [one.textContent, one.getAttribute("aria-pressed")])).toEqual([["Chat", "true"], ["Canvas", "false"]]);
    await act(async () => options()[1]!.click());
    expect(fixture.dispatch.mock.calls).toEqual([[{ type: "showProject", projectId: "p-bride" }]]);
  });

  it("shows another group chat of the project's department under its top bar too, and one outside the projects as it is", async () => {
    await drawRoom(room("side-room", "The bride"));
    expect(q("[data-project-chat]")?.dataset.projectChat).toBe("p-bride");
    await drawRoom(room("sales-room", "Sales"));
    expect([q("[data-project-chat]"), q("[data-group-view]")?.dataset.groupView]).toEqual([null, "sales-room"]);
  });

  describe("of a drama whose production made bots for its episodes", () => {
    const episodeBots = { "frame-1": { number: 1, job: "storyboard" }, "cut-1": { number: 1, job: "post" } } as const;
    const started: Message = { id: "started", role: "bot", kind: "activity", at: 2, tool: { name: "EP01 storyboard started: frame-1", ok: true } };
    beforeEach(() => {
      fixture.state = { ...fixture.state, bots: [main, lead, writer, bot("frame-1", { section: "The bride" }), bot("cut-1", { section: "The bride" })] };
      setTeamProjects({ root: "/dramas", projects: [{ ...bride, roomId: "bride-room", botIds: [...bride.botIds, "frame-1", "cut-1"], episodeBots }] });
    });

    it("lists in the project's own group chat only the bots of the whole drama, the production's notes left in it as they are", async () => {
      const own = { ...room("bride-room", "The bride"), memberIds: ["lead", "frame-1", "writer", "cut-1"], messages: [started] };
      await drawRoom(own);
      expect(fixture.shownGroup).toEqual({ ...own, memberIds: ["lead", "writer"] });
      const shown = fixture.shownGroup;
      await drawRoom(own);
      expect(fixture.shownGroup).toBe(shown);
    });

    it("leaves the project's own group chat as it is while no episode's bot is in it, and another group chat of its department", async () => {
      const own = room("bride-room", "The bride");
      await drawRoom(own);
      expect(fixture.shownGroup).toBe(own);
      const side = { ...room("side-room", "The bride"), memberIds: ["lead", "frame-1"] };
      await drawRoom(side);
      expect(fixture.shownGroup).toBe(side);
    });
  });

  it("gives way to MagicBot when the project is archived while its group chat is open", async () => {
    setTeamProjects({ root: "/dramas", projects: [{ ...bride, roomId: "bride-room" }] });
    await drawRoom(room("bride-room", "The bride"));
    await act(async () => setTeamProjects({ root: "/dramas", projects: [{ ...bride, roomId: "bride-room", archivedAt: 5 }] }));
    expect(fixture.dispatch.mock.calls).toEqual([[{ type: "select", id: "main" }]]);
  });
});
