import { createHash } from "node:crypto";

import type { ProjectFlowWire, TeamFlowLineInput, TeamFlowsWire } from "../../shared/team-flow.ts";
import type { ServerTextParams } from "../../shared/server-text.ts";
import {
  stageLines, type FlowLineWire, type FlowStage, type ProjectPipelineWire, type TeamPipelineLineInput, type TeamPipelineRejudgeResult,
  type TeamPipelineRestoreInput, type TeamPipelinesWire,
} from "../../shared/team-pipeline.ts";
import { sectionKey, type BotRecord, type StoreChange } from "../store.ts";
import { userError, type UserError, type UserErrorKey } from "../user-errors.ts";
import { readFlowFile, storedPipeline, writeFlowFile, type FlowFile, type StoredPipeline, type StoredPipelines } from "./file.ts";
import type { FlowLine, InstalledFlows, JudgeTarget, PipelinePlace } from "./flows.ts";
import {
  heldBy, lineKey, lineProblem, memberStages, nothingStored, parentsOf, pipelineLines, placeIn, projectPipelineOf, type Pipeline, type Stages,
} from "./pipeline.ts";

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
  /** Runs after a pipeline may have changed, once what it answers shows the change. */
  changed(): void;
}

export interface Refusal { ok: false; status: number; error: UserError }
export type PipelinesResult = { ok: true; pipelines: TeamPipelinesWire } | Refusal;
export type RejudgeResult = ({ ok: true } & TeamPipelineRejudgeResult) | Refusal;
export type LineResult = { ok: true; flows: TeamFlowsWire } | Refusal;

interface Team {
  section: string;
  members: BotRecord[];
  chief: BotRecord;
}

interface TeamPipeline extends Pipeline {
  pending: string[];
  manual: string[];
}

interface Ends {
  team: Team;
  from: BotRecord;
  to: BotRecord;
}

const NOTHING: StoredPipeline = { stages: {}, judged: {}, manual: [], added: [], removed: [] };

const following = (bot: BotRecord): string | undefined =>
  bot.teamProject?.source && !bot.teamProject.sourceLeft ? bot.teamProject.source : undefined;

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

const dictionary = <T>(entries: Iterable<readonly [string, T]>): Record<string, T> => {
  const out: Record<string, T> = Object.create(null);
  for (const [key, value] of entries) out[key] = value;
  return out;
};

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

const words = (bot: BotRecord): readonly string[] => [bot.name, bot.title ?? "", bot.description ?? "", bot.soul ?? ""];

/**
 * Every team's pipeline, stored in `team-flows.json` by the team's memory key: its members' stages, the members set by
 * hand and the lines drawn and taken away by hand. A pipeline is read against today's members, and rewritten when a
 * member leaves; a project's is mapped from its team's, never stored.
 */
export class TeamFlows implements InstalledFlows {
  private readonly deps: TeamFlowsDeps;
  private file: FlowFile;
  private readonly keys = new Map<string, string | null>();
  private readonly cache = new Map<string, TeamPipeline | null>();
  private readonly prints = new Map<string, { words: readonly string[]; print: string }>();
  /** Member → the fingerprint of the words a judge was last given of it. */
  private readonly read = new Map<string, string>();
  private shape = "";

  constructor(deps: TeamFlowsDeps) {
    this.deps = deps;
    this.file = readFlowFile(deps.file);
    if (!this.file.readable) this.logUnreadable(this.file.problem);
  }

  /** Tidies the stored pipelines against today's members and follows the store; returns the unsubscribe. */
  start(): () => void {
    this.shape = this.membership();
    this.tidy();
    return this.deps.store.onChange((change) => this.storeChanged(change));
  }

  /** Reads `team-flows.json` again, as after it changed on disk. */
  reload(): void {
    this.adopt(readFlowFile(this.deps.file));
    this.tidy();
    this.deps.changed();
  }

  private adopt(next: FlowFile): void {
    const wasReadable = this.file.readable;
    this.file = next;
    this.forget();
    if (!next.readable) {
      if (wasReadable) this.logUnreadable(next.problem);
    } else if (!wasReadable) {
      this.deps.log("team flows: team-flows.json can be read again");
    }
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
    const pipeline = this.pipelineOf(sectionKey(section));
    return pipeline ? parentsOf(pipeline.members, pipeline.leadId, pipeline.lines) : {};
  }

  projectParents(projectId: string): Record<string, string> {
    const pipeline = this.projectPipelineOf(projectId);
    return pipeline ? parentsOf(pipeline.members, pipeline.leadId, pipeline.lines) : {};
  }

