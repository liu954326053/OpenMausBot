export const BOARD_CARD_KINDS = [
  "bot", "brief", "plan", "episode", "episodeStack", "character", "scene", "shot", "result", "final", "generic",
] as const;

export type BoardCardKind = (typeof BOARD_CARD_KINDS)[number];

export interface BoardCardSize {
  width: number;
  height: number;
}

/** Each kind's box on the board, in board pixels. A card always draws at its kind's size; what it holds beyond that
 * scrolls or is cut short inside it. */
export const BOARD_CARD_SIZES: Readonly<Record<BoardCardKind, Readonly<BoardCardSize>>> = {
  bot: { width: 320, height: 300 },
  brief: { width: 320, height: 300 },
  plan: { width: 320, height: 320 },
  episode: { width: 360, height: 236 },
  episodeStack: { width: 360, height: 212 },
  character: { width: 400, height: 208 },
  scene: { width: 320, height: 268 },
  shot: { width: 440, height: 212 },
  result: { width: 320, height: 256 },
  final: { width: 520, height: 440 },
  generic: { width: 320, height: 220 },
};
