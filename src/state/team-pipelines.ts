import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type {
  TeamPipelineLineInput, TeamPipelineRejudgeInput, TeamPipelineRejudgeResult, TeamPipelineRestoreInput, TeamPipelinesWire, TeamPipelineWire,
} from "../../shared/team-pipeline";
import { orderBots, teamSize } from "../lib/team-canvas";
import { pipelineLayout, pipelineShape, type PipelineLayout } from "../lib/team-pipeline";
import type { TeamMapSection } from "../lib/team-map";
import { api } from "./api";
import { useStoreActions } from "./store-select";

/** Another admin can change a line from another window; nothing tells this one, so it reads again. */
const READ_AGAIN_MS = 15_000;
/** While members are being judged, their lines are about to appear. */
const READ_WHILE_JUDGING_MS = 2_000;

export interface TeamPipelineMap {
  readable: boolean;
  layouts: Array<PipelineLayout | null>;
  pipelineOf(sectionKey: string): TeamPipelineWire | undefined;
  /** Tile sizes for the map when any team draws its pipeline. */
  sizes: { sizes: Array<{ width: number; height: number }> } | undefined;
  setLine(input: TeamPipelineLineInput): Promise<void>;
  rejudge(section: string): Promise<void>;
  /** The team judged again last, while its Undo is offered; `key` changes with every rejudge. */
  rejudged: { section: string; key: number } | null;
  undoRejudge(): Promise<void>;
  forgetRejudge(): void;
}

/** Only a person who may manage teams reads and changes pipelines; everyone else keeps the map as it was. */
export function useTeamPipelineMap(sections: TeamMapSection[], canManage: boolean, orders: Record<string, string[]>): TeamPipelineMap {
  const { flushBotPatches } = useStoreActions();
  const [pipelines, setPipelines] = useState<TeamPipelinesWire | null>(null);
  const [rejudged, setRejudged] = useState<{ section: string; key: number; undo: TeamPipelineRestoreInput } | null>(null);
  const asked = useRef(0), shownFrom = useRef(0);
  /** An answer to an earlier request never replaces the answer to a later one. */
  const show = useCallback((order: number, next: TeamPipelinesWire) => {
    if (order < shownFrom.current) return;
    shownFrom.current = order;
    setPipelines(next);
  }, []);
  const read = useCallback((background: boolean) => {
    const order = ++asked.current;
    return api<TeamPipelinesWire>("/api/team-pipelines", { background }).then((next) => show(order, next), () => {});
  }, [show]);

  const shape = pipelineShape(sections);
  const botIds = sections.flatMap((section) => [...section.chiefs, ...section.members].map((bot) => bot.id));
  useEffect(() => {
    if (!canManage) return;
    let active = true;
    void Promise.all(botIds.map((id) => flushBotPatches(id))).then(() => { if (active) void read(false); });
    return () => { active = false; };
  }, [canManage, shape]);
  const judging = canManage && (pipelines?.teams.some((team) => team.pending.length > 0) ?? false);
  useEffect(() => {
    if (!canManage) return;
    const timer = window.setInterval(() => void read(true), judging ? READ_WHILE_JUDGING_MS : READ_AGAIN_MS);
    return () => window.clearInterval(timer);
  }, [canManage, judging, read]);

  const shown = canManage ? pipelines : null;
  const layouts = useMemo(() => sections.map((section) => {
    const pipeline = shown?.teams.find((team) => team.section === section.key);
    const order = Object.hasOwn(orders, section.key) ? orders[section.key] : [];
    return pipeline ? pipelineLayout(orderBots([...section.chiefs, ...section.members], order), pipeline) : null;
  }), [sections, shown, orders]);
  const sizes = useMemo(() => layouts.some(Boolean)
    ? { sizes: layouts.map((layout, index) => layout ?? teamSize(sections[index])) }
    : undefined, [layouts, sections]);

  const setLine = useCallback(async (input: TeamPipelineLineInput) => {
    const order = ++asked.current;
    show(order, await api<TeamPipelinesWire>("/api/team-pipelines/line", { method: "PUT", body: JSON.stringify(input) }));
  }, [show]);
  const rejudge = useCallback(async (section: string) => {
    const order = ++asked.current;
    const input: TeamPipelineRejudgeInput = { section };
    const result = await api<TeamPipelineRejudgeResult>("/api/team-pipelines/rejudge", { method: "POST", body: JSON.stringify(input) });
    show(order, result.pipelines);
    setRejudged({ section, key: order, undo: result.undo });
  }, [show]);
  const undoRejudge = useCallback(async () => {
    if (!rejudged) return;
    await api("/api/team-pipelines/restore", { method: "PUT", body: JSON.stringify(rejudged.undo) });
    await read(false);
  }, [rejudged, read]);
  const forgetRejudge = useCallback(() => setRejudged(null), []);

  return {
    readable: shown?.readable ?? true,
    layouts,
    pipelineOf: (sectionKey) => shown?.teams.find((team) => team.section === sectionKey),
    sizes,
    setLine,
    rejudge,
    rejudged: rejudged && { section: rejudged.section, key: rejudged.key },
    undoRejudge,
    forgetRejudge,
  };
}
