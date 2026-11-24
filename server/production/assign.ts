import { PRODUCTION_JOBS, type ProductionJob } from "../../shared/production.ts";

/** A bot of the project as its job is told from: what it is called and what it says of itself. */
export interface ProductionMember {
  id: string;
  name: string;
  title: string;
  description: string;
}

/**
 * `title`: a word that names the job wherever it stands in a member's title or name. `text`: the job said as the
 * member's own work, for running text, where a bare word is often a mention of someone else's ("hands the script to
 * the storyboard artist").
 */
const JOB_WORDS: Record<ProductionJob, { title: RegExp; text: RegExp }> = {
  script: {
    title: /编剧|編劇|剧本|劇本|脚本|腳本|screenwriter|screenplay|playwright|\bscript\b|\bwriter\b/i,
    text: /编剧|編劇|(写|撰写|创作|编写|改编|寫|撰寫|創作|編寫|改編)[^，。；,.;\n]{0,6}(剧本|劇本|脚本|腳本)|(剧本|劇本)(创作|写作|創作|寫作)|screenwriter|script ?writer|writes? (the |a )?(script|screenplay)s?\b/i,
  },
  character: {
    title: /角色|人设|人設|人物设[计定]|人物設[計定]|原画|原畫|造型|\bcharacters?\b|character design/i,
    text: /(角色|人物|造型)(设计|設計|设定|設定)|人设设计|人設設計|原画师|原畫師|designs? (the )?characters?\b|character design/i,
  },
  scene: {
    title: /场景|場景|背景|布景|气氛图|氣氛圖|\bscenes?\b|\bbackgrounds?\b|environment|set design/i,
    text: /(场景|場景|背景)(设计|設計|设定|設定|绘制|繪製)|气氛图|氣氛圖|designs? (the )?(scenes?|backgrounds?|environments?)\b|(scene|background|environment|set) design/i,
  },
  storyboard: {
    title: /分镜|分鏡|故事板|storyboard|shot list/i,
    text: /分镜师|分鏡師|(画|绘制|设计|拆|拆成|拆解成|畫|繪製|設計)[^，。；,.;\n]{0,6}(分镜|分鏡)|(分镜|分鏡)(设计|脚本|設計|腳本)|storyboard(er| artist)|(draws?|makes?|writes?) (the |a )?storyboards?\b|into (a |the )?(storyboard|shot list)s?\b/i,
  },
  post: {
    title: /后期|後期|剪辑|剪輯|(?<!语音|語音)合成|调色|調色|post[- ]?production|\bpost\b|\bedit(or|ing)?\b|compositing|compositor/i,
    text: /剪辑师|剪輯師|后期(制作|合成|剪辑)|後期(製作|合成|剪輯)|负责[^，。；,.;\n]{0,6}(剪辑|后期)|負責[^，。；,.;\n]{0,6}(剪輯|後期)|video edit(or|ing)|post[- ]production|edits? the (film|video|footage)s?\b/i,
  },
};

/** A team that has an art designer and nobody for characters or scenes: the art designer does both. */
const ART = /美术|美術|concept art|art director|art design/i;

/**
 * Who does each job when the lead named nobody for it: the first member whose title or name says the job, else the
 * first whose description says it as its own work. One member may do several jobs; a job nobody's words say is left
 * out.
 */
export function defaultAssignments(members: readonly ProductionMember[]): Partial<Record<ProductionJob, string>> {
  const assignments: Partial<Record<ProductionJob, string>> = {};
  for (const job of PRODUCTION_JOBS) {
    const named = members.find((member) => JOB_WORDS[job].title.test(`${member.title}\n${member.name}`))
      ?? members.find((member) => JOB_WORDS[job].text.test(member.description));
    if (named) assignments[job] = named.id;
  }
  const artist = members.find((member) => ART.test(`${member.title}\n${member.name}`));
  if (artist) {
    assignments.character ??= artist.id;
    assignments.scene ??= artist.id;
  }
  return assignments;
}
