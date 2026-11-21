import type { HelperToolContext } from "../routes/helper-tools.ts";
import { PASS } from "../routes/table.ts";

export type ProjectCanvasToolRoute = (ctx: HelperToolContext & { threadId: string }) => Promise<typeof PASS | void>;

let bound: ProjectCanvasToolRoute = async () => PASS;

/** The bots' canvas tools among the internal tool routes; they pass until the canvas host is made. */
export const projectCanvasToolRoutes: ProjectCanvasToolRoute = (ctx) => bound(ctx);

export function setProjectCanvasToolRoutes(route: ProjectCanvasToolRoute): void {
  bound = route;
}
