import { basename, dirname, join, resolve } from "node:path";

import type { TeamProjectProposal, TeamProjectProposalResult } from "../shared/team-project-proposal.ts";
import {
  TEAM_PROJECT_NAME_MAX, isTeamProjectName, type CreateTeamProjectResult, type ProjectTeamUnusable, type ProjectTeamWire, type TeamProjectRefusal,
  type TeamProjectsApi,
} from "../shared/team-projects.ts";
import type { OptionCardData } from "../shared/wire.ts";
import { newId } from "./contracts.ts";
import type { CoordinateBotsCall } from "./coordinator.ts";
import { intlLocale } from "./language.ts";
import type { PeerDeliveryReceipt } from "./peer-delivery.ts";
import { serverLine, type ServerLineKey } from "./server-lines.ts";
import { findProjectTeam, teamRevision } from "./team-projects/teams.ts";
import { coordinateMessageMax, tooLongRefusal } from "./too-long.ts";
import { userError } from "./user-errors.ts";

export const LIST_PROJECT_TEAMS_TOOL = "list_project_teams";
export const PROPOSE_TEAM_PROJECT_TOOL = "propose_team_project";

/** What the proposals ask of projects. */
export interface TeamProjectBackends {
  projects: Pick<TeamProjectsApi, "create" | "teams">;
  /** The folder new projects go in; null until the person chooses one. */
  projectsRoot(): string | null;
}

type Refusal = TeamProjectRefusal | "team_changed" | "root_changed";
type Decision = "card-shown" | "user-approved" | "user-denied";
type Created = Extract<TeamProjectProposalResult, { state: "created" }>;
type MainBotDecision = Exclude<TeamProjectProposalResult, Created>;
type Outcome = { result: TeamProjectProposalResult } & Partial<Pick<TeamProjectProposal, "name" | "folder">>;
type CardLine = { id: string; card?: OptionCardData };
type Respond = { status: number; body: Record<string, unknown> };

const DECISION_WORDS_ROOM = 4000;
/** The request reaches the main bot inside the decision and the lead inside one hand-over: it fits both with room to spare. */
export const TEAM_PROJECT_BRIEF_MAX = coordinateMessageMax - DECISION_WORDS_ROOM;

const NO_ROOT = "No folder for projects is chosen yet, so no project can be made. Tell the person to choose one in Settings, under Data, and to ask you again afterwards.";
const PROPOSE_A_TEAM = "propose a new team with propose_team_setup first, with one of its bots appointed Chief of Staff, and propose the project once the person has confirmed that team. Never make bots for it with create_bot.";
const NO_TEAMS = `There is no team a project can be made from yet. Do not propose a project now: ${PROPOSE_A_TEAM}`;
const CONTEXT_SHOWN = 400;
const BAD_NAME = `The project's name is also its folder's name: give one short name of at most ${TEAM_PROJECT_NAME_MAX} characters, without / \\ : * ? " < > | and without a dot at the start or the end.`;
const PROPOSED = "A card with Create and Cancel is now in the chat. Nothing is made until the person presses Create: say so in one short line and end your turn. On Create the app makes the project and hands the request to its lead itself, so you never hand it over; you hear back only if they press Cancel or the project cannot be made. If they tell you what to change instead, call propose_team_project again; the earlier card then stops working.";

