import { useCallback, useEffect, useMemo, useState } from "react";

import type { TeamFlowLineInput, TeamFlowsWire, TeamFlowWire } from "../../shared/team-flow";
import { orderBots, teamSize } from "../lib/team-canvas";
import { flowLayout, flowShape, type FlowLayout } from "../lib/team-flow";
import type { TeamMapSection } from "../lib/team-map";
import { api } from "./api";
import { useStoreActions } from "./store-select";

/** Another admin can change a line from another window; nothing tells this one, so it reads again. */
const READ_AGAIN_MS = 15_000;

export interface TeamFlowMap {
  readable: boolean;
  layouts: Array<FlowLayout | null>;
  flowOf(sectionKey: string): TeamFlowWire | undefined;
  /** Tile sizes for the map when any team draws its flow. */
  sizes: { sizes: Array<{ width: number; height: number }> } | undefined;
  setLine(input: TeamFlowLineInput): Promise<void>;
}

/** Only a person who may manage teams reads and changes flows; everyone else keeps the map as it was. */
export function useTeamFlowMap(sections: TeamMapSection[], canManage: boolean, orders: Record<string, string[]>): TeamFlowMap {
  const { flushBotPatches } = useStoreActions();
  const [flows, setFlows] = useState<TeamFlowsWire | null>(null);
  const shape = flowShape(sections);
  const botIds = sections.flatMap((section) => [...section.chiefs, ...section.members].map((bot) => bot.id));
  useEffect(() => {
    if (!canManage) return;
    let active = true;
    const read = (background: boolean) => api<TeamFlowsWire>("/api/team-flows", { background })
      .then((next) => { if (active) setFlows(next); }, () => {});
    void Promise.all(botIds.map((id) => flushBotPatches(id))).then(() => { if (active) void read(false); });
    const timer = window.setInterval(() => void read(true), READ_AGAIN_MS);
    return () => { active = false; window.clearInterval(timer); };
  }, [canManage, shape]);
  const shown = canManage ? flows : null;
  const layouts = useMemo(() => sections.map((section) => {
    const flow = shown?.teams.find((team) => team.section === section.key);
    const order = Object.hasOwn(orders, section.key) ? orders[section.key] : [];
    return flow ? flowLayout(orderBots([...section.chiefs, ...section.members], order), flow) : null;
  }), [sections, shown, orders]);
  const sizes = useMemo(() => layouts.some(Boolean)
    ? { sizes: layouts.map((layout, index) => layout ?? teamSize(sections[index])) }
    : undefined, [layouts, sections]);
  const setLine = useCallback(async (input: TeamFlowLineInput) => {
    setFlows(await api<TeamFlowsWire>("/api/team-flows/line", { method: "PUT", body: JSON.stringify(input) }));
  }, []);
  return {
    readable: shown?.readable ?? true,
    layouts,
    flowOf: (sectionKey) => shown?.teams.find((team) => team.section === sectionKey),
    sizes,
    setLine,
  };
}
