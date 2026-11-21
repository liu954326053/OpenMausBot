import { afterEach, describe, expect, it } from "vitest";

import type { GenerationFailure, GenerationJob } from "../../shared/project-generation.ts";
import type { OptionCardData } from "../../shared/wire.ts";
import { addServerLinePacks, setConversationLanguage } from "../server-lines.ts";
import { userError } from "../user-errors.ts";
import { CanvasGenerationCards, resumeCanvasGeneration, type CanvasCardStore } from "./generation-card.ts";
import { CanvasOpRefusal } from "./ops.ts";
import { CanvasRefusal, type ProjectCanvasService } from "./service.ts";

const PAST: GenerationFailure = {
  code: "confirmation_needed", error: "A bot may start 3 videos a day without you, and this one has started 3. Confirm to let it make 1 more.",
  errorKey: "serverError.projectGeneration.confirmVideos", errorParams: { ceiling: 3, used: 3, asked: 1 }, allowance: { used: 3, ceiling: 3, asked: 1 },
};
const NO_SERVER: GenerationFailure = { code: "no_server", error: "Choose an MCP server for videos in this project's settings first.", errorKey: "serverError.projectGeneration.noVideoServer" };
const TOO_MANY: GenerationFailure = {
  code: "too_many", error: "This project already has 50 generations waiting or running. Wait for some of them to finish.",
  errorKey: "serverError.projectGeneration.tooMany", errorParams: { count: 50 },
};

type Generated = Awaited<ReturnType<ProjectCanvasService["generate"]>>;

function setup(generate: () => Promise<Generated> = async () => ({ job: { id: "job-9" } as GenerationJob }), botProject = "p1") {
  const lines: Array<{ id: string; card?: OptionCardData }> = [];
  const store: CanvasCardStore = {
    messagesFor: () => lines,
    appendMessage: (_threadId, message) => {
      lines.push({ id: `m${lines.length + 1}`, card: message.card });
      return lines.at(-1)!;
    },
    patchMessage: (_threadId, messageId, patch) => {
      const line = lines.find((one) => one.id === messageId);
      if (line) line.card = patch.card;
    },
  };
  const generated: unknown[] = [];
  const heard: string[] = [];
  const turn = { parked: true };
  const service = {
    projectOfBot: () => ({ id: botProject }),
    generate: async (project: { id: string }, requester: unknown, nodeId: unknown) => {
      generated.push({ projectId: project.id, requester, nodeId });
      return generate();
    },
  } as unknown as Pick<ProjectCanvasService, "projectOfBot" | "generate">;
  const cards = new CanvasGenerationCards({ store, service, answer: (_threadId, _messageId, text) => (turn.parked ? (heard.push(text), true) : false) });
  const ask = () => cards.ask({ projectId: "p1", botId: "writer", threadId: "t1", nodeId: "shot-1", title: "Poster", failure: PAST });
  return { store, lines, cards, generated, heard, turn, ask };
}

afterEach(() => setConversationLanguage(() => undefined));

