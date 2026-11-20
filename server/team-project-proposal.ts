import { basename, dirname, join, resolve } from "node:path";

import type { TeamProjectProposal, TeamProjectProposalResult } from "../shared/team-project-proposal.ts";
import { TEAM_PROJECT_NAME_MAX, isTeamProjectName, type CreateTeamProjectResult, type TeamProjectRefusal, type TeamProjectsApi } from "../shared/team-projects.ts";
import type { TeamTemplateSummary, TemplateLibraryApi } from "../shared/template-library.ts";
import type { OptionCardData } from "../shared/wire.ts";
import { newId } from "./contracts.ts";
import { intlLocale } from "./language.ts";
import { serverLine, type ServerLineKey } from "./server-lines.ts";
import { coordinateMessageMax, tooLongRefusal } from "./too-long.ts";
import { userError } from "./user-errors.ts";

export const LIST_TEAM_TEMPLATES_TOOL = "list_team_templates";
export const PROPOSE_TEAM_PROJECT_TOOL = "propose_team_project";

/** What the proposals ask of the template library and of projects. */
export interface TeamProjectBackends {
  templates: Pick<TemplateLibraryApi, "list">;
  projects: Pick<TeamProjectsApi, "create">;
  /** The folder new projects go in; null until the person chooses one. */
  projectsRoot(): string | null;
}

type Refusal = TeamProjectRefusal | "template_changed" | "root_changed";
type Decision = "card-shown" | "user-approved" | "user-denied";
type Outcome = { result: TeamProjectProposalResult } & Partial<Pick<TeamProjectProposal, "name" | "folder">>;
type CardLine = { id: string; card?: OptionCardData };
type Respond = { status: number; body: Record<string, unknown> };

const DECISION_WORDS_ROOM = 4000;
/** The request reaches the main bot inside the decision and the lead inside one hand-over: it fits both with room to spare. */
export const TEAM_PROJECT_BRIEF_MAX = coordinateMessageMax - DECISION_WORDS_ROOM;

const NO_ROOT = "No folder for projects is chosen yet, so no project can be made. Tell the person to choose one in Settings, under Data, and to ask you again afterwards.";
const NO_TEMPLATES = "There are no team templates yet, so no project can be proposed. Tell the person so, and that team templates are made in Settings, under Templates. You cannot make or change one.";
const BAD_NAME = `The project's name is also its folder's name: give one short name of at most ${TEAM_PROJECT_NAME_MAX} characters, without / \\ : * ? " < > | and without a dot at the start or the end.`;
const PROPOSED = "A card with Create and Cancel is now in the chat. Nothing is made until the person presses Create: say so in one short line, end your turn and wait for the decision. If they tell you what to change instead, call propose_team_project again; the earlier card then stops working.";

const REFUSED: Record<Refusal, { line: ServerLineKey; next: string }> = {
  no_root: { line: "server.teamProjectProposal.refused.noRoot", next: NO_ROOT },
  root_missing: { line: "server.teamProjectProposal.refused.rootMissing", next: "The folder for projects is not there, as when its drive is not connected. Tell the person, and propose again once they say it is back." },
  bad_name: { line: "server.teamProjectProposal.refused.badName", next: `${BAD_NAME} Propose again under such a name.` },
  name_taken: { line: "server.teamProjectProposal.refused.nameTaken", next: "A project or a department already has that name. Propose again under another name; ask the person which if you cannot tell." },
  folder_exists: { line: "server.teamProjectProposal.refused.folderExists", next: "The folder for projects already holds a folder of that name. Propose again under another name; ask the person which if you cannot tell." },
  no_template: { line: "server.teamProjectProposal.refused.noTemplate", next: "That team template is gone. Read list_team_templates again and propose with one that is there." },
  template_changed: { line: "server.teamProjectProposal.refused.templateChanged", next: "The team template was saved again after the card was made, so the person had not seen the team as it is now. Read list_team_templates again and propose once more." },
  root_changed: { line: "server.teamProjectProposal.refused.rootChanged", next: "The folder for projects was changed after the card was made, so the person had not seen where the project would go. Propose once more." },
  failed: { line: "server.teamProjectProposal.refused.failed", next: "Tell the person what went wrong in plain words, and offer to try again." },
};
const CARD_SAYS_WHY = " The card already tells the person why, so keep your own words short.";

