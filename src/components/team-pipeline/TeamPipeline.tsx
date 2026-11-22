import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { Check, Unlink, X } from "lucide-react";
import type { Bot } from "@/state/store";
import { usePopoverDismiss } from "@/hooks/use-popover-dismiss";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { CARD_HEIGHT, CARD_WIDTH, type Point } from "@/lib/team-canvas";
import type { PipelineLayout, PipelineLine } from "@/lib/team-pipeline";
import type { TeamMapSection } from "@/lib/team-map";
import type { FlowLineWire, TeamPipelineLineInput, TeamPipelineWire } from "../../../shared/team-pipeline";
import { MENU_GUTTER, MENU_LABEL, MENU_NOTE, MENU_ROW, MENU_SHEET } from "../menu-recipe";
import { cardHasNote, PipelineCardNote } from "./PipelineCardNote";

type Drawing = { from: string; pointerId: number; start: Point; moved: boolean };

const dotOf = (card: Point): Point => ({ x: card.x + CARD_WIDTH, y: card.y + CARD_HEIGHT / 2 });
const same = (a: FlowLineWire | null, b: FlowLineWire) => a !== null && a.from === b.from && a.to === b.to;

export function TeamPipeline({ section, pipeline, layout, canDraw, readable, renderBot, onLine }: {
  section: TeamMapSection<Bot>;
  pipeline: TeamPipelineWire;
  layout: PipelineLayout;
  canDraw: boolean;
  readable: boolean;
  renderBot: (bot: Bot, note?: ReactNode) => ReactNode;
  onLine: (input: TeamPipelineLineInput) => Promise<void>;
}) {
  const noteId = useId();
  const root = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const removal = useRef<HTMLButtonElement>(null);
  const dots = useRef(new Map<string, HTMLButtonElement>());
  const drawing = useRef<Drawing | null>(null);
  const afterDrag = useRef(false);
  const [pointer, setPointer] = useState<{ from: string; at: Point; target: string | null } | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [selected, setSelected] = useState<FlowLineWire | null>(null);
  const [focused, setFocused] = useState<FlowLineWire | null>(null);
  const [problem, setProblem] = useState<{ text: string; at: Point } | null>(null);
  const [said, setSaid] = useState("");
  const [busy, setBusy] = useState(false);

  const members = [...section.chiefs, ...section.members];
  const bots = new Map(members.map((bot) => [bot.id, bot]));
  const cards = new Map(layout.cards.map((card) => [card.botId, card]));
  const nameOf = (id: string) => bots.get(id)?.name ?? id;
  const drawable = canDraw && readable;
  const selectedLine = drawable ? layout.lines.find((line) => same(selected, line)) : undefined;
  const sends = (from: string, to: string) => pipeline.lines.some((line) => line.from === from && line.to === to);

  usePopoverDismiss(menuFor !== null, menu, () => setMenuFor(null));
  usePopoverDismiss(selectedLine !== undefined, removal, () => setSelected(null));
  useEffect(() => {
    if (menuFor) menu.current?.querySelector<HTMLButtonElement>("[role=menuitemcheckbox]")?.focus();
  }, [menuFor]);
  useEffect(() => {
    if (selected && !focused) removal.current?.focus();
  }, [selected, focused]);

  const change = async (input: TeamPipelineLineInput, at: Point) => {
    if (busy) return;
    setProblem(null); setMenuFor(null); setBusy(true);
    try {
      await onLine(input);
      setSelected(null);
      setSaid(t(input.present ? "teamPipeline.added" : "teamPipeline.removed", { from: nameOf(input.from), to: nameOf(input.to) }));
    } catch (error) {
      setProblem({ text: error instanceof Error ? error.message : String(error), at });
    } finally {
      setBusy(false);
    }
  };
  const under = (botId: string): Point => {
    const card = cards.get(botId);
    return card ? { x: card.x, y: card.y + CARD_HEIGHT + 8 } : { x: 0, y: 0 };
  };
  const add = (from: string, to: string) => change({ from, to, present: true }, under(from));
  const remove = (line: PipelineLine) => change({ from: line.from, to: line.to, present: false }, { x: line.mid.x - CARD_WIDTH / 2, y: line.mid.y + 20 });

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
    if (target && target !== active.from) void add(active.from, target);
  };
  const menuKeys = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("[role=menuitemcheckbox]")];
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
  const lineKeys = (event: ReactKeyboardEvent<SVGPathElement>, line: PipelineLine) => {
    if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setFocused(null); setSelected(line); }
    if (event.key === "Delete" || event.key === "Backspace") { event.preventDefault(); void remove(line); }
    if (event.key === "Escape") setSelected(null);
  };

  const drawingFrom = pointer ? cards.get(pointer.from) : undefined;
  return <div ref={root} className="pointer-events-none absolute inset-0" data-team-pipeline={section.key}>
    <svg aria-hidden={drawable && layout.lines.length ? undefined : true} className="absolute inset-0 overflow-visible" width={layout.width} height={layout.height}>
      {layout.lines.map((line) => {
        const lit = same(selected, line) || same(focused, line);
        return <path key={`${line.from}:${line.to}`} data-pipeline-line={`${line.from}:${line.to}`} d={line.path} fill="none" strokeLinecap="round" strokeLinejoin="round"
          strokeWidth={lit ? 2.5 : 1.5} className={cn("transition-colors duration-[120ms] motion-reduce:transition-none", lit ? "stroke-accent" : "stroke-ink-secondary/35")} />;
      })}
      {drawable && layout.lines.map((line) => <path key={`hit:${line.from}:${line.to}`} d={line.hit} fill="none" stroke="transparent" strokeWidth={14}
        tabIndex={0} role="button" aria-pressed={same(selected, line)}
        aria-label={t("teamPipeline.line", { from: nameOf(line.from), to: nameOf(line.to) })}
        className="pointer-events-auto cursor-pointer outline-none" style={{ pointerEvents: "stroke" }}
        onClick={() => setSelected(line)} onFocus={() => setFocused(line)} onBlur={() => setFocused(null)}
        onKeyDown={(event) => lineKeys(event, line)} />)}
      {pointer && drawingFrom && <path d={`M ${dotOf(drawingFrom).x} ${dotOf(drawingFrom).y} L ${pointer.at.x} ${pointer.at.y}`} fill="none" strokeWidth={2} strokeDasharray="6 5" strokeLinecap="round" className="stroke-accent" />}
    </svg>
    {layout.cards.map((card) => {
      const bot = bots.get(card.botId);
      if (!bot) return null;
      const candidates = members.filter((other) => other.id !== bot.id && other.id !== pipeline.chiefId);
      const note = `${noteId}-${bot.id}`;
      return <div key={bot.id} data-pipeline-card={bot.id} data-column={card.column} role="group" aria-label={bot.name} aria-describedby={cardHasNote(pipeline, bot.id) ? note : undefined}
        className={cn("pointer-events-auto absolute rounded-xl", pointer?.target === bot.id && "ring-2 ring-accent ring-offset-2 ring-offset-panel")}
        style={{ left: card.x, top: card.y }}>
        {renderBot(bot, <PipelineCardNote id={note} pipeline={pipeline} botId={bot.id} />)}
        {drawable && <button ref={(element) => { if (element) dots.current.set(bot.id, element); else dots.current.delete(bot.id); }}
          type="button" data-pipeline-dot={bot.id} disabled={busy} aria-haspopup="menu" aria-expanded={menuFor === bot.id}
          aria-label={t("teamPipeline.drawFrom", { name: bot.name })} title={t("teamPipeline.drawHint", { name: bot.name })}
          className="group absolute -right-3 top-1/2 z-10 flex size-6 -translate-y-1/2 cursor-crosshair touch-none items-center justify-center rounded-full focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-default"
          onPointerDown={(event) => press(event, bot.id)} onPointerMove={drag} onPointerUp={(event) => release(event)} onPointerCancel={(event) => release(event, true)}
          onKeyDown={(event) => { if (event.key === "Escape" && drawing.current) { event.preventDefault(); release(null, true); } }}
          onClick={() => { if (!afterDrag.current) setMenuFor(menuFor === bot.id ? null : bot.id); }}>
          <span className={cn("size-3 rounded-full border-2 border-panel transition-colors duration-[120ms] motion-reduce:transition-none",
            menuFor === bot.id || pointer?.from === bot.id ? "bg-accent" : "bg-ink-secondary/60 group-hover:bg-accent group-focus-visible:bg-accent")} />
        </button>}
        {menuFor === bot.id && <div ref={menu} role="menu" aria-label={t("teamPipeline.menu", { name: bot.name })} onKeyDown={menuKeys}
          className={cn(MENU_SHEET, "absolute right-0 top-[calc(50%+16px)] z-30 w-56 animate-pop-in motion-reduce:animate-none")}>
          <p className={MENU_LABEL}><span className="truncate">{t("teamPipeline.menu", { name: bot.name })}</span></p>
          {candidates.length === 0 && <p className={MENU_NOTE}>{t("teamPipeline.nobody")}</p>}
          {candidates.map((other) => {
            const present = sends(bot.id, other.id);
            return <button key={other.id} type="button" role="menuitemcheckbox" aria-checked={present} className={MENU_ROW}
              onClick={() => void change({ from: bot.id, to: other.id, present: !present }, under(bot.id))}>
              <span className={MENU_GUTTER}>{present && <Check size={16} aria-hidden="true" />}</span>
              <span className="min-w-0 flex-1 truncate">{other.name}</span>
            </button>;
          })}
        </div>}
      </div>;
    })}
    {selectedLine && <button ref={removal} type="button" disabled={busy} onClick={() => void remove(selectedLine)}
      aria-label={t("teamPipeline.removeLineAria", { from: nameOf(selectedLine.from), to: nameOf(selectedLine.to) })} title={t("teamPipeline.removeLine")}
      onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); setSelected(null); } }}
      className="pointer-events-auto absolute z-20 flex size-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-hairline bg-panel text-ink-secondary transition-colors duration-[120ms] hover:text-danger focus-visible:outline-2 focus-visible:outline-accent motion-reduce:transition-none"
      style={{ left: selectedLine.mid.x, top: selectedLine.mid.y }}>
      <Unlink size={14} aria-hidden="true" />
    </button>}
    {problem && <div role="alert" style={{ left: problem.at.x, top: problem.at.y, width: CARD_WIDTH }}
      className="pointer-events-auto absolute z-30 flex items-start gap-2 rounded-lg border border-danger/40 bg-panel px-3 py-2 text-[12px] leading-4 text-danger">
      <span className="min-w-0 flex-1">{problem.text}</span>
      <button type="button" aria-label={t("teamPipeline.dismiss")} onClick={() => setProblem(null)}
        className="-m-1 flex size-6 shrink-0 items-center justify-center rounded-md text-danger hover:bg-danger/10 focus-visible:outline-2 focus-visible:outline-accent"><X size={14} aria-hidden="true" /></button>
    </div>}
    {!readable && <p className="pointer-events-auto absolute inset-x-2 top-[calc(100%+8px)] z-30 rounded-lg border border-warning/40 bg-panel px-3 py-2 text-[12px] leading-4 text-warning">{t("teamPipeline.unreadable")}</p>}
    <p role="status" aria-live="polite" className="sr-only">{said}</p>
  </div>;
}
