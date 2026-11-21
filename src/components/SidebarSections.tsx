import { useState } from "react";
import { sidebarLayoutInteractive, sidebarSectionCollapsed, TOOLS_SECTION_ID } from "@/lib/sidebar-layout";
import { loadCollapsedSections, saveCollapsedSections, toggleCollapsedSection, type SidebarDensity } from "@/lib/sidebar-preferences";

/** Whether the sidebar's Tools section is folded on this device, and the toggle when it can be folded. */
export function useToolsSection(density: SidebarDensity, query: string) {
  const [collapsedIds, setCollapsedIds] = useState<string[]>(() => loadCollapsedSections());
  return {
    collapsed: sidebarSectionCollapsed(TOOLS_SECTION_ID, collapsedIds, density, query),
    toggle: sidebarLayoutInteractive(density, query) ? () => {
      const next = toggleCollapsedSection(collapsedIds, TOOLS_SECTION_ID);
      setCollapsedIds(next);
      saveCollapsedSections(next);
    } : undefined,
  };
}