const REFUSED: Record<Refusal, { line: ServerLineKey; next: string }> = {
  no_root: { line: "server.teamProjectProposal.refused.noRoot", next: NO_ROOT },
  root_missing: { line: "server.teamProjectProposal.refused.rootMissing", next: "The folder for projects is not there, as when its drive is not connected. Tell the person, and propose again once they say it is back." },
  bad_name: { line: "server.teamProjectProposal.refused.badName", next: `${BAD_NAME} Propose again under such a name.` },
  name_taken: { line: "server.teamProjectProposal.refused.nameTaken", next: "A project or a department already has that name. Propose again under another name; ask the person which if you cannot tell." },
  folder_exists: { line: "server.teamProjectProposal.refused.folderExists", next: "The folder for projects already holds a folder of that name. Propose again under another name; ask the person which if you cannot tell." },
  no_team: { line: "server.teamProjectProposal.refused.noTeam", next: "No team has that name now. Read list_project_teams again and propose with a team that is there." },
  team_unusable: { line: "server.teamProjectProposal.refused.teamUnusable", next: "No project can be made from that team now. Read list_project_teams again: it says why." },
  team_changed: { line: "server.teamProjectProposal.refused.teamChanged", next: "The team changed after the card was made, so the person had not seen the team as it is now. Read list_project_teams again and propose once more." },
  root_changed: { line: "server.teamProjectProposal.refused.rootChanged", next: "The folder for projects was changed after the card was made, so the person had not seen where the project would go. Propose once more." },
  failed: { line: "server.teamProjectProposal.refused.failed", next: "Tell the person what went wrong in plain words, and offer to try again." },
};
const CARD_SAYS_WHY = " The card already tells the person why, so keep your own words short.";

const isRefusal = (code: string): code is Refusal => Object.hasOwn(REFUSED, code);

const UNUSABLE: Record<ProjectTeamUnusable, (team: string) => string> = {
  empty: (team) => `"${team}" has no bots yet, so no project can be made from it. To use it, propose bots for it with propose_team_setup, one of them appointed Chief of Staff.`,
  no_chief: (team) => `"${team}" has no Chief of Staff to lead a project, so none can be made from it. To use it, propose appointing one of its bots Chief of Staff with propose_team_setup.`,
  main_bot_chief: (team) => `You are the Chief of Staff of "${team}", and you belong to no team, so no project can be made from it. To use it, propose appointing one of its own bots Chief of Staff with propose_team_setup.`,
};

function contextLine(context: string): string {
  const text = context.replace(/\s+/g, " ").trim();
  if (!text) return "(none)";
  return text.length > CONTEXT_SHOWN ? `${text.slice(0, CONTEXT_SHOWN - 1)}…` : text;
}

function teamLines(teams: readonly ProjectTeamWire[]): string {
  return teams.map((team) => {
    if (team.unusable) return `- "${team.name}": cannot be used. ${UNUSABLE[team.unusable](team.name)}`;
    return [
      `- "${team.name}"`,
      `  Context: ${contextLine(team.context)}`,
      `  Chief of Staff: ${team.chief!.name}${team.chief!.title ? ` (${team.chief!.title})` : ""}`,
      `  Members: ${team.members.map((member) => `${member.name}: ${member.title || "(no title)"}`).join("; ")}`,
    ].join("\n");
  }).join("\n");
}

/** What the main bot's parked turn still has to hear about its card: Cancel or a refusal. A project that was made needs no
 * turn of the main bot, since the server hands the request to the project's lead. */
export function mainBotDecision(proposal: TeamProjectProposal | undefined): MainBotDecision | undefined {
  return proposal?.result?.state === "created" ? undefined : proposal?.result;
}

/** What the main bot hears once its card is answered. Only a model reads it. */
export function teamProjectDecisionText(proposal: TeamProjectProposal, result: MainBotDecision): string {
  const head = `MagicBot project decision ${proposal.requestId}:`;
  if (result.state === "cancelled") {
    return `${head} the person pressed Cancel, so no project was made. Do not propose it again unless they ask. If they tell you what to change, call propose_team_project again with the change.`;
  }
  const code = isRefusal(result.code) ? result.code : "failed";
  return `${head} the person pressed Create, but the project "${proposal.name}" was not made (${result.code}: ${result.error}). ${REFUSED[code].next}${code === "failed" ? "" : CARD_SAYS_WHY}`;
}

