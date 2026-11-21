/** How the person answered. `started`: they confirmed and the job began. `refused`: they confirmed, but generation refused
 * it then; `code` and `error` (English) are generation's. `declined`: nothing was generated. */
export type CanvasGenerationDecision =
  | { state: "started"; jobId: string }
  | { state: "refused"; code: string; error: string }
  | { state: "declined" };

/** A project's bot asked to generate one of its canvas nodes past its ceiling, so the person confirms on a card first.
 * Confirm starts the node as it is then, for that bot. The card's `subtitle` is generation's reason in English;
 * `reasonKey`, a `serverError.projectGeneration.*` key, and `reasonParams` give it in the person's language. Everything
 * Confirm needs is here, so the card can still be answered after a restart. */
export interface CanvasGenerationConfirmation {
  requestId: string;
  projectId: string;
  nodeId: string;
  /** The node's title when the card was made. */
  title: string;
  botId: string;
  threadId: string;
  reasonKey: string;
  reasonParams?: Record<string, string | number>;
  createdAt: number;
  result?: CanvasGenerationDecision;
  /** The bot's parked turn heard the result. */
  resumed?: boolean;
}

export interface CanvasGenerationCardField {
  canvasGeneration?: CanvasGenerationConfirmation;
}
