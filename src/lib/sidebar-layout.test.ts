import { describe, expect, it } from "vitest";

import {
  TOOLS_SECTION_ID,
  sidebarConnectorPreview,
  sidebarLayoutInteractive,
  sidebarGoalRunPreview,
  sidebarSectionCollapsed,
} from "./sidebar-layout";

describe("sidebar layout", () => {
  it("forces filtered and icon-only views open and non-reorderable", () => {
    expect(sidebarLayoutInteractive("comfortable", "")).toBe(true);
    expect(sidebarLayoutInteractive("comfortable", "writer")).toBe(false);
    expect(sidebarLayoutInteractive("icons", "")).toBe(false);
    expect(sidebarSectionCollapsed(TOOLS_SECTION_ID, [TOOLS_SECTION_ID], "comfortable", "")).toBe(true);
    expect(sidebarSectionCollapsed(TOOLS_SECTION_ID, [TOOLS_SECTION_ID], "comfortable", "writer")).toBe(false);
    expect(sidebarSectionCollapsed(TOOLS_SECTION_ID, [TOOLS_SECTION_ID], "icons", "")).toBe(false);
  });

  it("keeps a terminal channel goal meaningful in the sidebar", () => {
    expect(sidebarGoalRunPreview({
      runId: "run-1",
      goal: "Ship the launch post",
      status: "completed",
      coordinatorBotId: "lead",
      coordinatorName: "Lead",
      turnCount: 3,
      maxTurns: 13,
      detail: "Drafted and verified.",
      startedAt: 1,
      finishedAt: 2,
    })).toBe("Completed: Drafted and verified.");
  });

  it("previews a connection card by its app and state, not the phone fallback line", () => {
    const say = (key: string) => ({
      "connectors.card.connected": "Connected",
      "connectors.card.waiting": "Waiting for sign-in…",
      "connectors.card.connectSecurely": "Connect securely",
    })[key] ?? key;
    const card = { label: "GitHub", status: "required" as const };
    expect(sidebarConnectorPreview(card, say)).toBe("GitHub · Connect securely");
    expect(sidebarConnectorPreview({ ...card, status: "failed" }, say)).toBe("GitHub · Connect securely");
    expect(sidebarConnectorPreview({ ...card, status: "authorizing" }, say)).toBe("GitHub · Waiting for sign-in…");
    expect(sidebarConnectorPreview({ ...card, status: "connected" }, say)).toBe("GitHub · Connected");
    expect(sidebarConnectorPreview({ ...card, dismissed: true }, say)).toBe("GitHub");
  });
});
