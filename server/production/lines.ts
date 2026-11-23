import { isUnfinishedTurn } from "../project-canvas/task-targets.ts";
import type { Message } from "../store.ts";

/** How a turn ended, read from the line that ends it. */
export type TurnEnd = { ok: true; reply: string } | { ok: false };

/** The end of a turn this line marks: its last reply once it is settled, or the row a failed or stopped turn ends with;
 * null for any other line. */
export function turnEndOf(message: Message): TurnEnd | null {
  if (message.role === "bot" && message.kind === "text" && message.turnTerminal === true && message.turnSucceeded !== undefined) {
    return message.turnSucceeded ? { ok: true, reply: message.text?.trim() ?? "" } : { ok: false };
  }
  return isUnfinishedTurn(message) ? { ok: false } : null;
}
