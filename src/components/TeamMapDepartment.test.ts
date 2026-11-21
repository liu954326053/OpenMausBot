// @vitest-environment happy-dom
import { createElement, Fragment, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildTeamMapSections, type TeamMapSection } from "@/lib/team-map";
import type { Bot } from "@/state/store";

const fixture = vi.hoisted(() => ({ dispatch: vi.fn(), api: vi.fn(), side: { shown: true } }));
vi.mock("@/state/store", async (original) => ({
  ...await original<typeof import("@/state/store")>(),
  useStore: () => ({ state: { bots: [], groups: [] }, dispatch: fixture.dispatch }),
  api: fixture.api,
}));
vi.mock("@/state/team-projects", async (original) => ({ ...await original<object>(), useTeamProjectSide: () => fixture.side }));
vi.mock("@/lib/use-owner-or-admin", () => ({ useOwnerOrAdmin: () => true }));
vi.mock("./ChiefPicker", () => ({
  ChiefPicker: ({ department, anchor, onClose }: { department: string; anchor: HTMLElement; onClose: () => void }) =>
    createElement("div", { "data-picker": department, "data-anchor": anchor.tagName }, createElement("button", { type: "button", onClick: onClose }, "Close picker")),
}));
vi.mock("./team-projects/NewTeamProjectDialog", () => ({
  NewTeamProjectDialog: ({ team, onClose }: { team?: string; onClose: () => void }) =>
    createElement("div", { "data-new-project": team ?? "" }, createElement("button", { type: "button", onClick: onClose }, "Close dialog")),
}));

const { DeleteDepartmentDialog, TeamMapDepartmentDialogs, TeamMapDepartmentItems, TeamMapNote, useProjectTeamNotes } = await import("./TeamMapDepartment");

let root: Root;
let host: HTMLElement;
const onClose = vi.fn();
const onError = vi.fn();
const render = (department: string | null) => flushSync(() => root.render(createElement(DeleteDepartmentDialog, { department, onClose, onError })));
const dialog = () => document.body.querySelector<HTMLElement>("[role=alertdialog]");
const button = (label: string) => [...dialog()!.querySelectorAll("button")].find((each) => each.textContent === label)!;
const settle = () => new Promise((done) => setTimeout(done, 0));

