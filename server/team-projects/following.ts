import { saveBotsOnceAfter } from "../registry-store.ts";
import { sectionKey, type BotRecord, type Store } from "../store.ts";
import { copyUpdate } from "./follow.ts";
import type { StoredTeamProject, TeamProjectRegistry } from "./registry.ts";

export interface FollowingDeps {
  store: Store;
  registry: TeamProjectRegistry;
  /** The department that holds a memory key now; null when none does. Throws when the departments cannot be read. */
  teamOfKey(key: string): string | null;
  context(section: string): string;
  setContext(section: string, text: string): void;
  log(line: string): void;
}

const detailOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

const follows = (bot: BotRecord | null | undefined): bot is BotRecord & { teamProject: { source: string } } =>
  Boolean(bot?.teamProject?.source && !bot.teamProject.sourceLeft);

/**
 * Keeps each copy showing what its source shows, and each project the context of its team. A copy whose source was
 * deleted, archived or moved out of the team, or whose team was deleted, follows nobody from then on.
 */
export class Following {
  private readonly deps: FollowingDeps;
  private readonly syncing = new Set<string>();

  constructor(deps: FollowingDeps) {
    this.deps = deps;
  }

  private projects(): StoredTeamProject[] {
    return this.deps.registry.readable ? this.deps.registry.projects() : [];
  }

  private copiesIn(projectId: string): BotRecord[] {
    return this.deps.store.bots.filter((bot) => bot.teamProject?.id === projectId);
  }

  /** The department of the project's team now: null when the team was deleted, undefined when that cannot be told. */
  teamSection(project: StoredTeamProject): string | null | undefined {
    if (!project.team) return undefined;
    try {
      return this.deps.teamOfKey(project.team.key);
    } catch {
      return undefined;
    }
  }

  private busy(bot: BotRecord): boolean {
    return Boolean(bot.busy || bot.tasks?.some((task) => task.busy) || this.deps.store.groups.some((group) => group.busyBotId === bot.id));
  }

  /**
   * Brings a copy in line with its source. A busy copy keeps its model until its turns end, as a person's own model
   * change waits. True when its name changed, which may free or take another copy's name.
   */
  sync(botId: string): boolean {
    const { store } = this.deps;
    const copy = store.bot(botId);
    if (!follows(copy) || this.syncing.has(botId)) return false;
    const source = store.bot(copy.teamProject.source);
    if (!source) return false;
    const others = this.copiesIn(copy.teamProject.id).filter((bot) => bot.id !== copy.id).map((bot) => bot.name);
    const update = copyUpdate(source, copy, others);
    if (!update) return false;
    this.syncing.add(botId);
    try {
      if (Object.keys(update.fields).length) store.patchBot(copy.id, update.fields);
      if (update.soul !== undefined) store.patchBotProfile(copy.id, { soul: update.soul });
      if (update.model && !this.busy(store.bot(botId) ?? copy)) store.applyModelDefault(copy.id, update.model);
    } finally {
      this.syncing.delete(botId);
    }
    return update.fields.name !== undefined;
  }

  private trySync(copy: BotRecord): boolean {
    try {
      return this.sync(copy.id);
    } catch (error) {
      this.deps.log(`${copy.name} was not brought in line with its source: ${detailOf(error)}`);
      return false;
    }
  }

  private letGo(copy: BotRecord & { teamProject: { source: string } }, project: StoredTeamProject, why: string): void {
    try {
      this.deps.store.patchBot(copy.id, { teamProject: { ...copy.teamProject, sourceLeft: true } });
      this.deps.log(`${copy.name} in ${project.name} follows nobody now: ${why}`);
    } catch (error) {
      this.deps.log(`${copy.name} in ${project.name} still follows a source that is gone (${why}): ${detailOf(error)}`);
    }
  }

  /** Why the copy's source is no longer the team's to follow; null while it is, undefined when that cannot be told. */
  private gone(copy: BotRecord & { teamProject: { source: string } }, teamSection: string | null | undefined): string | null | undefined {
    if (teamSection === undefined) return undefined;
    if (teamSection === null) return "its team was deleted";
    const source = this.deps.store.bot(copy.teamProject.source);
    if (!source) return "its source was deleted";
    if (source.hidden) return `${source.name} was archived`;
    if (sectionKey(source.section) !== teamSection) return `${source.name} left ${teamSection}`;
    return null;
  }

  /** Lets go of the project's copies whose source left, then brings the rest in line until no name moves. */
  private followProject(project: StoredTeamProject, only?: ReadonlySet<string>): void {
    const teamSection = this.teamSection(project);
    let renamed = false;
    for (const copy of this.copiesIn(project.id)) {
      if (!follows(copy) || (only && !only.has(copy.id))) continue;
      const why = this.gone(copy, teamSection);
      if (why === null) renamed = this.trySync(copy) || renamed;
      else if (why !== undefined) this.letGo(copy, project, why);
    }
    for (let pass = 0; renamed && pass < this.copiesIn(project.id).length; pass += 1) {
      renamed = false;
      for (const copy of this.copiesIn(project.id)) renamed = this.trySync(copy) || renamed;
    }
    if (teamSection && project.team && teamSection !== project.team.name) this.recordTeamName(project, teamSection);
  }

  private recordTeamName(project: StoredTeamProject, name: string): void {
    try {
      this.deps.registry.replace({ ...project, team: { ...project.team!, name } });
    } catch (error) {
      this.deps.log(`the new name of ${project.name}'s team was not recorded: ${detailOf(error)}`);
    }
  }

  /** A bot changed: a copy is brought back in line, and a source's copies follow it or let go of it. */
  changed(botId: string): void {
    const bot = this.deps.store.bot(botId);
    if (bot?.teamProject) {
      if (this.trySync(bot)) this.renumber(bot.teamProject.id);
      return;
    }
    this.sourceChanged(botId);
  }

  /** The source changed or was deleted. */
  sourceChanged(botId: string): void {
    const copies = this.deps.store.bots.filter((bot) => follows(bot) && bot.teamProject.source === botId);
    if (!copies.length) return;
    const ids = new Set(copies.map((copy) => copy.id));
    saveBotsOnceAfter(() => {
      for (const project of this.projects()) {
        if (copies.some((copy) => copy.teamProject!.id === project.id)) this.followProject(project, ids);
      }
    });
  }

  /** A group chat changed: a copy whose turn in it ended takes the model it waited for. */
  groupChanged(groupId: string): void {
    for (const botId of this.deps.store.group(groupId)?.memberIds ?? []) {
      if (follows(this.deps.store.bot(botId))) this.changed(botId);
    }
  }

  private renumber(projectId: string): void {
    const project = this.projects().find((candidate) => candidate.id === projectId);
    if (project) saveBotsOnceAfter(() => this.followProject(project));
  }

  /** Gives each project the context of its team now. */
  contexts(): void {
    for (const project of this.projects()) {
      const teamSection = this.teamSection(project);
      if (!teamSection) continue;
      const text = this.deps.context(teamSection);
      if (this.deps.context(project.section) === text) continue;
      try {
        this.deps.setContext(project.section, text);
      } catch (error) {
        this.deps.log(`the context of ${project.name} was not brought in line with ${teamSection}: ${detailOf(error)}`);
      }
    }
  }

  /** Every project at once: after a start, and whenever the departments change. */
  all(): void {
    saveBotsOnceAfter(() => {
      for (const project of this.projects()) this.followProject(project);
    });
    this.contexts();
  }
}
