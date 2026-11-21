import { existsSync, readFileSync, rmSync } from "node:fs";
import { basename } from "node:path";

import { chiefScope } from "../shared/bot-owner.ts";
import { writeFileAtomic } from "./atomic.ts";

type SavedBot = {
  name?: unknown;
  section?: unknown;
  defaultBot?: { person?: string };
  teamProject?: unknown;
  chiefOfStaff?: unknown;
  managedSections?: unknown;
  createdBy?: string;
  reportsTo?: string;
};

const sectionOf = (bot: SavedBot): string => (typeof bot.section === "string" ? bot.section.trim() : "");
const isMainBot = (bot: SavedBot): boolean => Boolean(bot.defaultBot) && !bot.teamProject;
const scopeOf = (bot: SavedBot): string => chiefScope({ section: sectionOf(bot), createdBy: bot.createdBy, reportsTo: bot.reportsTo, defaultBot: bot.defaultBot });
const detailOf = (error: unknown) => (error instanceof Error ? error.message : String(error));
const stampOf = (now: Date) => now.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");

interface Moved {
  name: string;
  from: string;
  /** Who already led the general area, so the main bot stopped being a Chief. */
  yieldedTo?: string;
}

/**
 * The saved bots with each main bot in no department. A main bot that was a Chief stays the Chief of the general area,
 * unless that area already has one: that Chief stays, and the main bot is no longer a Chief.
 */
function withoutMainBotDepartments(bots: SavedBot[]): { bots: SavedBot[]; moved: Moved[] } {
  const moving = new Set(bots.filter((bot) => isMainBot(bot) && sectionOf(bot)));
  const chiefs = new Map(bots.filter((bot) => bot.chiefOfStaff === true && !moving.has(bot)).map((bot) => [scopeOf(bot), bot]));
  const moved: Moved[] = [];
  const next = bots.map((bot) => {
    if (!moving.has(bot)) return bot;
    const { section: _section, ...left } = bot;
    const name = typeof bot.name === "string" ? bot.name : "MagicBot";
    if (bot.chiefOfStaff !== true) {
      moved.push({ name, from: sectionOf(bot) });
      return left;
    }
    const rival = chiefs.get(scopeOf(left));
    if (!rival) {
      chiefs.set(scopeOf(left), left);
      moved.push({ name, from: sectionOf(bot) });
      return left;
    }
    const { managedSections: _managed, ...yielded } = left;
    moved.push({ name, from: sectionOf(bot), yieldedTo: typeof rival.name === "string" ? rival.name : "another bot" });
    return { ...yielded, chiefOfStaff: false };
  });
  return { bots: next, moved };
}

export interface MainBotDepartmentRun {
  /** The bots file, read before anything else reads it. */
  file: string;
  log(line: string): void;
  now?(): Date;
  write?(path: string, text: string): void;
}

/**
 * The main bot belongs to no department. Before the bots are read, a main bot saved in a department is moved out of it:
 * the file is backed up next to itself first, then replaced whole. When either fails nothing changes, and the next start
 * tries again.
 */
export function takeMainBotOutOfDepartments({ file, log, now = () => new Date(), write = (path, text) => writeFileAtomic(path, text, { mode: 0o600 }) }: MainBotDepartmentRun): void {
  if (!existsSync(file)) return;
  let text: string;
  let bots: unknown;
  try {
    text = readFileSync(file, "utf8");
    bots = JSON.parse(text);
    if (!Array.isArray(bots)) throw new Error("it does not hold a list of bots");
  } catch (error) {
    log(`main bot: ${basename(file)} could not be read, so the main bot was not checked: ${detailOf(error)}`);
    return;
  }
  const { bots: next, moved } = withoutMainBotDepartments(bots as SavedBot[]);
  if (!moved.length) return;
  const backup = `${file}.bak.${stampOf(now())}`;
  let backedUp = false;
  try {
    write(backup, text);
    backedUp = true;
    write(file, JSON.stringify(next));
  } catch (error) {
    if (backedUp) rmSync(backup, { force: true });
    for (const bot of moved) log(`main bot: ${bot.name} stays in the department ${bot.from} until the next start: ${detailOf(error)}`);
    return;
  }
  for (const bot of moved) {
    const chief = bot.yieldedTo ? ` and is no longer a Chief of Staff, since ${bot.yieldedTo} already leads the general area` : "";
    log(`main bot: ${bot.name} left the department ${bot.from}${chief}; ${basename(file)} was backed up to ${basename(backup)}`);
  }
}
