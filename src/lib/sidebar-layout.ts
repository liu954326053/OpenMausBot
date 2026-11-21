import type { GroupGoalRunCardData } from "../../shared/group-goal-run";
import type { ConnectorCardData } from "../../shared/connector-card";
import { t } from "./i18n";
import type { LocaleKey } from "@/locales";

export const TOOLS_SECTION_ID = "builtin:tools";

export type SidebarSectionId = string;
export type SidebarDensityMode = "comfortable" | "icons";

const GOAL_RUN_PREVIEW_LABEL = {
  working: "routines.goal.working",
  completed: "routines.goal.completed",
  "needs-input": "routines.goal.needs-input",
  blocked: "routines.goal.blocked",
  "limit-reached": "routines.goal.limit-reached",
  paused: "routines.goal.paused",
  stopped: "routines.goal.stopped",
  failed: "routines.goal.failed",
} satisfies Record<GroupGoalRunCardData["status"], LocaleKey>;

export function sidebarGoalRunPreview(run: GroupGoalRunCardData): string {
  const detail = run.detail?.replace(/\s+/g, " ").trim();
  const goal = run.goal.replace(/\s+/g, " ").trim();
  const summary = detail || goal;
  const label = t(GOAL_RUN_PREVIEW_LABEL[run.status]);
  return summary ? `${label}: ${summary}` : label;
}

export type SidebarConnectorPreviewKey = "connectors.card.connected" | "connectors.card.waiting" | "connectors.card.connectSecurely";

export function sidebarConnectorPreview(
  connector: Pick<ConnectorCardData, "label" | "status" | "dismissed">,
  say: (key: SidebarConnectorPreviewKey) => string,
): string {
  if (connector.dismissed) return connector.label;
  const key: SidebarConnectorPreviewKey = connector.status === "connected"
    ? "connectors.card.connected"
    : connector.status === "authorizing" ? "connectors.card.waiting" : "connectors.card.connectSecurely";
  return `${connector.label} · ${say(key)}`;
}

export function sidebarLayoutInteractive(density: SidebarDensityMode, query: string): boolean {
  return density !== "icons" && query.trim().length === 0;
}

export function sidebarSectionCollapsed(
  id: SidebarSectionId,
  collapsedIds: SidebarSectionId[],
  density: SidebarDensityMode,
  query: string,
): boolean {
  return sidebarLayoutInteractive(density, query) && collapsedIds.includes(id);
}
