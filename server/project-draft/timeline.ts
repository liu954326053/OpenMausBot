import type { DraftShot } from "./canvas.ts";
import { refuse } from "./refusal.ts";
import type { StoredTimeline } from "./store.ts";

/** The canvas's shots as the film uses them: the ones that play, in order, and the ones left out. A shot nobody
 * ordered plays after the ordered ones, in the canvas's order. */
export function arrangedShots(shots: readonly DraftShot[], stored: Pick<StoredTimeline, "order" | "leftOut">): { playing: DraftShot[]; leftOut: DraftShot[] } {
  const byId = new Map(shots.map((shot) => [shot.shotId, shot]));
  const out = new Set(stored.leftOut);
  const ordered = [...new Set(stored.order)].filter((id) => byId.has(id) && !out.has(id));
  const placed = new Set(ordered);
  return {
    playing: [...ordered.map((id) => byId.get(id)!), ...shots.filter((shot) => !placed.has(shot.shotId) && !out.has(shot.shotId))],
    leftOut: shots.filter((shot) => out.has(shot.shotId)),
  };
}

/** What to store for a `ProjectTimelineInput`: the shots it names play in its order and the canvas's other shots are
 * left out. Refused when an id is not a shot of the project. */
export function orderFrom(shots: readonly DraftShot[], body: unknown): Pick<StoredTimeline, "order" | "leftOut"> {
  const shotIds = body && typeof body === "object" && !Array.isArray(body) ? (body as { shotIds?: unknown }).shotIds : undefined;
  if (!Array.isArray(shotIds) || shotIds.some((id) => typeof id !== "string") || new Set(shotIds).size !== shotIds.length) {
    throw refuse(400, "serverError.projectDraft.orderInvalid");
  }
  const order = shotIds as string[];
  const known = new Set(shots.map((shot) => shot.shotId));
  const unknown = order.find((id) => !known.has(id));
  if (unknown !== undefined) throw refuse(422, "serverError.projectDraft.unknownShot", { shot: unknown.slice(0, 200) });
  const named = new Set(order);
  return { order, leftOut: shots.filter((shot) => !named.has(shot.shotId)).map((shot) => shot.shotId) };
}
