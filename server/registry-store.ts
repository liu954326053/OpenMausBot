// Where the Store keeps its bots, rooms and their threads. The Store says what changed (one thread, one owner's record,
// an owner gone, the whole list) and how soon it must be on disk; the registry decides how to write that. Today's one
// layout keeps everything in bots.json and groups.json, each rewritten whole for any change: temp file, fsync, rename,
// owner-only, skipped when the text is unchanged. A layout that keeps threads as rows can write one row where this one
// writes a whole file, behind the same calls.
import { chmodSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { OwnedFile } from "./atomic.ts";
import { DATA_DIR } from "./config.ts";
import { batchSaves, saveByIterationEnd, saveLater, supersedeWaitingSaves } from "./save-batch.ts";
import type { BotRecord, GroupRecord } from "./store.ts";

export const BOTS_FILE = join(DATA_DIR, "bots.json");
export const GROUPS_FILE = join(DATA_DIR, "groups.json");

export type RegistryOwner = { kind: "bot" | "group"; id: string };

/**
 * How soon a change must be on disk:
 * - "now": before the call returns, synced. Creates, deletions, permissions, anything a person asked for; a failure
 *   throws, so the caller can put memory back (server/registry-save.ts commitRegistryChange).
 * - "pass": on disk by the end of the current event-loop iteration (from a setImmediate callback: of the next one), in
 *   one write of the file with every other "pass" change of that iteration (server/save-batch.ts saveByIterationEnd).
 *   A turn's bookkeeping: an engine session, which engine has the thread, what was handed to it, when the person last
 *   wrote, a title, a read mark. A crash, a kill or a fatal exit before then loses that iteration's changes and leaves
 *   the last whole file; a graceful stop or a clean exit writes them first. One committed with commitRegistryChange
 *   outside `batch` is written before the call returns, as "now" is, so a failed write still puts it back.
 * - "later": within SAVE_LATER_MAX_MS (server/save-batch.ts saveLater). Only what server/registry-save.ts
 *   DEFERRABLE_FIELDS allows, and a thread's usage: harmless to lose in a crash. Bots only: nothing of a room waits,
 *   and no room save supersedes a waiting write, so the types refuse "later" for a room.
 */
export type RegistryDurability = "now" | "pass" | "later";

export interface RegistryStore {
  /** The saved bots as parsed; throws when nothing readable is saved, which must never read as "every bot was deleted". */
  loadBots(): BotRecord[];
  /** The saved rooms as parsed; throws when nothing readable is saved. */
  loadGroups(): GroupRecord[];
  /** Every bot and its threads as `bots` holds them, synced before it returns (inside saveBotsOnceAfter, when the pass
   * returns). `bots` may be a list that is not live yet (saved first, so a failure leaves memory alone); `current` says
   * it is the live list, holding every change. */
  writeBots(bots: readonly BotRecord[], current: boolean): void;
  /** Every room and its threads as `groups` holds them, synced before it returns. */
  writeGroups(groups: readonly GroupRecord[]): void;
  /**
   * One owner's thread changed (`threadId`), or its record or any of its threads (undefined). `write` is the Store's
   * own save of the whole list (what rollback and tests hook); it runs when `durability` says, and it throws when it
   * runs before the call returns.
   * A row layout narrows that save to the one thread; this one writes the whole file.
   */
  upsertThread(owner: RegistryOwner & { kind: "bot" }, threadId: string | undefined, durability: RegistryDurability, write: () => void): void;
  upsertThread(owner: RegistryOwner & { kind: "group" }, threadId: string | undefined, durability: Exclude<RegistryDurability, "later">, write: () => void): void;
  /** An owner and all its threads leave the registry; `write` saves the list without it, synced, before it returns. */
  deleteOwner(owner: RegistryOwner, write: () => void): void;
  /** Every "pass" change while `run` runs waits for the end of the iteration, one committed with commitRegistryChange
   * too (a failed write is then logged, and memory keeps the change for the next save): one transaction in a row layout. */
  batch<T>(run: () => T): T;
}

/** Owner-only (0600): the registries hold souls, project paths and per-bot settings. Best effort; Windows has no POSIX mode bits. */
function tightenRegistryFile(file: string): void {
  if (process.platform === "win32") return;
  try {
    if ((statSync(file).mode & 0o077) !== 0) chmodSync(file, 0o600);
  } catch {
  }
}

export function persistedPin<T extends { pinned?: boolean }>(task: T): T {
  if (task.pinned === true) return task;
  if (!("pinned" in task)) return task;
  const { pinned: _pinned, ...rest } = task;
  return rest as T;
}

/** What bots.json holds: live state (busy, activity, a turn's start) is never saved. */
export const persistedBots = (bots: readonly BotRecord[]) => bots.map(({ busy: _busy, activity: _activity, ...bot }) => ({ ...bot,
  tasks: bot.tasks?.map(({ busy: _taskBusy, activity: _taskActivity, turnStartedAt: _taskTurnStarted, ...task }) => persistedPin(task)),
}));

let passDepth = 0;
const waitingBots = new Map<JsonRegistry, () => void>();

/**
 * Every save of the bots asked for while `run` runs waits, and the last list asked for is written once when it
 * returns: for a pass that changes many bots, each change of which is made again when it is lost (copies follow their
 * source again at the next start). A failure then is logged, not thrown, and memory keeps the changes for the next
 * save. A bot's deletion is still written at once, before its files go.
 */
export function saveBotsOnceAfter<T>(run: () => T): T {
  passDepth += 1;
  try {
    return run();
  } finally {
    passDepth -= 1;
    if (passDepth === 0) writeWaitingBots();
  }
}

function writeWaitingBots(): void {
  for (const [registry, write] of waitingBots) {
    waitingBots.delete(registry);
    try {
      write();
    } catch (error) {
      console.error("the bots changed in one pass were not saved; the next save writes them", error);
    }
  }
}

/** What groups.json holds: a room's running turn is never saved. */
export const persistedGroups = (groups: readonly GroupRecord[]) => groups.map(({ busyBotId: _busyBotId, turnStartedAt: _turnStartedAt, ...g }) => ({
  ...g,
  ...(g.tasks ? { tasks: g.tasks.map((task) => persistedPin(task)) } : {}),
}));

/** Today's layout: bots.json and groups.json, each the whole list with its threads. */
export class JsonRegistry implements RegistryStore {
  private readonly botsFile = new OwnedFile(BOTS_FILE, { mode: 0o600 });
  private readonly groupsFile = new OwnedFile(GROUPS_FILE, { mode: 0o600 });
  private writingDeletion = false;

  loadBots(): BotRecord[] {
    tightenRegistryFile(BOTS_FILE);
    supersedeWaitingSaves(BOTS_FILE); // the file is read afresh, so a write still waiting has nothing left to add
    const text = readFileSync(BOTS_FILE, "utf8"), bots = JSON.parse(text) as BotRecord[];
    this.botsFile.loaded(text);
    return bots;
  }

  loadGroups(): GroupRecord[] {
    tightenRegistryFile(GROUPS_FILE);
    supersedeWaitingSaves(GROUPS_FILE);
    const text = readFileSync(GROUPS_FILE, "utf8"), groups = JSON.parse(text) as GroupRecord[];
    this.groupsFile.loaded(text);
    return groups;
  }

  writeBots(bots: readonly BotRecord[], current: boolean): void {
    if (passDepth > 0 && !this.writingDeletion) waitingBots.set(this, () => this.writeWholeBots(bots, current));
    else this.writeWholeBots(bots, current);
  }

  private writeWholeBots(bots: readonly BotRecord[], current: boolean): void {
    this.botsFile.write(JSON.stringify(persistedBots(bots)));
    waitingBots.delete(this);
    if (current) supersedeWaitingSaves(BOTS_FILE);
  }

  writeGroups(groups: readonly GroupRecord[]): void {
    this.groupsFile.write(JSON.stringify(persistedGroups(groups)));
  }

  upsertThread(owner: RegistryOwner, _threadId: string | undefined, durability: RegistryDurability, write: () => void): void {
    if (durability === "pass") saveByIterationEnd(owner.kind === "bot" ? BOTS_FILE : GROUPS_FILE, write);
    else if (durability === "later") saveLater(BOTS_FILE, write); // bots only (see RegistryDurability)
    else write();
  }

  deleteOwner(owner: RegistryOwner, write: () => void): void {
    this.writingDeletion = owner.kind === "bot";
    try {
      write();
    } finally {
      this.writingDeletion = false;
    }
    supersedeWaitingSaves(owner.kind === "bot" ? BOTS_FILE : GROUPS_FILE);
  }

  batch<T>(run: () => T): T {
    return batchSaves(run);
  }
}
