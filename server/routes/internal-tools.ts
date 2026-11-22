// The agents tools' internal calls that need only the capability's bot and conversation, its body and its folders: research,
// the helper models' decide and extract, MagicBot's notifications, the usage limits, publishing an app, the project canvas and the project timeline. Runs inside index.ts's /api/internal/ block, after the
// capability bearer is checked; each route answers its own paths and passes the rest on.
import type { AppPublisher } from "../host/app-publisher.ts";
import { projectCanvasToolRoutes } from "../project-canvas/tool-route.ts";
import { projectDraftToolRoutes } from "../project-draft/tool-route.ts";
import { createAppHostingInternalRoutes } from "./app-hosting.ts";
import { createEngineLimitsRoutes, type EngineLimitsDeps } from "./engine-limits.ts";
import { createHelperToolRoutes, type HelperToolContext, type HelperToolDeps } from "./helper-tools.ts";
import { createMagicBotNotificationRoutes, type LiveNotificationsDeps } from "./mausbot-notifications.ts";
import { PASS } from "./table.ts";
import { createXResearchInternalRoutes, type XResearchDeps } from "./x-research.ts";

export function createInternalToolRoutes(deps: { helpers: HelperToolDeps; xResearch: XResearchDeps; notifications: LiveNotificationsDeps; engineLimits: EngineLimitsDeps; appPublisher: AppPublisher }) {
  const routes = [createXResearchInternalRoutes(deps.xResearch), createHelperToolRoutes(deps.helpers), createMagicBotNotificationRoutes(deps.notifications), createEngineLimitsRoutes(deps.engineLimits), createAppHostingInternalRoutes(deps.appPublisher), projectCanvasToolRoutes, projectDraftToolRoutes];
  return async (ctx: HelperToolContext & { threadId: string }): Promise<typeof PASS | void> => {
    for (const route of routes) if (await route(ctx) !== PASS) return;
    return PASS;
  };
}
