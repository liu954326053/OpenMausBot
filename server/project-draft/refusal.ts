import type { ServerTextParams } from "../../shared/server-text.ts";
import { userError, type UserErrorKey } from "../user-errors.ts";

/** A request the draft module does not carry out, with the status and body it is answered with. */
export class DraftRefusal extends Error {
  readonly status: number;
  readonly body: { error: string } & Record<string, unknown>;
  constructor(status: number, body: { error: string } & Record<string, unknown>) {
    super(body.error);
    this.status = status;
    this.body = body;
  }
}

export const refuse = (status: number, key: UserErrorKey, params?: ServerTextParams): DraftRefusal => new DraftRefusal(status, userError(key, params));

/** How a refused request is answered; null for an error that is not a refusal. What the canvas refuses is answered as
 * the canvas words it. */
export function draftRefusalOf(error: unknown): { status: number; body: { error: string } & Record<string, unknown> } | null {
  if (error instanceof DraftRefusal) return { status: error.status, body: error.body };
  const sent = error as { status?: unknown; body?: unknown } | null;
  if (!(error instanceof Error) || typeof sent?.status !== "number") return null;
  return { status: sent.status, body: { error: error.message, ...(sent.body && typeof sent.body === "object" ? sent.body : {}) } };
}