export class TeamProjectProposalError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export interface TeamProjectProposalOptions {
  store: {
    messagesFor(threadId: string): readonly CardLine[];
    appendMessage(threadId: string, message: { role: "bot"; kind: "options"; card: OptionCardData }): { id: string };
    patchMessage(threadId: string, messageId: string, patch: { card: OptionCardData }): unknown;
  };
  backends: TeamProjectBackends;
  botName(botId: string): string | undefined;
  /** Hands the decision to the turn parked on this card; false when none took it. */
  answer(threadId: string, messageId: string, text: string): boolean;
  /** A newer card replaced `from`: the turn parked on it waits on `to`. */
  follow(threadId: string, from: string, to: string): void;
  /** Ends the turn parked on this card without waking it. */
  release(threadId: string, messageId: string): void;
  /** coordinate_bots for `from`, made by the server while no turn of that bot runs. */
  handOff(from: { botId: string; threadId: string }, call: CoordinateBotsCall): Promise<Respond>;
  /** Why this bot takes no new work now, in the person's words; null when it can take work. */
  held(botId: string, language: string | undefined): string | null;
  decide(row: { threadId: string; requestId: string; botId: string; summary: string; decision: Decision }): void;
  language?(threadId: string): string | undefined;
}

export class TeamProjectProposalService {
  private readonly resolving = new Set<string>();
  private readonly options: TeamProjectProposalOptions;
  constructor(options: TeamProjectProposalOptions) { this.options = options; }

  teamsText(): string {
    const teams = this.options.backends.projects.teams();
    if (!teams.some((team) => !team.unusable)) return teams.length ? `${NO_TEAMS}\n${teamLines(teams)}` : NO_TEAMS;
    return [
      `Teams (${teams.length}). A project gets copies of one team's bots, led by the copy of its Chief of Staff. Pick the team whose context and members fit what the person wants; propose_team_project takes its name.`,
      teamLines(teams),
      `When no team fits, do not propose a project yet: ${PROPOSE_A_TEAM}`,
    ].join("\n");
  }

  /** The bot's earlier open proposal in this conversation is superseded, so only its newest one can be answered. */
  propose(input: { botId: string; threadId: string; name: string; team: string; brief: string }): { requestId: string; messageId: string; text: string } {
    const { store, backends } = this.options;
    const root = backends.projectsRoot();
    if (root === null) throw new TeamProjectProposalError(NO_ROOT, 409);
    const teams = backends.projects.teams();
    const team = findProjectTeam(teams, input.team);
    if (!team) throw new TeamProjectProposalError(teams.length ? `No team is called "${input.team}". The teams there are:\n${teamLines(teams)}` : NO_TEAMS, 404);
    if (team.unusable) throw new TeamProjectProposalError(UNUSABLE[team.unusable](team.name), 409);
    const name = input.name.normalize("NFC").trim();
    const base = resolve(root);
    const folder = join(base, name);
    // Security: the card shows this folder, so a name that is not one folder's name would show a place `create` never checks.
    if (!isTeamProjectName(name) || basename(folder) !== name || dirname(folder) !== base) throw new TeamProjectProposalError(BAD_NAME, 400);
    const brief = input.brief.trim();
    if (!brief) throw new TeamProjectProposalError("Say what the person wants made in request: it is handed to the project's lead.", 400);
    if (brief.length > TEAM_PROJECT_BRIEF_MAX) {
      throw new TeamProjectProposalError(tooLongRefusal("request", TEAM_PROJECT_BRIEF_MAX, "Say what the person wants in fewer words, then call propose_team_project again."), 400);
    }

    const replaced: string[] = [];
    for (const line of store.messagesFor(input.threadId)) {
      const card = line.card;
      if (!card?.teamProjectProposal || card.teamProjectProposal.botId !== input.botId || card.answered || card.dismissed || card.expired) continue;
      store.patchMessage(input.threadId, line.id, { card: { ...card, expired: true, options: [] } });
      replaced.push(line.id);
    }
    const requestId = newId();
    const language = this.language(input.threadId);
    const members = new Intl.ListFormat(intlLocale(language), { type: "conjunction" }).format(team.members.map((member) => member.name));
    const proposal: TeamProjectProposal = {
      requestId, botId: input.botId, threadId: input.threadId, name, folder,
      team: { name: team.name, chief: team.chief!, members: team.members, revision: teamRevision(team) },
      brief, createdAt: Date.now(),
    };
    const card: OptionCardData = {
      title: serverLine(language, "server.teamProjectProposal.card.title", { name }),
      subtitle: [folder, serverLine(language, "server.teamProjectProposal.card.team", { team: team.name, members })].join("\n"),
      options: ["Create", "Cancel"], requestId, tool: PROPOSE_TEAM_PROJECT_TOOL, fixedOptions: true, teamProjectProposal: proposal,
    };
    const message = store.appendMessage(input.threadId, { role: "bot", kind: "options", card });
    for (const earlier of replaced) this.options.follow(input.threadId, earlier, message.id);
    this.options.decide({ threadId: input.threadId, requestId, botId: input.botId, summary: `${card.title}\n${card.subtitle}`, decision: "card-shown" });
    return { requestId, messageId: message.id, text: PROPOSED };
  }

