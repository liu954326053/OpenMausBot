import {
  BOT_GENERATION_CEILING, BOT_GENERATION_WINDOW_MS, type BotGenerationAllowance, type GenerationFailure, type GenerationKind, type GenerationRequester,
} from "../../shared/project-generation.ts";
import { failure } from "./failure.ts";
import type { GenerationStore } from "./store.ts";

interface Started {
  botId: string;
  kind: GenerationKind;
  results: number;
  at: number;
}

const isStarted = (value: unknown): value is Started => {
  const entry = value as Partial<Started> | null;
  return Boolean(entry) && typeof entry!.botId === "string" && (entry!.kind === "image" || entry!.kind === "video")
    && typeof entry!.results === "number" && typeof entry!.at === "number";
};

/** What each bot started without the person, so one bot can't spend without end: past its ceiling, the person confirms. */
export class BotCeiling {
  private started: Started[];
  private readonly store: GenerationStore;
  private readonly now: () => number;

  constructor(store: GenerationStore, now: () => number = Date.now) {
    this.store = store;
    this.now = now;
    this.started = store.botLedger().filter(isStarted);
  }

  private recent(): Started[] {
    const since = this.now() - BOT_GENERATION_WINDOW_MS;
    return this.started.filter((entry) => entry.at > since);
  }

  allowance(botId: string): BotGenerationAllowance {
    const used = (kind: GenerationKind) => this.recent().filter((entry) => entry.botId === botId && entry.kind === kind).reduce((sum, entry) => sum + entry.results, 0);
    return {
      image: { used: used("image"), ceiling: BOT_GENERATION_CEILING.image },
      video: { used: used("video"), ceiling: BOT_GENERATION_CEILING.video },
      windowMs: BOT_GENERATION_WINDOW_MS,
    };
  }

  /** Why this request needs the person first; null when it may start. */
  check(requester: GenerationRequester, kind: GenerationKind, results: number): GenerationFailure | null {
    if (requester.kind !== "bot" || requester.confirmed) return null;
    const { used, ceiling } = this.allowance(requester.botId)[kind];
    if (used + results <= ceiling) return null;
    return failure("confirmation_needed", kind === "image" ? "confirmImages" : "confirmVideos", { ceiling, used, asked: results }, { allowance: { used, ceiling, asked: results } });
  }

  record(requester: GenerationRequester, kind: GenerationKind, results: number): void {
    if (requester.kind !== "bot" || requester.confirmed) return;
    this.started = [...this.recent(), { botId: requester.botId, kind, results, at: this.now() }];
    this.store.saveBotLedger(this.started);
  }
}
