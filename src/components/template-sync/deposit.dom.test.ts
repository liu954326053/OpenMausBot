// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { TeamProjectWire } from "../../../shared/team-projects";

const sent = vi.hoisted(() => ({ deposit: vi.fn() }));
vi.mock("@/lib/template-sync", () => ({ depositMemoryToTemplate: sent.deposit, depositSkillToLibrary: vi.fn() }));

import { setLocale } from "@/lib/i18n";
import { setTeamProjects } from "@/state/team-projects";
import { DepositMemoryButton } from "./deposit";

const bride: TeamProjectWire = {
  id: "p1", name: "The bride", folder: "/dramas/The bride", section: "The bride", template: { id: "urban", name: "Urban", version: 2 },
  leadBotId: "lead", createdAt: 1, folderState: "ready", botIds: ["lead", "writer"],
};

let container: HTMLDivElement, root: Root;
const buttons = () => [...container.querySelectorAll("button")].map((button) => button.textContent);
const draw = async (botId: string) => { await act(async () => root.render(createElement(DepositMemoryButton, { botId, path: "memory/cast.md" }))); };
const click = async (label: string, within = "") => {
  await act(async () => [...container.querySelectorAll<HTMLElement>(`${within} button`)].find((button) => button.textContent === label)!.click());
};

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  setLocale("en");
  sent.deposit.mockReset().mockResolvedValue({ id: "urban", name: "Urban", version: 3 });
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

describe("adding a memory note to the template", () => {
  it("is offered for a project's bot, and sends that bot's note once the person confirms", async () => {
    await draw("writer");
    expect(buttons()).toEqual(["Add to template"]);

    await click("Add to template");
    expect(sent.deposit).not.toHaveBeenCalled();
    expect(container.querySelector('[role="dialog"]')?.textContent).toContain("memory/cast.md");
    await click("Add to template", '[role="dialog"]');

    expect(sent.deposit).toHaveBeenCalledWith("writer", "memory/cast.md");
  });

  it("is not offered for a bot outside projects, which has no template", async () => {
    await draw("pepper");
    expect(buttons()).toEqual([]);
  });
});
