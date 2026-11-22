// @vitest-environment happy-dom
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setLocale } from "@/lib/i18n";
import { initialState, StoreContext, type Bot, type Message, type OptionCardData } from "@/state/store";
import type { StoreValue } from "@/state/store-context";
import type { TeamProjectProposal, TeamProjectProposalResult } from "../../../shared/team-project-proposal";
import { ApprovalCard } from "../ApprovalCard";
import { approvalBlocksComposer, PendingApprovalActions, PendingApprovalPanel, pendingApprovals, spokenApprovalPrompt } from "../PendingApproval";

const listed = vi.hoisted(() => ({ side: { shown: false, projects: [] as Array<{ id: string; leadBotId?: string }> } }));
vi.mock("@/lib/use-owner-or-admin", () => ({ useOwnerOrAdmin: () => true }));
vi.mock("@/lib/cloud-guest", async (original) => ({ ...await original<typeof import("@/lib/cloud-guest")>(), useCloudGuest: () => false }));
vi.mock("@/state/team-projects", async (original) => ({ ...await original<typeof import("@/state/team-projects")>(), useTeamProjectSide: () => listed.side }));

const FOLDER = "/Users/ada/Dramas/The Swapped Bride";
const TITLE = "Create the project “The Swapped Bride”?";
const PRODUCER = { id: "src-pia", name: "Pia", title: "Runs the production" };
const proposal: TeamProjectProposal = {
  requestId: "req-project", botId: "magicbot", threadId: "thread-main", name: "The Swapped Bride", folder: FOLDER,
  team: {
    name: "Urban romance crew", chief: PRODUCER, revision: "r1",
    members: [PRODUCER, { id: "src-wen", name: "Wen", title: "Writes the episodes" }, { id: "src-sol", name: "Sol", title: "Draws the shots" }],
  },
  brief: "Make a 60-episode revenge drama.", createdAt: 1,
};
const BEFORE_TEAMS: TeamProjectProposal = {
  ...proposal, team: undefined,
  template: {
    id: "tpl-urban", name: "Urban romance crew", version: 3, genre: "CEO romance, revenge", lead: "producer",
    roles: [
      { key: "writer", name: "Wen", title: "Writes the episodes" },
      { key: "producer", name: "Pia", title: "Runs the production" },
      { key: "storyboard", name: "Sol", title: "Draws the shots" },
    ],
  },
};
const CREATED: TeamProjectProposalResult = { state: "created", projectId: "project-1", leadBotId: "bot-pia", leadName: "Pia" };

function projectCard(patch: Partial<OptionCardData> = {}, result?: TeamProjectProposalResult): Message {
  return {
    id: "project-card", role: "bot", kind: "options", at: 1,
    card: {
      title: TITLE, subtitle: `${FOLDER}\nUrban romance crew: Pia, Wen, and Sol`, options: ["Create", "Cancel"],
      requestId: "req-project", tool: "propose_team_project", fixedOptions: true,
      teamProjectProposal: result ? { ...proposal, result } : proposal, ...patch,
    },
  };
}

const magicbot = { id: "magicbot", name: "MagicBot", color: "green" } as Bot;
const pia: Bot = {
  id: "bot-pia", threadId: "pia-main", name: "Pia", title: "Runs the production", description: "", notifications: true,
  color: "pink", unread: false, messages: [], modelSelection: { instanceId: "fake", model: "test" },
  tasks: [{ threadId: "pia-main", title: "Main", createdAt: 1 }],
};

const dispatch = vi.fn();
let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  setLocale("en");
  dispatch.mockReset();
  listed.side = { shown: false, projects: [] };
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  setLocale("en");
  vi.unstubAllGlobals();
});

async function show(node: ReactNode, bots: Bot[] = [pia]): Promise<void> {
  const value = { state: { ...initialState, bots }, dispatch } as unknown as StoreValue;
  await act(async () => { root.render(createElement(StoreContext.Provider, { value }, node)); });
}
const showCard = (message: Message, bots?: Bot[]) => show(createElement(ApprovalCard, { bot: magicbot, message, threadId: "thread-main" }), bots);
const showActions = (message: Message) => show(createElement(PendingApprovalActions, {
  pending: pendingApprovals([message])[0]!, threadId: "thread-main", bot: magicbot, onCancelTurn: () => undefined,
}));
const texts = (selector: string) => [...host.querySelectorAll(selector)].map((node) => node.textContent);
const openButton = () => host.querySelector<HTMLButtonElement>("[data-team-project-open]");
const dimmed = () => Boolean(host.querySelector("[data-team-project-proposal]")?.closest(".opacity-70"));

