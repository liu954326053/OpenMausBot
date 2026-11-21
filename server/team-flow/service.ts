import type { ProjectFlowWire, TeamFlowLineInput, TeamFlowsWire, TeamFlowWire } from "../../shared/team-flow.ts";
import type { ServerTextParams } from "../../shared/server-text.ts";
import { sectionKey, type BotRecord, type StoreChange } from "../store.ts";
import { userError, type UserError, type UserErrorKey } from "../user-errors.ts";
import { readFlowFile, writeFlowFile, type FlowFile, type StoredFlows } from "./file.ts";
import type { FlowLine, InstalledFlows } from "./flows.ts";
import { compactLines, flowParents, lineProblem, projectFlowParents, withLine, type StoredLines } from "./tree.ts";

export interface TeamFlowsDeps {
  store: {
    readonly bots: readonly BotRecord[];
    onChange(listener: (change: StoreChange) => void): () => void;
  };
  /** `team-flows.json` in the data directory. */
  file: string;
  /** The memory key of a department, which a rename keeps. Throws when the departments cannot be read. */
  teamKey(section: string): string;
  /** The same, registering a department that has none yet. */
  ensureTeamKey(section: string): string;
  /** The department whose memory key is `key` now, null when none is. Throws when the departments cannot be read. */
  teamOfKey(key: string): string | null;
  log(line: string): void;
  /** Runs after a flow may have changed, once what it answers shows the change. */
  changed(): void;
}

export type LineResult = { ok: true; flows: TeamFlowsWire } | { ok: false; status: number; error: UserError };

interface Flow {
  rootId: string;
  parents: Readonly<Record<string, string>>;
}

interface Team {
  section: string;
  members: BotRecord[];
  chief: BotRecord;
}

type Placing = { team: Team } | { refused: LineResult };

const following = (bot: BotRecord): string | undefined =>
  bot.teamProject?.source && !bot.teamProject.sourceLeft ? bot.teamProject.source : undefined;

const sameLines = (a: StoredLines, b: StoredLines) => {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => Object.hasOwn(b, key) && a[key] === b[key]);
};

const dictionary = <T>(entries: Iterable<readonly [string, T]>): Record<string, T> => {
  const out: Record<string, T> = Object.create(null);
  for (const [key, value] of entries) out[key] = value;
  return out;
};

/**
 * Every team's flow, stored in `team-flows.json` as the lines someone placed, by the team's memory key. A flow is read
 * against today's members, and rewritten when a member leaves; a project's is mapped from its team's, never stored.
 */
export class TeamFlows implements InstalledFlows {
  private readonly deps: TeamFlowsDeps;
  private file: FlowFile;
  private readonly keys = new Map<string, string | null>();
  private readonly flows = new Map<string, Flow | null>();
  private shape = "";

  constructor(deps: TeamFlowsDeps) {
    this.deps = deps;
    this.file = readFlowFile(deps.file);
    if (!this.file.readable) this.logUnreadable(this.file.problem);
  }

  /** Tidies the stored lines against today's members and follows the store; returns the unsubscribe. */
  start(): () => void {
    this.shape = this.membership();
    this.tidy();
    return this.deps.store.onChange((change) => this.storeChanged(change));
  }

  /** Reads `team-flows.json` again, as after it changed on disk. */
  reload(): void {
    if (this.adopt(readFlowFile(this.deps.file))) this.tidy();
    this.deps.changed();
  }

  /** True when the file became readable again. */
  private adopt(next: FlowFile): boolean {
    const wasReadable = this.file.readable;
    this.file = next;
    this.forget();
    if (!next.readable) {
      if (wasReadable) this.logUnreadable(next.problem);
      return false;
    }
    if (!wasReadable) this.deps.log("team flows: team-flows.json can be read again");
    return !wasReadable;
  }

  /** Takes in what changed on disk since the file was read; false while it cannot be read. */
  private onDisk(): boolean {
    const now = readFlowFile(this.deps.file);
    if (now.text !== this.file.text || now.readable !== this.file.readable) this.adopt(now);
    return this.file.readable;
  }

  get readable(): boolean {
    return this.file.readable;
  }

  parents(section: string): Record<string, string> {
    return { ...this.flowOf(sectionKey(section))?.parents };
  }

  projectParents(projectId: string): Record<string, string> {
    return { ...this.projectFlow(projectId)?.parents };
  }

  lineOf(botId: string): FlowLine | null {
    const bot = this.deps.store.bots.find((candidate) => candidate.id === botId);
    if (!bot || bot.hidden || bot.defaultBot) return null;
    const flow = this.flowOf(sectionKey(bot.section));
    if (!flow || (bot.id !== flow.rootId && !Object.hasOwn(flow.parents, bot.id))) return null;
    const members = Object.keys(flow.parents);
    return {
      superior: bot.id === flow.rootId ? null : flow.parents[bot.id]!,
      subordinates: members.filter((member) => flow.parents[member] === bot.id),
      team: [flow.rootId, ...members],
    };
  }

