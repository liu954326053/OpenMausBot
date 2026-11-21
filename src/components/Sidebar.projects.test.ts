import { Children, isValidElement, type EffectCallback, type ReactElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Action, AppState, Bot, Group } from "@/state/store";

const fixture = vi.hoisted(() => ({
  values: [] as unknown[], index: 0, advanced: false, phone: false, admin: null as boolean | null,
  state: {} as AppState, dispatch: vi.fn(), storage: new Map<string, string>(),
  requests: [] as Array<{ path: string; method: string; body: unknown }>,
}));
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useState: (initial: unknown) => {
    const index = fixture.index++;
    if (!(index in fixture.values)) fixture.values[index] = typeof initial === "function" ? (initial as () => unknown)() : initial;
    return [fixture.values[index], (next: unknown) => {
      fixture.values[index] = typeof next === "function" ? (next as (value: unknown) => unknown)(fixture.values[index]) : next;
    }];
  },
  useRef: (initial: unknown) => {
    const index = fixture.index++;
    if (!(index in fixture.values)) fixture.values[index] = { current: initial };
    return fixture.values[index];
  },
  useCallback: (callback: unknown) => callback,
  useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => snapshot(),
  useEffect: (_effect: EffectCallback) => {},
  useLayoutEffect: () => {},
}));
vi.mock("react-dom", () => ({ createPortal: (node: ReactNode) => node }));
vi.mock("./MenuMotion", () => ({
  useMenuMotion: (open: boolean) => ({ shown: open, closing: false, className: "", exitProps: {} }),
  useHeldMenuMotion: (value: unknown) => ({ shown: value !== null, value, closing: false, className: "", exitProps: {} }),
}));
vi.mock("./DesktopCapabilities", async () => {
  const { initialDesktopCapabilities } = await import("@/lib/desktop");
  return { useDesktopCapabilities: () => ({ capabilities: initialDesktopCapabilities() }), windowFramed: () => false };
});
vi.mock("@/lib/thread-preferences", () => ({ useShowThreads: () => fixture.advanced }));
vi.mock("@/lib/interface-mode", () => ({ useAdvancedMode: () => fixture.advanced, setAdvancedMode: () => {} }));
vi.mock("@/lib/use-owner-or-admin", () => ({ useOwnerOrAdmin: () => fixture.admin }));
vi.mock("@/state/store-select", async (importOriginal) => (await import("@/testing/plain-store-select")).plainStoreSelect(await importOriginal()));
vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return { ...original, useStore: () => ({ state: fixture.state, dispatch: fixture.dispatch }) };
});

import { initialState } from "@/state/store";
import { setTeamProjects } from "@/state/team-projects";
import { useTeamMapTarget } from "@/state/team-map-focus";
import { SIDEBAR_DENSITY_KEY } from "@/lib/sidebar-preferences";
import { PHONE_LAYOUT } from "@/lib/use-media-query";
import { BotContextMenu, BotListItem, Sidebar } from "./Sidebar";
import { MovedBotRows } from "./MoveToTeam";
import { OtherPlaceBots } from "./OtherPlaceBots";
const drawSidebar = (Sidebar as unknown as { type: (props: import("react").ComponentProps<typeof Sidebar>) => import("react").ReactNode }).type;
import { SidebarFooter } from "./SidebarFooter";
import { SidebarInboxRow } from "./SidebarInboxRow";
import { PhoneHero } from "./SidebarPhoneHero";
import { SidebarSectionHeader } from "./SidebarSectionHeader";
import { SidebarTileGrid } from "./SidebarTiles";
import { NewTeamProjectDialog } from "./team-projects/NewTeamProjectDialog";
import { SidebarTeamProjects } from "./team-projects/SidebarTeamProjects";
import { ConfirmDialog } from "./ConfirmDialog";
import { TeamDialog } from "./TeamDialog";

const bot = (id: string, extra: Partial<Bot> = {}): Bot => ({
  id, threadId: `${id}-thread`, name: id, title: "", description: "", notifications: true,
  color: "green", unread: false, modelSelection: { instanceId: "fake", model: "m" }, messages: [], ...extra,
});
const room: Group = {
  id: "room", threadId: "room-thread", name: "Launch room", memberIds: ["atlas"], messages: [],
  defaultResponder: { kind: "mentions" }, bulletin: "", unread: false, createdAt: 1,
};
const work = {
  id: "p1", name: "Work", folder: "/dramas/Work", section: "Work", team: { key: "team:urban", name: "Urban" }, follows: {},
  leadBotId: "dodo", createdAt: 1, folderState: "ready" as const, botIds: ["dodo", "echo"],
};
const withProject = () => setTeamProjects({ root: "/dramas", projects: [work] });

