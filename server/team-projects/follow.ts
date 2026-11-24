import { takeImportName } from "../../shared/import-name.ts";
import { episodeCode } from "../../shared/production.ts";
import { COPY_FIELDS, type CopyField } from "../../shared/team-projects.ts";
import { sameModelSelection } from "../../shared/thread-model.ts";
import type { ModelSelection } from "../../shared/wire.ts";
import type { BotRecord } from "../store.ts";

type LookField = Exclude<CopyField, "name" | "soul" | "modelSelection">;

/** What a copy shows of its source besides its name, persona and model. */
export const FOLLOWED_FIELDS = COPY_FIELDS.filter((field): field is LookField => field !== "name" && field !== "soul" && field !== "modelSelection") satisfies ReadonlyArray<keyof BotRecord>;

const COPY_FIELD_NAMES: ReadonlySet<string> = new Set<string>(COPY_FIELDS satisfies ReadonlyArray<keyof BotRecord>);

export const isCopyField = (field: string): boolean => COPY_FIELD_NAMES.has(field);

export interface CopyUpdate {
  fields: Partial<BotRecord>;
  soul?: string;
  model?: ModelSelection;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

const cleared = (value: unknown) => value === undefined || value === null || value === "";

/** The fields a copy takes from its source that `changes` would set to something else. */
export function changedCopyFields(copy: BotRecord, changes: object): string[] {
  return Object.entries(changes).filter(([field, next]) => {
    if (!isCopyField(field)) return false;
    if (field === "modelSelection") return !(next && typeof next === "object" && sameModelSelection(next as ModelSelection, copy.modelSelection));
    if (field === "name") return typeof next !== "string" || next.trim() !== copy.name;
    const current = copy[field as keyof BotRecord];
    return !(cleared(next) && cleared(current)) && !same(next, current);
  }).map(([field]) => field);
}

/** The name a copy takes: its source's, with its episode after it when it is one episode's own bot, numbered when
 * another bot of the project has it already. */
export function copyName(source: Pick<BotRecord, "name">, otherNames: Iterable<string>, episode?: number): string {
  const name = episode === undefined ? source.name : `${source.name} ${episodeCode(episode)}`;
  return takeImportName(name, new Set([...otherNames].map((other) => other.trim().toLowerCase())));
}

/** What `copy` needs to show what `source` shows now: only what differs. Null when nothing does. */
export function copyUpdate(source: BotRecord, copy: BotRecord, otherNames: Iterable<string>): CopyUpdate | null {
  const fields: Partial<BotRecord> = {};
  const name = copyName(source, otherNames, copy.teamProject?.episode?.number);
  if (name !== copy.name) fields.name = name;
  for (const field of FOLLOWED_FIELDS) {
    if (!same(source[field], copy[field])) Object.assign(fields, { [field]: source[field] });
  }
  const update: CopyUpdate = { fields };
  if ((source.soul ?? "") !== (copy.soul ?? "")) update.soul = source.soul ?? "";
  if (!sameModelSelection(source.modelSelection, copy.modelSelection)) update.model = structuredClone(source.modelSelection);
  return Object.keys(fields).length || update.soul !== undefined || update.model ? update : null;
}