  wire(): TeamFlowsWire {
    const sections = [...new Set(this.deps.store.bots.map((bot) => sectionKey(bot.section)))].filter((section) => section && !this.projectOf(section));
    const teams = sections.flatMap((section): TeamFlowWire[] => {
      const flow = this.flowOf(section);
      if (!flow) return [];
      const parents = { ...flow.parents };
      return [{ section, chiefId: flow.rootId, parents, placed: Object.keys(parents).filter((member) => parents[member] !== flow.rootId) }];
    });
    return { readable: this.file.readable, teams };
  }

  projectWire(projectId: string): ProjectFlowWire {
    const flow = this.projectFlow(projectId);
    return { projectId, leadId: flow?.rootId ?? null, parents: { ...flow?.parents } };
  }

  /** Places `botId` under `superiorId`, or back under its Chief for null. */
  setLine({ botId, superiorId }: TeamFlowLineInput): LineResult {
    this.onDisk();
    const file = this.file;
    if (!file.readable) return refuse(503, "serverError.teamFlow.unreadable");
    const bot = this.ownBot(botId);
    if (!bot) return refuse(404, "serverError.teamFlow.noBot");
    const placing = this.placing(bot);
    if ("refused" in placing) return placing.refused;
    const { team } = placing;
    const flow = this.flowOf(team.section)!;
    if (superiorId !== null) {
      const superior = this.ownBot(superiorId);
      if (!superior) return refuse(404, "serverError.teamFlow.noBot");
      if (superior.defaultBot) return refuse(409, "serverError.teamFlow.mainBot");
      if (superior.hidden) return refuse(409, "serverError.teamFlow.archived", { bot: superior.name });
      if (superior.id !== bot.id && sectionKey(superior.section) !== team.section) {
        return refuse(409, "serverError.teamFlow.otherTeam", { superior: superior.name, team: team.section });
      }
      const problem = lineProblem(flow.parents, team.chief.id, bot.id, superior.id);
      if (problem === "self") return refuse(409, "serverError.teamFlow.self");
      if (problem === "chief") return refuse(409, "serverError.teamFlow.chief", { bot: bot.name, team: team.section });
      if (problem === "loop") return refuse(409, "serverError.teamFlow.loop", { bot: bot.name, superior: superior.name });
    } else if (bot.id === team.chief.id) {
      return { ok: true, flows: this.wire() };
    }
    let key: string;
    try {
      key = this.deps.ensureTeamKey(team.section);
    } catch {
      return refuse(503, "serverError.department.readFailed");
    }
    const members = team.members.map((member) => member.id);
    const lines = compactLines(members, team.chief.id, withLine(this.storedLines(team.section), team.chief.id, bot.id, superiorId));
    const teams = dictionary(Object.entries(file.teams).filter(([stored]) => stored !== key));
    if (Object.keys(lines).length) teams[key] = lines;
    try {
      this.save(teams);
    } catch (error) {
      return refuse(500, "serverError.teamFlow.saveFailed", { detail: error instanceof Error ? error.message : String(error) });
    }
    this.keys.set(team.section, key);
    this.deps.changed();
    return { ok: true, flows: this.wire() };
  }

  private placing(bot: BotRecord): Placing {
    if (bot.defaultBot) return { refused: refuse(409, "serverError.teamFlow.mainBot") };
    if (bot.hidden) return { refused: refuse(409, "serverError.teamFlow.archived", { bot: bot.name }) };
    const section = sectionKey(bot.section);
    if (bot.teamProject || this.projectOf(section)) {
      const team = this.sourceTeam(bot.teamProject?.id ?? this.projectOf(section)!);
      return { refused: team
        ? refuse(409, "serverError.teamFlow.project", { bot: bot.name, team: team.section })
        : refuse(409, "serverError.teamFlow.projectNoTeam", { bot: bot.name }) };
    }
    if (!section) return { refused: refuse(409, "serverError.teamFlow.general", { bot: bot.name }) };
    const team = this.team(section);
    return team ? { team } : { refused: refuse(409, "serverError.teamFlow.noChief", { team: section }) };
  }

  private ownBot(botId: string): BotRecord | undefined {
    return this.deps.store.bots.find((bot) => bot.id === botId);
  }

  private team(section: string): Team | null {
    const members = this.deps.store.bots.filter((bot) => !bot.hidden && !bot.defaultBot && sectionKey(bot.section) === section);
    const chief = members.find((bot) => bot.chiefOfStaff);
    return chief ? { section, members, chief } : null;
  }

  /** The project whose department this is. */
  private projectOf(section: string): string | undefined {
    return section ? this.deps.store.bots.find((bot) => bot.teamProject && sectionKey(bot.section) === section)?.teamProject!.id : undefined;
  }

  private flowOf(section: string): Flow | null {
    if (!section) return null;
    if (!this.flows.has(section)) {
      const project = this.projectOf(section);
      this.flows.set(section, project ? this.projectFlow(project) : this.teamFlow(section));
    }
    return this.flows.get(section)!;
  }

