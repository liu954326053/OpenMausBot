// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { TeamProjectWire } from "../../../shared/team-projects";
import { loadLocale, setLocale } from "@/lib/i18n";
import { forgetDisclosuresForTests } from "@/lib/remembered-disclosure";
import { splitEpisodes } from "@/lib/team-projects";
import type { Bot } from "@/state/store";
import { SidebarProjectEpisodes } from "./SidebarProjectEpisodes";

const bot = (id: string, extra: Partial<Bot> = {}): Bot => ({
  id, threadId: `${id}-thread`, name: id, title: "", description: "", notifications: true,
  color: "green", unread: false, modelSelection: { instanceId: "fake", model: "m" }, messages: [], ...extra,
});
const NUMBERS = Array.from({ length: 60 }, (_, index) => index + 1);
const code = (number: number) => `EP${String(number).padStart(2, "0")}`;
const drama = (id: string): Pick<TeamProjectWire, "id" | "episodeBots"> => ({
  id,
  episodeBots: Object.fromEntries(NUMBERS.flatMap((number) => [
    [`${id}-shots-${number}`, { number, job: "storyboard" as const }],
    [`${id}-post-${number}`, { number, job: "post" as const }],
  ])),
});
const crew = (id: string) => NUMBERS.flatMap((number) => [
  bot(`${id}-shots-${number}`, { name: `Frame ${code(number)}`, title: "Storyboard artist" }),
  bot(`${id}-post-${number}`, { name: `Cut ${code(number)}` }),
]);

const lamp = drama("lamp");
let bots = crew("lamp");
let simple = true;
let openChat: string | null = null;
const onOpenBot = vi.fn();

let container: HTMLDivElement, root: Root;
const q = (selector: string) => document.body.querySelector<HTMLElement>(selector);
const all = (selector: string) => [...document.body.querySelectorAll<HTMLElement>(selector)];
const episodesRow = () => q("[data-sidebar-project-episodes-row]")!;
const episodeRow = (number: number) => q(`[data-sidebar-project-episode-row="${number}"]`)!;
const episodeRows = () => all("[data-sidebar-project-episode-row]");
const botRow = (id: string) => q(`[data-sidebar-project-bot="${id}"]`);
const botRows = () => all("[data-sidebar-project-bot]").map((one) => one.dataset.sidebarProjectBot);
const mark = (row: HTMLElement) => row.querySelector<HTMLElement>("[data-section-mark]");
const controlled = (row: HTMLElement) => document.getElementById(row.getAttribute("aria-controls")!)!;
const click = async (element: HTMLElement | null) => {
  expect(element).toBeTruthy();
  await act(async () => element!.click());
};

