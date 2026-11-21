import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { Unlink, X } from "lucide-react";
import type { Bot } from "@/state/store";
import { usePopoverDismiss } from "@/hooks/use-popover-dismiss";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { CARD_HEIGHT, CARD_WIDTH, type Point } from "@/lib/team-canvas";
import { polylinePath } from "@/lib/team-canvas-computers";
import { ownStretch, removableLines, type FlowLayout } from "@/lib/team-flow";
import type { TeamMapSection } from "@/lib/team-map";
import type { TeamFlowLineInput, TeamFlowWire } from "../../../shared/team-flow";
import { MENU_LABEL, MENU_META, MENU_NOTE, MENU_ROW, MENU_SHEET } from "../menu-recipe";

type Drawing = { from: string; pointerId: number; start: Point; moved: boolean };

const dotOf = (card: Point): Point => ({ x: card.x + CARD_WIDTH, y: card.y + CARD_HEIGHT / 2 });

export function TeamFlowTree({ section, flow, layout, canDraw, readable, renderBot, onLine }: {
  section: TeamMapSection<Bot>;
  flow: TeamFlowWire;
  layout: FlowLayout;
  canDraw: boolean;
  readable: boolean;
  renderBot: (bot: Bot) => ReactNode;
  onLine: (input: TeamFlowLineInput) => Promise<void>;
}) {
  const root = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const removal = useRef<HTMLButtonElement>(null);
  const dots = useRef(new Map<string, HTMLButtonElement>());
  const drawing = useRef<Drawing | null>(null);
  const afterDrag = useRef(false);
  const [pointer, setPointer] = useState<{ from: string; at: Point; target: string | null } | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [focused, setFocused] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [said, setSaid] = useState("");
  const [busy, setBusy] = useState(false);

  const members = [...section.chiefs, ...section.members];
  const bots = new Map(members.map((bot) => [bot.id, bot]));
  const cards = new Map(layout.cards.map((card) => [card.botId, card]));
  const nameOf = (id: string) => bots.get(id)?.name ?? id;
  const drawable = canDraw && readable;
  const removable = drawable ? removableLines(layout, flow.chiefId) : [];
  const selectedLink = removable.find((link) => link.botId === selected);
  const superiorOf = (id: string) => layout.links.find((link) => link.botId === id)?.superiorId;

  usePopoverDismiss(menuFor !== null, menu, () => setMenuFor(null));
  usePopoverDismiss(selectedLink !== undefined, removal, () => setSelected(null));
  useEffect(() => {
    if (menuFor) menu.current?.querySelector<HTMLButtonElement>("[role=menuitem]:not(:disabled)")?.focus();
  }, [menuFor]);
  useEffect(() => {
    if (selected && !focused) removal.current?.focus();
  }, [selected, focused]);

  const change = async (botId: string, superiorId: string | null) => {
    setProblem(null); setMenuFor(null); setBusy(true);
    try {
      await onLine({ botId, superiorId });
      setSelected(null);
      setSaid(superiorId && superiorId !== flow.chiefId
        ? t("teamFlow.placed", { name: nameOf(botId), superior: nameOf(superiorId) })
        : t("teamFlow.underChief", { name: nameOf(botId), chief: nameOf(flow.chiefId) }));
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const local = (clientX: number, clientY: number): Point => {
    const element = root.current;
    if (!element) return { x: 0, y: 0 };
    const bounds = element.getBoundingClientRect();
    const scale = element.offsetWidth ? bounds.width / element.offsetWidth : 1;
    return { x: (clientX - bounds.left) / scale, y: (clientY - bounds.top) / scale };
  };
  const botAt = (clientX: number, clientY: number) =>
    document.elementFromPoint(clientX, clientY)?.closest<HTMLElement>("[data-bot-id]")?.dataset.botId ?? null;
  const press = (event: ReactPointerEvent<HTMLButtonElement>, from: string) => {
    if (!drawable || busy || event.button !== 0 || !event.isPrimary) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drawing.current = { from, pointerId: event.pointerId, start: { x: event.clientX, y: event.clientY }, moved: false };
  };
  const drag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const active = drawing.current;
    if (!active || active.pointerId !== event.pointerId) return;
    if (!active.moved && Math.hypot(event.clientX - active.start.x, event.clientY - active.start.y) < 5) return;
    active.moved = true;
    const target = botAt(event.clientX, event.clientY);
    setPointer({ from: active.from, at: local(event.clientX, event.clientY), target: target === active.from ? null : target });
  };
  const release = (event: ReactPointerEvent<HTMLButtonElement> | null, cancelled = false) => {
    const active = drawing.current;
    if (!active || (event && active.pointerId !== event.pointerId)) return;
    drawing.current = null;
    setPointer(null);
    const dot = dots.current.get(active.from);
    if (dot?.hasPointerCapture(active.pointerId)) dot.releasePointerCapture(active.pointerId);
    if (!active.moved) return;
    afterDrag.current = true;
    window.setTimeout(() => { afterDrag.current = false; }, 0);
    const target = !cancelled && event ? botAt(event.clientX, event.clientY) : null;
    if (target && target !== active.from) void change(target, active.from);
  };
  const menuKeys = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("[role=menuitem]:not(:disabled)")];
    const index = items.findIndex((item) => item === document.activeElement);
    const next = ({ ArrowDown: index + 1, ArrowUp: index - 1, Home: 0, End: items.length - 1 } as Record<string, number>)[event.key];
    if (next !== undefined && items.length) {
      event.preventDefault();
      items[(next + items.length) % items.length].focus();
    }
    if (event.key === "Escape" && menuFor) {
      event.preventDefault();
      dots.current.get(menuFor)?.focus();
      setMenuFor(null);
    }
    if (event.key === "Tab") setMenuFor(null);
  };
  const lineKeys = (event: ReactKeyboardEvent<SVGPathElement>, botId: string) => {
    if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setFocused(null); setSelected(botId); }
    if (event.key === "Delete" || event.key === "Backspace") { event.preventDefault(); void change(botId, null); }
    if (event.key === "Escape") setSelected(null);
  };

  const drawingFrom = pointer ? cards.get(pointer.from) : undefined;
  const stretch = selectedLink ? ownStretch(selectedLink) : null;
  return <div ref={root} className="pointer-events-none absolute inset-0" data-team-flow={section.key}>
    <svg aria-hidden={removable.length ? undefined : true} className="absolute inset-0 overflow-visible" width={layout.width} height={layout.height}>
      {layout.links.map((link) => {
        const lit = link.botId === selected || link.botId === focused;
        return <path key={link.botId} data-flow-line={`${link.superiorId}:${link.botId}`} d={polylinePath(link.points)} fill="none" strokeLinejoin="round"
          strokeWidth={lit ? 2.5 : 1.5} className={cn("transition-colors duration-[120ms] motion-reduce:transition-none", lit ? "stroke-accent" : "stroke-ink-secondary/35")} />;
      })}
      {removable.map((link) => <path key={`hit:${link.botId}`} d={polylinePath(ownStretch(link))} fill="none" stroke="transparent" strokeWidth={16}
        tabIndex={0} role="button" aria-pressed={link.botId === selected}
        aria-label={t("teamFlow.line", { superior: nameOf(link.superiorId), name: nameOf(link.botId) })}
        className="pointer-events-auto cursor-pointer outline-none" style={{ pointerEvents: "stroke" }}
        onClick={() => setSelected(link.botId)} onFocus={() => setFocused(link.botId)} onBlur={() => setFocused(null)}
        onKeyDown={(event) => lineKeys(event, link.botId)} />)}
      {pointer && drawingFrom && <path d={polylinePath([dotOf(drawingFrom), pointer.at])} fill="none" strokeWidth={2} strokeDasharray="6 5" strokeLinecap="round" className="stroke-accent" />}
    </svg>
    {layout.cards.map((card) => {
      const bot = bots.get(card.botId);
      if (!bot) return null;
      const candidates = members.filter((other) => other.id !== bot.id && other.id !== flow.chiefId);
      return <div key={bot.id} data-flow-card={bot.id} className={cn("pointer-events-auto absolute rounded-xl", pointer?.target === bot.id && "ring-2 ring-accent ring-offset-2 ring-offset-panel")}
        style={{ left: card.x, top: card.y }}>
        {renderBot(bot)}
        {drawable && <button ref={(element) => { if (element) dots.current.set(bot.id, element); else dots.current.delete(bot.id); }}
          type="button" data-flow-dot={bot.id} disabled={busy} aria-haspopup="menu" aria-expanded={menuFor === bot.id}
          aria-label={t("teamFlow.drawFrom", { name: bot.name })} title={t("teamFlow.drawHint", { name: bot.name })}
          className="group absolute -right-3 top-1/2 z-10 flex size-6 -translate-y-1/2 cursor-crosshair touch-none items-center justify-center rounded-full focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-default"
          onPointerDown={(event) => press(event, bot.id)} onPointerMove={drag} onPointerUp={(event) => release(event)} onPointerCancel={(event) => release(event, true)}
          onKeyDown={(event) => { if (event.key === "Escape" && drawing.current) { event.preventDefault(); release(null, true); } }}
          onClick={() => { if (!afterDrag.current) setMenuFor(menuFor === bot.id ? null : bot.id); }}>
          <span className={cn("size-3 rounded-full border-2 border-panel transition-colors duration-[120ms] motion-reduce:transition-none",
            menuFor === bot.id || pointer?.from === bot.id ? "bg-accent" : "bg-ink-secondary/60 group-hover:bg-accent group-focus-visible:bg-accent")} />
        </button>}
        {menuFor === bot.id && <div ref={menu} role="menu" aria-label={t("teamFlow.menu", { name: bot.name })} onKeyDown={menuKeys}
          className={cn(MENU_SHEET, "absolute right-0 top-[calc(50%+16px)] z-30 w-56 animate-pop-in motion-reduce:animate-none")}>
          <p className={MENU_LABEL}>{t("teamFlow.menu", { name: bot.name })}</p>
          {candidates.length === 0 && <p className={MENU_NOTE}>{t("teamFlow.nobodyToPlace")}</p>}
          {candidates.map((other) => {
            const already = superiorOf(other.id) === bot.id;
            return <button key={other.id} type="button" role="menuitem" disabled={already} className={MENU_ROW} onClick={() => void change(other.id, bot.id)}>
              <span className="min-w-0 flex-1 truncate">{other.name}</span>
              {already && <span className={MENU_META}>{t("teamFlow.alreadyUnder")}</span>}
            </button>;
          })}
        </div>}
      </div>;
    })}
    {selectedLink && stretch && <button ref={removal} type="button" onClick={() => void change(selectedLink.botId, null)}
      aria-label={t("teamFlow.removeLineAria", { superior: nameOf(selectedLink.superiorId), name: nameOf(selectedLink.botId) })} title={t("teamFlow.removeLine")}
      onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); setSelected(null); } }}
      className="pointer-events-auto absolute z-20 flex size-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-hairline bg-panel text-ink-secondary shadow-sm transition-colors duration-[120ms] hover:text-danger focus-visible:outline-2 focus-visible:outline-accent motion-reduce:transition-none"
      style={{ left: (stretch[0].x + stretch[1].x) / 2, top: stretch[0].y }}>
      <Unlink size={13} />
    </button>}
    {(problem || !readable) && <div role={problem ? "alert" : undefined}
      className={cn("pointer-events-auto absolute inset-x-2 top-[calc(100%+8px)] z-30 flex items-start gap-2 rounded-lg border bg-panel px-3 py-2 text-[12px] shadow-sm",
        problem ? "border-danger/40 text-danger" : "border-warning/40 text-warning")}>
      <span className="min-w-0 flex-1">{problem ?? t("teamFlow.unreadable")}</span>
      {problem && <button type="button" aria-label={t("teamFlow.dismiss")} onClick={() => setProblem(null)}
        className="-m-1 flex size-6 shrink-0 items-center justify-center rounded-md text-danger hover:bg-danger/10 focus-visible:outline-2 focus-visible:outline-accent"><X size={12} /></button>}
    </div>}
    <p role="status" aria-live="polite" className="sr-only">{said}</p>
  </div>;
}