type Props = { children?: ReactNode; [key: string]: unknown };
type RowProps = Parameters<typeof BotListItem>[0];
type ProjectsProps = Parameters<typeof SidebarTeamProjects>[0];
function nodes(value: ReactNode): ReactElement<Props>[] {
  return Children.toArray(value).flatMap((child) => {
    if (!isValidElement<Props>(child)) return [];
    return [child, ...nodes(child.props.children)];
  });
}
function render() {
  fixture.index = 0;
  const root = drawSidebar({ open: false, onClose: () => {} }) as ReactElement<Props>;
  return [root, ...nodes(root.props.children)];
}
const rows = () => render().filter((node) => node.type === BotListItem).map((node) => node.props as unknown as RowProps);
const listed = () => rows().map((props) => props.bot.id);
const projects = () => render().find((node) => node.type === SidebarTeamProjects)!.props as unknown as ProjectsProps;
const at = (type: unknown) => render().findIndex((node) => node.type === type);
const marked = (attribute: string) => render().find((node) => node.props[attribute] !== undefined);
const actions = () => fixture.dispatch.mock.calls.map(([action]) => action as Action);
const search = (text: string) => {
  fixture.phone = true;
  (render().find((node) => typeof node.props.onQuery === "function")!.props.onQuery as (query: string) => void)(text);
};
const openPlus = () => (render().find((node) => node.type === "button" && node.props["aria-label"] === "New")!.props.onClick as () => void)();
const choose = (attribute: string) => (marked(attribute)!.props.onClick as () => void)();

beforeEach(() => {
  fixture.values = [];
  fixture.advanced = false;
  fixture.phone = false;
  fixture.admin = null;
  fixture.storage = new Map();
  fixture.requests = [];
  fixture.dispatch.mockClear();
  fixture.state = {
    ...initialState,
    bots: [bot("magic", { name: "MagicBot", defaultBot: {} }), bot("atlas"), bot("bea"), bot("dodo", { section: "Work" }), bot("echo", { section: "Work" })],
    groups: [room, { ...room, id: "set", name: "On set", section: "Work" }],
    sections: ["Work"],
  };
  vi.stubGlobal("window", Object.assign(new EventTarget(), {
    innerWidth: 1280, innerHeight: 800, ogb: undefined, setTimeout, clearTimeout,
    matchMedia: (query: string) => ({ matches: fixture.phone && query === PHONE_LAYOUT, addEventListener() {}, removeEventListener() {} }),
  }));
  vi.stubGlobal("document", { body: {}, querySelector: () => null });
  vi.stubGlobal("requestAnimationFrame", () => 0);
  vi.stubGlobal("fetch", async (path: string, init: RequestInit) => {
    fixture.requests.push({ path, method: init.method ?? "GET", body: init.body ? JSON.parse(String(init.body)) : undefined });
    return new Response(JSON.stringify({ sections: ["Clients"], botIds: [] }), { status: 200 });
  });
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => fixture.storage.get(key) ?? null,
    setItem: (key: string, value: string) => { fixture.storage.set(key, value); },
    removeItem: (key: string) => { fixture.storage.delete(key); },
  });
});
afterEach(() => {
  setTeamProjects(null);
  vi.unstubAllGlobals();
});

describe("the sidebar from top to bottom", () => {
  it("lists the main bot, the inbox, then the projects, and no department, bot list or group chat list", () => {
    fixture.advanced = true;
    withProject();
    expect(listed()).toEqual(["magic"]);
    expect(at(BotListItem)).toBeLessThan(at(SidebarInboxRow));
    expect(at(SidebarInboxRow)).toBeLessThan(at(SidebarTeamProjects));
    expect(render().filter((node) => node.props["data-sidebar-section-id"])).toEqual([]);
    expect(render().some((node) => node.type === SidebarSectionHeader)).toBe(false);
  });

  it("draws Simple's main bot as a tile with the inbox under it, above the list that scrolls", () => {
    withProject();
    const grid = render().find((node) => node.type === SidebarTileGrid)!;
    expect((grid.props.primary as Bot).id).toBe("magic");
    expect(listed()).toEqual([]);
    expect(at(SidebarTileGrid)).toBeLessThan(at(SidebarInboxRow));
    expect(at(SidebarInboxRow)).toBeLessThan(at(SidebarTeamProjects));
  });

  it("keeps the same order in the icons rail", () => {
    fixture.storage.set(SIDEBAR_DENSITY_KEY, "avatars");
    withProject();
    expect(listed()).toEqual(["magic"]);
    expect(rows()[0]!.density).toBe("icons");
    expect(at(BotListItem)).toBeLessThan(at(SidebarInboxRow));
    expect(at(SidebarInboxRow)).toBeLessThan(at(SidebarTeamProjects));
    expect(projects().mode.density).toBe("icons");
  });

  it("is the same with no projects: the main bot and the inbox, then New project", () => {
    fixture.advanced = true;
    expect(listed()).toEqual(["magic"]);
    expect(projects().side.shown).toBe(false);
    expect(render().filter((node) => node.props["data-sidebar-section-id"])).toEqual([]);
  });

  it("leaves out a main bot hidden from the sidebar, with a search too", () => {
    fixture.advanced = true;
    fixture.state = { ...fixture.state, bots: fixture.state.bots.map((one) => (one.id === "magic" ? { ...one, sidebarHidden: true } : one)) };
    expect(listed()).toEqual([]);
    search("magic");
    expect(render().some((node) => node.type === PhoneHero)).toBe(false);
  });

  it("tells the projects how the sidebar is drawn", () => {
    withProject();
    expect(projects().mode).toEqual({ density: "comfortable", advanced: false, tight: true, remote: false });
    fixture.advanced = true;
    fixture.storage.set(SIDEBAR_DENSITY_KEY, "avatars");
    expect(projects().mode).toEqual({ density: "icons", advanced: true, tight: true, remote: false });
  });
});

