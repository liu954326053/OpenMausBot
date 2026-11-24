// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppState, Bot } from "@/state/store";

const fixture = vi.hoisted(() => ({ state: {} as AppState, dispatch: vi.fn(), admin: null as boolean | null }));
vi.mock("@/lib/use-owner-or-admin", () => ({ useOwnerOrAdmin: () => fixture.admin }));
vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return { ...original, useStore: () => ({ state: fixture.state, dispatch: fixture.dispatch }) };
});
vi.mock("./MenuMotion", () => ({
  useHeldMenuMotion: (value: unknown) => ({ shown: value !== null, value, closing: false, className: "", exitProps: {} }),
}));

import { setLocale } from "@/lib/i18n";
import { initialState } from "@/state/store";
import { setTeamProjects } from "@/state/team-projects";
import { useMayMoveBot, useOpenDepartments } from "./bot-sections";
import { SectionPicker } from "./SidebarSectionPicker";
import { TeamDialog } from "./TeamDialog";

const bot = (id: string, extra: Partial<Bot> = {}): Bot => ({
  id, threadId: `${id}-thread`, name: id, title: "", description: "", notifications: true,
  color: "green", unread: false, modelSelection: { instanceId: "fake", model: "m" }, messages: [], ...extra,
});
const bride = {
  id: "p1", name: "The bride", folder: "/dramas/The bride", section: "The bride", team: { key: "team:urban", name: "Urban" }, follows: {},
  leadBotId: "lead", createdAt: 1, folderState: "ready" as const, botIds: ["lead", "writer"], episodeBots: {},
};

let container: HTMLDivElement, root: Root;
const texts = (selector: string) => [...document.body.querySelectorAll<HTMLElement>(selector)].map((element) => element.textContent);

function Probe({ id }: { id: string }) {
  const may = useMayMoveBot(fixture.state.bots.find((one) => one.id === id));
  return createElement("output", null, `${may} ${useOpenDepartments(fixture.state).join(",")}`);
}
const probe = async (id: string) => {
  await act(async () => root.render(createElement(Probe, { id })));
  return document.body.querySelector("output")!.textContent;
};

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  setLocale("en");
  fixture.admin = null;
  fixture.state = {
    ...initialState,
    bots: [bot("main"), bot("sales", { section: "Sales" }), bot("lead", { section: "The bride", chiefOfStaff: true }), bot("writer", { section: "The bride" })],
    sections: ["Sales", "The bride"],
  };
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

describe("moving bots between departments, with projects", () => {
  it("keeps a project's bot in its team, and offers no project's department to the others", async () => {
    expect(await probe("sales")).toBe("true Sales");
    expect(await probe("writer")).toBe("false Sales");
    expect(await probe("lead")).toBe("false Sales");
  });

  it("is as before on a server without projects", async () => {
    setTeamProjects(null);
    expect(await probe("writer")).toBe("true Sales,The bride");
  });

  it("still lets only those who may move bots move them", async () => {
    fixture.admin = false;
    expect(await probe("sales")).toBe("false Sales");
  });

  it("gives an archived project's department to no one either", async () => {
    setTeamProjects({ root: "/dramas", projects: [{ ...bride, archivedAt: 4 }] });
    expect(await probe("sales")).toBe("true Sales");
  });

  it("lists no project's department in the department picker", async () => {
    await act(async () => root.render(createElement(SectionPicker, { current: "Sales", anchor: { x: 10, y: 10 }, onClose: () => {}, onAssign: () => {} })));
    expect(texts("[data-section-picker] .truncate")).toEqual(["Sales"]);
  });

  it("offers no project's bot to add to a department", async () => {
    await act(async () => root.render(createElement(TeamDialog, { section: "Sales", onClose: () => {} })));
    const offered = document.body.textContent ?? "";
    expect([offered.includes("main"), offered.includes("sales"), offered.includes("writer"), offered.includes("lead")]).toEqual([true, true, false, false]);
  });
});

describe("the main bot", () => {
  beforeEach(() => {
    fixture.state = { ...fixture.state, bots: [...fixture.state.bots, bot("MagicBot", { defaultBot: {} })] };
  });

  it("is offered no department to move to", async () => {
    expect(await probe("MagicBot")).toBe("false Sales");
  });

  it("is not offered to add to a department, nor to make one with", async () => {
    await act(async () => root.render(createElement(TeamDialog, { section: "Sales", onClose: () => {} })));
    expect(document.body.textContent).not.toContain("MagicBot");
    await act(async () => root.render(createElement(TeamDialog, { onClose: () => {} })));
    expect(document.body.textContent).not.toContain("MagicBot");
  });

  it("is offered to move out of a department it is still in", async () => {
    fixture.state = { ...fixture.state, bots: fixture.state.bots.map((one) => (one.id === "MagicBot" ? { ...one, section: "Sales" } : one)) };
    await act(async () => root.render(createElement(TeamDialog, { section: "", onClose: () => {} })));
    expect(document.body.textContent).toContain("MagicBot");
  });
});
