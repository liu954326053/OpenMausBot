import { createHash } from "node:crypto";

import type {
  CreateTeamProjectInput, CreateTeamProjectResult, ProjectTeamWire, TeamChangesInput, TeamChangesResult, TeamProjectLookup, TeamProjectRecord,
  TeamProjectWire, TeamProjectsApi, TeamProjectsListWire,
} from "../../shared/team-projects.ts";
import type { PackageImportDeps } from "../package-import.ts";
import type { RoutineManager } from "../routines.ts";
import type { ShareTarget } from "../share.ts";
import { sectionKey, type BotRecord, type Store, type StoreChange } from "../store.ts";
import { userError, userErrorThrown, type UserError } from "../user-errors.ts";
import { teamProjectFolderReady } from "../workspace.ts";
import { renderTeamProjectCopies, writeTeamProjectCopies, type TeamMemoryLine } from "./copies.ts";
import { createTeamProject, type ExportedTeam } from "./create.ts";
import { changedCopyFields, isCopyField } from "./follow.ts";
import { Following } from "./following.ts";
import type { StoredTeamProject, TeamProjectRegistry } from "./registry.ts";
import { checkTeamProjectsRoot } from "./root.ts";
import { addCopy, teamChangesOf } from "./team-changes.ts";
import { findProjectTeam, projectTeams, teamBots, type TeamSources } from "./teams.ts";

export interface TeamProjectsDeps {
  registry: TeamProjectRegistry;
  store: Store;
  dataDir: string;
  /** Null before the routines are loaded. */
  routines(): Pick<RoutineManager, "listRoutines" | "update"> | null;
  /** Puts a project bot's own files where its project keeps them. Throws when the project folder cannot take them. */
  ensureWorkspace(botId: string): void;
  importDeps(): Promise<PackageImportDeps>;
  /** Deletes a bot as a person deleting it would. Null when it is gone; else why it could not be deleted now. */
  deleteBot(botId: string): Promise<string | null>;
  /** The share export of a department or of one bot, carrying the skills `carries` picks and no others. Throws when it cannot be made. */
  exportDocument(target: ShareTarget, carries: (bot: BotRecord, skill: string) => boolean): ExportedTeam;
  /** The names of the skills a bot learned itself: the ones its copies take. */
  ownSkillNames(botId: string): readonly string[];
  /** The memory key of a department, made fast so a rename keeps it. */
  teamKey(section: string): string;
  /** The department that holds a memory key now; null when none does. */
  teamOfKey(key: string): string | null;
  context(section: string): string;
  setContext(section: string, text: string): void;
  memory(section: string): readonly TeamMemoryLine[];
  /** Calls `flush` a moment after the first call since the last flush. */
  schedule(flush: () => void): void;
  newId(): string;
  now?(): number;
  log?(line: string): void;
}

type MovingBot = Pick<BotRecord, "name" | "section" | "teamProject">;

function publicRecord(project: StoredTeamProject): TeamProjectRecord {
  const { pausedRoutineIds: _paused, ...record } = project;
  return record;
}

const detailOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

const routinesCannotBeChanged = (error: unknown) => (error as { status?: unknown } | null)?.status === 503;

function roleOfJoiner(botId: string, taken: ReadonlySet<string>): string {
  for (let attempt = 0; ; attempt += 1) {
    const role = `member-${createHash("sha256").update(`${botId} ${attempt}`).digest("hex").slice(0, 8)}`;
    if (!taken.has(role)) return role;
  }
}

export class TeamProjects implements TeamProjectsApi {
  private readonly deps: TeamProjectsDeps;
  private readonly pending = new Map<string, { folder: string }>();
  private readonly knownBots = new Set<string>();
  private readonly staleCopies = new Set<string>();
  private readonly writtenCopies = new Map<string, string>();
  private readonly refusedCopies = new Set<string>();
  private everyCopyStale = false;
  private readonly following: Following;

  constructor(deps: TeamProjectsDeps) {
    this.deps = deps;
    this.following = new Following({ ...deps, log: (line) => this.log(line) });
  }

