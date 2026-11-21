// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sent = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock("@/state/api", async (original) => ({ ...await original<typeof import("@/state/api")>(), api: sent.api }));

import { setLocale } from "@/lib/i18n";
import { DepositSkillButton } from "./DepositSkillButton";

let container: HTMLDivElement, root: Root;
const dialog = () => document.body.querySelector<HTMLElement>('[role="alertdialog"]');
const click = async (label: string, within: ParentNode = document.body) => {
  await act(async () => [...within.querySelectorAll<HTMLElement>("button")].find((button) => button.textContent === label)!.click());
};

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  setLocale("en");
  sent.api.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(createElement(DepositSkillButton, { botId: "pepper", name: "cast-notes" })));
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("adding a learned skill to the skills library", () => {
  it("says what it does, and shares the skill only once the person confirms", async () => {
    sent.api.mockResolvedValue({ ok: true, shared: [] });
    await click("Add to library", container);
    expect(sent.api).not.toHaveBeenCalled();
    expect(dialog()?.textContent).toContain("Puts this bot's learned skill “cast-notes” in the skills library");

    await click("Add to library", dialog()!);

    expect(sent.api).toHaveBeenCalledWith("/api/bots/pepper/skills/cast-notes/share", { method: "POST" });
    expect(dialog()).toBeNull();
    expect(container.textContent).toBe("“cast-notes” is in the skills library.");
  });

  it("keeps the dialog open with the server's words when sharing fails", async () => {
    sent.api.mockRejectedValue(new Error("The skills library is off."));
    await click("Add to library", container);
    await click("Add to library", dialog()!);

    expect(dialog()?.querySelector('[role="alert"]')?.textContent).toBe("The skills library is off.");
    expect(container.textContent).toBe("Add to library");
  });
});
