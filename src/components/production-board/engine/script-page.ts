export type ScriptLine = { k: "slug" | "act" | "who" | "dlg"; t: string };

const HEADING = /^(#{1,6}\s+|场\s*\d|第.{1,4}场|内景|外景|int\.|ext\.|scene\s+\d)/i;
const SPOKEN = /^([^：:]{1,16})[：:]\s*(\S.*)$/;
const LABELS = new Set(["人物", "角色", "时间", "地点", "场景", "道具", "备注", "音效", "音乐", "characters", "cast", "time", "place", "location", "setting", "props", "note", "notes", "sound", "music"]);
const couldSpeak = (name: string) => !/\p{Nd}/u.test(name) && !LABELS.has(name.trim().toLowerCase());
const plain = (line: string) => line.replace(/^#{1,6}\s+/, "").replace(/\*\*(.+?)\*\*/g, "$1").replace(/^[-*]\s+/, "").trim();

/** An episode's script as the lines of a script page: scene headings, action, who speaks and what they say. */
export function scriptPage(text: string, max = 14): ScriptLine[] {
  const lines: ScriptLine[] = [];
  for (const raw of text.split(/\r?\n/)) {
    if (lines.length >= max) break;
    const bold = /^\*\*(.+)\*\*$/.exec(raw.trim());
    const line = plain(raw);
    if (!line) continue;
    const spoken = SPOKEN.exec(line);
    if (HEADING.test(raw.trim()) || (bold && HEADING.test(bold[1]!))) lines.push({ k: "slug", t: line });
    else if (spoken && couldSpeak(spoken[1]!)) {
      if (lines.length + 2 > max) break;
      lines.push({ k: "who", t: spoken[1]!.trim() }, { k: "dlg", t: spoken[2]!.trim() });
    } else lines.push({ k: "act", t: line });
  }
  return lines;
}