const isRefusal = (code: string): code is Refusal => Object.hasOwn(REFUSED, code);

function rolesLeadFirst(template: Pick<TeamTemplateSummary, "lead" | "roles">): TeamTemplateSummary["roles"] {
  return [...template.roles.filter((role) => role.key === template.lead), ...template.roles.filter((role) => role.key !== template.lead)];
}

function templateLines(templates: readonly TeamTemplateSummary[]): string {
  return templates.map((template) => [
    `- id ${template.id}: "${template.name}"`,
    `  Suits: ${template.genre.trim() || "(not said)"}`,
    `  Roles: ${rolesLeadFirst(template).map((role) => `${role.name}${role.key === template.lead ? " (lead)" : ""}: ${role.title}`).join("; ")}`,
  ].join("\n")).join("\n");
}

/** What the main bot hears once its card is answered. Only a model reads it. */
export function teamProjectDecisionText(proposal: TeamProjectProposal): string {
  const head = `MagicBot project decision ${proposal.requestId}:`;
  const result = proposal.result;
  if (!result) return `${head} not answered yet.`;
  if (result.state === "cancelled") {
    return `${head} the person pressed Cancel, so no project was made. Do not propose it again unless they ask. If they tell you what to change, call propose_team_project again with the change.`;
  }
  if (result.state === "refused") {
    const code = isRefusal(result.code) ? result.code : "failed";
    return `${head} the person pressed Create, but the project "${proposal.name}" was not made (${result.code}: ${result.error}). ${REFUSED[code].next}${code === "failed" ? "" : CARD_SAYS_WHY}`;
  }
  const lead = result.leadName ? `${result.leadName} (bot id "${result.leadBotId}")` : `the bot with id "${result.leadBotId}"`;
  return [
    `${head} the person pressed Create, and the project "${proposal.name}" now exists in ${proposal.folder}, with the team of the template "${proposal.template.name}". Its lead is ${lead}.`,
    "Do these two things now, in this order:",
    `1. Hand the person's request to the lead: call coordinate_bots with bot_ids ["${result.leadBotId}"], reply "none", thread "new", title ${JSON.stringify(proposal.name)}, and the request below as the message, word for word, with anything else the person told you that the team needs. Reach only the lead, not the other members: the lead runs the project. Do not do the work yourself.`,
    `2. Then tell the person, in one or two short sentences, that the project is ready and its lead has their request. Write the project in that reply as #${proposal.name}, with a space before and after it: the app turns that into a link that opens the lead's chat on their request. Open project on the card opens the same chat.`,
    ...(result.missingSkills.length ? [`The template names skills the skills library does not hold, so the team works without them: ${result.missingSkills.join(", ")}. Say so.`] : []),
    "Do not propose this project again.",
    "The person's request:",
    proposal.brief,
  ].join("\n");
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
  decide(row: { threadId: string; requestId: string; botId: string; summary: string; decision: Decision }): void;
  language?(threadId: string): string | undefined;
}

export class TeamProjectProposalService {
  private readonly resolving = new Set<string>();
  private readonly options: TeamProjectProposalOptions;
  constructor(options: TeamProjectProposalOptions) { this.options = options; }

  templatesText(): string {
    const templates = this.options.backends.templates.list().teams;
    if (!templates.length) return NO_TEMPLATES;
    return [
      `Team templates (${templates.length}). Pick the one whose "Suits" line fits what the person wants; propose_team_project takes its id.`,
      templateLines(templates),
      "When none fits, do not propose: tell the person so and name the templates there are. You cannot make or change a template; the person does that in Settings, under Templates.",
    ].join("\n");
  }

