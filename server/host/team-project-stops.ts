import { serverLine } from "../server-lines.ts";
import { teamProjectStop, type TeamProjectStop } from "../team-project-folders.ts";
import type { BotHolds } from "./bot-holds.ts";

interface StoppedBot {
  id: string;
  name: string;
  color: string;
}

export interface TeamProjectStops extends BotHolds {
  /** Says in a room why this bot was passed over: once per conversation and reason, until the bot may run again. */
  noteRoomSkip(botId: string, threadId: string, language?: string): void;
}

/**
 * A project bot whose project folder is not there, whose project is archived, or whose project nothing knows takes no
 * new work, through the same questions every way work starts already asks about a bot the person paused. Who the person
 * paused (`heldBots`, `state`, `set`) stays what it was: the person did not pause these.
 */
export function withTeamProjectStops(
  holds: BotHolds,
  deps: {
    bot(botId: string): StoppedBot | undefined;
    note(threadId: string, bot: StoppedBot, line: string): void;
    stop?(botId: string): TeamProjectStop | null;
  },
): TeamProjectStops {
  const stopOf = deps.stop ?? teamProjectStop;
  const noted = new Map<string, Map<string, TeamProjectStop["reason"]>>();

  const stopped = (botId: string): { bot: StoppedBot; stop: TeamProjectStop } | null => {
    const stop = stopOf(botId);
    const bot = stop ? deps.bot(botId) : undefined;
    if (stop && bot) return { bot, stop };
    noted.delete(botId);
    return null;
  };

  const line = (found: { bot: StoppedBot; stop: TeamProjectStop }, language: string | undefined) => {
    if (found.stop.reason === "folder_missing") return serverLine(language, "server.teamProjectBot.folderMissing", { bot: found.bot.name, folder: found.stop.folder });
    return serverLine(language, found.stop.reason === "archived" ? "server.teamProjectBot.archived" : "server.teamProjectBot.unknown", { bot: found.bot.name });
  };

  return {
    held: (botId) => stopped(botId) !== null || holds.held(botId),
    heldBots: () => holds.heldBots(),
    state: () => holds.state(),
    text(botId, language) {
      const found = stopped(botId);
      return found ? line(found, language) : holds.text(botId, language);
    },
    handoff(botId) {
      const found = stopped(botId);
      if (!found) return holds.handoff(botId);
      const closing = " Do not retry, and do not hand this to another bot to work around it.";
      if (found.stop.reason === "folder_missing") {
        return `@${found.bot.name} can't take work right now: the folder of the project it belongs to was not found at ${found.stop.folder}, so nothing was handed to it. `
          + `Tell the person in one line that the drive has to be reconnected or the folder put back.${closing}`;
      }
      if (found.stop.reason === "archived") {
        return `@${found.bot.name} takes no new work because the project it belongs to is archived, so nothing was handed to it. `
          + `Tell the person in one line that they can restore the project in Settings → Data.${closing}`;
      }
      return `@${found.bot.name} can't take work right now: MagicBot has no record of the project it belongs to, so nothing was handed to it. `
        + `Tell the person in one line that projects.json in MagicBot's data folder has to be restored from a backup.${closing}`;
    },
    set: (kind, id, paused) => holds.set(kind, id, paused),
    forget: (kind, id) => holds.forget(kind, id),
    rename: (from, to) => holds.rename(from, to),
    noteRoomSkip(botId, threadId, language) {
      const found = stopped(botId);
      if (!found) return;
      const threads = noted.get(botId) ?? new Map<string, TeamProjectStop["reason"]>();
      if (threads.get(threadId) === found.stop.reason) return;
      threads.set(threadId, found.stop.reason);
      noted.set(botId, threads);
      deps.note(threadId, found.bot, line(found, language));
    },
  };
}