  lineOf(botId: string): FlowLine | null {
    const place = this.placeOf(botId);
    if (!place) return null;
    const lead = place.team[0]!;
    return { superior: botId === lead ? null : place.upstream[0] ?? lead, subordinates: place.downstream, team: place.team };
  }

  placeOf(botId: string): PipelinePlace | null {
    const bot = this.ownBot(botId);
    if (!bot || bot.hidden || bot.defaultBot) return null;
    const pipeline = this.pipelineOf(sectionKey(bot.section));
    return pipeline ? placeIn(pipeline, bot.id) : null;
  }

  projectPipeline(projectId: string): ProjectPipelineWire {
    const pipeline = this.projectPipelineOf(projectId);
    return { projectId, leadId: pipeline?.leadId ?? null, stages: { ...pipeline?.stages }, lines: [...(pipeline?.lines ?? [])] };
  }

  judgeTargets(): JudgeTarget[] {
    return this.teamSections().flatMap((section): JudgeTarget[] => {
      const pipeline = this.pipelineOf(section);
      const team = this.team(section);
      if (!team || !pipeline?.pending.length) return [];
      for (const member of team.members) if (pipeline.pending.includes(member.id)) this.read.set(member.id, this.fingerprint(member));
      return [{
        section, chiefId: team.chief.id, pending: [...pipeline.pending],
        members: team.members.map((member) => ({ id: member.id, name: member.name, title: member.title ?? "", description: member.description ?? "", soul: member.soul ?? "" })),
      }];
    });
  }

  setJudged(section: string, stages: Stages): void {
    if (!this.onDisk()) return;
    const team = this.teamAt(section);
    if ("ok" in team) return;
    const stored = this.storedOf(team.section) ?? NOTHING;
    const given: Record<string, FlowStage[]> = { ...stored.stages } as Record<string, FlowStage[]>;
    const judged: Record<string, string> = { ...stored.judged };
    for (const member of team.members) {
      if (member.id === team.chief.id || stored.manual.includes(member.id) || !Object.hasOwn(stages, member.id)) continue;
      given[member.id] = memberStages(stages[member.id]!);
      judged[member.id] = this.read.get(member.id) ?? this.fingerprint(member);
      this.read.delete(member.id);
    }
    const refused = this.put(team, { ...stored, stages: given, judged });
    if (refused) this.deps.log(`team flows: the stages judged for ${team.section} were not kept: ${refused.error.error}`);
  }

  pipelines(): TeamPipelinesWire {
    const teams = this.teamSections().flatMap((section) => {
      const pipeline = this.pipelineOf(section);
      if (!pipeline) return [];
      return [{ section, chiefId: pipeline.leadId, stages: { ...pipeline.stages }, pending: [...pipeline.pending], manual: [...pipeline.manual], lines: [...pipeline.lines] }];
    });
    return { readable: this.file.readable, teams };
  }

  /** Draws the line from `from` to `to`, or takes it away. Both ends become manual. */
  setLine({ from, to, present }: TeamPipelineLineInput): PipelinesResult {
    const ends = this.ends(from, to);
    if ("ok" in ends) return ends;
    const { team } = ends;
    const pipeline = this.pipelineOf(team.section)!;
    const line = { from: ends.from.id, to: ends.to.id };
    if (pipeline.lines.some((drawn) => lineKey(drawn) === lineKey(line)) === present) return this.answer();
    const refused = present ? this.problem(pipeline.lines, ends) : null;
    if (refused) return refused;
    const stored = this.storedOf(team.section) ?? NOTHING;
    const staged = this.staged(pipeline).some((given) => lineKey(given) === lineKey(line));
    const others = (lines: readonly FlowLineWire[]) => lines.filter((drawn) => lineKey(drawn) !== lineKey(line));
    return this.put(team, {
      ...stored,
      added: present && !staged ? [...others(stored.added), line] : others(stored.added),
      removed: !present && staged ? [...others(stored.removed), line] : others(stored.removed),
      manual: [...new Set([...stored.manual, line.from, line.to])],
    }) ?? this.answer();
  }

  /** Forgets what the person set by hand in the team and has every member judged again. */
  rejudge(section: string): RejudgeResult {
    if (!this.onDisk()) return refuse(503, "serverError.teamFlow.unreadable");
    const team = this.teamAt(section);
    if ("ok" in team) return team;
    const stored = this.storedOf(team.section) ?? NOTHING;
    const undo: TeamPipelineRestoreInput = { section: team.section, state: stored };
    const refused = this.put(team, NOTHING, "always");
    return refused ?? { ok: true, pipelines: this.pipelines(), undo };
  }

