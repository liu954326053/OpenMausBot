import { PIPELINE_STAGES, type FlowStage, type PipelineStage } from "../../shared/team-pipeline.ts";

export interface JudgedMember {
  name: string;
  title: string;
  description: string;
  soul: string;
}

/**
 * `title`: a word that names the stage wherever it stands in a member's title or name. `text`: the stage said as the
 * member's own work, for running text, where a bare word is often a mention of someone else's ("hands the script to
 * the storyboard artist").
 */
export const STAGE_KEYWORDS: Record<PipelineStage, { title: RegExp; text: RegExp }> = {
  script: {
    title: /编剧|編劇|剧本|劇本|脚本|腳本|screenwriter|screenplay|playwright|\bscript\b|\bwriter\b/i,
    text: /编剧|編劇|(写|撰写|创作|编写|寫|撰寫|創作|編寫)[^，。；,.;\n]{0,6}(剧本|劇本|脚本|腳本)|(剧本|劇本)(创作|写作|創作|寫作)|screenwriter|script ?writer|writes? (the |a )?(script|screenplay)s?\b/i,
  },
  character: {
    title: /角色|人设|人設|人物设[计定]|人物設[計定]|美术|美術|原画|原畫|造型|\bcharacters?\b|concept art|art director|art design/i,
    text: /(角色|人物|美术|美術|造型)(设计|設計|设定|設定)|人设设计|人設設計|原画师|原畫師|designs? (the )?characters?\b|character design|concept art/i,
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

/** A soul says who the bot is first; further down it names the teammates it works with. */
const SOUL_OPENING_CHARS = 200;

const named = (text: string, kind: "title" | "text"): PipelineStage[] =>
  text.trim() ? PIPELINE_STAGES.filter((stage) => STAGE_KEYWORDS[stage][kind].test(text)) : [];

/** The member's stages by the words of its title and name, else of its description, else of how its soul opens. */
export function keywordStages(member: JudgedMember): FlowStage[] {
  const readings = [
    () => named(`${member.title}\n${member.name}`, "title"),
    () => named(member.description, "text"),
    () => named(member.soul.trimStart().slice(0, SOUL_OPENING_CHARS), "text"),
  ];
  for (const read of readings) {
    const stages = read();
    if (stages.length) return stages;
  }
  return ["other"];
}
