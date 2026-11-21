/** One bot of the team a proposed project would be made from, as its card lists it. */
export interface TeamProjectProposalMember {
  id: string;
  name: string;
  /** What the bot does, in a line. */
  title: string;
}

/** One role of the team template a card names instead of a team. */
export interface TeamProjectProposalRole {
  key: string;
  name: string;
  title: string;
}

/** How a proposal ended. `code` is why the project was not made: a `TeamProjectRefusal`, or `team_changed` when the
 * team's name, Chief or members changed after the card was made. `error` is English, for the bot that proposed.
 * `missingSkills` is on cards created from a team template only. */
export type TeamProjectProposalResult =
  | { state: "created"; projectId: string; leadBotId: string; leadName: string; missingSkills?: string[] }
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
  /** The team as it was when the card was made, its Chief first among `members`. `revision` is what Create compares
   * with the team as it is then. */
  team?: { name: string; chief: TeamProjectProposalMember; members: TeamProjectProposalMember[]; revision: string };
  /** On a card that names a team template instead of a team: that template. Create refuses such a card. */
  template?: { id: string; name: string; version: number; genre: string; lead: string; roles: TeamProjectProposalRole[] };
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
