import { mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";

import { writeFileAtomic } from "../atomic.ts";
import type { StoredLines } from "./tree.ts";

/** Team memory key → the lines placed in that team's flow. */
export type StoredFlows = Readonly<Record<string, StoredLines>>;

/** `text` is what the file held when read, null when there was none: a write goes ahead only over that text. */
export type FlowFile = ({ readable: true; teams: StoredFlows } | { readable: false; problem: string }) & { text: string | null };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

function parsed(input: unknown): StoredFlows | null {
  if (!isRecord(input) || input.version !== 1 || !isRecord(input.teams)) return null;
  const teams: Record<string, Record<string, string>> = Object.create(null);
  for (const [key, lines] of Object.entries(input.teams)) {
    if (!isRecord(lines)) return null;
    const own: Record<string, string> = Object.create(null);
    for (const [botId, superiorId] of Object.entries(lines)) {
      if (typeof superiorId !== "string" || !botId || !superiorId) return null;
      own[botId] = superiorId;
    }
    teams[key] = own;
  }
  return teams;
}

export function readFlowFile(path: string): FlowFile {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { readable: true, teams: Object.create(null), text: null };
    return { readable: false, problem: messageOf(error), text: null };
  }
  try {
    const teams = parsed(JSON.parse(text));
    return teams ? { readable: true, teams, text } : { readable: false, problem: "it does not hold team flows this version can read", text };
  } catch (error) {
    return { readable: false, problem: messageOf(error), text };
  }
}

/** Returns the text written. */
export function writeFlowFile(path: string, teams: StoredFlows): string {
  const text = `${JSON.stringify({ version: 1, teams }, null, 2)}\n`;
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileAtomic(path, text, { mode: 0o600 });
  return text;
}
