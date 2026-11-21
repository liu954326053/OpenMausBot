import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { Check, Loader2 } from "lucide-react";

import { popoverClosesOnKey, usePopoverDismiss } from "@/hooks/use-popover-dismiss";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { api } from "@/state/api";
import { refreshInbox } from "@/state/inbox";
import type { AppState, BotAnnouncement } from "@/state/store";
import { sameItems, useStoreDispatch, useStoreSelector } from "@/state/store-select";
import { BotAvatar } from "./Avatar";
import { MENU_HEADING, MENU_NOTE, MENU_SHEET } from "./menu-recipe";
import { anchoredMenuPosition, nextMenuIndex } from "./SidebarPopoverMenu";

const EDGE = 8;
const ROW = "flex min-h-8 w-full items-center gap-2 rounded-lg px-2 py-1.5 text-start text-[14px] leading-5 text-ink hover:bg-menu-hover focus-visible:bg-menu-hover focus-visible:outline-none disabled:opacity-60 disabled:hover:bg-transparent";

const membersOf = (department: string) => (state: AppState) =>
  state.bots.filter((bot) => !bot.hidden && !bot.defaultBot && (bot.section?.trim() ?? "") === department);

const choices = (menu: HTMLElement | null) => [...menu?.querySelectorAll<HTMLButtonElement>("[data-chief-choice]:not(:disabled)") ?? []];

/** A department's bots, one of which becomes its Chief of Staff: the change the Chief of Staff switch in a bot's settings makes. */
export function ChiefPicker({ department, anchor, onClose, onChosen }: {
  department: string;
  /** The control that opened it: the menu opens at it and gives the keyboard back to it. */
  anchor: HTMLElement;
  onClose: () => void;
  /** After the server made the bot the Chief of Staff. */
  onChosen?: (botId: string) => void;
}) {
  const members = useStoreSelector(membersOf(department), sameItems);
  const instances = useStoreSelector((state) => state.instances);
  const dispatch = useStoreDispatch();
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState("");
  const live = useRef(true);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);

  const close = (refocus: boolean) => {
    onClose();
    if (refocus && anchor.isConnected) anchor.focus();
  };
  const inside = useRef({ contains: (target: unknown) => Boolean(menuRef.current?.contains(target as Node) || anchor.contains(target as Node)) });
  usePopoverDismiss(saving === null, inside, () => close(false));

  useLayoutEffect(() => {
    const place = () => {
      const menu = menuRef.current;
      if (!menu) return;
      const rtl = getComputedStyle(anchor).direction === "rtl";
      setPosition(anchoredMenuPosition(anchor.getBoundingClientRect(), { width: menu.offsetWidth, height: menu.offsetHeight }, { width: window.innerWidth, height: window.innerHeight }, rtl, "end"));
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [anchor, members.length, error]);

  const placed = position !== null;
  useEffect(() => {
    if (!placed) return;
    const rows = choices(menuRef.current);
    (rows.find((row) => row.getAttribute("aria-checked") === "true") ?? rows[0] ?? menuRef.current)?.focus();
  }, [placed]);

  const choose = async (bot: AppState["bots"][number]) => {
    if (saving !== null) return;
    if (bot.chiefOfStaff) return close(true);
    setSaving(bot.id);
    setError("");
    try {
      const { bot: saved } = await api<{ bot: BotAnnouncement }>(`/api/bots/${encodeURIComponent(bot.id)}`, { method: "PATCH", body: JSON.stringify({ chiefOfStaff: true }) });
      dispatch({ type: "botPatched", bot: saved });
      void refreshInbox();
      onChosen?.(bot.id);
      if (live.current) close(true);
    } catch (cause) {
      if (!live.current) return;
      setSaving(null);
      setError(cause instanceof Error && cause.message ? cause.message : t("chiefPicker.failed", { name: bot.name }));
    }
  };

  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const rows = choices(event.currentTarget);
    const next = nextMenuIndex(event.key, rows.indexOf(document.activeElement as HTMLButtonElement), rows.length);
    if (next !== null) {
      event.preventDefault();
      rows[next]?.focus();
    } else if (event.key === "Tab" || popoverClosesOnKey({ key: event.key, defaultPrevented: event.defaultPrevented, isComposing: event.nativeEvent.isComposing })) {
      event.preventDefault();
      event.stopPropagation();
      if (saving === null) close(true);
    }
  };

  const title = t("chiefPicker.title", { team: department });
  return createPortal(
    <div ref={menuRef} role="menu" aria-label={title} aria-busy={saving !== null} tabIndex={-1} data-chief-picker={department} onKeyDown={onKey}
      onPointerDown={(event) => event.stopPropagation()}
      style={{ position: "fixed", left: position?.left ?? 0, top: position?.top ?? 0, minWidth: 240, maxWidth: `min(320px, calc(100vw - ${EDGE * 2}px))`, maxHeight: `calc(100vh - ${EDGE * 2}px)`, visibility: placed ? undefined : "hidden" }}
      className={cn(MENU_SHEET, "z-[61] animate-pop-in overflow-y-auto outline-none motion-reduce:animate-none")}>
      <div dir="auto" className={MENU_HEADING}>{title}</div>
      {members.map((bot) => {
        const coordinates = instances.find((instance) => instance.instanceId === bot.modelSelection.instanceId)?.capabilities?.agentsMcp === true;
        const detail = coordinates ? bot.title?.trim() : t("permissions.chief.unsupported");
        return (
          <button key={bot.id} type="button" role="menuitemradio" aria-checked={Boolean(bot.chiefOfStaff)} data-chief-choice={bot.id}
            disabled={(!coordinates && !bot.chiefOfStaff) || (saving !== null && saving !== bot.id)} title={detail || undefined}
            onClick={() => void choose(bot)} className={ROW}>
            <BotAvatar bot={bot} size={20} animated={false} />
            <span className="flex min-w-0 flex-1 flex-col">
              <span dir="auto" className="truncate">{bot.name}</span>
              {detail && <span dir="auto" className="truncate text-[12px] leading-4 text-ink-secondary">{detail}</span>}
            </span>
            <span className="flex size-4 shrink-0 items-center justify-center text-ink-secondary">
              {saving === bot.id ? <Loader2 size={14} aria-hidden="true" className="animate-spin motion-reduce:animate-none" /> : bot.chiefOfStaff && <Check size={16} aria-hidden="true" />}
            </span>
          </button>
        );
      })}
      {!members.length && <p className={MENU_NOTE}>{t("chiefPicker.noBots")}</p>}
      {error && <p role="alert" dir="auto" className={cn(MENU_NOTE, "text-danger")}>{error}</p>}
    </div>,
    document.body,
  );
}