beforeEach(() => {
  fixture.dispatch.mockReset();
  fixture.api.mockReset();
  onClose.mockReset();
  onError.mockReset();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => { flushSync(() => root.unmount()); host.remove(); });

describe("deleting a department from the team map", () => {
  it("sends one request however often it is pressed, and holds the dialog until the server answers", async () => {
    let answer!: (value: { sections: string[] }) => void;
    fixture.api.mockReturnValue(new Promise((resolve) => { answer = resolve; }));
    render("Launch");
    expect(dialog()?.textContent).toContain("Delete Launch department?");
    flushSync(() => { button("Delete department").click(); button("Delete department").click(); });
    expect(fixture.api).toHaveBeenCalledTimes(1);
    expect(fixture.api).toHaveBeenCalledWith("/api/sidebar-sections?section=Launch", { method: "DELETE" });
    expect(dialog()?.getAttribute("aria-busy")).toBe("true");
    expect([...dialog()!.querySelectorAll("button")].every((each) => each.disabled)).toBe(true);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(onClose).not.toHaveBeenCalled();

    answer({ sections: ["Research"] });
    await settle();
    expect(fixture.dispatch).toHaveBeenCalledWith({ type: "sectionDeleted", section: "Launch", sections: ["Research"] });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("stays open after a failure, says why, and can be pressed again", async () => {
    fixture.api.mockRejectedValueOnce(new Error("Fixture deletion failure")).mockResolvedValueOnce({ sections: [] });
    render("Launch");
    flushSync(() => button("Delete department").click());
    await settle();
    expect(onError).toHaveBeenCalledWith("Fixture deletion failure");
    expect(onClose).not.toHaveBeenCalled();
    expect(dialog()?.getAttribute("aria-busy")).toBe("false");

    flushSync(() => button("Delete department").click());
    await settle();
    expect(fixture.api).toHaveBeenCalledTimes(2);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("is closed while no department is being deleted", () => {
    render(null);
    expect(dialog()).toBeNull();
  });
});

describe("choosing a Chief of Staff from the team map", () => {
  const show = (children: ReactNode) => flushSync(() => root.render(createElement(Fragment, null, children, createElement(TeamMapDepartmentDialogs))));
  const note = () => host.querySelector<HTMLElement>("[data-team-note]")!;
  const picker = () => host.querySelector<HTMLElement>("[data-picker]");
  const item = (label: string) => [...host.querySelectorAll<HTMLButtonElement>("button")].find((each) => each.textContent === label);
  beforeEach(() => { fixture.side = { shown: true }; });

  it("turns the label of a department with no Chief into a button that opens and closes the picker of its bots", () => {
    show(createElement(TeamMapNote, { department: "Night shift", reason: "no_chief", canChoose: true }));
    expect(note().tagName).toBe("BUTTON");
    expect(note().textContent).toBe("No Chief of Staff");
    expect(note().getAttribute("aria-haspopup")).toBe("menu");
    expect(note().getAttribute("aria-expanded")).toBe("false");
    flushSync(() => note().click());
    expect(picker()?.dataset.picker).toBe("Night shift");
    expect(picker()?.dataset.anchor).toBe("BUTTON");
    expect(note().getAttribute("aria-expanded")).toBe("true");
    flushSync(() => note().click());
    expect(picker()).toBeNull();
  });

  it("leaves the label as words for someone who can't choose, and for a reason a Chief doesn't settle", () => {
    show(createElement(TeamMapNote, { department: "Night shift", reason: "no_chief", canChoose: false }));
    expect(note().tagName).toBe("SPAN");
    expect(note().title).toBe("It has no Chief of Staff to lead a project yet.");
    show(createElement(TeamMapNote, { department: "Night shift", reason: "main_bot_chief", canChoose: true }));
    expect(note().tagName).toBe("SPAN");
    show(createElement(TeamMapNote, { department: "Night shift", reason: undefined, canChoose: true }));
    expect(host.querySelector("[data-team-note]")).toBeNull();
  });

  it("offers a new project with this team, and the team's Chief of Staff opened at the menu's button, in the department's menu", () => {
    const menu = createElement("details", { open: true }, createElement("summary", null, "Manage"),
      createElement("div", null, createElement(TeamMapDepartmentItems, { department: "Night shift", itemClass: "item" })));
    show(menu);
    flushSync(() => item("New project from this department")!.click());
    expect(host.querySelector<HTMLElement>("[data-new-project]")?.dataset.newProject).toBe("Night shift");
    flushSync(() => item("Close dialog")!.click());
    expect(host.querySelector("[data-new-project]")).toBeNull();
    flushSync(() => item("Choose Chief of Staff")!.click());
    expect(picker()?.dataset.picker).toBe("Night shift");
    expect(picker()?.dataset.anchor).toBe("SUMMARY");
    flushSync(() => item("Close picker")!.click());
    expect(picker()).toBeNull();
  });

  it("offers no new project where projects are not offered", () => {
    fixture.side = { shown: false };
    show(createElement(TeamMapDepartmentItems, { department: "Night shift", itemClass: "item" }));
    expect(item("New project from this department")).toBeUndefined();
    expect(item("Choose Chief of Staff")).toBeDefined();
  });
});

describe("why a department can't be made into a project", () => {
  const bot = (id: string, extra: Partial<Bot> = {}) => ({ id, name: id, ...extra }) as Bot;
  let notes: [string, string][] = [];
  function Notes({ sections }: { sections: TeamMapSection<Bot>[] }) {
    notes = [...useProjectTeamNotes(sections)];
    return null;
  }
  const notesFor = (bots: Bot[], names: string[] = []) => {
    flushSync(() => root.render(createElement(Notes, { sections: buildTeamMapSections(bots, names) })));
    return notes;
  };
  beforeEach(() => { fixture.side = { shown: true }; });

  it("follows the bots on the map, so a Chief chosen anywhere clears the note at once", () => {
    const team = [bot("main", { defaultBot: {}, chiefOfStaff: true }), bot("nia", { section: "Night shift" }), bot("ode", { section: "Night shift" })];
    expect(notesFor(team)).toEqual([["Night shift", "no_chief"]]);
    expect(notesFor(team.map((one) => (one.id === "nia" ? { ...one, chiefOfStaff: true } : one)))).toEqual([]);
  });

  it("says when the main bot leads a department, or it has no bots, and never notes the bots in no department", () => {
    expect(notesFor([bot("main", { defaultBot: {}, chiefOfStaff: true, section: "Ops" }), bot("gus", { section: "Ops" }), bot("pepper")], ["Empty room"]))
      .toEqual([["Ops", "main_bot_chief"], ["Empty room", "empty"]]);
  });

  it("notes nothing where projects are not offered", () => {
    fixture.side = { shown: false };
    expect(notesFor([bot("nia", { section: "Night shift" })])).toEqual([]);
  });
});
