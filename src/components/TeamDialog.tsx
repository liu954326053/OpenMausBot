import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Plus, X } from "lucide-react";
import { api, useStore, type Bot } from "@/state/store";
import { BotPickerList } from "./BotPickerList";
import { SETTINGS_INPUT } from "./SettingsPrimitives";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { imeComposing } from "@/lib/send-key";
import { useTeamProjectSide } from "@/state/team-projects";

export function TeamDialog({ section, rename = false, onClose, onRenamed, onCreated }: {
  section?: string;
  rename?: boolean;
  onRenamed?: (oldName: string, newName: string) => void;
  /** A new department was made, with this name. */
  onCreated?: (name: string) => void;
  onClose: () => void;
}) {
  const { state, dispatch } = useStore();
  const projects = useTeamProjectSide();
  const [name, setName] = useState(section ?? "");
  const managing = Boolean(section) && !rename;
  const initialMembers = useRef(new Set(managing ? state.bots.filter(bot => !bot.hidden && (bot.section?.trim() ?? "") === section).map(bot => bot.id) : []));
  const [picked, setPicked] = useState<Set<string>>(() => new Set(initialMembers.current));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const dialog = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    (dialog.current?.querySelector<HTMLElement>("input") ?? dialog.current?.querySelector<HTMLElement>("button"))?.focus();
    return () => { if (opener?.isConnected) opener.focus(); };
  }, []);
  const moving = section !== undefined && !rename;
  const title = rename ? t("team.rename") : managing ? t(initialMembers.current.size ? "team.manageBots" : "team.addBots") : moving ? t("team.moveTo", { name: section || t("teamSettings.general") }) : t("team.create");
  const candidates = state.bots.filter((bot) => !bot.hidden && !projects.of(bot) && !(bot.defaultBot && (managing || !moving)) && (managing || !moving || (bot.section?.trim() ?? "") !== section));
  const addBotIds = [...picked].filter(id => !initialMembers.current.has(id));
  const removeBotIds = [...initialMembers.current].filter(id => !picked.has(id));
  const unchanged = managing ? !addBotIds.length && !removeBotIds.length : moving && !picked.size;
  const save = async () => {
    if (saving || (!moving && !name.trim()) || unchanged) return;
    if (section === undefined && [...(state.sections ?? []), ...state.bots.map((bot) => bot.section), ...state.groups.map((group) => group.section)].includes(name.trim())) {
      setError(t("team.duplicate"));
      return;
    }
    setSaving(true);
    setError("");
    try {
      const result: { sections: string[]; bots?: Bot[] } = await api(
        rename || managing ? `/api/sidebar-sections?section=${encodeURIComponent(section!)}` : "/api/sidebar-sections",
        { method: rename ? "PATCH" : managing ? "PUT" : "POST", body: JSON.stringify(rename ? { name: name.trim() } : managing ? { addBotIds, removeBotIds } : { name: name.trim(), botIds: [...picked] }) },
      );
      dispatch({ type: "sections", sections: result.sections });
      for (const bot of result.bots ?? []) dispatch({ type: "botPatched", bot });
      if (rename && section !== undefined) onRenamed?.(section, name.trim());
      if (section === undefined) onCreated?.(name.trim());
      onCloseRef.current();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setSaving(false);
    }
  };
  const createBot = () => {
    setError("");
    dispatch({ type: "newBot", section, preserveSelection: true, onError: setError, onCreated: (bot) => {
      initialMembers.current.add(bot.id);
      setPicked(previous => new Set([...previous, bot.id]));
    } });
  };
  return createPortal(
    <div className="ui-scrim fixed inset-0 z-[60] flex items-center justify-center p-4" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !saving) onClose();
    }}>
      <div ref={dialog} role="dialog" aria-modal="true" aria-labelledby="team-dialog-title" tabIndex={-1}
        className="ui-modal flex max-h-full w-full max-w-[480px] flex-col text-ink outline-none animate-pop-in motion-reduce:animate-none"
        onKeyDown={(event) => {
          if (imeComposing(event.nativeEvent)) { event.stopPropagation(); return; }
          if (event.key === "Escape" && !saving) { event.stopPropagation(); onClose(); }
          if (event.key === "Tab") {
            const controls = dialog.current?.querySelectorAll<HTMLElement>("input:enabled, button:enabled");
            if (!controls?.length) return;
            const first = controls[0], last = controls[controls.length - 1];
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
          }
        }}>
        <header className="flex items-center justify-between gap-3 px-5 pb-2 pt-5">
          <h2 id="team-dialog-title" dir="auto" title={title} className="min-w-0 truncate text-[20px] font-semibold leading-7 tracking-[-0.01em]">{title}</h2>
          <button type="button" aria-label={t("team.closeDialog")} disabled={saving} onClick={onClose} className="ui-icon-button shrink-0"><X size={18} /></button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4">
          {(!moving || rename) && <label className="mb-3 block text-[13px] font-medium leading-[18px] text-ink">{t("team.name")}
            <input value={name} dir="auto" maxLength={60} disabled={saving} onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter" && !imeComposing(event.nativeEvent)) void save(); }}
              className={cn(SETTINGS_INPUT, "mt-1.5 font-normal")} />
          </label>}
          {!rename && <>
            <p className="mb-3 text-[13px] leading-[18px] text-ink-secondary">
              {managing ? t("team.manageIntro") : moving ? t("team.moveIntro") : t("team.createIntro")} {t("team.moveWarning")}
            </p>
            {managing && <button type="button" disabled={saving || state.botCreationPending} onClick={createBot} className="ui-button ui-button-sm mb-3">
              <Plus size={14} />{t("sidebar.newBot")}
            </button>}
            <fieldset disabled={saving}>
              <legend className="mb-1 text-[12px] font-medium text-ink-secondary">{t("team.existingBots")}</legend>
              <BotPickerList bots={candidates} picked={picked} emptyHint={t("team.noBots")} onToggle={(id) => setPicked((previous) => {
                const next = new Set(previous);
                if (next.has(id)) next.delete(id); else next.add(id);
                return next;
              })} />
            </fieldset>
          </>}
          {error && <p role="alert" className="mt-3 text-[13px] text-danger">{error}</p>}
        </div>
        <footer className="flex flex-wrap items-center justify-end gap-2 px-5 pb-5">
          <button type="button" disabled={saving} onClick={onClose} className="ui-button ui-button-md">{t("common.cancel")}</button>
          <button type="button" disabled={saving || (!moving && !name.trim()) || unchanged} onClick={() => void save()} className="ui-button ui-button-md ui-button-primary">
            {saving ? t("team.saving") : rename ? t("folder.saveName") : managing ? t("common.save") : moving ? picked.size ? t(picked.size === 1 ? "team.moveOne" : "team.moveMany", { count: picked.size }) : t("team.moveSelected") : t("team.create")}
          </button>
        </footer>
      </div>
    </div>, document.body,
  );
}
