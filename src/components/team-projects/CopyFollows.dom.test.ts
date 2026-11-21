// @vitest-environment happy-dom
import { createElement, type ReactElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Bot } from "@/state/store";
import type { TeamProjectWire } from "../../../shared/team-projects";

const fixture = vi.hoisted(() => ({ dispatch: vi.fn(), bots: [] as Bot[] }));
vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return {
    ...original,
    useStore: () => ({ state: { ...original.initialState, bots: fixture.bots }, dispatch: fixture.dispatch, flushBotPatches: () => Promise.resolve(null) }),
  };
});
vi.mock("../Avatar", () => ({ BotAvatar: () => null, MausAvatar: () => null }));

const { setTeamProjects } = await import("@/state/team-projects");
const { CopyFollowsNotice } = await import("./CopyFollows");
const { PanelHero } = await import("../bot-panel/PanelHero");
const { IdentitySection } = await import("../bot-settings/IdentitySection");
const { useBotSettingsDerived } = await import("../bot-settings/useBotSettingsDerived");

const bot = (id: string, name: string, extra: Partial<Bot> = {}): Bot => ({
  id, threadId: `thread-${id}`, name, title: "Writer", description: "Writes scenes", soul: "", notifications: true,
  color: "green", unread: false, messages: [], modelSelection: { instanceId: "claude", model: "claude-opus-5-5" }, ...extra,
});
const source = bot("quill", "Quill", { section: "Drama team" });
const copy = bot("quill-copy", "Quill", { section: "Bride" });
const own = bot("helper", "Helper", { section: "Bride" });
const project = (follows: Record<string, string>): TeamProjectWire => ({
  id: "bride", name: "Bride", folder: "/dramas/Bride", section: "Bride", team: { key: "team:drama", name: "Drama team" }, follows,
  leadBotId: "quill-copy", createdAt: 1, folderState: "ready", botIds: ["quill-copy", "helper"],
});

let host: HTMLDivElement;
let root: Root;
const render = (element: ReactElement) => flushSync(() => root.render(element));
const click = (element: Element | null) => {
  if (!element) throw new Error("nothing to click");
  flushSync(() => element.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 })));
};

beforeEach(() => {
  fixture.dispatch.mockReset();
  fixture.bots = [source, copy, own];
  setTeamProjects({ root: "/dramas", projects: [project({ "quill-copy": "quill" })] });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  flushSync(() => root.unmount());
  host.remove();
  setTeamProjects(null);
});

describe("a copy's settings", () => {
  it("say which bot the copy follows, and open that bot", () => {
    render(createElement(CopyFollowsNotice, { bot: copy }));
    expect(host.querySelector("[data-copy-follows]")?.textContent).toContain("Follows Quill in Drama team");
    click(host.querySelector("[data-copy-follows-open]"));
    expect(fixture.dispatch).toHaveBeenCalledWith({ type: "toggleSettings", open: true, botId: "quill" });
  });

  it("say nothing for a bot that follows nobody: one of the project's own, or a copy whose source left", () => {
    render(createElement(CopyFollowsNotice, { bot: own }));
    expect(host.querySelector("[data-copy-follows]")).toBeNull();
    setTeamProjects({ root: "/dramas", projects: [project({})] });
    render(createElement(CopyFollowsNotice, { bot: copy }));
    expect(host.querySelector("[data-copy-follows]")).toBeNull();
  });

  it("show the name, job and look without a way to change them", () => {
    const props = { bot: copy, activeState: "idle" as const, patch: vi.fn(), editorOpen: false, onToggleEditor: vi.fn(), readOnly: true };
    render(createElement(PanelHero, props));
    expect(host.querySelector("[data-panel-rename], [data-panel-label], [data-panel-avatar]")).toBeNull();
    expect(host.querySelector("#bot-settings-title")?.textContent).toBe("Quill");
    expect(host.querySelector("[data-panel-label-shown]")?.textContent).toBe("Writer");

    render(createElement(IdentitySection, { bot: copy, patch: vi.fn(), activeState: "idle", mascotMotion: null, readOnly: true }));
    const fields = [...host.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input, textarea")];
    expect(fields.map((field) => field.value)).toEqual(["Quill", "Writer", "Writes scenes"]);
    expect(fields.every((field) => field.readOnly)).toBe(true);
    expect(host.querySelector("[data-identity-avatar-shown]")).not.toBeNull();
  });

  it("send no change to what a copy follows, and every other change as before", () => {
    let patch: ReturnType<typeof useBotSettingsDerived>["patch"] = () => {};
    const Probe = ({ of }: { of: Bot }) => {
      patch = useBotSettingsDerived(of).patch;
      return null;
    };
    render(createElement(Probe, { of: copy }));
    patch({ name: "Nib", title: "Editor", soul: "Short.", color: "blue", modelSelection: { instanceId: "codex", model: "gpt" }, voice: "calm" });
    patch({ avatarUrl: "/avatar.png" });
    expect(fixture.dispatch.mock.calls).toEqual([[{ type: "updateBot", botId: "quill-copy", patch: { voice: "calm" } }]]);

    fixture.dispatch.mockReset();
    render(createElement(Probe, { of: own }));
    patch({ name: "Nib" });
    expect(fixture.dispatch).toHaveBeenCalledWith({ type: "updateBot", botId: "helper", patch: { name: "Nib" } });
  });
});