  /** The bot's earlier open proposal in this conversation is superseded, so only its newest one can be answered. */
  propose(input: { botId: string; threadId: string; name: string; templateId: string; brief: string }): { requestId: string; messageId: string; text: string } {
    const { store, backends } = this.options;
    const root = backends.projectsRoot();
    if (root === null) throw new TeamProjectProposalError(NO_ROOT, 409);
    const templates = backends.templates.list().teams;
    const template = templates.find((candidate) => candidate.id === input.templateId);
    if (!template) {
      throw new TeamProjectProposalError(templates.length
        ? `No team template has the id "${input.templateId}". The ones there are:\n${templateLines(templates)}`
        : NO_TEMPLATES, 404);
    }
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
    const members = new Intl.ListFormat(intlLocale(language), { type: "conjunction" }).format(rolesLeadFirst(template).map((role) => role.name));
    const proposal: TeamProjectProposal = {
      requestId, botId: input.botId, threadId: input.threadId, name, folder,
      template: { id: template.id, name: template.name, version: template.version, genre: template.genre, lead: template.lead, roles: template.roles },
      brief, createdAt: Date.now(),
    };
    const card: OptionCardData = {
      title: serverLine(language, "server.teamProjectProposal.card.title", { name }),
      subtitle: [folder, serverLine(language, "server.teamProjectProposal.card.team", { template: template.name, members })].join("\n"),
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
      try {
        outcome = args.behavior === "deny" ? { result: { state: "cancelled" } } : await this.create(proposal);
      } finally {
        this.resolving.delete(proposal.requestId);
      }
      settled = this.record(args.threadId, message.id, { ...proposal, ...outcome });
      this.options.decide({ threadId: args.threadId, requestId: proposal.requestId, botId: proposal.botId, summary: `${card.title}\n${card.subtitle}`,
        decision: args.behavior === "allow" ? "user-approved" : "user-denied" });
    }
    if (settled.result && !settled.resumed) this.resume(args.threadId, message.id, (text) => this.options.answer(args.threadId, message.id, text));
    return { status: 200, body: { ok: true, outcome: settled.result?.state === "created" ? "allowed-once" : "rejected", ...(settled.result ? { result: settled.result } : {}), alreadySettled: duplicate } };
  }

  decided(threadId: string, messageId: string): boolean {
    return Boolean(this.options.store.messagesFor(threadId).find((line) => line.id === messageId)?.card?.teamProjectProposal?.result);
  }

  /** Hands the card's decision to a parked turn; true once that turn took it. A restart calls it again for a card
   * answered while no turn could take it. */
  resume(threadId: string, messageId: string, answer: (text: string) => boolean): boolean {
    const card = this.options.store.messagesFor(threadId).find((line) => line.id === messageId)?.card, proposal = card?.teamProjectProposal;
    if (!card || !proposal?.result || !answer(teamProjectDecisionText(proposal))) return false;
    if (!proposal.resumed) this.options.store.patchMessage(threadId, messageId, { card: { ...card, teamProjectProposal: { ...proposal, resumed: true } } });
    return true;
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

  /** Security: Create makes what the card showed or nothing. A template saved again, or another folder for projects, refuses it. */
  private async create(proposal: TeamProjectProposal): Promise<Outcome> {
    const { backends } = this.options;
    const refused = (code: Refusal, error: string): Outcome => ({ result: { state: "refused", code, error } });
    const template = backends.templates.list().teams.find((candidate) => candidate.id === proposal.template.id);
    if (!template) return refused("no_template", "the team template is gone");
    if (template.version !== proposal.template.version) return refused("template_changed", "the team template was saved again after the card was made");
    if (this.rootMoved(proposal)) return refused("root_changed", "the folder for projects was changed after the card was made");
    let made: CreateTeamProjectResult;
    try {
      made = await backends.projects.create({ name: proposal.name, templateId: proposal.template.id });
    } catch (error) {
      made = { error: error instanceof Error ? error.message : String(error), code: "failed" };
    }
    if ("code" in made) return refused(made.code, made.error);
    const { id, name, folder, leadBotId } = made.project;
    return { name, folder, result: { state: "created", projectId: id, leadBotId, leadName: this.options.botName(leadBotId) ?? "", missingSkills: made.missingSkills } };
  }

  private record(threadId: string, messageId: string, settled: TeamProjectProposal & { result: TeamProjectProposalResult }): TeamProjectProposal {
    const { result } = settled;
    const current = this.options.store.messagesFor(threadId).find((line) => line.id === messageId)?.card;
    if (current) {
      const closed = result.state === "created" ? { answered: "allow" }
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
