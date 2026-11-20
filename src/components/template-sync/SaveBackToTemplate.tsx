import { useState } from "react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { saveTeamBack } from "@/lib/template-sync";
import type { SaveBackMode, SaveBackResult } from "../../../shared/template-sync";
import { ReviewDialog } from "./ReviewDialog";

const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error));

function Choice({ checked, onSelect, title, help }: { checked: boolean; onSelect: () => void; title: string; help: string }) {
  return (
    <label className={cn("flex cursor-pointer gap-2 rounded-lg border p-3", checked ? "border-accent bg-accent/5" : "border-hairline/40 hover:bg-control/40")}>
      <input type="radio" name="template-sync-save-back" checked={checked} onChange={onSelect} className="mt-1" />
      <span className="min-w-0">
        <span className="block text-[13px] font-medium text-ink">{title}</span>
        <span className="block text-[12px] text-ink-secondary">{help}</span>
      </span>
    </label>
  );
}

/** "存回模板": save the project's current team as its template's next version, or as a brand new template. */
export function SaveBackToTemplate({ projectId, projectName, templateName, onClose }: {
  projectId: string;
  projectName: string;
  templateName: string;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<SaveBackMode>("version");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SaveBackResult | null>(null);

  const save = () => {
    setBusy(true);
    setError(null);
    saveTeamBack(projectId, { mode })
      .then(setResult)
      .catch((cause: unknown) => setError(errorText(cause)))
      .finally(() => setBusy(false));
  };

  const body = result
    ? <p className="text-ink">{t(result.mode === "version" ? "templateSync.saveBack.doneVersion" : "templateSync.saveBack.doneNew", { name: result.name, version: result.version })}</p>
    : (
      <fieldset className="flex flex-col gap-2">
        <Choice checked={mode === "version"} onSelect={() => setMode("version")} title={t("templateSync.saveBack.versionTitle")} help={t("templateSync.saveBack.versionHelp", { name: templateName })} />
        <Choice checked={mode === "new"} onSelect={() => setMode("new")} title={t("templateSync.saveBack.newTitle")} help={t("templateSync.saveBack.newHelp", { name: projectName })} />
      </fieldset>
    );

  return (
    <ReviewDialog
      titleId="template-sync-save-back-title"
      title={t("templateSync.saveBack.title", { name: projectName })}
      confirmLabel={result ? t("common.close") : t("templateSync.saveBack.save")}
      busy={busy}
      showCancel={!result}
      error={error}
      onConfirm={result ? onClose : save}
      onClose={onClose}
    >
      {body}
    </ReviewDialog>
  );
}
