import type { HelperToolContext } from "../routes/helper-tools.ts";
import { PASS } from "../routes/table.ts";

export type ProjectDraftToolRoute = (ctx: HelperToolContext & { threadId: string }) => Promise<typeof PASS | void>;

let bound: ProjectDraftToolRoute = async () => PASS;

/** The post bot's timeline tools among the internal tool routes; they pass until the draft host is made. */
export const projectDraftToolRoutes: ProjectDraftToolRoute = (ctx) => bound(ctx);

export function setProjectDraftToolRoutes(route: ProjectDraftToolRoute): void {
  bound = route;
}
