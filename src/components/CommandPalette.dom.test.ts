// @vitest-environment happy-dom
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "@/lib/i18n";
import type { Bot } from "@/state/store";
import { setTeamProjects } from "@/state/team-projects";
import type { TeamProjectWire } from "../../shared/team-projects";

const fixture = vi.hoisted(() => ({ dispatch: vi.fn() }));
vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return {
    ...original,
    api: vi.fn(async () => ({ hits: [] })),
    useStore: () => ({ state: { ...original.initialState, bots, groups: [] }, dispatch: fixture.dispatch }),
  };
});

import { CommandPalette, openCommandPalette } from "./CommandPalette";

const bot = (id: string, name: string, title: string, section: string, more: Partial<Bot> = {}): Bot => ({
  id, threadId: `${id}-thread`, name, title, description: "", color: "blue", notifications: false, unread: false,
  busy: false, messages: [], section, modelSelection: { instanceId: "claude", model: "fake" }, ...more,
});
const bots: Bot[] = [
  bot("maus", "Maus", "", "", { defaultBot: {} }),
  bot("writer", "编剧", "写每一集的剧本", "剧组"),
  bot("writer-copy", "编剧", "写每一集的剧本", "雨夜新娘"),
  bot("helper", "Helper", "", ""),
];
const project: TeamProjectWire = {
  id: "bride", name: "雨夜新娘", folder: "/projects/雨夜新娘", section: "雨夜新娘", team: { key: "crew", name: "剧组" },
  leadBotId: "writer-copy", createdAt: 1, folderState: "ready", botIds: ["writer-copy"], follows: { "writer-copy": "writer" },
};

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  setTeamProjects({ root: "/projects", projects: [project] });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  flushSync(() => root.unmount());
  host.remove();
  setTeamProjects(null);
  vi.clearAllMocks();
});

function open() {
  flushSync(() => root.render(createElement(CommandPalette)));
  flushSync(() => openCommandPalette());
  return document.querySelector<HTMLInputElement>('[role="dialog"] input')!;
}

function type(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  flushSync(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function press(input: HTMLInputElement, key: string) {
  flushSync(() => input.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })));
}

const entries = () => [...document.querySelectorAll<HTMLElement>("[data-palette-entry]")].map((row) => row.dataset.paletteEntry);
const home = (entry: string) => {
  const label = document.querySelector(`[data-palette-entry="${entry}"] [data-palette-home]`);
  return label && { text: label.textContent, title: label.getAttribute("title") };
};

describe("Command palette bots", () => {
  it("says where a team bot and its copy in a project live when both have the same name and title", () => {
    type(open(), "编剧");
    expect(entries()).toEqual(["bot:writer", "bot:writer-copy"]);
    expect(home("bot:writer")).toEqual({ text: "剧组", title: "剧组" });
    expect(home("bot:writer-copy")).toEqual({ text: "雨夜新娘", title: "雨夜新娘" });
  });

  it("leaves the main bot unlabelled and puts a bot in no department in the general one", () => {
    open();
    expect(entries()).toEqual(["bot:maus", "bot:writer", "bot:writer-copy", "bot:helper"]);
    expect(home("bot:maus")).toBeNull();
    expect(home("bot:helper")?.text).toBe(t("teamSettings.general"));
  });

  it("moves to the copy with the arrow key and opens it with Enter", () => {
    const input = open();
    type(input, "编剧");
    press(input, "ArrowDown");
    press(input, "Enter");
    expect(fixture.dispatch).toHaveBeenCalledWith({ type: "select", id: "writer-copy" });
  });
});
