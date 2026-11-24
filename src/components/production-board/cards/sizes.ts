export const BOARD_CARD_KINDS = [
  "bot", "brief", "plan", "episode", "episodeStack", "character", "scene", "shot", "result", "final", "generic",
] as const;

export type BoardCardKind = (typeof BOARD_CARD_KINDS)[number];

export interface BoardCardSize {
  width: number;
  height: number;
}

/** Each kind's box on the board, in board pixels. A card always draws at its kind's size; what it holds beyond that
 * scrolls or is cut short inside. */
export const BOARD_CARD_SIZES: Readonly<Record<BoardCardKind, Readonly<BoardCardSize>>> = {
  bot: { width: 320, height: 420 },
  brief: { width: 320, height: 300 },
  plan: { width: 320, height: 336 },
  episode: { width: 360, height: 236 },
  episodeStack: { width: 380, height: 250 },
  character: { width: 380, height: 200 },
  scene: { width: 320, height: 250 },
  shot: { width: 440, height: 212 },
  result: { width: 320, height: 240 },
  final: { width: 560, height: 520 },
  generic: { width: 320, height: 220 },
};
