import type { CanvasGenerationConfirmation, CanvasGenerationDecision } from "../../shared/project-canvas.ts";
import type { GenerationFailure } from "../../shared/project-generation.ts";
import type { ServerErrorBody } from "../../shared/server-text.ts";
import type { OptionCardData } from "../../shared/wire.ts";
import { newId } from "../contracts.ts";
import { conversationLanguage, serverLine } from "../server-lines.ts";
import { userError } from "../user-errors.ts";
import { canvasRefusalOf, type ProjectCanvasService } from "./service.ts";

export const CANVAS_GENERATE_TOOL = "canvas_generate";

type CardLine = { id: string; card?: OptionCardData };

export interface CanvasCardStore {
  messagesFor(threadId: string): readonly CardLine[];
  appendMessage(threadId: string, message: { role: "bot"; kind: "options"; card: OptionCardData }): { id: string };
  patchMessage(threadId: string, messageId: string, patch: { card: OptionCardData }): unknown;
}

export interface CanvasGenerationCardsDeps {
  store: CanvasCardStore;
  service: Pick<ProjectCanvasService, "projectOfBot" | "generate">;
  /** Hands the decision to the turn parked on this card; false when none took it. */
  answer(threadId: string, messageId: string, text: string): boolean;
}

const isOpen = (card: OptionCardData) => !card.answered && !card.dismissed && !card.expired;

type NoteForPerson = Required<Pick<ServerErrorBody, "error" | "errorKey">> & Pick<ServerErrorBody, "errorParams">;

/** What the bot hears once its card is answered. Only a model reads it. */
export function canvasGenerationDecisionText(asked: CanvasGenerationConfirmation, result: CanvasGenerationDecision): string {
  const head = `MagicBot generation decision ${asked.requestId}:`;
  const node = `"${asked.title}" (${asked.nodeId})`;
  if (result.state === "declined") {
    return `${head} the person declined generating ${node}, so nothing was generated and the node is as it was. Do not ask for it again unless they ask.`;
  }
  if (result.state === "started") {
    return `${head} the person confirmed, and the generation of ${node} started (job ${result.jobId}). Its node shows how it goes; what it makes lands to its right, connected from it.`;
  }
  return `${head} the person confirmed, but generation refused ${node} (${result.code}): ${result.error}`;
}

/** Hands an answered card's decision to the turn parked on it; true once that turn took it. A restart calls it again for
 * a card answered while no turn could take it. */
export function resumeCanvasGeneration(store: CanvasCardStore, threadId: string, messageId: string, answer: (text: string) => boolean): boolean {
  const card = store.messagesFor(threadId).find((line) => line.id === messageId)?.card, asked = card?.canvasGeneration;
  if (!card || !asked?.result || !answer(canvasGenerationDecisionText(asked, asked.result))) return false;
  if (!asked.resumed) store.patchMessage(threadId, messageId, { card: { ...card, canvasGeneration: { ...asked, resumed: true } } });
  return true;
}

/** The cards that ask the person about a bot's generation past its ceiling. */
export class CanvasGenerationCards {
  private readonly settling = new Map<string, Promise<void>>();
  private readonly deps: CanvasGenerationCardsDeps;

  constructor(deps: CanvasGenerationCardsDeps) {
    this.deps = deps;
  }

