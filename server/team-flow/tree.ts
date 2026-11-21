/** Member id → the superior someone placed it under. A member without a line is under the Chief. */
export type StoredLines = Readonly<Record<string, string>>;

export type LineProblem = "self" | "chief" | "loop";

/** Every member but the Chief → its superior. A line to a bot that is no longer a member follows that bot's own line up. */
export function flowParents(members: readonly string[], chiefId: string, stored: StoredLines): Record<string, string> {
  const inTeam = new Set(members);
  const parents: Record<string, string> = Object.create(null);
  for (const member of members) {
    if (member === chiefId) continue;
    const passed = new Set([member]);
    let superior = Object.hasOwn(stored, member) ? stored[member] : undefined;
    while (superior !== undefined && !inTeam.has(superior) && !passed.has(superior)) {
      passed.add(superior);
      superior = Object.hasOwn(stored, superior) ? stored[superior] : undefined;
    }
    parents[member] = superior !== undefined && inTeam.has(superior) && superior !== member ? superior : chiefId;
  }
  for (const member of members) {
    const passed = new Set<string>();
    for (let at = member; at !== chiefId; at = parents[at]!) {
      if (passed.has(parents[at]!)) {
        parents[at] = chiefId;
        break;
      }
      passed.add(at);
    }
  }
  return { ...parents };
}

/** Why `botId` cannot be placed under `superiorId`, both members of the flow `parents` describes. */
export function lineProblem(parents: Readonly<Record<string, string>>, chiefId: string, botId: string, superiorId: string): LineProblem | null {
  if (botId === superiorId) return "self";
  if (botId === chiefId) return "chief";
  for (let at: string | undefined = superiorId; at !== undefined && at !== chiefId; at = parents[at]) {
    if (at === botId) return "loop";
  }
  return null;
}

export function withLine(stored: StoredLines, chiefId: string, botId: string, superiorId: string | null): Record<string, string> {
  const next: Record<string, string> = { ...stored };
  if (superiorId === null || superiorId === chiefId) delete next[botId];
  else next[botId] = superiorId;
  return next;
}

/**
 * The stored lines of today's members only: a member that left takes its lines with it and its subordinates move
 * under its former superior, and a line to the Chief, now the default, is not kept.
 */
export function compactLines(members: readonly string[], chiefId: string, stored: StoredLines): Record<string, string> {
  return Object.fromEntries(Object.entries(flowParents(members, chiefId, stored)).filter(([, superior]) => superior !== chiefId));
}

export interface ProjectFlowBot {
  id: string;
  /** The team member it is a copy of, while it follows one. */
  source?: string;
}

export interface ProjectFlowInput {
  leadId: string;
  bots: readonly ProjectFlowBot[];
  /** The flow of the team the project was made from; null when it has none. */
  team: { chiefId: string; parents: Readonly<Record<string, string>> } | null;
}

/** Every bot of the project but the lead → its superior: the copy of the nearest superior its source has in the team. */
export function projectFlowParents({ leadId, bots, team }: ProjectFlowInput): Record<string, string> {
  const copyOf = new Map<string, string>();
  for (const bot of bots) if (bot.source && !copyOf.has(bot.source)) copyOf.set(bot.source, bot.id);
  const above = (member: string) => (team && Object.hasOwn(team.parents, member) ? team.parents[member] : undefined);
  const parents: Record<string, string> = {};
  for (const bot of bots) {
    if (bot.id === leadId) continue;
    let superior = leadId;
    if (team && bot.source && (bot.source === team.chiefId || above(bot.source) !== undefined)) {
      for (let at = above(bot.source); at !== undefined; at = above(at)) {
        const copy = copyOf.get(at);
        if (copy !== undefined && copy !== bot.id) {
          superior = copy;
          break;
        }
      }
    }
    parents[bot.id] = superior;
  }
  return parents;
}