describe("a project the main bot proposes", () => {
  it("shows what will be made: the folder, the team and its members, the Chief of Staff first as the lead", async () => {
    await showCard(projectCard());
    expect(host.textContent).toContain(TITLE);
    expect(texts("dt")).toEqual(["Project folder", "Team", "Members"]);
    expect(texts("dd").slice(0, 2)).toEqual([FOLDER, "Urban romance crew"]);
    expect(host.querySelector("dd")?.className).toContain("font-mono");
    expect(texts("li")).toEqual(["Pia (Chief of Staff)Runs the production", "WenWrites the episodes", "SolDraws the shots"]);
    expect(host.querySelector("pre")).toBeNull();
    expect(host.textContent).toContain("Waiting for your confirmation below. To change anything, just say so in the chat.");
    expect(openButton()).toBeNull();
  });

  it("leaves the message box usable while it waits, so the person can say what to change", async () => {
    expect(approvalBlocksComposer(pendingApprovals([projectCard()])[0])).toBe(false);
    const lift: Message = { id: "lift", role: "bot", kind: "options", at: 1, card: { title: "Use the lent computer?", subtitle: "", options: ["Allow", "Not now"], requestId: "req-lift", tool: "lending_lift", fixedOptions: true, lendingLift: { requestMessageId: "m1" } } };
    expect(approvalBlocksComposer(pendingApprovals([lift])[0])).toBe(true);
    expect(approvalBlocksComposer(undefined)).toBe(false);
  });

  it("does not take the keyboard from the message box, as a card that must be answered first does", async () => {
    const lift: Message = { id: "lift", role: "bot", kind: "options", at: 1, card: { title: "Use the lent computer?", subtitle: "", options: ["Allow", "Not now"], requestId: "req-lift", tool: "lending_lift", fixedOptions: true, lendingLift: { requestMessageId: "m1" } } };
    await showActions(lift);
    expect(document.activeElement?.textContent).toBe("Not now");
    await act(async () => root.render(null));
    await showActions(projectCard());
    expect(texts("button")).toEqual(["Cancel", "Create"]);
    expect(document.activeElement).toBe(document.body);
  });

  it("is answered with Create and Cancel, and with nothing else", async () => {
    const message = projectCard();
    const [pending] = pendingApprovals([message]);
    expect(pending).toMatchObject({ requestId: "req-project", tool: "propose_team_project" });
    await showActions(message);
    expect(texts("button")).toEqual(["Cancel", "Create"]);
    await act(async () => host.querySelectorAll("button")[1]!.click());
    expect(dispatch).toHaveBeenLastCalledWith(expect.objectContaining({ type: "decideRequest", threadId: "thread-main", requestId: "req-project", behavior: "allow" }));
    await act(async () => host.querySelectorAll("button")[0]!.click());
    expect(dispatch).toHaveBeenLastCalledWith(expect.objectContaining({ type: "decideRequest", threadId: "thread-main", requestId: "req-project", behavior: "deny" }));
    expect(spokenApprovalPrompt(pending!, "MagicBot")).toBe(`MagicBot: ${TITLE} Review the details and choose Create or Cancel.`);
  });

  it("asks in the card's own words where it is answered, the details one press away", async () => {
    await show(createElement(PendingApprovalPanel, { pending: pendingApprovals([projectCard()])[0]!, count: 1, index: 0, botName: "MagicBot" }));
    expect(host.textContent).toContain(TITLE);
    expect(host.querySelector("pre")?.textContent).toBe(`${FOLDER}\nUrban romance crew: Pia, Wen, and Sol`);
  });

  it("reads in Chinese", async () => {
    setLocale("zh");
    await showCard(projectCard());
    expect(texts("dt")).toEqual(["项目文件夹", "团队", "成员"]);
    expect(texts("li")[0]).toBe("Pia（参谋长）Runs the production");
    expect(host.textContent).toContain("正在等待你在下方确认。想改什么，直接在对话里说。");
    await showActions(projectCard());
    expect(texts("button")).toEqual(["取消", "创建"]);
    await showCard(projectCard({ answered: "allow" }, CREATED));
    expect(host.textContent).toContain("项目已创建，需求已交给Pia");
    expect(openButton()?.textContent).toBe("打开项目");
  });
});

