// Adapted from basketikun/infinite-canvas@9cd3deac web/src/components/canvas/canvas-node-list.tsx, MIT License, Copyright (c) 2026 basketikun (full text in third_party/infinite-canvas/LICENSE)
import { useState } from "react";
import { Search, X } from "lucide-react";
import { botIdOfNode, type CanvasNode } from "../../../shared/project-canvas";
import { MENU_ITEM } from "@/components/menu-recipe";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { useCanvasUi } from "./canvas-ui";
import { NODE_ICONS, nodeLabel, nodeTypeLabel, pipelineLabel } from "./node-kinds";

const TYPE_ORDER: CanvasNode["type"][] = ["bot", "shot", "text", "image", "video", "audio", "file", "config", "group"];

export function NodeList({ aboveMinimap, onClose, onFocus }: { aboveMinimap: boolean; onClose: () => void; onFocus: (nodeId: string) => void }) {
  const ui = useCanvasUi();
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const kindOf = (node: CanvasNode) => pipelineLabel(node, ui.snapshot) ?? nodeTypeLabel(node.type);
  const nodes = ui.snapshot.nodes
    .filter((node) => !needle || nodeLabel(node).toLowerCase().includes(needle) || nodeTypeLabel(node.type).toLowerCase().includes(needle) || kindOf(node).toLowerCase().includes(needle))
    .sort((a, b) => {
      const lead = (node: CanvasNode) => Number(ui.snapshot.bots[botIdOfNode(node.id) ?? ""]?.lead === true);
      return TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type) || lead(b) - lead(a) || nodeLabel(a).localeCompare(nodeLabel(b));
    });
  return (
    <aside aria-label={t("projectCanvas.nodeList.title")} className={cn("popover-surface pointer-events-auto absolute start-6 top-4 z-[80] flex w-64 flex-col gap-2 rounded-xl border border-hairline/50 bg-menu p-2", aboveMinimap ? "bottom-68" : "bottom-24")}>
      <div className="flex items-center gap-2 ps-2">
        <h2 className="flex-1 truncate text-[13px] font-semibold leading-[18px] text-ink">{t("projectCanvas.nodeList.title")}</h2>
        <span className="text-[12px] leading-4 text-ink-tertiary tabular-nums">{ui.snapshot.nodes.length}</span>
        <button type="button" className="ui-icon-button" aria-label={t("projectCanvas.nodeList.close")} title={t("projectCanvas.nodeList.close")} onClick={onClose}>
          <X size={16} aria-hidden="true" />
        </button>
      </div>
      <label className="flex h-8 items-center gap-2 rounded-lg border border-hairline/40 bg-inset px-2 focus-within:border-focus">
        <Search size={14} aria-hidden="true" className="shrink-0 text-ink-tertiary" />
        <input
          type="search"
          value={query}
          aria-label={t("projectCanvas.nodeList.search")}
          placeholder={t("projectCanvas.nodeList.search")}
          className="min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-ink-tertiary"
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      <ul className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto">
        {nodes.map((node) => {
          const Icon = NODE_ICONS[node.type];
          return (
            <li key={node.id}>
              <button type="button" className={cn(MENU_ITEM, "hover:bg-menu-hover", ui.selection.has(node.id) && "bg-menu-active")} aria-current={ui.selection.has(node.id) || undefined} onClick={() => onFocus(node.id)}>
                <Icon size={16} aria-hidden="true" className="shrink-0 text-ink-secondary" />
                <span className="min-w-0 flex-1 truncate">{nodeLabel(node)}</span>
                <span className="max-w-[45%] shrink-0 truncate text-[12px] leading-4 text-ink-tertiary">{kindOf(node)}</span>
              </button>
            </li>
          );
        })}
      </ul>
      {!nodes.length ? <p className="px-2 pb-2 text-[12px] leading-4 text-ink-tertiary">{t("projectCanvas.nodeList.none")}</p> : null}
    </aside>
  );
}
