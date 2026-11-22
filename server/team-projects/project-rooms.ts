import type { TeamProjectRecord } from "../../shared/team-projects.ts";
import { serverLine } from "../server-lines.ts";
import type { BotRecord, GroupRecord, Store, StoreChange } from "../store.ts";
import type { StoredTeamProject, TeamProjectRegistry } from "./registry.ts";

/** A project's group chat, as the parts that send into it see it. */
export interface ProjectRoom {
  groupId: string;
  threadId: string;
  memberIds: readonly string[];
}

/** The project's group chat; undefined while it has none. */
export function projectRoom(store: Pick<Store, "group">, project: Pick<TeamProjectRecord, "roomId">): ProjectRoom | undefined {
  const group = project.roomId ? store.group(project.roomId) : undefined;
  return group && !group.dm ? { groupId: group.id, threadId: group.threadId, memberIds: group.memberIds } : undefined;
}

/** The project whose group chat has this conversation. */
export function projectOfRoomThread(store: Pick<Store, "groupByThread">, projects: () => ReadonlyArray<Pick<TeamProjectRecord, "id" | "roomId">>, threadId: string): string | undefined {
  const group = store.groupByThread(threadId);
  return group ? projects().find((project) => project.roomId === group.id)?.id : undefined;
}

export interface ProjectRoomsDeps {
  registry: Pick<TeamProjectRegistry, "readable" | "projects" | "find" | "replace">;
  store: Pick<Store, "bots" | "group" | "createGroup" | "patchGroup" | "deleteGroup" | "onChange">;
  /** Changes the room as the person would, with the same refusals; throws when it may not change now. */
  updateRoom(groupId: string, patch: { memberIds: string[] }): GroupRecord;
  /** Tells the open apps about a room made or changed here. */
  published(group: GroupRecord): void;
  /** The language the server writes its own lines in. */
  language(): string | undefined;
  /** Calls `retry` once, a while later. */
  later(retry: () => void): void;
  log(line: string): void;
}

/** The project's bots, its lead first. */
function botsOf(project: StoredTeamProject, bots: readonly BotRecord[]): BotRecord[] {
  const own = bots.filter((bot) => bot.teamProject?.id === project.id);
  return [...own.filter((bot) => bot.id === project.leadBotId), ...own.filter((bot) => bot.id !== project.leadBotId)];
}

const detailOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * Each project's group chat: made with the project, or for a project made before there were any, with all its bots and
 * its lead answering by default, in its folder. A bot that joins the project later joins its room once; one the person
 * takes out of the room stays out.
 */
export class ProjectRooms {
  private readonly deps: ProjectRoomsDeps;
  /** By project: the bots its room was given, or that were in the project when it was last looked at. */
  private readonly offered = new Map<string, Set<string>>();
  private readonly retrying = new Set<string>();

  constructor(deps: ProjectRoomsDeps) {
    this.deps = deps;
  }

  /** Makes the rooms the projects lack, and from then on adds the bots that join a project to its room. Returns how to stop. */
  start(): () => void {
    if (this.deps.registry.readable) for (const project of this.deps.registry.projects()) this.ensure(project.id);
    return this.deps.store.onChange((change) => this.changed(change));
  }

  /** The project's room, made now for a project that never had one; undefined while it has no bot, and once the person
   * deleted its room. */
  ensure(projectId: string): GroupRecord | undefined {
    const project = this.deps.registry.find(projectId);
    if (!project) return undefined;
    const bots = botsOf(project, this.deps.store.bots);
    if (project.roomId) {
      this.offered.set(project.id, new Set(bots.map((bot) => bot.id)));
      return this.deps.store.group(project.roomId);
    }
    if (!bots.length) return undefined;
    const name = serverLine(this.deps.language(), "server.teamProject.roomName", { project: project.name });
    const made = this.deps.store.createGroup(name, bots.map((bot) => bot.id), false, project.section, {
      defaultResponder: { kind: "member", botId: bots[0]!.id },
      completed: true,
    });
    try {
      if (!this.deps.registry.replace({ ...project, roomId: made.id })) throw new Error("the project is gone");
    } catch (error) {
      this.deps.store.deleteGroup(made.id);
      this.deps.log(`team projects: no group chat was made for ${project.name}: ${detailOf(error)}`);
      return undefined;
    }
    const room = this.deps.store.patchGroup(made.id, { cwd: project.folder }) ?? made;
    this.offered.set(project.id, new Set(bots.map((bot) => bot.id)));
    this.deps.published(room);
    return room;
  }

  private changed(change: StoreChange): void {
    if (change.type !== "bot") return;
    const projectId = this.deps.store.bots.find((bot) => bot.id === change.botId)?.teamProject?.id;
    if (projectId) this.join(projectId, change.botId);
  }

  /** A project's bot joins its room, unless the room was given it already or the project's room is not made yet. */
  private join(projectId: string, botId: string): void {
    const offered = this.offered.get(projectId);
    if (!offered || offered.has(botId)) return;
    const project = this.deps.registry.find(projectId);
    const room = project?.roomId ? this.deps.store.group(project.roomId) : undefined;
    if (!room || room.memberIds.includes(botId)) {
      offered.add(botId);
      return;
    }
    try {
      const updated = this.deps.updateRoom(room.id, { memberIds: [...room.memberIds, botId] });
      offered.add(botId);
      this.deps.published(updated);
    } catch (error) {
      const key = `${projectId}:${botId}`;
      if (this.retrying.has(key)) return;
      this.retrying.add(key);
      this.deps.log(`team projects: a bot of ${project!.name} did not join its group chat yet: ${detailOf(error)}`);
      this.deps.later(() => {
        this.retrying.delete(key);
        this.join(projectId, botId);
      });
    }
  }
}
