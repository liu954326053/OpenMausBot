import { useState } from "react";
import { LayoutTemplate, Loader2 } from "lucide-react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { saveBotAsTemplate, saveDepartmentAsTemplate, templateFailure } from "@/lib/template-library";
import { useOwnerOrAdmin } from "@/lib/use-owner-or-admin";
import { refreshTemplateLibrary } from "@/state/template-library";
import { useStore, type Bot } from "@/state/store";

/**
 * A menu item that saves something as a template and then shows it: Settings opens on Templates, where the new
 * template is listed. Only the owner or an admin is offered it, as the Templates page is theirs alone.
 */
function SaveAsTemplateItem({ label, save, className, onDone, mark }: {
  label: string; save: () => Promise<unknown>; className: string; onDone: () => void; mark: string;
}) {
  const { dispatch } = useStore();
  const [saving, setSaving] = useState(false);
  if (useOwnerOrAdmin() !== true) return null;
  const run = async () => {
    setSaving(true);
    try {
      await save();
      void refreshTemplateLibrary();
      dispatch({ type: "toggleAppSettings", open: true, section: "templates" });
    } catch (cause) {
      dispatch({ type: "error", message: templateFailure(cause) });
    } finally {
      setSaving(false);
      onDone();
    }
  };
  return (
    <button type="button" role="menuitem" data-save-as-template={mark} disabled={saving} className={cn(className, "text-ink hover:bg-menu-hover disabled:opacity-60")} onClick={() => void run()}>
      {saving ? <Loader2 size={16} className="animate-spin text-ink-secondary motion-reduce:animate-none" /> : <LayoutTemplate size={16} className="text-ink-secondary" />}
      {saving ? t("common.saving") : label}
    </button>
  );
}

export function SaveBotAsTemplate({ bot, className, onDone }: { bot: Bot; className: string; onDone: () => void }) {
  return <SaveAsTemplateItem mark="bot" label={t("templateLibrary.saveBot")} save={() => saveBotAsTemplate(bot.id)} className={className} onDone={onDone} />;
}

export function SaveDepartmentAsTemplate({ department, className, onDone }: { department: string; className: string; onDone: () => void }) {
  return <SaveAsTemplateItem mark="department" label={t("templateLibrary.saveDepartment")} save={() => saveDepartmentAsTemplate(department)} className={className} onDone={onDone} />;
}
