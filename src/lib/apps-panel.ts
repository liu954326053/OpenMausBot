import type { AppState } from "@/state/store";

type AppsPanelState = Pick<AppState, "pluginsOpen" | "pluginsSurface">;

/** Apps and MCP servers are two entries into one panel: each is lit only while the panel shows its own side. */
export const appsOpen = (state: AppsPanelState): boolean => state.pluginsOpen && state.pluginsSurface !== "mcp";
export const mcpOpen = (state: AppsPanelState): boolean => state.pluginsOpen && state.pluginsSurface === "mcp";