  private teamFlow(section: string): Flow | null {
    const team = this.team(section);
    if (!team) return null;
    const members = team.members.map((member) => member.id);
    return { rootId: team.chief.id, parents: flowParents(members, team.chief.id, this.storedLines(section)) };
  }

  private projectFlow(projectId: string): Flow | null {
    const bots = this.deps.store.bots.filter((bot) => !bot.hidden && bot.teamProject?.id === projectId);
    const lead = bots.find((bot) => bot.chiefOfStaff);
    if (!lead) return null;
    const team = this.sourceTeam(projectId);
    const teamFlow = team && this.flowOf(team.section);
    const inTeam = (source: string) => team?.members.some((member) => member.id === source) === true;
    return {
      rootId: lead.id,
      parents: projectFlowParents({
        leadId: lead.id,
        bots: bots.map((bot) => {
          const source = following(bot);
          return source && inTeam(source) ? { id: bot.id, source } : { id: bot.id };
        }),
        team: teamFlow ? { chiefId: teamFlow.rootId, parents: teamFlow.parents } : null,
      }),
    };
  }

  /** The team the project's copies follow: the one their sources are in, the lead's source's first. */
  private sourceTeam(projectId: string): Team | null {
    const copies = this.deps.store.bots
      .filter((bot) => !bot.hidden && bot.teamProject?.id === projectId && following(bot))
      .sort((a, b) => Number(Boolean(b.chiefOfStaff)) - Number(Boolean(a.chiefOfStaff)));
    for (const copy of copies) {
      const source = this.ownBot(following(copy)!);
      const section = sectionKey(source?.section);
      if (!source || source.hidden || !section || this.projectOf(section)) continue;
      const team = this.team(section);
      if (team) return team;
    }
    return null;
  }

  private storedLines(section: string): StoredLines {
    const file = this.file;
    if (!file.readable) return {};
    const key = this.keyOf(section);
    return key !== null && Object.hasOwn(file.teams, key) ? file.teams[key]! : {};
  }

  private keyOf(section: string): string | null {
    if (!this.keys.has(section)) {
      let key: string | null = null;
      try {
        key = this.deps.teamKey(section);
      } catch {
        key = null;
      }
      this.keys.set(section, key);
    }
    return this.keys.get(section)!;
  }

  private membership(): string {
    return JSON.stringify(this.deps.store.bots.map((bot) => [
      bot.id, sectionKey(bot.section), Boolean(bot.hidden), Boolean(bot.chiefOfStaff), Boolean(bot.defaultBot), bot.teamProject?.id ?? "",
      following(bot) ?? "",
    ]));
  }

  private storeChanged(change: StoreChange): void {
    if (change.type === "sections") this.keys.clear();
    if (change.type !== "bot" && change.type !== "bot.deleted" && change.type !== "sections") return;
    const shape = this.membership();
    if (shape === this.shape && change.type !== "sections") return;
    this.shape = shape;
    this.forget();
    this.tidy();
    this.deps.changed();
  }

  private forget(): void {
    this.keys.clear();
    this.flows.clear();
  }

  /** Rewrites the stored lines to today's members: a member that left takes its lines with it, and a deleted team its flow. */
  private tidy(): void {
    this.onDisk();
    const file = this.file;
    if (!file.readable) return;
    const sections = new Map<string, string>();
    for (const section of new Set(this.deps.store.bots.map((bot) => sectionKey(bot.section)))) {
      const key = section && this.keyOf(section);
      if (key) sections.set(key, section);
    }
    const teams: Record<string, StoredLines> = Object.create(null);
    let changed = false;
    for (const [key, lines] of Object.entries(file.teams)) {
      let section: string | null | undefined = sections.get(key);
      if (section === undefined) {
        try {
          section = this.deps.teamOfKey(key);
        } catch {
          return;
        }
      }
      const team = section && !this.projectOf(section) ? this.team(section) : null;
      const kept = section === null || (section && this.projectOf(section)) ? {}
        : team ? compactLines(team.members.map((member) => member.id), team.chief.id, lines) : lines;
      if (!sameLines(kept, lines)) changed = true;
      if (Object.keys(kept).length) teams[key] = kept;
    }
    if (!changed) return;
    try {
      this.save(teams);
    } catch (error) {
      this.deps.log(`team flows: the lines of members who left were not tidied away: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private save(teams: StoredFlows): void {
    this.file = { readable: true, teams, text: writeFlowFile(this.deps.file, teams) };
    this.flows.clear();
  }

  private logUnreadable(problem: string): void {
    this.deps.log(`team flows: team-flows.json cannot be read (${problem}). Every team keeps to its default flow, each member under its Chief, no line can be changed, and the file is left as it is until it is restored`);
  }
}

function refuse(status: number, key: UserErrorKey, params?: ServerTextParams): LineResult {
  return { ok: false, status, error: userError(key, params) };
}
