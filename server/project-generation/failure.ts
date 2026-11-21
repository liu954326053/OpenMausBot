import type { GenerationFailure, GenerationFailureCode } from "../../shared/project-generation.ts";
import { redactSecretsInText } from "../../shared/redact.ts";
import type { ServerTextParams } from "../../shared/server-text.ts";
import { userError } from "../user-errors.ts";
import type { PROJECT_GENERATION_ERRORS } from "./error-text.ts";

export type GenerationErrorName = keyof typeof PROJECT_GENERATION_ERRORS extends `serverError.projectGeneration.${infer Name}` ? Name : never;

type Extra = Pick<GenerationFailure, "reason" | "problems" | "allowance">;

export function failure(code: GenerationFailureCode, name: GenerationErrorName, params?: ServerTextParams, extra: Extra = {}): GenerationFailure {
  return { code, ...userError(`serverError.projectGeneration.${name}`, params), ...extra };
}

/** Why a generation cannot go on, thrown inside project generation and answered where a route or a job catches it. */
export class GenerationRefused extends Error {
  readonly failure: GenerationFailure;

  constructor(said: GenerationFailure) {
    super(said.error);
    this.failure = said;
  }
}

export function refused(code: GenerationFailureCode, name: GenerationErrorName, params?: ServerTextParams, extra?: Extra): GenerationRefused {
  return new GenerationRefused(failure(code, name, params, extra));
}

const TEXT_LIMIT = 300;
const SCHEME = /^(bearer|basic|token)$/i;

/**
 * Security: an MCP server's own words may echo what it was sent. Every configured value (its address, header and env
 * values, and each word of them) is masked, then anything secret-shaped, before the words reach a job, a log or a person.
 */
export function maskedServerText(text: string, configured: readonly string[]): string {
  const values = configured.flatMap((value) => [value, ...value.split(/\s+/)]).filter((value) => value.length >= 6 && !SCHEME.test(value));
  let out = text.slice(0, TEXT_LIMIT * 4);
  for (const value of values.sort((a, b) => b.length - a.length)) out = out.split(value).join("«redacted»");
  out = redactSecretsInText(out).replace(/\s+/g, " ").trim();
  return out.length <= TEXT_LIMIT ? out : `${out.slice(0, TEXT_LIMIT - 1)}…`;
}
