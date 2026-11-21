import { takeImportName } from "../../shared/import-name.ts";
import { sameModelSelection } from "../../shared/thread-model.ts";
import type { ModelSelection } from "../../shared/wire.ts";
import type { BotRecord } from "../store.ts";

/** What a copy shows of its source besides its name, persona and model. */
export const FOLLOWED_FIELDS = [
  "title", "description", "color", "mascotExpression", "mascotBody", "mascotFaceColor",
  "avatarUrl", "avatarCrop", "avatarZoom", "avatarFocusX", "avatarFocusY",
] as const satisfies ReadonlyArray<keyof BotRecord>;

/** Every field of a copy that is its source's: a direct change to one of them is refused. */
export const COPY_FIELDS: ReadonlySet<string> = new Set(["name", "soul", "modelSelection", ...FOLLOWED_FIELDS]);

export interface CopyUpdate {
  fields: Partial<BotRecord>;
  soul?: string;
  model?: ModelSelection;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** The name a copy takes: its source's, numbered when another bot of the project has it already. */
export function copyName(source: Pick<BotRecord, "name">, otherNames: Iterable<string>): string {
  return takeImportName(source.name, new Set([...otherNames].map((name) => name.trim().toLowerCase())));
}

/** What `copy` needs to show what `source` shows now: only what differs. Null when nothing does. */
export function copyUpdate(source: BotRecord, copy: BotRecord, otherNames: Iterable<string>): CopyUpdate | null {
  const fields: Partial<BotRecord> = {};
  const name = copyName(source, otherNames);
  if (name !== copy.name) fields.name = name;
  for (const field of FOLLOWED_FIELDS) {
    if (!same(source[field], copy[field])) Object.assign(fields, { [field]: source[field] });
  }
  const update: CopyUpdate = { fields };
  if ((source.soul ?? "") !== (copy.soul ?? "")) update.soul = source.soul ?? "";
  if (!sameModelSelection(source.modelSelection, copy.modelSelection)) update.model = structuredClone(source.modelSelection);
  return Object.keys(fields).length || update.soul !== undefined || update.model ? update : null;
}
