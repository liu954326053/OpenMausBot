import { describe, expect, it } from "vitest";
import { botNodeId, type CanvasNode } from "../../shared/project-canvas";
import { layoutPipeline } from "../lib/project-canvas/stage-layout";
import { dramaCanvasSnapshot } from "./project-canvas-drama-sample";

const overlap = (a: CanvasNode, b: CanvasNode) => a.position.x < b.position.x + b.width && b.position.x < a.position.x + a.width && a.position.y < b.position.y + b.height && b.position.y < a.position.y + a.height;

describe("the drama sample", () => {
  it("is the whole pipeline with eight shots, each with a creation node and one to three takes of which one is selected", () => {
    const { nodes, bots } = dramaCanvasSnapshot();
    expect(Object.values(bots).map((bot) => bot.stages.join())).toEqual(["lead", "script", "character", "storyboard", "post", "other"]);
    const shots = nodes.filter((node) => node.type === "shot");
    expect(shots).toHaveLength(8);
    for (const shot of shots) {
      const takes = nodes.filter((node) => node.metadata?.role === "take" && node.metadata.shotId === shot.id);
      expect(nodes.filter((node) => node.metadata?.role === "creation" && node.metadata.shotId === shot.id), shot.id).toHaveLength(1);
      expect(takes.length, shot.id).toBeGreaterThanOrEqual(1);
      expect(takes.length, shot.id).toBeLessThanOrEqual(3);
      expect(takes.filter((take) => take.metadata?.selected), shot.id).toHaveLength(1);
    }
  });

  it("stands as Tidy leaves it: nothing moves again, and no two nodes overlap outside a group and what it holds", () => {
    for (const moment of ["confirm", "generating", "failed", "finished"] as const) {
      const snapshot = dramaCanvasSnapshot({ moment, film: moment === "finished" });
      const moved = [...layoutPipeline(snapshot)].filter(([id, position]) => {
        const node = snapshot.nodes.find((one) => one.id === id)!;
        return node.position.x !== position.x || node.position.y !== position.y;
      });
      expect(moved, moment).toEqual([]);
      const loose = snapshot.nodes.filter((node) => !node.groupId);
      const clashes = loose.flatMap((a, index) => loose.slice(index + 1).filter((b) => overlap(a, b)).map((b) => `${a.id} × ${b.id}`));
      expect(clashes, moment).toEqual([]);
    }
  });

  it("stands the stages left to right with the bot outside the pipeline below the lead", () => {
    const { nodes } = dramaCanvasSnapshot();
    const at = (botId: string) => nodes.find((node) => node.id === botNodeId(botId))!.position;
    const columns = ["yunzhou", "yanqing", "mobai", "xiaoman", "qinghe"].map((botId) => at(botId).x);
    expect([...columns].sort((a, b) => a - b)).toEqual(columns);
    expect(new Set(columns).size).toBe(5);
    expect(at("ache")).toEqual({ x: at("yunzhou").x, y: at("yunzhou").y + 180 + 64 });
  });

  it("waits before the videos with no take yet, and after a failure has the two shots without one", () => {
    const takes = (moment: "confirm" | "failed") => dramaCanvasSnapshot({ moment }).nodes.filter((node) => node.metadata?.role === "take").map((node) => node.metadata!.shotId);
    expect(takes("confirm")).toEqual([]);
    expect(dramaCanvasSnapshot({ moment: "confirm" }).run!.videos).toEqual({ status: "confirm", shots: 8, ready: 0, failed: 0 });
    expect(new Set(takes("failed")).size).toBe(6);
    expect(dramaCanvasSnapshot({ moment: "failed" }).run!.videos).toEqual({ status: "failed", shots: 8, ready: 6, failed: 2 });
  });
});