  private log(line: string): void {
    (this.deps.log ?? ((text) => console.error(text)))(`team projects: ${line}`);
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  /** Follows the bots from here on, and brings the copies up to date. Returns how to stop. */
  start(): () => void {
    for (const bot of this.deps.store.bots) {
      this.knownBots.add(bot.id);
      this.defaultBotToProjectFolder(bot);
    }
    this.following.all();
    this.touchAll();
    return this.deps.store.onChange((change) => this.onStoreChange(change));
  }

  /** The departments' contexts or names changed on disk. */
  contextsChanged(): void {
    this.following.all();
    this.touchAll();
  }

  readonly lookup: TeamProjectLookup = (projectId) => {
    const pending = this.pending.get(projectId);
    if (pending) return { folder: pending.folder };
    const project = this.deps.registry.find(projectId);
    return project && { folder: project.folder, ...(project.archivedAt === undefined ? {} : { archivedAt: project.archivedAt }) };
  };

  private botsOf(projectId: string): BotRecord[] {
    return this.deps.store.bots.filter((bot) => bot.teamProject?.id === projectId);
  }

  private wire(project: StoredTeamProject): TeamProjectWire {
    const ready = teamProjectFolderReady(project.folder);
    if (ready && !this.writtenCopies.has(project.id)) this.touch(project.id);
    const bots = this.botsOf(project.id);
    const follows = Object.fromEntries(bots.flatMap((bot) => (bot.teamProject?.source && !bot.teamProject.sourceLeft ? [[bot.id, bot.teamProject.source]] : [])));
    const teamChanges = project.archivedAt === undefined ? this.teamChanges(project) : null;
    return { ...publicRecord(project), folderState: ready ? "ready" : "missing", botIds: bots.map((bot) => bot.id), follows, ...(teamChanges ? { teamChanges } : {}) };
  }

  private teamChanges(project: StoredTeamProject) {
    return teamChangesOf(this.deps.store.bots, project.id, this.following.teamSection(project));
  }

  list(): TeamProjectWire[] {
    return this.deps.registry.projects().map((project) => this.wire(project));
  }

  listWire(): TeamProjectsListWire {
    return { root: this.deps.registry.root(), projects: this.list() };
  }

  setRoot(path: unknown): { root: string } | UserError {
    const checked = checkTeamProjectsRoot(path, this.deps.dataDir);
    if (!checked.ok) return userError(checked.error);
    this.deps.registry.setRoot(checked.root);
    return { root: checked.root };
  }

  private teamSources(): TeamSources {
    const projectSections = this.deps.registry.readable
      ? this.deps.registry.projects().map((project) => project.section)
      : this.deps.store.bots.filter((bot) => bot.teamProject).map((bot) => sectionKey(bot.section));
    return { bots: this.deps.store.bots, sections: this.deps.store.sections, projectSections: new Set(projectSections), context: this.deps.context };
  }

  teams(): ProjectTeamWire[] {
    return projectTeams(this.teamSources());
  }

  /** A department's share export, or one bot's, with each bot's own skills and no skill from the library. */
  private exportOf(target: ShareTarget): ExportedTeam {
    const own = new Map<string, ReadonlySet<string>>();
    return this.deps.exportDocument(target, (bot, skill) => {
      if (!own.has(bot.id)) own.set(bot.id, new Set(this.deps.ownSkillNames(bot.id)));
      return own.get(bot.id)!.has(skill);
    });
  }

  async create(input: CreateTeamProjectInput): Promise<CreateTeamProjectResult> {
    const outcome = await createTeamProject(input, {
      registry: this.deps.registry,
      dataDir: this.deps.dataDir,
      importDeps: this.deps.importDeps,
      team: (name) => findProjectTeam(this.teams(), name),
      exportTeam: (section) => this.exportOf({ scope: "department", section, bots: teamBots(this.deps.store.bots, section) }),
      teamKey: this.deps.teamKey,
      syncCopy: (botId) => void this.following.sync(botId),
      ensureWorkspace: this.deps.ensureWorkspace,
      pending: this.pending,
      writeCopies: (project) => {
        const state = this.writeCopies(project);
        if (state !== "written") throw new Error(`the copies in the project folder could not be written (${state})`);
      },
      newId: this.deps.newId,
      now: () => this.now(),
      log: (line) => this.log(line),
    });
    return "project" in outcome ? { project: this.wire(outcome.project) } : outcome;
  }

  /**
   * Makes the changes in the project's team the person decided on, each only if it still stands: copies of new members,
   * and the departed copies deleted or kept as the project's own. Null: no project has that id.
   */
  async decideTeamChanges(id: string, input: TeamChangesInput): Promise<TeamChangesResult | null> {
    const project = this.stored(id);
    if (!project) return null;
    const teamSection = this.following.teamSection(project);
    const changes = this.teamChanges(project);
    const joined = new Set(changes?.joined.map((member) => member.id));
    const left = new Set(changes?.left.map((copy) => copy.id));
    const skipped: string[] = [];
    const skip = (id: string, line?: string) => {
      skipped.push(id);
      if (line) this.log(line);
    };
    for (const copyId of input.keep) {
      const copy = left.has(copyId) ? this.deps.store.bot(copyId) : null;
      if (!copy?.teamProject) { skip(copyId); continue; }
      try {
        this.deps.store.patchBot(copyId, { teamProject: { id: copy.teamProject.id, role: copy.teamProject.role } });
      } catch (error) {
        skip(copyId, `${copy.name} was not kept in ${project.name}: ${detailOf(error)}`);
      }
    }
    for (const copyId of input.remove) {
      const copy = left.has(copyId) ? this.deps.store.bot(copyId) : null;
      if (!copy) { skip(copyId); continue; }
      const refused = await this.deps.deleteBot(copyId).catch(detailOf);
      if (refused) skip(copyId, `${copy.name} was not removed from ${project.name}: ${refused}`);
    }
    for (const sourceId of input.add) {
      const source = joined.has(sourceId) && teamSection ? this.deps.store.bot(sourceId) : null;
      if (!source || !teamSection) { skip(sourceId); continue; }
      try {
        await addCopy(project, source, teamSection, {
          importDeps: this.deps.importDeps,
          exportMember: (member, section) => this.exportOf({ scope: "department", section, bots: [member] }),
          ensureWorkspace: this.deps.ensureWorkspace,
          syncCopy: (botId) => void this.following.sync(botId),
        });
      } catch (error) {
        skip(sourceId, `no copy of ${source.name} was made in ${project.name}: ${detailOf(error)}`);
      }
    }
    return { project: this.afterChange(id)!, skipped };
  }

  private stored(id: string): StoredTeamProject | undefined {
    return this.deps.registry.projects().find((project) => project.id === id);
  }

  archive(id: string): TeamProjectWire | null {
    const project = this.stored(id);
    if (!project) return null;
    if (project.archivedAt !== undefined) return this.wire(project);
    const routines = this.deps.routines();
    const botIds = new Set(this.botsOf(id).map((bot) => bot.id));
    const paused: string[] = [];
    try {
      for (const routine of routines?.listRoutines() ?? []) {
        if (!routine.enabled || !botIds.has(routine.botId)) continue;
        routines!.update(routine.id, { enabled: false });
        paused.push(routine.id);
      }
      this.deps.registry.replace({ ...project, archivedAt: this.now(), ...(paused.length ? { pausedRoutineIds: paused } : {}) });
    } catch (error) {
      for (const routineId of paused) {
        try { routines!.update(routineId, { enabled: true }); } catch (failure) { this.log(`routine ${routineId} stayed paused after an archive that failed: ${detailOf(failure)}`); }
      }
      throw error;
    }
    return this.afterChange(id);
  }

  restore(id: string): TeamProjectWire | null {
    const project = this.stored(id);
    if (!project) return null;
    if (project.archivedAt === undefined) return this.wire(project);
    const { archivedAt: _archivedAt, pausedRoutineIds = [], ...restored } = project;
    const routines = this.deps.routines();
    const resumed: string[] = [];
    try {
      for (const routineId of pausedRoutineIds) {
        const routine = routines?.listRoutines().find((candidate) => candidate.id === routineId);
        if (!routine || routine.enabled) continue;
        try {
          routines!.update(routineId, { enabled: true });
          resumed.push(routineId);
        } catch (error) {
          if (routinesCannotBeChanged(error)) throw error;
          this.log(`routine ${routineId} stays paused after the restore: ${detailOf(error)}`);
        }
      }
      this.deps.registry.replace(restored);
    } catch (error) {
      for (const routineId of resumed) {
        try { routines!.update(routineId, { enabled: false }); } catch (failure) { this.log(`routine ${routineId} stayed on after a restore that failed: ${detailOf(failure)}`); }
      }
      throw error;
    }
    return this.afterChange(id);
  }

  private afterChange(id: string): TeamProjectWire | null {
    const project = this.stored(id);
    if (!project) return null;
    try { this.writeCopies(project); } catch (error) { this.log(`the copies of ${project.name} were not updated: ${detailOf(error)}`); }
    return this.wire(project);
  }

  /**
   * Security invariant: a project's department stays closed to other bots while the list of projects cannot be read.
   * A department that holds a project's bot is then that project's.
   */
  private projectIdOfDepartment(section: string): string | undefined {
    if (!section) return undefined;
    if (this.deps.registry.readable) return this.deps.registry.projects().find((project) => project.section === section)?.id;
    return this.deps.store.bots.find((bot) => bot.teamProject && sectionKey(bot.section) === section)?.teamProject?.id;
  }

  /** Why `bot` may not go to the department `to`: null when it may, and when it stays where it is. */
  moveRefusal(bot: MovingBot, to: string | null | undefined): UserError | null {
    const target = sectionKey(to);
    if (target === sectionKey(bot.section)) return null;
    if (bot.teamProject && (!this.deps.registry.readable || this.deps.registry.find(bot.teamProject.id))) {
      return userError("serverError.teamProject.botStays", { bot: bot.name });
    }
    return this.projectIdOfDepartment(target) ? userError("serverError.teamProject.noJoin", { department: target }) : null;
  }

  moveRefusalFor(botId: string, to: string | null | undefined): UserError | null {
    const bot = this.deps.store.bots.find((candidate) => candidate.id === botId);
    return bot ? this.moveRefusal(bot, to) : null;
  }

  /** Why the department may not be renamed or deleted: null when it is no project's. */
  departmentRefusal(section: string | null | undefined): UserError | null {
    const name = sectionKey(section);
    return this.projectIdOfDepartment(name) ? userError("serverError.teamProject.departmentFixed", { department: name }) : null;
  }

  /** Why these fields of the bot may not change: it is a copy, and they are its source's. Null otherwise. */
  copyRefusal(botId: string, fields: Iterable<string>): UserError | null {
    const copy = this.deps.store.bot(botId);
    const membership = copy?.teamProject;
    if (!copy || !membership?.source || membership.sourceLeft || ![...fields].some(isCopyField)) return null;
    const source = this.deps.store.bot(membership.source);
    const team = (source && sectionKey(source.section)) || this.deps.registry.find(membership.id)?.team?.name || "";
    return userError("serverError.teamProject.copyFollows", { bot: copy.name, source: source?.name ?? copy.name, team });
  }

  /** `copyRefusal` for a request that sets fields to values: a value the copy has already changes nothing. */
  copyChangeRefusal(botId: string, changes: object): UserError | null {
    const copy = this.deps.store.bot(botId);
    return copy ? this.copyRefusal(botId, changedCopyFields(copy, changes)) : null;
  }

  /** Why a department's shared instructions may not change: it is a project's, and they are its team's. Null otherwise. */
  contextRefusal(section: string | null | undefined): UserError | null {
    const name = sectionKey(section);
    if (!name || !this.deps.registry.readable) return null;
    const team = this.deps.registry.projects().find((project) => project.section === name)?.team;
    if (!team) return null;
    let teamSection: string | null;
    try {
      teamSection = this.deps.teamOfKey(team.key);
    } catch {
      teamSection = team.name;
    }
    return teamSection ? userError("serverError.teamProject.contextFollows", { department: name, team: teamSection }) : null;
  }

  /** For a Chief's team setup: throws when the change moves a bot into or out of a project. */
  checkSetupChange(before: MovingBot, fields: { section?: string }): void {
    if (fields.section === undefined) return;
    const refused = this.moveRefusal(before, fields.section);
    if (refused) throw Object.assign(userErrorThrown(refused.errorKey, refused.errorParams), { status: 409 });
  }

  private onStoreChange(change: StoreChange): void {
    if (change.type === "bot.deleted") {
      this.knownBots.delete(change.botId);
      this.following.sourceChanged(change.botId);
      this.touchAll();
      return;
    }
    if (change.type === "sections") {
      this.following.all();
      return this.touchAll();
    }
    if (change.type === "group") {
      this.following.groupChanged(change.groupId);
      return this.defaultRoomToProjectFolder(change.groupId);
    }
    if (change.type !== "bot") return;
    const bot = this.deps.store.bots.find((candidate) => candidate.id === change.botId);
    if (!bot) return;
    if (!this.knownBots.has(bot.id)) {
      this.knownBots.add(bot.id);
      this.takeIntoProjectOfItsDepartment(bot);
    }
    this.following.changed(bot.id);
    const projectId = bot.teamProject?.id;
    if (!projectId) return;
    this.defaultBotToProjectFolder(bot);
    this.followLead(projectId);
    this.touch(projectId);
  }

  private defaultBotToProjectFolder(bot: BotRecord): void {
    if (!bot.teamProject || bot.cwd) return;
    const folder = this.deps.registry.find(bot.teamProject.id)?.folder;
    if (folder) this.deps.store.patchBot(bot.id, { cwd: folder });
  }

  private takeIntoProjectOfItsDepartment(bot: BotRecord): void {
    const membership = bot.teamProject;
    const projectId = membership?.id ?? this.projectIdOfDepartment(sectionKey(bot.section));
    if (!projectId) return;
    const readable = this.deps.registry.readable;
    const project = this.deps.registry.find(projectId);
    if (readable && !project) return;
    const taken = new Set(this.botsOf(projectId).filter((other) => other.id !== bot.id).map((other) => other.teamProject!.role));
    if (membership && !taken.has(membership.role)) return;
    this.deps.store.patchBot(bot.id, { teamProject: { id: projectId, role: roleOfJoiner(bot.id, taken) }, ...(bot.cwd || !project ? {} : { cwd: project.folder }) });
    try {
      this.deps.ensureWorkspace(bot.id);
    } catch (error) {
      this.log(`the files of ${bot.name} were not put into ${project?.name ?? "its project"}: ${detailOf(error)}`);
    }
  }

  private defaultRoomToProjectFolder(groupId: string): void {
    const group = this.deps.store.group(groupId);
    if (!group || group.cwd || !group.memberIds.length) return;
    const projects = group.memberIds.map((id) => this.deps.store.bots.find((bot) => bot.id === id)?.teamProject?.id);
    const projectId = projects[0];
    if (!projectId || projects.some((id) => id !== projectId)) return;
    const folder = this.lookup(projectId)?.folder;
    if (folder) this.deps.store.patchGroup(group.id, { cwd: folder });
  }

  private followLead(projectId: string): void {
    const project = this.deps.registry.find(projectId);
    if (!project) return;
    const chief = this.botsOf(projectId).find((bot) => bot.chiefOfStaff && sectionKey(bot.section) === project.section);
    if (!chief || chief.id === project.leadBotId) return;
    try {
      this.deps.registry.replace({ ...project, leadBotId: chief.id });
    } catch (error) {
      this.log(`the lead of ${project.name} was not recorded: ${detailOf(error)}`);
    }
  }

  private touch(projectId: string): void {
    this.staleCopies.add(projectId);
    this.deps.schedule(() => this.flushCopies());
  }

  /** Every project's copies may be behind their sources: the context or the team memory changed, or a bot left. */
  touchAll(): void {
    this.everyCopyStale = true;
    this.deps.schedule(() => this.flushCopies());
  }

  flushCopies(): void {
    if (!this.deps.registry.readable) return;
    const all = this.everyCopyStale;
    const stale = new Set(this.staleCopies);
    this.everyCopyStale = false;
    this.staleCopies.clear();
    for (const project of this.deps.registry.projects()) {
      if (!all && !stale.has(project.id)) continue;
      try { this.writeCopies(project); } catch (error) { this.log(`the copies of ${project.name} were not updated: ${detailOf(error)}`); }
    }
  }

  private writeCopies(project: StoredTeamProject): "written" | "missing" | "refused" {
    const files = renderTeamProjectCopies(publicRecord(project), { bots: (id) => this.botsOf(id), context: this.deps.context, memory: this.deps.memory });
    const print = JSON.stringify(files);
    if (this.writtenCopies.get(project.id) === print) return "written";
    const state = writeTeamProjectCopies(project.folder, files);
    if (state === "written") {
      this.writtenCopies.set(project.id, print);
      this.refusedCopies.delete(project.id);
      return state;
    }
    this.writtenCopies.delete(project.id);
    if (state === "refused" && !this.refusedCopies.has(project.id)) {
      this.refusedCopies.add(project.id);
      this.log(`the copies of ${project.name} are not written: .magic-team, team or team/personas in its folder is not a real folder`);
    }
    return state;
  }
}