  /** Puts a team's pipeline as it was before a rejudge; null when `state` is not what a rejudge answered. */
  restore({ section, state }: TeamPipelineRestoreInput): PipelinesResult | null {
    const stored = storedPipeline(state);
    if (!stored) return null;
    if (!this.onDisk()) return refuse(503, "serverError.teamFlow.unreadable");
    const team = this.teamAt(section);
    if ("ok" in team) return team;
    return this.put(team, stored, "always") ?? this.answer();
  }

  flowsWire(): TeamFlowsWire {
    const teams = this.teamSections().flatMap((section) => {
      const pipeline = this.pipelineOf(section);
      if (!pipeline) return [];
      const parents = parentsOf(pipeline.members, pipeline.leadId, pipeline.lines);
      return [{ section, chiefId: pipeline.leadId, parents, placed: Object.keys(parents).filter((member) => parents[member] !== pipeline.leadId) }];
    });
    return { readable: this.file.readable, teams };
  }

  projectFlowWire(projectId: string): ProjectFlowWire {
    return { projectId, leadId: this.projectPipelineOf(projectId)?.leadId ?? null, parents: this.projectParents(projectId) };
  }

  /** A tree's line: `superiorId` becomes the one bot whose work goes to `botId`; null forgets the lines into `botId`
   * that were drawn and taken away by hand. */
  setSuperior({ botId, superiorId }: TeamFlowLineInput): LineResult {
    const ends = this.ends(superiorId ?? botId, botId);
    if ("ok" in ends) return ends;
    const { team, to: bot } = ends;
    const stored = this.storedOf(team.section) ?? NOTHING;
    const elsewhere = (lines: readonly FlowLineWire[]) => lines.filter((line) => line.to !== bot.id);
    let next: StoredPipeline = { ...stored, added: elsewhere(stored.added), removed: elsewhere(stored.removed) };
    if (superiorId !== null) {
      const pipeline = this.pipelineOf(team.section)!;
      const line = { from: ends.from.id, to: bot.id };
      const given = this.staged(pipeline).filter((staged) => staged.to === bot.id);
      const alone = { ...next, removed: [...next.removed, ...given] };
      const refused = this.problem(pipelineLines({ chiefId: team.chief.id, members: pipeline.members, stages: pipeline.stages, added: alone.added, removed: alone.removed }), ends);
      if (refused) return refused;
      const staged = given.some((one) => one.from === line.from);
      next = {
        ...next,
        added: staged ? next.added : [...next.added, line],
        removed: [...next.removed, ...given.filter((one) => one.from !== line.from)],
        manual: [...new Set([...stored.manual, line.from, line.to])],
      };
    }
    return this.put(team, next) ?? { ok: true, flows: this.flowsWire() };
  }

  private answer(): PipelinesResult {
    return { ok: true, pipelines: this.pipelines() };
  }

  private staged(pipeline: Pipeline): FlowLineWire[] {
    return stageLines(pipeline.leadId, pipeline.members, pipeline.stages);
  }

  private problem(lines: readonly FlowLineWire[], { team, from, to }: Ends): Refusal | null {
    const problem = lineProblem(lines, team.chief.id, from.id, to.id);
    if (problem === "self") return refuse(409, "serverError.teamFlow.self");
    if (problem === "chief") return refuse(409, "serverError.teamFlow.chief", { bot: to.name, team: team.section });
    if (problem === "loop") return refuse(409, "serverError.teamFlow.loop", { from: from.name, to: to.name });
    return null;
  }

  /** The two ends of a line someone means to change, both members of one team whose stored pipeline can be read. */
  private ends(fromId: string, toId: string): Ends | Refusal {
    if (!this.onDisk()) return refuse(503, "serverError.teamFlow.unreadable");
    const from = this.ownBot(fromId), to = this.ownBot(toId);
    if (!from || !to) return refuse(404, "serverError.teamFlow.noBot");
    const team = this.teamOf(to);
    if ("ok" in team) return team;
    if (from.defaultBot) return refuse(409, "serverError.teamFlow.mainBot");
    if (from.hidden) return refuse(409, "serverError.teamFlow.archived", { bot: from.name });
    if (from.id !== to.id && sectionKey(from.section) !== team.section) return refuse(409, "serverError.teamFlow.otherTeam", { bot: from.name, team: team.section });
    return { team, from, to };
  }