async function draw(project = lamp, shown = bots): Promise<void> {
  const { episodes } = splitEpisodes(project, shown);
  await act(async () => root.render(createElement(SidebarProjectEpisodes, { key: project.id, project, episodes, simple, gap: "gap-0.5", openChat, onOpenBot })));
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  setLocale("en");
  forgetDisclosuresForTests();
  bots = crew("lamp");
  simple = true;
  openChat = null;
  onOpenBot.mockClear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("a drama's episodes in the sidebar", () => {
  it("are one folded row, Episodes, with nothing drawn under it", async () => {
    await draw();
    expect([episodesRow().textContent, episodesRow().getAttribute("aria-expanded")]).toEqual(["Episodes", "false"]);
    expect(controlled(episodesRow()).hidden).toBe(true);
    expect([episodeRows(), botRows()]).toEqual([[], []]);
  });

  it("unfold into one folded row per episode, in order", async () => {
    await draw();
    await click(episodesRow());
    expect([episodesRow().getAttribute("aria-expanded"), controlled(episodesRow()).hidden]).toEqual(["true", false]);
    expect(episodeRows().map((row) => row.textContent)).toEqual(NUMBERS.map(code));
    expect(new Set(episodeRows().map((row) => row.getAttribute("aria-expanded")))).toEqual(new Set(["false"]));
    expect(botRows()).toEqual([]);
    expect(controlled(episodeRow(1)).getAttribute("aria-label")).toBe("EP01");
  });

  it("unfold an episode into its storyboard bot and its post bot, each with its role after its name, a click opening the bot's conversation", async () => {
    await draw();
    await click(episodesRow());
    await click(episodeRow(2));
    expect([episodeRow(2).getAttribute("aria-expanded"), botRows()]).toEqual(["true", ["lamp-shots-2", "lamp-post-2"]]);
    const role = (id: string) => botRow(id)!.querySelector("[data-sidebar-project-bot-title]")?.textContent;
    expect([botRow("lamp-shots-2")!.textContent, role("lamp-shots-2"), role("lamp-post-2")]).toEqual(["Frame EP02Storyboard artist", "Storyboard artist", "Post"]);
    expect(botRow("lamp-post-2")!.title).toBe("Cut EP02 · Post");
    await click(botRow("lamp-post-2"));
    expect(onOpenBot.mock.calls.map(([one]) => (one as Bot).id)).toEqual(["lamp-post-2"]);
    await click(episodeRow(2));
    expect([episodeRow(2).getAttribute("aria-expanded"), botRows()]).toEqual(["false", []]);
  });

  it("stay unfolded as the person left them while the app runs, each project's apart", async () => {
    await draw();
    await click(episodesRow());
    await click(episodeRow(3));
    await act(async () => root.unmount());
    root = createRoot(container);
    await draw();
    expect([episodesRow().getAttribute("aria-expanded"), episodeRow(3).getAttribute("aria-expanded"), botRows()]).toEqual(["true", "true", ["lamp-shots-3", "lamp-post-3"]]);
    await draw(drama("dawn"), crew("dawn"));
    expect([episodesRow().getAttribute("aria-expanded"), episodeRows()]).toEqual(["false", []]);
  });

  it("mark a folded episode, and the folded Episodes row, with what goes on among their bots", async () => {
    bots = crew("lamp").map((one) => (one.id === "lamp-shots-3" ? { ...one, unread: true } : one.id === "lamp-post-5" ? { ...one, activity: "waiting-on-you" as const } : one));
    await draw();
    expect([mark(episodesRow())?.dataset.sectionMark, mark(episodesRow())?.title]).toEqual(["waiting", "1 waiting for you, 1 unread"]);
    await click(episodesRow());
    expect(mark(episodesRow())).toBeNull();
    expect([1, 3, 5].map((number) => mark(episodeRow(number))?.dataset.sectionMark ?? null)).toEqual([null, "unread", "waiting"]);
    await click(episodeRow(3));
    expect([mark(episodeRow(3)), mark(botRow("lamp-shots-3")!)?.dataset.sectionMark]).toEqual([null, "unread"]);
  });

  it("mark the row of the conversation open that the person can see: Episodes, its episode, then its own", async () => {
    openChat = "lamp-post-7";
    await draw();
    const current = () => [episodesRow(), episodeRows().find((row) => row.dataset.sidebarProjectEpisodeRow === "7"), botRow("lamp-post-7")]
      .map((row) => row?.getAttribute("aria-current") ?? null);
    expect(current()).toEqual(["page", null, null]);
    await click(episodesRow());
    expect(current()).toEqual([null, "page", null]);
    expect(episodeRows().filter((row) => row.getAttribute("aria-current")).map((row) => row.textContent)).toEqual(["EP07"]);
    await click(episodeRow(7));
    expect(current()).toEqual([null, null, "page"]);
  });

  it("set each level further in, in Simple and in Advanced", async () => {
    const inset = (row: HTMLElement) => [...row.classList].find((name) => name.startsWith("ps-"));
    for (const [shown, expected] of [[true, ["ps-[50px]", "ps-[80px]", "ps-[92px]"]], [false, ["ps-[46px]", "ps-[74px]", "ps-[86px]"]]] as const) {
      simple = shown;
      forgetDisclosuresForTests();
      await act(async () => root.unmount());
      root = createRoot(container);
      await draw();
      await click(episodesRow());
      await click(episodeRow(1));
      expect([inset(episodesRow()), inset(episodeRow(1)), inset(botRow("lamp-shots-1")!)]).toEqual(expected);
    }
  });

  it("are named in the page's language", async () => {
    await loadLocale("zh");
    await draw();
    await click(episodesRow());
    await click(episodeRow(1));
    expect([episodesRow().textContent, botRow("lamp-post-1")!.querySelector("[data-sidebar-project-bot-title]")?.textContent]).toEqual(["分集", "后期"]);
  });
});
