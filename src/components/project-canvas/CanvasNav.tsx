import { useState } from "react";
import { ChevronsRight, ListTree } from "lucide-react";
import { MENU_LABEL, MENU_NOTE, MENU_ROW } from "@/components/menu-recipe";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { canvasOutline, filmClock, type OutlineEntry } from "@/lib/project-canvas/outline";
import { useCanvasUi } from "./canvas-ui";
import { DOCK_SURFACE } from "./docks";
import { nodeLabel } from "./node-kinds";

/** The canvas's table of contents, floating on its right: its characters, its scenes and its shots, a shot saying how
 * long it runs and where it starts in the film, each row taking the view to what it names. */
export function CanvasNav({ onFocus }: { onFocus: (nodeId: string) => void }) {
  const ui = useCanvasUi();
  const [chosen, setChosen] = useState<boolean | null>(null);
  const outline = canvasOutline(ui.snapshot.nodes);
  const listed = outline.characters.length + outline.scenes.length + outline.shots.length;
  const open = chosen ?? listed > 0;
  if (!open) {
    const show = t("projectCanvas.nav.show");
    return (
      <div className="pointer-events-none absolute end-6 top-4 z-[80] flex">
        <div className={DOCK_SURFACE}>
          <button
            type="button"
            className="ui-icon-button"
            aria-label={show}
            title={show}
            onClick={() => setChosen(true)}
            onPointerDown={(event) => event.stopPropagation()}
            onDoubleClick={(event) => event.stopPropagation()}
          >
            <ListTree size={16} aria-hidden="true" />
          </button>
        </div>
      </div>
    );
  }
  const hide = t("projectCanvas.nav.hide");
  const shotMeta = (entry: OutlineEntry): string | undefined => {
    if (entry.durationMs === undefined) return undefined;
    const duration = t("projectCanvas.nav.seconds", { count: Math.round(entry.durationMs / 1000) });
    if (entry.fromMs === undefined) return duration;
    return t("projectCanvas.nav.timing", { duration, from: filmClock(entry.fromMs), to: filmClock(entry.fromMs + entry.durationMs) });
  };
  const section = (key: string, label: string, entries: readonly OutlineEntry[], title: (entry: OutlineEntry, index: number) => string, meta?: (entry: OutlineEntry) => string | undefined) => {
    if (!entries.length) return null;
    return (
      <section key={key} className="flex flex-col" data-canvas-outline-section={key}>
        <h3 className={MENU_LABEL}>{label}</h3>
        <ul className="flex flex-col gap-0.5">
          {entries.map((entry, index) => {
            const name = title(entry, index);
            const info = meta?.(entry);
            const current = ui.selection.has(entry.nodeId);
            return (
              <li key={entry.nodeId}>
                <button
                  type="button"
                  data-canvas-outline={entry.nodeId}
                  className={cn(MENU_ROW, current && "bg-menu-active")}
                  title={name}
                  aria-current={current ? "true" : undefined}
                  onClick={() => onFocus(entry.nodeId)}
                >
                  <span dir="auto" className="min-w-0 flex-1 truncate font-medium">{name}</span>
                  {info ? <span data-canvas-outline-meta="" className="shrink-0 text-[11px] leading-4 tabular-nums text-ink-tertiary">{info}</span> : null}
                </button>
              </li>
            );
          })}
        </ul>
      </section>
    );
  };
  return (
    <aside
      aria-label={t("projectCanvas.nav.title")}
      data-canvas-no-zoom=""
      className="popover-surface pointer-events-auto absolute end-6 top-4 z-[80] flex max-h-[calc(100%-7rem)] w-72 flex-col rounded-xl border border-hairline/50 bg-menu p-1.5"
      onPointerDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      <div className="flex h-8 shrink-0 items-center gap-1 ps-2">
        <ListTree size={14} aria-hidden="true" className="shrink-0 text-ink-tertiary" />
        <h2 className="min-w-0 flex-1 truncate text-[13px] font-semibold leading-[18px] text-ink">{t("projectCanvas.nav.title")}</h2>
        <button type="button" className="ui-icon-button" aria-label={hide} title={hide} onClick={() => setChosen(false)}>
          <ChevronsRight size={16} aria-hidden="true" className="rtl:-scale-x-100" />
        </button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto pb-1">
        {listed ? (
          <>
            {section("characters", t("projectCanvas.nav.characters"), outline.characters, (entry) => nodeLabel(entry.node))}
            {section("scenes", t("projectCanvas.nav.scenes"), outline.scenes, (entry) => nodeLabel(entry.node))}
            {section("shots", t("projectCanvas.nav.shots"), outline.shots, (entry, index) => entry.node.title.trim() || t("projectCanvas.nav.shot", { count: index + 1 }), shotMeta)}
          </>
        ) : (
          <p className={MENU_NOTE}>{t("projectCanvas.nav.empty")}</p>
        )}
      </div>
    </aside>
  );
}