describe("the card that asks the person about a bot's generation past its ceiling", () => {
  it("is put in the bot's conversation once while it is open, in its language, with generation's reason", () => {
    addServerLinePacks({ zh: { "server.projectCanvas.generationCard.title": "生成“{title}”？" } });
    setConversationLanguage(() => "zh");
    const { lines, ask } = setup();
    const first = ask();
    expect(ask()).toEqual({ requestId: first.requestId, already: true });
    expect(lines).toHaveLength(1);
    expect(lines[0]!.card).toEqual({
      title: "生成“Poster”？", subtitle: PAST.error, options: ["Confirm", "Cancel"], requestId: first.requestId, tool: "canvas_generate", fixedOptions: true,
      canvasGeneration: {
        requestId: first.requestId, projectId: "p1", nodeId: "shot-1", title: "Poster", botId: "writer", threadId: "t1",
        reasonKey: PAST.errorKey, reasonParams: PAST.errorParams, createdAt: expect.any(Number),
      },
    });
  });

  it("starts the node for the bot, confirmed, once the person confirms, and the bot hears it once", async () => {
    const { lines, cards, generated, heard, ask } = setup();
    const { requestId } = ask();
    expect(await cards.answer("t1", requestId, "allow")).toBe("allowed-once");
    expect(await cards.answer("t1", requestId, "allow")).toBe("allowed-once");
    expect(generated).toEqual([{ projectId: "p1", requester: { kind: "bot", botId: "writer", confirmed: true }, nodeId: "shot-1" }]);
    expect(lines[0]!.card).toMatchObject({ answered: "allow", canvasGeneration: { result: { state: "started", jobId: "job-9" }, resumed: true } });
    expect(heard).toEqual([expect.stringMatching(/^MagicBot generation decision \S+: the person confirmed, and the generation of "Poster" \(shot-1\) started \(job job-9\)/)]);
  });

  it("generates nothing when the person cancels, tells the bot so, and lets the bot ask again", async () => {
    const { lines, cards, generated, heard, ask } = setup();
    const { requestId } = ask();
    expect(await cards.answer("t1", requestId, "deny")).toBe("rejected");
    expect(generated).toEqual([]);
    expect(lines[0]!.card).toMatchObject({ answered: "deny", canvasGeneration: { result: { state: "declined" }, resumed: true } });
    expect(heard).toEqual([expect.stringContaining('the person declined generating "Poster" (shot-1), so nothing was generated')]);
    expect(ask().already).toBe(false);
  });

  it("shows a refusal after Confirm in generation's own words and key, and tells the bot", async () => {
    const refused = setup(async () => ({ refused: NO_SERVER }));
    const { requestId } = refused.ask();
    expect(await refused.cards.answer("t1", requestId, "allow")).toBe("allowed-once");
    expect(refused.lines[0]!.card).toMatchObject({
      answered: "allow", held: NO_SERVER.error, heldCode: NO_SERVER.errorKey, canvasGeneration: { result: { state: "refused", code: "no_server", error: NO_SERVER.error } },
    });
    expect(refused.lines[0]!.card).not.toHaveProperty("heldParams");
    expect(refused.heard).toEqual([expect.stringContaining(`but generation refused "Poster" (shot-1) (no_server): ${NO_SERVER.error}`)]);
    const moved = setup(undefined, "p2");
    await moved.cards.answer("t1", moved.ask().requestId, "allow");
    expect(moved.generated).toEqual([]);
    expect(moved.lines[0]!.card).toMatchObject({ heldCode: "serverError.projectCanvas.notMember", canvasGeneration: { result: { state: "refused", code: "not_member" } } });
  });

  it("keeps the values of a refusal's line beside its key, so the person reads it whole in their language", async () => {
    const crowded = setup(async () => ({ refused: TOO_MANY }));
    await crowded.cards.answer("t1", crowded.ask().requestId, "allow");
    expect(crowded.lines[0]!.card).toMatchObject({ held: TOO_MANY.error, heldCode: TOO_MANY.errorKey, heldParams: { count: 50 } });
  });

  it("shows the canvas's own line when it refuses the node at Confirm", async () => {
    const busy = setup(async () => { throw new CanvasRefusal(409, { code: "generating", ...userError("serverError.projectCanvas.alreadyGenerating") }); });
    await busy.cards.answer("t1", busy.ask().requestId, "allow");
    expect(busy.lines[0]!.card).toMatchObject({
      answered: "allow", held: "This node is being generated already.", heldCode: "serverError.projectCanvas.alreadyGenerating",
      canvasGeneration: { result: { state: "refused", code: "generating", error: "This node is being generated already." } },
    });
    expect(busy.lines[0]!.card).not.toHaveProperty("heldParams");
    expect(busy.heard).toEqual([expect.stringContaining('but generation refused "Poster" (shot-1) (generating): This node is being generated already.')]);
  });

  it("tells the person the node changed when the canvas refuses it at Confirm without a line of its own, and the bot the canvas's words", async () => {
    const changed = setup(async () => { throw new CanvasOpRefusal("not_yours", "shot-1 was not put there by you; ask the person to generate it"); });
    await changed.cards.answer("t1", changed.ask().requestId, "allow");
    expect(changed.lines[0]!.card).toMatchObject({
      answered: "allow", held: "That node changed after the bot asked, so nothing was generated.", heldCode: "serverError.projectCanvas.generationChanged",
      canvasGeneration: { result: { state: "refused", code: "not_yours", error: "shot-1 was not put there by you; ask the person to generate it" } },
    });
    expect(changed.heard).toEqual([expect.stringContaining('but generation refused "Poster" (shot-1) (not_yours): shot-1 was not put there by you')]);
  });

  it("starts the node once when the person answers twice at the same time", async () => {
    let release!: () => void;
    const { cards, generated, ask } = setup(() => new Promise((resolve) => { release = () => resolve({ job: { id: "job-9" } as GenerationJob }); }));
    const { requestId } = ask();
    const answers = [cards.answer("t1", requestId, "allow"), cards.answer("t1", requestId, "deny")];
    await Promise.resolve();
    release();
    expect(await Promise.all(answers)).toEqual(["allowed-once", "allowed-once"]);
    expect(generated).toHaveLength(1);
  });

  it("hands a decision no turn took to the bot's turn when it is parked again, and is no card of any other kind", async () => {
    const { store, lines, cards, heard, turn, ask } = setup();
    turn.parked = false;
    await cards.answer("t1", ask().requestId, "deny");
    expect(lines[0]!.card!.canvasGeneration).not.toHaveProperty("resumed");
    turn.parked = true;
    expect(resumeCanvasGeneration(store, "t1", "m1", (text) => (heard.push(text), true))).toBe(true);
    expect(lines[0]!.card!.canvasGeneration).toMatchObject({ resumed: true });
    expect(heard).toEqual([expect.stringContaining("declined")]);
    expect(await cards.answer("t1", "another-card", "allow")).toBeUndefined();
  });
});