  private teamOf(bot: BotRecord): Team | Refusal {
    if (bot.defaultBot) return refuse(409, "serverError.teamFlow.mainBot");
    if (bot.hidden) return refuse(409, "serverError.teamFlow.archived", { bot: bot.name });
    const section = sectionKey(bot.section);
    if (bot.teamProject || this.projectOf(section)) {
      const team = this.sourceTeam(bot.teamProject?.id ?? this.projectOf(section)!);
      return team
        ? refuse(409, "serverError.teamFlow.project", { bot: bot.name, team: team.section })
        : refuse(409, "serverError.teamFlow.projectNoTeam", { bot: bot.name });
    }
    if (!section) return refuse(409, "serverError.teamFlow.general", { bot: bot.name });
    return this.team(section) ?? refuse(409, "serverError.teamFlow.noChief", { team: section });
  }

  /** The team that is the department `name`. */
  private teamAt(name: string): Team | Refusal {
    const section = sectionKey(name);
    if (!section || this.projectOf(section) || !this.deps.store.bots.some((bot) => !bot.hidden && sectionKey(bot.section) === section)) {
      return refuse(404, "serverError.teamFlow.noTeam");
    }
    return this.team(section) ?? refuse(409, "serverError.teamFlow.noChief", { team: section });
  }

  /** Stores `next`, held to the team's members, as its pipeline and tells the listeners; with `tell: "always"` it
   * tells them even when that changes nothing. Null when it went well. */
  private put(team: Team, next: StoredPipeline, tell: "changed" | "always" = "changed"): Refusal | null {
    const file = this.file;
    if (!file.readable) return refuse(503, "serverError.teamFlow.unreadable");
    const held = heldBy(team.members.map((member) => member.id), team.chief.id, next);
    if (same(held, heldBy(team.members.map((member) => member.id), team.chief.id, this.storedOf(team.section) ?? NOTHING))) {
      if (tell === "always") this.deps.changed();
      return null;
    }
    let key: string;
    try {
      key = this.deps.ensureTeamKey(team.section);
    } catch {
      return refuse(503, "serverError.department.readFailed");
    }
    const teams = dictionary(Object.entries(file.teams).filter(([stored]) => stored !== key));
    if (!nothingStored(held)) teams[key] = held;
    try {
      this.save(teams);
    } catch (error) {
      return refuse(500, "serverError.teamFlow.saveFailed", { detail: messageOf(error) });
    }
    this.keys.set(team.section, key);
    this.deps.changed();
    return null;
  }

  private ownBot(botId: string): BotRecord | undefined {
    return this.deps.store.bots.find((bot) => bot.id === botId);
  }

  private team(section: string): Team | null {
    const members = this.deps.store.bots.filter((bot) => !bot.hidden && !bot.defaultBot && sectionKey(bot.section) === section);
    const chief = members.find((bot) => bot.chiefOfStaff);
    return chief ? { section, members, chief } : null;
  }

  /** The departments that can be teams: General and projects' own aside. */
  private teamSections(): string[] {
    return [...new Set(this.deps.store.bots.map((bot) => sectionKey(bot.section)))].filter((section) => section && !this.projectOf(section));
  }

  /** The project whose department this is. */
  private projectOf(section: string): string | undefined {
    return section ? this.deps.store.bots.find((bot) => bot.teamProject && sectionKey(bot.section) === section)?.teamProject!.id : undefined;
  }

  private pipelineOf(section: string): TeamPipeline | null {
    if (!section) return null;
    if (!this.cache.has(section)) {
      const project = this.projectOf(section);
      this.cache.set(section, project ? this.projectPipelineOf(project) : this.teamPipeline(section));
    }
    return this.cache.get(section)!;
  }

  private teamPipeline(section: string): TeamPipeline | null {
    const team = this.team(section);
    if (!team) return null;
    const stored = this.storedOf(section);
    const stages: Record<string, FlowStage[]> = {};
    const pending: string[] = [];
    for (const member of team.members) {
      if (member.id === team.chief.id) stages[member.id] = ["lead"];
      else if (stored && this.waits(stored, member)) pending.push(member.id);
      else if (stored && Object.hasOwn(stored.stages, member.id)) stages[member.id] = memberStages(stored.stages[member.id]!);
      stages[member.id] ??= ["other"];
    }
    const members = team.members.map((member) => member.id);
    return {
      leadId: team.chief.id, members, stages, pending,
      manual: (stored?.manual ?? []).filter((member) => member !== team.chief.id && members.includes(member)),
      lines: pipelineLines({ chiefId: team.chief.id, members, stages, added: stored?.added ?? [], removed: stored?.removed ?? [] }),
    };
  }

