/** A line an OpenMausBot build stored, worded as this build words it. The app knows some of its own notes and errors by
 * their opening words, and a conversation that build left holds them under its name. */
export function inThisBuildsWords(line: string): string {
  return line.replace(/\b(?:Open)?MausBot\b/g, "MagicBot");
}
