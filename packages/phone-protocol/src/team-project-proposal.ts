/** One role of the team a proposed project would get, as its card lists it. */
export interface TeamProjectProposalRole {
  key: string;
  name: string;
  /** What the role does, in a line. */
  title: string;
}

/** How a proposal ended. `code` is why the project was not made: a `TeamProjectRefusal`, or `template_changed` when the
 * team template was saved again or deleted after the card was made. `error` is English, for the bot that proposed. */
export type TeamProjectProposalResult =
  | { state: "created"; projectId: string; leadBotId: string; leadName: string; missingSkills: string[] }
  | { state: "cancelled" }
  | { state: "refused"; code: string; error: string };

/** A project the main bot proposed: what its card shows and everything Create needs, so the card can still be answered
 * after a restart. */
export interface TeamProjectProposal {
  requestId: string;
  botId: string;
  threadId: string;
  /** The project's name, which is also its folder's. */
  name: string;
  /** Absolute path of the folder Create makes. */
  folder: string;
  /** The team template as it was when the card was made. `lead` is the `key` of the role that leads the team. */
  template: { id: string; name: string; version: number; genre: string; lead: string; roles: TeamProjectProposalRole[] };
  /** What the person wants made. The main bot hands it to the project's lead once the project exists. */
  brief: string;
  createdAt: number;
  result?: TeamProjectProposalResult;
  /** The main bot's parked turn took the result. */
  resumed?: boolean;
}

export interface TeamProjectProposalCardField {
  teamProjectProposal?: TeamProjectProposal;
}