  /** Whether a judge is still to give `member` its stages: it has none, or its words changed since it was judged. */
  private waits(stored: StoredPipeline, member: BotRecord): boolean {
    if (stored.manual.includes(member.id)) return false;
    if (!Object.hasOwn(stored.stages, member.id)) return true;
    return Object.hasOwn(stored.judged, member.id) && stored.judged[member.id] !== this.fingerprint(member);
  }

  private fingerprint(bot: BotRecord): string {
    const now = words(bot);
    const kept = this.prints.get(bot.id);
    if (kept && kept.words.every((word, index) => word === now[index])) return kept.print;
    const print = createHash("sha256").update(JSON.stringify(now)).digest("hex");
    this.prints.set(bot.id, { words: now, print });
    return print;
  }

  private projectPipelineOf(projectId: string): TeamPipeline | null {
    const bots = this.deps.store.bots.filter((bot) => !bot.hidden && bot.teamProject?.id === projectId);
    const lead = bots.find((bot) => bot.chiefOfStaff);
    if (!lead) return null;
    const team = this.sourceTeam(projectId);
    const source = team && this.pipelineOf(team.section);
    const stored = team && this.storedOf(team.section);
    const inTeam = (member: string) => team?.members.some((one) => one.id === member) === true;
    const { stages, lines } = projectPipelineOf({
      leadId: lead.id,
      bots: bots.map((bot) => {
        const member = following(bot);
        return member && inTeam(member) ? { id: bot.id, source: member } : { id: bot.id };
      }),
      team: source ? { chiefId: source.leadId, stages: source.stages, added: stored?.added ?? [], removed: stored?.removed ?? [] } : null,
    });
    return { leadId: lead.id, members: bots.map((bot) => bot.id), stages, lines, pending: [], manual: [] };
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

  /** What is stored of the team; null while that cannot be known, so nobody is taken for a member to judge. */
  private storedOf(section: string): StoredPipeline | null {
    const file = this.file;
    const key = file.readable ? this.keyOf(section) : null;
    if (!file.readable || key === null) return null;
    return Object.hasOwn(file.teams, key) ? file.teams[key]! : NOTHING;
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
      following(bot) ?? "", bot.hidden || bot.defaultBot || bot.teamProject || !sectionKey(bot.section) ? "" : this.fingerprint(bot),
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
    this.cache.clear();
  }

  /** Rewrites the stored pipelines to today's members: a member that left takes its stages and its lines with it, a
   * deleted team its pipeline, and an older version's file becomes this version's. */
  private tidy(): void {
    if (!this.onDisk()) return;
    const file = this.file;
    if (!file.readable) return;
    const sections = new Map<string, string>();
    for (const section of new Set(this.deps.store.bots.map((bot) => sectionKey(bot.section)))) {
      const key = section && this.keyOf(section);
      if (key) sections.set(key, section);
    }
    const teams: Record<string, StoredPipeline> = Object.create(null);
    let changed = file.upgraded;
    for (const [key, stored] of Object.entries(file.teams)) {
      let section: string | null | undefined = sections.get(key);
      if (section === undefined) {
        try {
          section = this.deps.teamOfKey(key);
        } catch {
          return;
        }
      }
      const team = section && !this.projectOf(section) ? this.team(section) : null;
      const kept = section === null || (section && this.projectOf(section)) ? NOTHING
        : team ? heldBy(team.members.map((member) => member.id), team.chief.id, stored) : stored;
      if (!same(kept, stored)) changed = true;
      if (nothingStored(kept)) changed = true;
      else teams[key] = kept;
    }
    if (!changed) return;
    try {
      this.save(teams);
    } catch (error) {
      this.deps.log(`team flows: what members who left held was not tidied away: ${messageOf(error)}`);
    }
  }

  private save(teams: StoredPipelines): void {
    this.file = { readable: true, teams, upgraded: false, text: writeFlowFile(this.deps.file, teams) };
    this.cache.clear();
  }

  private logUnreadable(problem: string): void {
    this.deps.log(`team flows: team-flows.json cannot be read (${problem}). Every team keeps to its default pipeline, each member under its Chief, no line can be changed, and the file is left as it is until it is restored`);
  }
}

function refuse(status: number, key: UserErrorKey, params?: ServerTextParams): Refusal {
  return { ok: false, status, error: userError(key, params) };
}