describe("a search", () => {
  const type = (text: string) => (render().find((node) => node.type === "input" && node.props["aria-label"] === "Search projects")!.props.onChange as (event: { target: { value: string } }) => void)({ target: { value: text } });

  it("hands the projects what was typed, trimmed, below the main bot and the inbox", () => {
    withProject();
    search(" Wor ");
    expect(projects().query).toBe("Wor");
    expect((render().find((node) => node.type === PhoneHero)!.props.bot as Bot).id).toBe("magic");
    expect(at(PhoneHero)).toBeLessThan(at(SidebarInboxRow));
    expect(at(SidebarInboxRow)).toBeLessThan(at(SidebarTeamProjects));
  });

  it("lists no bot but the main one, no group chat and none of the other place's bots", () => {
    fixture.advanced = true;
    withProject();
    expect(render().some((node) => node.type === OtherPlaceBots)).toBe(true);
    type("a");
    expect([projects().query, listed(), render().some((node) => node.props.group !== undefined), render().some((node) => node.type === OtherPlaceBots)]).toEqual(["a", ["magic"], false, false]);
    expect([at(SidebarInboxRow) >= 0, render().some((node) => node.type === MovedBotRows)]).toEqual([true, true]);
    type("");
    expect([projects().query, render().some((node) => node.type === OtherPlaceBots)]).toEqual(["", true]);
  });
});

describe("the team map's dot", () => {
  const footer = () => render().find((node) => node.type === SidebarFooter)!.props as { teamMapUnread?: boolean };
  const unread = (id: string) => {
    fixture.state = { ...fixture.state, bots: fixture.state.bots.map((one) => (one.id === id ? { ...one, unread: true } : one)) };
  };

  it("shows while a bot in no project has something unread", () => {
    withProject();
    expect(footer().teamMapUnread).toBe(false);
    unread("atlas");
    expect(footer().teamMapUnread).toBe(true);
  });

  it("stays off for the main bot and a project's bots, which the sidebar shows", () => {
    withProject();
    unread("magic");
    unread("echo");
    expect(footer().teamMapUnread).toBe(false);
  });

  it("shows for a group chat outside the projects, not for a project's", () => {
    withProject();
    fixture.state = { ...fixture.state, groups: fixture.state.groups.map((group) => (group.id === "set" ? { ...group, unread: true } : group)) };
    expect(footer().teamMapUnread).toBe(false);
    fixture.state = { ...fixture.state, groups: fixture.state.groups.map((group) => ({ ...group, unread: true })) };
    expect(footer().teamMapUnread).toBe(true);
  });
});

describe("making something from the + menu", () => {
  beforeEach(() => { fixture.admin = true; });

  it("opens the new project dialog from New project, and from the list's own New project", () => {
    withProject();
    openPlus();
    choose("data-plus-new-project");
    expect(render().some((node) => node.type === NewTeamProjectDialog)).toBe(true);
    fixture.values = [];
    projects().onNew();
    expect(render().some((node) => node.type === NewTeamProjectDialog)).toBe(true);
  });

  it("makes a bot where the person is, then shows it on the team map", () => {
    openPlus();
    choose("data-plus-new-bot");
    const made = actions().find((action) => action.type === "newBot") as Extract<Action, { type: "newBot" }>;
    expect(made.preserveSelection).toBe(true);
    made.onCreated!(bot("nova"));
    expect(actions().at(-1)).toEqual({ type: "showTeamMap" });
    expect(useTeamMapTarget()).toEqual({ botId: "nova" });
  });

  it("shows a new department on the team map", () => {
    openPlus();
    choose("data-plus-new-department");
    const dialog = render().find((node) => node.type === TeamDialog)!;
    (dialog.props.onCreated as (name: string) => void)("Ops");
    expect(actions()).toEqual([{ type: "showTeamMap" }]);
    expect(useTeamMapTarget()).toEqual({ department: "Ops" });
  });

  it("makes a department from a bot's New department…, moves the bot into it and shows it on the team map", () => {
    type MenuProps = Parameters<typeof BotContextMenu>[0];
    (render().find((node) => node.type === BotContextMenu)!.props as unknown as MenuProps).onNewSection!("atlas");
    (render().find((node) => node.type === TeamDialog)!.props.onCreated as (name: string) => void)("Ops");
    expect(actions()).toEqual([{ type: "updateBot", botId: "atlas", patch: { section: "Ops" } }, { type: "showTeamMap" }]);
    expect(useTeamMapTarget()).toEqual({ department: "Ops" });
  });
});

