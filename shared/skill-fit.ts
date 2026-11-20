// Which of many skills fit a bot or a task, by the words they share. A word in a skill's name counts twice one in its
// description, a word few skills use counts more than one most of them use, and a long description earns no more than a
// short one. No model call: the same words always pick the same skills, so a bot's list holds still between turns and
// its prompt stays cached.

export interface FitSkill {
  name: string;
  description: string;
}

const COMMON = new Set([
  "about", "after", "also", "and", "any", "are", "can", "does", "each", "for", "from", "has", "have", "how", "into", "its",
  "not", "one", "skill", "that", "the", "their", "them", "then", "this", "use", "used", "user", "using", "was", "what",
  "when", "which", "who", "will", "with", "you", "your",
]);

const COMMON_PAIRS = new Set([
  "一个", "什么", "以及", "你的", "使用", "可以", "如何", "帮助", "我们", "或者", "技能", "没有", "根据", "用于", "用户", "进行",
  "这个", "通过", "需要",
]);

const UNSPACED = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]+/gu;

/** Lowercased words of three letters or more, a plural "s" dropped and cut to six letters, so "invoices", "invoicing"
 * and "invoice" meet. Chinese and Japanese are written without spaces, so a run of their characters gives each pair of
 * neighbours instead. */
export function fitWords(text: string): string[] {
  return (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).flatMap((run) => {
    const words: string[] = [];
    let at = 0;
    const spaced = (word: string) => {
      if (word.length < 3 || COMMON.has(word)) return;
      const single = word.length > 3 && word.endsWith("s") && !word.endsWith("ss") ? word.slice(0, -1) : word;
      words.push(single.slice(0, 6));
    };
    for (const match of run.matchAll(UNSPACED)) {
      spaced(run.slice(at, match.index));
      at = match.index + match[0].length;
      const characters = Array.from(match[0]);
      for (let i = 0; i + 1 < characters.length; i++) {
        const pair = characters[i]! + characters[i + 1]!;
        if (!COMMON_PAIRS.has(pair)) words.push(pair);
      }
    }
    spaced(run.slice(at));
    return words;
  });
}

/** The skills that share a word with `about`, best first; a skill that shares none is left out. */
export function rankSkills<T extends FitSkill>(skills: readonly T[], about: string): T[] {
  const wanted = new Set(fitWords(about));
  if (!wanted.size || !skills.length) return [];
  const docs = skills.map((skill) => {
    const weights = new Map<string, number>();
    for (const word of fitWords(skill.description)) weights.set(word, 1);
    for (const word of fitWords(skill.name.replace(/-/g, " "))) weights.set(word, 2);
    return weights;
  });
  const usedBy = new Map<string, number>();
  for (const doc of docs) for (const word of doc.keys()) usedBy.set(word, (usedBy.get(word) ?? 0) + 1);
  const averageSize = docs.reduce((sum, doc) => sum + doc.size, 0) / docs.length || 1;
  return skills
    .map((skill, i) => {
      const doc = docs[i]!;
      let score = 0;
      for (const [word, weight] of doc) if (wanted.has(word)) score += weight * Math.log(1 + skills.length / usedBy.get(word)!);
      return { skill, score: score / (0.5 + (0.5 * doc.size) / averageSize) };
    })
    .filter((hit) => hit.score > 0)
    .sort((a, b) => b.score - a.score || a.skill.name.localeCompare(b.skill.name))
    .map((hit) => hit.skill);
}