describe("once the person has answered", () => {
  const listLead = () => { listed.side = { shown: true, projects: [{ id: "project-1", leadBotId: "bot-pia" }] }; };

  it("a project that was made says so and that its lead has the request, and opens on its lead's conversation", async () => {
    listLead();
    const made = projectCard({ answered: "allow" }, CREATED);
    expect(pendingApprovals([made])).toEqual([]);
    await showCard(made);
    expect(host.textContent).toContain("Project created; Pia has the request");
    expect(host.textContent).not.toContain("Waiting for your confirmation");
    expect(openButton()?.textContent).toBe("Open project");
    expect(dimmed()).toBe(false);
    await act(async () => openButton()!.click());
    expect(dispatch.mock.calls.map(([action]) => action)).toEqual([{ type: "select", id: "bot-pia" }]);
  });

  it("opens the lead's own conversation, not the thread the main bot handed the request into", async () => {
    listLead();
    const handed = { threadId: "pia-drama", title: "The Swapped Bride", createdAt: 2, openedBy: { botId: "magicbot", name: "MagicBot", at: 2 } };
    await showCard(projectCard({ answered: "allow" }, CREATED), [{ ...pia, tasks: [...pia.tasks!, handed] }]);
    await act(async () => openButton()!.click());
    expect(dispatch.mock.calls.map(([action]) => action)).toEqual([{ type: "select", id: "bot-pia" }]);
  });

  it("opens the project's canvas while the list of projects is not read yet, or while its lead is not listed", async () => {
    await showCard(projectCard({ answered: "allow" }, CREATED));
    await act(async () => openButton()!.click());
    listLead();
    await showCard(projectCard({ answered: "allow" }, CREATED), []);
    await act(async () => openButton()!.click());
    expect(dispatch.mock.calls.map(([action]) => action)).toEqual([{ type: "showProject", projectId: "project-1" }, { type: "showProject", projectId: "project-1" }]);
  });

  it("still opens a project whose lead is gone, and offers no way in once the project is gone", async () => {
    listed.side = { shown: true, projects: [{ id: "project-1" }] };
    await showCard(projectCard({ answered: "allow" }, CREATED), []);
    expect(openButton()?.getAttribute("data-team-project-open")).toBe("project-1");
    listed.side = { shown: true, projects: [] };
    await showCard(projectCard({ answered: "allow" }, CREATED));
    expect(host.textContent).toContain("Project created");
    expect(openButton()).toBeNull();
  });

  it("a project whose request did not reach its lead says why, and opens the lead's conversation to tell the lead there", async () => {
    listLead();
    const why = "The request did not reach Pia. Every bot is paused, so Pia takes no new work. Resume every bot from any bot’s menu in the sidebar. Then open the project and tell Pia what you want.";
    await showCard(projectCard({ answered: "allow", held: why }, CREATED));
    expect(host.textContent).toContain("Project created");
    expect(host.textContent).not.toContain("has the request");
    expect(host.textContent).toContain(why);
    expect(dimmed()).toBe(false);
    await act(async () => openButton()!.click());
    expect(dispatch.mock.calls.map(([action]) => action)).toEqual([{ type: "select", id: "bot-pia" }]);
  });

  it("shows a card that names a team template instead of a team, the template's lead first", async () => {
    await showCard(projectCard({ teamProjectProposal: { ...BEFORE_TEAMS, result: { ...CREATED, missingSkills: ["shot-list"] } }, answered: "allow" }));
    expect(texts("dd").slice(0, 2)).toEqual([FOLDER, "Urban romance crew"]);
    expect(texts("li")).toEqual(["Pia (Chief of Staff)Runs the production", "WenWrites the episodes", "SolDraws the shots"]);
    expect(host.textContent).toContain("Project created");
    expect(host.textContent).not.toContain("shot-list");
  });

  it("Cancel reads as cancelled", async () => {
    const cancelled = projectCard({ answered: "deny" }, { state: "cancelled" });
    expect(pendingApprovals([cancelled])).toEqual([]);
    await showCard(cancelled);
    expect(host.textContent).toContain("Cancelled");
    expect(openButton()).toBeNull();
    expect(dimmed()).toBe(true);
  });

  it("a project that could not be made reads as not created, with why", async () => {
    const why = "A project or a department is already called “The Swapped Bride”. Ask again with another name.";
    const refused = projectCard({ expired: true, options: [], held: why }, { state: "refused", code: "name_taken", error: "taken" });
    expect(pendingApprovals([refused])).toEqual([]);
    await showCard(refused);
    expect(host.textContent).toContain("Not created");
    expect(host.textContent).toContain(why);
    expect(host.textContent).not.toContain("Expired");
    expect(openButton()).toBeNull();
  });

  it("a card a newer proposal replaced says so, and can no longer be answered", async () => {
    const replaced = projectCard({ expired: true, options: [] });
    expect(pendingApprovals([replaced])).toEqual([]);
    await showCard(replaced);
    expect(host.textContent).toContain("Replaced by a newer proposal");
    expect(host.textContent).not.toContain("Expired");
  });
});
