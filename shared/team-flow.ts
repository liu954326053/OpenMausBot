/**
 * A team's flow says who is whose superior. It is a tree: the team's Chief of Staff is the root and has no superior;
 * every other member has exactly one superior and any number of subordinates. A member nobody placed is under the
 * Chief. Only a team with a Chief has a flow, and the main bot is in none.
 */
export interface TeamFlowWire {
  /** The department that is the team. */
  section: string;
  chiefId: string;
  /** Every member but the Chief → the id of its superior. */
  parents: Record<string, string>;
  /** The members someone placed under a superior other than the Chief; the rest are under the Chief by default. */
  placed: string[];
}

/** `GET /api/team-flows`: the flow of every team, General and projects' own departments aside. */
export interface TeamFlowsWire {
  /**
   * False while the stored flows cannot be read. Every team then shows and keeps to its default flow, with each member
   * under the Chief, and no line can be drawn or removed until the file is restored.
   */
  readable: boolean;
  teams: TeamFlowWire[];
}

/**
 * `PUT /api/team-flows/line`: makes `botId` a direct subordinate of `superiorId`, which replaces its superior.
 * `superiorId: null` takes its line away, which puts it back under the Chief.
 */
export interface TeamFlowLineInput {
  botId: string;
  superiorId: string | null;
}

/**
 * `GET /api/team-flows/projects/:id`: a project's flow, never stored. The project's lead is the root. A copy is under
 * the copy of the nearest superior its source has in the team's flow; every other bot of the project, and every bot
 * of a project not made from a team, is under the lead.
 */
export interface ProjectFlowWire {
  projectId: string;
  /** Null while the project has no lead: then it has no flow. */
  leadId: string | null;
  /** Every bot of the project but the lead → the id of its superior. */
  parents: Record<string, string>;
}
