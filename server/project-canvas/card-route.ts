type AnswerCard = (threadId: string, requestId: string, behavior: string) => Promise<string | undefined>;

let bound: AnswerCard = async () => undefined;

/** Settles a canvas generation card; undefined for any other card, and until the canvas host is made. */
export const answerCanvasGenerationCard: AnswerCard = (threadId, requestId, behavior) => bound(threadId, requestId, behavior);

export function setCanvasGenerationCardAnswer(answer: AnswerCard): void {
  bound = answer;
}
