import type { ProjectTimelineWire } from "../../shared/project-draft.ts";
import type { FlowStage } from "../../shared/team-pipeline.ts";
import type { TeamProjectWire } from "../../shared/team-projects.ts";
import { PASS } from "../routes/table.ts";
import type { ProjectDraftCanvas } from "./canvas.ts";
import type { ProjectDrafts } from "./drafts.ts";
import { draftRefusalOf } from "./refusal.ts";
import type { ProjectDraftToolRoute } from "./tool-route.ts";

export const PROJECT_TIMELINE_TOOL_PATHS = {
  read: "/api/internal/project-timeline/read",
  setOrder: "/api/internal/project-timeline/set-order",
} as const;

export interface ProjectTimelineToolDeps {
  drafts: Pick<ProjectDrafts, "timeline" | "setOrder" | "draftAtThisComputer">;
  canvas: Pick<ProjectDraftCanvas, "shots">;
  /** The project a bot is one of the bots of. */
  projectOfBot(botId: string): TeamProjectWire | undefined;
  /** A bot's stages in its pipeline. */
  stagesOf(botId: string): readonly FlowStage[];
}

const NOT_POST = "Only a project's bot whose job is post reads and sets a timeline, and only its own episode's.";
const seconds = (ms: number) => Math.round(ms / 10) / 100;

/** What both tools answer: the episode's film as it stands. */
function timelineText(project: TeamProjectWire, episode: number | undefined, timeline: ProjectTimelineWire, deps: ProjectTimelineToolDeps): string {
  const titles = new Map(deps.canvas.shots(project.id).map((shot) => [shot.shotId, shot.title]));
  const named = (shotId: string) => ({ shot_id: shotId, title: titles.get(shotId) ?? "" });
  const { state, name, reason } = deps.drafts.draftAtThisComputer(project.id, episode);
  return JSON.stringify({
    project: { id: project.id, name: project.name },
    ...(episode === undefined ? {} : { episode }),
    clips: timeline.clips.map((clip, index) => ({ position: index + 1, shot_id: clip.shotId, title: clip.title, seconds: seconds(clip.durationMs), file: clip.file.path })),
    total_seconds: seconds(timeline.clips.reduce((sum, clip) => sum + clip.durationMs, 0)),
    shots_without_video: timeline.missingShots.map(named),
    shots_left_out: (timeline.leftOut ?? []).map(named),
    draft: { state, ...(name ? { name } : {}), ...(reason ? { reason } : {}) },
  });
}

/** Security: every call is checked against the bot the capability names: only a project's bot whose job is post
 * reaches a timeline, and only the one of the episode it was made for. */
export function createProjectTimelineToolRoutes(deps: ProjectTimelineToolDeps): ProjectDraftToolRoute {
  return async (ctx) => {
    const tool = ctx.method === "POST" ? Object.entries(PROJECT_TIMELINE_TOOL_PATHS).find(([, path]) => path === ctx.path)?.[0] : undefined;
    if (!tool) return PASS;
    const project = deps.projectOfBot(ctx.botId);
    if (!project || !deps.stagesOf(ctx.botId).includes("post")) return void ctx.json(ctx.res, 403, { error: NOT_POST });
    const episode = project.episodeBots[ctx.botId]?.number;
    try {
      const body = await ctx.readBody();
      const asked = body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : {};
      const timeline = tool === "read" ? await deps.drafts.timeline(project.id, episode) : await deps.drafts.setOrder(project.id, { shotIds: asked.shot_ids }, episode);
      return void ctx.json(ctx.res, 200, { text: timelineText(project, episode, timeline, deps) });
    } catch (error) {
      const refused = draftRefusalOf(error);
      if (!refused) throw error;
      return void ctx.json(ctx.res, refused.status, { error: refused.body.error });
    }
  };
}
