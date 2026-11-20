// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { TeamProjectWire } from "../../../shared/team-projects";

const viewer = vi.hoisted(() => ({ ownerOrAdmin: true as boolean | null }));
vi.mock("@/lib/use-owner-or-admin", () => ({ useOwnerOrAdmin: () => viewer.ownerOrAdmin }));

import { setLocale } from "@/lib/i18n";
import { closeTemplateSyncDialog, useTemplateSyncDialog } from "./host";
import { TemplateSyncMenuItems } from "./ProjectMenuItems";

const bride: TeamProjectWire = {
  id: "p1", name: "The bride", folder: "/dramas/The bride", section: "The bride", template: { id: "urban", name: "Urban", version: 2 },
  leadBotId: "lead", createdAt: 1, folderState: "ready", botIds: ["lead", "writer"],
};

let container: HTMLDivElement, root: Root;
const onChoose = vi.fn();
const items = () => [...container.querySelectorAll<HTMLElement>('[role="menuitem"]')].map((item) => item.textContent);
const opened = () => JSON.parse(container.querySelector("[data-opened]")!.textContent!) as unknown;

function Menu({ project }: { project: TeamProjectWire }) {
  return createElement("div", { role: "menu" },
    createElement(TemplateSyncMenuItems, { project, onChoose }),
    createElement("button", { type: "button", role: "menuitem", autoFocus: true }, "Archive"),
    createElement("output", { "data-opened": "" }, JSON.stringify(useTemplateSyncDialog())));
}
const draw = async (project: TeamProjectWire = bride) => { await act(async () => root.render(createElement(Menu, { project }))); };
const click = async (selector: string) => { await act(async () => container.querySelector<HTMLElement>(selector)!.click()); };

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  setLocale("en");
  viewer.ownerOrAdmin = true;
  onChoose.mockClear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => { closeTemplateSyncDialog(); root.unmount(); });
  container.remove();
  vi.unstubAllGlobals();
});

describe("the template actions in a project's menu", () => {
  it("come first for the owner or an admin, and the first one takes the focus", async () => {
    await draw();
    expect(items()).toEqual(["Update from template…", "Save back to template…", "Archive"]);
    expect(document.activeElement?.textContent).toBe("Update from template…");
  });

  it("are not offered to anyone else, nor while it is not known who is asking", async () => {
    viewer.ownerOrAdmin = false;
    await draw();
    expect(items()).toEqual(["Archive"]);
    viewer.ownerOrAdmin = null;
    await draw();
    expect(items()).toEqual(["Archive"]);
    expect(document.activeElement?.textContent).toBe("Archive");
  });

  it("are not offered while the project's folder cannot be found", async () => {
    await draw({ ...bride, folderState: "missing" });
    expect(items()).toEqual(["Archive"]);
  });

  it("close the menu and open the update for that project", async () => {
    await draw();
    await click("[data-template-sync-update]");
    expect(onChoose).toHaveBeenCalledTimes(1);
    expect(opened()).toEqual({ kind: "update", projectId: "p1", projectName: "The bride" });
  });

  it("close the menu and open saving back, naming the project's template", async () => {
    await draw();
    await click("[data-template-sync-save-back]");
    expect(onChoose).toHaveBeenCalledTimes(1);
    expect(opened()).toEqual({ kind: "saveBack", projectId: "p1", projectName: "The bride", templateName: "Urban" });
  });
});
