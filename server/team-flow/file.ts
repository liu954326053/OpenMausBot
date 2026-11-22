import { mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";

import { PIPELINE_STAGES, type FlowLineWire, type FlowStage } from "../../shared/team-pipeline.ts";
import { writeFileAtomic } from "../atomic.ts";

/** What `team-flows.json` holds of one team. A member in none of these is still to be judged. */
export interface StoredPipeline {
  /** Member → the stages it was given; never the lead's. */
  stages: Readonly<Record<string, readonly FlowStage[]>>;
  /** Member → the fingerprint of its name, title, description and soul when its stages were judged. */
  judged: Readonly<Record<string, string>>;
  /** The members whose lines the person set by hand. */
  manual: readonly string[];
  /** The lines the person drew, in the order drawn, and the stages' lines the person took away. */
  added: readonly FlowLineWire[];
  removed: readonly FlowLineWire[];
}

/** Team memory key → that team's pipeline. */
export type StoredPipelines = Readonly<Record<string, StoredPipeline>>;

/** `text` is what the file held when read, null when there was none: a write goes ahead only over that text.
 * `upgraded` says the text is an older version's, so the pipelines are still to be written as this version's. */
export type FlowFile = ({ readable: true; teams: StoredPipelines; upgraded: boolean } | { readable: false; problem: string }) & { text: string | null };

const MEMBER_STAGES: readonly unknown[] = [...PIPELINE_STAGES, "other"];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

function dictionary<T>(input: unknown, value: (entry: unknown) => T | null): Record<string, T> | null {
  if (input === undefined) return Object.create(null);
  if (!isRecord(input)) return null;
  const out: Record<string, T> = Object.create(null);
  for (const [key, entry] of Object.entries(input)) {
    const read = key ? value(entry) : null;
    if (read === null) return null;
    out[key] = read;
  }
  return out;
}

function list<T>(input: unknown, value: (entry: unknown) => T | null): T[] | null {
  if (input === undefined) return [];
  if (!Array.isArray(input)) return null;
  const out: T[] = [];
  for (const entry of input) {
    const read = value(entry);
    if (read === null) return null;
    out.push(read);
  }
  return out;
}

const id = (entry: unknown): string | null => (typeof entry === "string" && entry ? entry : null);
const stage = (entry: unknown): FlowStage | null => (MEMBER_STAGES.includes(entry) ? (entry as FlowStage) : null);
const line = (entry: unknown): FlowLineWire | null => {
  if (!isRecord(entry)) return null;
  const from = id(entry.from), to = id(entry.to);
  return from !== null && to !== null ? { from, to } : null;
};

/** One team's pipeline as this version stores it; null for anything else. */
export function storedPipeline(input: unknown): StoredPipeline | null {
  if (!isRecord(input)) return null;
  const stages = dictionary(input.stages, (entry) => list(entry, stage));
  const judged = dictionary(input.judged, id);
  const manual = list(input.manual, id);
  const added = list(input.added, line);
  const removed = list(input.removed, line);
  return stages && judged && manual && added && removed ? { stages, judged, manual, added, removed } : null;
}

/** Version 1 held, per team, each placed member → its one superior. */
function upgradedPipeline(input: unknown): StoredPipeline | null {
  const superiors = input === undefined ? null : dictionary(input, id);
  if (!superiors) return null;
  const placed = Object.entries(superiors);
  return {
    stages: Object.create(null), judged: Object.create(null),
    manual: placed.map(([member]) => member),
    added: placed.map(([member, superior]) => ({ from: superior, to: member })),
    removed: [],
  };
}

function parsed(input: unknown): { teams: StoredPipelines; upgraded: boolean } | null {
  if (!isRecord(input) || (input.version !== 1 && input.version !== 2) || !isRecord(input.teams)) return null;
  const upgraded = input.version === 1;
  const teams = dictionary(input.teams, upgraded ? upgradedPipeline : storedPipeline);
  return teams && { teams, upgraded };
}

export function readFlowFile(path: string): FlowFile {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { readable: true, teams: Object.create(null), upgraded: false, text: null };
    return { readable: false, problem: messageOf(error), text: null };
  }
  try {
    const read = parsed(JSON.parse(text));
    return read ? { readable: true, ...read, text } : { readable: false, problem: "it does not hold team pipelines this version can read", text };
  } catch (error) {
    return { readable: false, problem: messageOf(error), text };
  }
}

/** Returns the text written. */
export function writeFlowFile(path: string, teams: StoredPipelines): string {
  const text = `${JSON.stringify({ version: 2, teams }, null, 2)}\n`;
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileAtomic(path, text, { mode: 0o600 });
  return text;
}
