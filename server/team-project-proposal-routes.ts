// The main bot's project proposals on the server: the two internal calls behind list_project_teams and
// propose_team_project, and the answer to the card. The internal calls run inside index.ts's /api/internal/ block after
// the capability bearer is checked; the bot is the capability's.
import type { ServerResponse } from "node:http";
import { z } from "zod";

import { appendDecision } from "./decision-log.ts";
import type { json as sendJson } from "./harness/http.ts";
import { PASS } from "./routes/table.ts";
import { proposesTeamProjects } from "./team-project-proposal-access.ts";
import {
  PROPOSE_TEAM_PROJECT_TOOL, TeamProjectProposalError, TeamProjectProposalService, type TeamProjectBackends, type TeamProjectProposalOptions,
} from "./team-project-proposal.ts";

type ProposalBot = NonNullable<Parameters<typeof proposesTeamProjects>[0]> & { id: string; name: string };

export interface TeamProjectProposalsDeps {
  store: TeamProjectProposalOptions["store"] & { bot(id: string): ProposalBot | null | undefined };
  dataDir: string;
  /** Read on every call, so what it returns may be built after this module. */
  backends(): TeamProjectBackends;
  /** Whether the thread is the bot's own chat or one of its own threads: never a room. */
  directChat(botId: string, threadId: string): boolean;
  answerCardNode(threadId: string, messageId: string, text: string): boolean;
  followCard(threadId: string, from: string, to: string): void;
  releaseCardNode(threadId: string, messageId: string): void;
  handOff: TeamProjectProposalOptions["handOff"];
  held: TeamProjectProposalOptions["held"];
  threadLanguage(threadId: string): string | undefined;
}

export interface TeamProjectInternalContext {
  method: string;
  path: string;
  res: ServerResponse;
  json: typeof sendJson;
  bot: ProposalBot;
  threadId: string;
  readBody(): Promise<unknown>;
  requireActive(): void;
}

const LIST = "/api/internal/project-teams";
const PROPOSE = "/api/internal/team-project-proposals";

const ONLY_MAIN_BOT = "Only the main bot proposes projects, and you are not it. Tell the person to ask their MagicBot.";
const OWN_CHAT_ONLY = "A project is proposed in your own chat with the person, not in a room. Tell the person to ask you there.";
const BAD_CALL = "propose_team_project needs name, team (a team's name from list_project_teams) and request, each as text.";

const BODY = z.object({
  fromBotId: z.string().optional(), fromThreadId: z.string().optional(),
  name: z.string(), team: z.string(), request: z.string(),
}).strict();

export function createTeamProjectProposals(deps: TeamProjectProposalsDeps) {
  const { store } = deps;
  const service = new TeamProjectProposalService({
    store,
    backends: {
      projects: { create: (input) => deps.backends().projects.create(input), teams: () => deps.backends().projects.teams() },
      projectsRoot: () => deps.backends().projectsRoot(),
    },
    botName: (botId) => store.bot(botId)?.name,
    answer: deps.answerCardNode,
    follow: deps.followCard,
    release: deps.releaseCardNode,
    handOff: deps.handOff,
    held: deps.held,
    language: deps.threadLanguage,
    decide: (row) => appendDecision(deps.dataDir, {
      ...row, botName: store.bot(row.botId)?.name, tool: PROPOSE_TEAM_PROJECT_TOOL, source: row.decision === "card-shown" ? "question" : "user",
    }),
  });

  /** Security: the tool list is presentation only. Every call is checked here against the bot the capability names. */
  async function internal(ctx: TeamProjectInternalContext): Promise<typeof PASS | void> {
    const listing = ctx.method === "GET" && ctx.path === LIST;
    if (!listing && !(ctx.method === "POST" && ctx.path === PROPOSE)) return PASS;
    if (!proposesTeamProjects(ctx.bot)) return void ctx.json(ctx.res, 403, { error: ONLY_MAIN_BOT });
    if (!deps.directChat(ctx.bot.id, ctx.threadId)) return void ctx.json(ctx.res, 403, { error: OWN_CHAT_ONLY });
    try {
      if (listing) {
        ctx.requireActive();
        return void ctx.json(ctx.res, 200, { text: service.teamsText() });
      }
      const parsed = BODY.safeParse(await ctx.readBody());
      if (!parsed.success) return void ctx.json(ctx.res, 400, { error: BAD_CALL });
      const { name, team, request } = parsed.data;
      const proposed = service.propose({ botId: ctx.bot.id, threadId: ctx.threadId, name, team, brief: request });
      return void ctx.json(ctx.res, 201, { text: proposed.text, requestId: proposed.requestId });
    } catch (error) {
      if (error instanceof TeamProjectProposalError) return void ctx.json(ctx.res, error.status, { error: error.message });
      throw error;
    }
  }

  return {
    internal,
    respond: (args: { threadId: string; requestId: string; behavior: string }, ownerReview: boolean) => service.respond(args, ownerReview),
    decided: (threadId: string, messageId: string) => service.decided(threadId, messageId),
    resume: (threadId: string, messageId: string, answer: (text: string) => boolean) => service.resume(threadId, messageId, answer),
  };
}
