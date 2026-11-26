export type ScriptLine = { k: "slug" | "act" | "who" | "dlg"; t: string };

const HEADING = /^(#{1,6}\s+|场\s*\d|第.{1,4}场|内景|外景|int\.|ext\.|scene\s+\d)/i;
const SPOKEN = /^([^：:]{1,16})[：:]\s*(\S.*)$/;
const plain = (line: string) => line.replace(/^#{1,6}\s+/, "").replace(/\*\*(.+?)\*\*/g, "$1").replace(/^[-*]\s+/, "").trim();

/** An episode's script as the lines of a script page: scene headings, action, who speaks and what they say. */
export function scriptPage(text: string, max = 14): ScriptLine[] {
  const lines: ScriptLine[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const bold = /^\*\*(.+)\*\*$/.exec(raw.trim());
    const line = plain(raw);
    if (!line) continue;
    const spoken = SPOKEN.exec(line);
    if (HEADING.test(raw.trim()) || (bold && HEADING.test(bold[1]!))) lines.push({ k: "slug", t: line });
    else if (spoken) lines.push({ k: "who", t: spoken[1]!.trim() }, { k: "dlg", t: spoken[2]!.trim() });
    else lines.push({ k: "act", t: line });
    if (lines.length >= max) break;
  }
  return lines.slice(0, max);
}