  /** Null when no project card has this id. */
  async respond(args: { threadId: string; requestId: string; behavior: string }, ownerReview: boolean): Promise<Respond | null> {
    const message = this.options.store.messagesFor(args.threadId).find((line) => line.card?.requestId === args.requestId && line.card.teamProjectProposal);
    const card = message?.card, proposal = card?.teamProjectProposal;
    if (!message || !card || !proposal) return null;
    if (args.behavior !== "allow" && args.behavior !== "deny") return { status: 400, body: { error: "Answer with Create or Cancel." } };
    if (args.behavior === "allow" && !ownerReview) return { status: 403, body: userError("serverError.teamProjectProposal.ownerCreates") };
    const duplicate = Boolean(card.answered || card.dismissed || card.expired);
    let settled = proposal;
    if (!duplicate) {
      if (this.resolving.has(proposal.requestId)) return { status: 409, body: userError("serverError.teamProjectProposal.beingCreated") };
      this.resolving.add(proposal.requestId);
      let outcome: Outcome;
      let note: string | undefined;
      try {
        outcome = args.behavior === "deny" ? { result: { state: "cancelled" } } : await this.create(proposal);
        if (outcome.result.state === "created") {
          this.options.release(args.threadId, message.id);
          note = await this.handOver({ ...proposal, ...outcome }, outcome.result);
        }
      } finally {
        this.resolving.delete(proposal.requestId);
      }
      settled = this.record(args.threadId, message.id, { ...proposal, ...outcome }, note);
      this.options.decide({ threadId: args.threadId, requestId: proposal.requestId, botId: proposal.botId, summary: `${card.title}\n${card.subtitle}`,
        decision: args.behavior === "allow" ? "user-approved" : "user-denied" });
    }
    if (mainBotDecision(settled) && !settled.resumed) this.resume(args.threadId, message.id, (text) => this.options.answer(args.threadId, message.id, text));
    return { status: 200, body: { ok: true, outcome: settled.result?.state === "created" ? "allowed-once" : "rejected", ...(settled.result ? { result: settled.result } : {}), alreadySettled: duplicate } };
  }

  decided(threadId: string, messageId: string): boolean {
    return Boolean(mainBotDecision(this.options.store.messagesFor(threadId).find((line) => line.id === messageId)?.card?.teamProjectProposal));
  }

  /** Hands the card's decision to a parked turn; true once that turn took it. A restart calls it again for a card
   * answered while no turn could take it. */
  resume(threadId: string, messageId: string, answer: (text: string) => boolean): boolean {
    const card = this.options.store.messagesFor(threadId).find((line) => line.id === messageId)?.card, proposal = card?.teamProjectProposal;
    const decision = mainBotDecision(proposal);
    if (!card || !proposal || !decision || !answer(teamProjectDecisionText(proposal, decision))) return false;
    if (!proposal.resumed) this.options.store.patchMessage(threadId, messageId, { card: { ...card, teamProjectProposal: { ...proposal, resumed: true } } });
    return true;
  }

