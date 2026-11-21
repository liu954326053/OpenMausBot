/** Where a bot stands in its flow: its superior (null for the root) and its direct subordinates, in the app's order. */
export interface FlowLine {
  superior: string | null;
  subordinates: string[];
}

/** What the running server's flows answer; see `TeamFlows`. */
export interface InstalledFlows {
  parents(section: string): Record<string, string>;
  projectParents(projectId: string): Record<string, string>;
  lineOf(botId: string): FlowLine | null;
}

const NONE: InstalledFlows = { parents: () => ({}), projectParents: () => ({}), lineOf: () => null };
let installed = NONE;

/** Until this is called no bot is in a flow, so every bot reaches the others as it would without one. */
export function installTeamFlows(flows: InstalledFlows): void {
  installed = flows;
}

/** Every member of the department's team but its Chief → its superior; a project's department answers its project's flow. */
export function parents(section: string): Record<string, string> {
  return installed.parents(section);
}

/** Every bot of the project but its lead → its superior, mapped from its team's flow through each copy's source. */
export function projectParents(projectId: string): Record<string, string> {
  return installed.projectParents(projectId);
}

/** Null for a bot in no flow: the main bot, an archived bot, a bot in General, in a department without a Chief, or a Chief nobody is under yet. */
export function flowLineOf(botId: string): FlowLine | null {
  return installed.lineOf(botId);
}