describe("a bot's menu in Simple", () => {
  type MenuProps = Parameters<typeof BotContextMenu>[0];
  const menuProps = (botId: string, extra: Partial<MenuProps> = {}): MenuProps => ({
    menu: { botId, x: 0, y: 0 }, onClose: vi.fn(), onArchive: vi.fn(), onDelete: vi.fn(), onMoveToSection: vi.fn(),
    onNewFolder: vi.fn(), onNewTaskFolder: vi.fn(), onNewSection: vi.fn(), ...extra,
  });
  const open = (props: MenuProps) => {
    fixture.index = 0;
    const tree = nodes(BotContextMenu(props));
    const move = tree.find((node) => node.props["data-bot-menu-move"] !== undefined)!;
    (move.props.onClick as (event: { detail: number }) => void)({ detail: 1 });
    fixture.index = 0;
    const flyout = nodes(BotContextMenu(props)).find((node) => node.props["data-bot-menu-flyout"] === "move")!;
    return nodes(flyout.props.children).filter((node) => node.props.role === "menuitem");
  };
  const label = (node: ReactElement<Props>) => nodes(node.props.children).length
    ? Children.toArray(node.props.children).filter((part) => typeof part === "string").join("") : String(node.props.children);

  it("moves it to a department, a new one or out of one, from Move to department", () => {
    fixture.state = { ...fixture.state, sections: ["Work", "Home"] };
    const props = menuProps("dodo");
    const items = open(props);
    expect(items.map(label)).toEqual(["Work", "Home", "New department…", "Remove from department"]);
    expect(items[0]!.props.disabled).toBe(true);
    (items[1]!.props.onClick as () => void)();
    (items[3]!.props.onClick as () => void)();
    expect(actions()).toEqual([
      { type: "updateBot", botId: "dodo", patch: { section: "Home" } },
      { type: "updateBot", botId: "dodo", patch: { section: "" } },
    ]);
    (items[2]!.props.onClick as () => void)();
    expect(props.onNewSection).toHaveBeenCalledWith("dodo");
  });

  it("offers only New department… to a bot in none, when there are no departments yet", () => {
    fixture.state = { ...fixture.state, sections: [], bots: [bot("atlas"), bot("bea")], groups: [room] };
    expect(open(menuProps("atlas")).map(label)).toEqual(["New department…"]);
  });
});

describe("deleting a Chief of Staff", () => {
  type MenuProps = Parameters<typeof BotContextMenu>[0];
  const askToDelete = (target: Bot) => (render().find((node) => node.type === BotContextMenu)!.props as unknown as MenuProps).onDelete(target);
  const openDialog = () => render().find((node) => node.type === ConfirmDialog && node.props.open === true);

  it("offers Archive first, which keeps its chats, and archives it as an ordinary bot", async () => {
    const chief = bot("atlas", { chiefOfStaff: true });
    fixture.state = { ...fixture.state, bots: [chief, bot("bea")] };
    askToDelete(chief);
    const dialog = openDialog()!;
    expect(dialog.props.body).toContain("Archive it instead to keep every conversation");
    const alternative = dialog.props.alternative as { label: string; onClick: () => void };
    expect(alternative.label).toBe("Archive instead");
    alternative.onClick();
    await vi.waitFor(() => expect(fixture.requests).toContainEqual({ path: "/api/bots/atlas", method: "PATCH", body: { hidden: true, chiefOfStaff: false } }));
    expect(openDialog()).toBeUndefined();
  });

  it("offers nothing else for any other bot, or for the last bot there is", () => {
    askToDelete(bot("bea"));
    expect(openDialog()!.props.alternative).toBeUndefined();
    const chief = bot("atlas", { chiefOfStaff: true });
    fixture.values = [];
    fixture.state = { ...fixture.state, bots: [chief] };
    askToDelete(chief);
    expect(openDialog()!.props.alternative).toBeUndefined();
  });
});
