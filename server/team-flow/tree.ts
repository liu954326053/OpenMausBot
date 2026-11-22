/** Member id → the superior someone placed it under. A member without a line is under the Chief. */
export type StoredLines = Readonly<Record<string, string>>;

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
