import type { ProductionTaskStatus } from "../../../shared/production";
import type { BoardIndex, BoardStageState } from "./board";
import type { BoardStage } from "./overlay";

const taskStage = (status: ProductionTaskStatus | undefined): BoardStageState =>
  status === "done" ? "done" : status === "working" ? "active" : status === "failed" ? "failed" : "wait";

function together(states: readonly BoardStageState[]): BoardStageState {
  if (!states.length) return "wait";
  if (states.includes("failed")) return "failed";
  if (states.includes("active")) return "active";
  return states.every((state) => state === "done") ? "done" : states.includes("done") ? "active" : "wait";
}

/** Each stage's state, from the production, or for a drama made before it, from what is on the canvas. */
export function boardStages(index: BoardIndex): Record<BoardStage, BoardStageState> {
  const { production, snapshot } = index;
  if (!production) {
    const shots = [...index.shots.values()].flat();
    const ready = shots.filter((shot) => (index.takesOf.get(shot.id) ?? []).some((take) => take.metadata?.selected)).length;
    const profiles = snapshot.nodes.filter((node) => node.metadata?.role === "character" || node.metadata?.role === "scene");
    return {
      brief: index.episodeNodes.size || shots.length ? "done" : "active",
      script: index.episodeNodes.size ? "done" : "wait",
      library: profiles.length ? "done" : "wait",
      storyboard: !shots.length ? "wait" : ready === shots.length ? "done" : "active",
      post: index.finals.size ? "done" : "wait",
    };
  }
  const episodes = production.episodes;
  const job = (name: "script" | "character" | "scene") => production.jobs.find((one) => one.job === name);
  const library = [job("character"), job("scene")].filter((one) => one !== undefined).map((one) => taskStage(one.status));
  const storyboard = (): BoardStageState => {
    if (episodes.some((one) => one.status === "failed" && !one.postBotId)) return "failed";
    if (episodes.some((one) => one.status === "storyboard" || one.status === "videos")) return "active";
    return episodes.length && episodes.every((one) => one.status === "post" || one.status === "done") ? "done" : "wait";
  };
  const post = (): BoardStageState => {
    if (episodes.some((one) => one.status === "failed" && one.postBotId)) return "failed";
    if (episodes.some((one) => one.status === "post")) return "active";
    return episodes.length && episodes.every((one) => one.status === "done") ? "done" : "wait";
  };
  return { brief: "done", script: taskStage(job("script")?.status), library: together(library), storyboard: storyboard(), post: post() };
}