  /** Puts the card in the bot's conversation, unless one for the same node is open there already. */
  ask(request: { projectId: string; botId: string; threadId: string; nodeId: string; title: string; failure: GenerationFailure }): { requestId: string; already: boolean } {
    const { store } = this.deps;
    const open = store.messagesFor(request.threadId).find((line) => line.card?.canvasGeneration?.nodeId === request.nodeId && line.card.canvasGeneration.botId === request.botId && isOpen(line.card));
    if (open?.card?.canvasGeneration) return { requestId: open.card.canvasGeneration.requestId, already: true };
    const { failure } = request;
    const requestId = newId();
    const asked: CanvasGenerationConfirmation = {
      requestId, projectId: request.projectId, nodeId: request.nodeId, title: request.title, botId: request.botId, threadId: request.threadId,
      reasonKey: failure.errorKey, ...(failure.errorParams ? { reasonParams: failure.errorParams } : {}), createdAt: Date.now(),
    };
    const card: OptionCardData = {
      title: serverLine(conversationLanguage(request.threadId), "server.projectCanvas.generationCard.title", { title: request.title }),
      subtitle: failure.error,
      options: ["Confirm", "Cancel"], requestId, tool: CANVAS_GENERATE_TOOL, fixedOptions: true, canvasGeneration: asked,
    };
    store.appendMessage(request.threadId, { role: "bot", kind: "options", card });
    return { requestId, already: false };
  }

  /** Confirm starts the node for the bot as it is now; anything else leaves it as it is. Undefined when no canvas
   * generation card has this id. The bot's parked turn hears the decision once. */
  async answer(threadId: string, requestId: string, behavior: string): Promise<"allowed-once" | "rejected" | undefined> {
    const { store } = this.deps;
    const find = () => store.messagesFor(threadId).find((line) => line.card?.requestId === requestId && line.card.canvasGeneration);
    const line = find();
    if (!line?.card?.canvasGeneration) return undefined;
    if (isOpen(line.card)) {
      let settling = this.settling.get(requestId);
      if (!settling) {
        settling = this.settle(threadId, line.id, line.card.canvasGeneration, behavior === "allow", find).finally(() => this.settling.delete(requestId));
        this.settling.set(requestId, settling);
      }
      await settling;
    }
    const settled = find()?.card;
    if (settled?.canvasGeneration?.result && !settled.canvasGeneration.resumed) {
      resumeCanvasGeneration(store, threadId, line.id, (text) => this.deps.answer(threadId, line.id, text));
    }
    return settled?.answered === "allow" ? "allowed-once" : "rejected";
  }

  private async settle(threadId: string, messageId: string, asked: CanvasGenerationConfirmation, allowed: boolean, find: () => CardLine | undefined): Promise<void> {
    const { result, noteForPerson } = allowed ? await this.confirm(asked) : { result: { state: "declined" } as const };
    const current = find()?.card;
    if (!current?.canvasGeneration) return;
    const held = noteForPerson && { held: noteForPerson.error, heldCode: noteForPerson.errorKey, ...(noteForPerson.errorParams ? { heldParams: noteForPerson.errorParams } : {}) };
    this.deps.store.patchMessage(threadId, messageId, { card: {
      ...current, answered: allowed ? "allow" : "deny", ...held,
      canvasGeneration: { ...current.canvasGeneration, result },
    } });
  }

  private async confirm(asked: CanvasGenerationConfirmation): Promise<{ result: CanvasGenerationDecision; noteForPerson?: NoteForPerson }> {
    const refused = (code: string, error: string, noteForPerson: NoteForPerson) => ({ result: { state: "refused", code, error } as const, noteForPerson });
    try {
      const project = this.deps.service.projectOfBot(asked.botId);
      if (project.id !== asked.projectId) {
        const notMember = userError("serverError.projectCanvas.notMember");
        return refused("not_member", notMember.error, notMember);
      }
      const outcome = await this.deps.service.generate(project, { kind: "bot", botId: asked.botId, confirmed: true }, asked.nodeId);
      return "job" in outcome ? { result: { state: "started", jobId: outcome.job.id } } : refused(outcome.refused.code, outcome.refused.error, outcome.refused);
    } catch (error) {
      const canvas = canvasRefusalOf(error);
      if (!canvas) throw error;
      const { code, errorKey, errorParams } = canvas.body as Partial<ServerErrorBody>;
      const forBot = canvas.body.error;
      return refused(typeof code === "string" ? code : String(canvas.status), forBot,
        typeof errorKey === "string" ? { error: forBot, errorKey, ...(errorParams ? { errorParams } : {}) } : userError("serverError.projectCanvas.generationChanged"));
    }
  }
}