  /** The request goes to the new project's lead as the main bot's coordinate_bots hand-off: in a new thread named after
   * the project, and the lead's turn starts. Returns the card's note when the lead did not get it. */
  private async handOver(proposal: TeamProjectProposal, made: Created): Promise<string | undefined> {
    const sent = await this.options.handOff({ botId: proposal.botId, threadId: proposal.threadId },
      { botIds: [made.leadBotId], message: proposal.brief, thread: "new", title: proposal.name, reply: "none", rework: false, consult: false }).catch(() => undefined);
    const receipt = (sent?.body.receipts as PeerDeliveryReceipt[] | undefined)?.[0];
    if (sent?.status === 200 && receipt && receipt.outcome !== "failed") return undefined;
    const language = this.language(proposal.threadId);
    const lead = made.leadName || proposal.team?.chief.name || "";
    const why = this.options.held(made.leadBotId, language);
    return why ? serverLine(language, "server.teamProjectProposal.handOver.held", { lead, why }) : serverLine(language, "server.teamProjectProposal.handOver.failed", { lead });
  }

  /** Whether new projects now go somewhere else than the card said. A list that cannot be read is `create`'s to report. */
  private rootMoved(proposal: TeamProjectProposal): boolean {
    try {
      const root = this.options.backends.projectsRoot();
      return root !== null && resolve(root) !== dirname(proposal.folder);
    } catch {
      return false;
    }
  }

  /** Security: Create makes what the card showed or nothing. A team whose name, Chief or members changed, or another
   * folder for projects, refuses it. */
  private async create(proposal: TeamProjectProposal): Promise<Outcome> {
    const { backends } = this.options;
    const refused = (code: Refusal, error: string): Outcome => ({ result: { state: "refused", code, error } });
    if (!proposal.team) return refused("team_changed", "the card names a team template, and projects are made from teams now");
    const team = findProjectTeam(backends.projects.teams(), proposal.team.name);
    if (!team) return refused("no_team", "no team has that name now");
    if (teamRevision(team) !== proposal.team.revision) return refused("team_changed", "the team's name, Chief of Staff or members changed after the card was made");
    if (this.rootMoved(proposal)) return refused("root_changed", "the folder for projects was changed after the card was made");
    let made: CreateTeamProjectResult;
    try {
      made = await backends.projects.create({ name: proposal.name, team: team.name });
    } catch (error) {
      made = { error: error instanceof Error ? error.message : String(error), code: "failed" };
    }
    if ("code" in made) return refused(made.code, made.error);
    const { id, name, folder, leadBotId } = made.project;
    return { name, folder, result: { state: "created", projectId: id, leadBotId, leadName: this.options.botName(leadBotId) ?? "" } };
  }

  private record(threadId: string, messageId: string, settled: TeamProjectProposal & { result: TeamProjectProposalResult }, note?: string): TeamProjectProposal {
    const { result } = settled;
    const current = this.options.store.messagesFor(threadId).find((line) => line.id === messageId)?.card;
    if (current) {
      const closed = result.state === "created" ? { answered: "allow", ...(note ? { held: note } : {}) }
        : result.state === "cancelled" ? { answered: "deny" }
        : { expired: true, options: [], held: serverLine(this.language(threadId), REFUSED[isRefusal(result.code) ? result.code : "failed"].line, { name: settled.name }) };
      this.options.store.patchMessage(threadId, messageId, { card: { ...current, ...closed, teamProjectProposal: settled } });
    }
    return settled;
  }

  private language(threadId: string): string | undefined {
    return this.options.language?.(threadId);
  }
}
