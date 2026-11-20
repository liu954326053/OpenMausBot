import { useEffect, useState } from "react";

import { t } from "@/lib/i18n";
import {
  ROLE_FIELD_LABEL, applyTemplateUpdate, previewTemplateUpdate, summarizeDiff, type DiffSummary,
} from "@/lib/template-sync";
import type { TemplateUpdatePreview, TemplateUpdateResult } from "../../../shared/template-sync";
import { ReviewDialog } from "./ReviewDialog";

const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error));

function DiffSummaryView({ summary }: { summary: DiffSummary }) {
  if (summary.identical) return <p className="text-ink-secondary">{t("templateSync.update.identical")}</p>;
  return (
    <div className="flex flex-col gap-3">
      {summary.changed.length > 0 && (
        <section>
          <h3 className="text-[12px] font-medium uppercase tracking-[0.08em] text-ink-secondary">{t("templateSync.update.changedTitle", { count: summary.changed.length })}</h3>
          <ul className="mt-1 space-y-1">
            {summary.changed.map((role) => (
              <li key={role.key}>
                <span className="font-medium text-ink">{role.to}</span>
                {role.renamed && <span className="text-ink-secondary">{t("templateSync.update.renamedFrom", { name: role.from })}</span>}
                <span className="text-ink-secondary"> · {role.fields.map((field) => t(ROLE_FIELD_LABEL[field])).join(" · ")}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {summary.added.length > 0 && (
        <section>
          <h3 className="text-[12px] font-medium uppercase tracking-[0.08em] text-ink-secondary">{t("templateSync.update.addedTitle", { count: summary.added.length })}</h3>
          <ul className="mt-1 space-y-0.5 text-ink-secondary">
            {summary.added.map((role) => <li key={role.key}>{role.title ? t("templateSync.update.roleWithTitle", { name: role.name, title: role.title }) : role.name}</li>)}
          </ul>
        </section>
      )}
      {summary.removed.length > 0 && (
        <section>
          <h3 className="text-[12px] font-medium uppercase tracking-[0.08em] text-ink-secondary">{t("templateSync.update.removedTitle", { count: summary.removed.length })}</h3>
          <ul className="mt-1 space-y-0.5 text-ink-secondary">
            {summary.removed.map((role) => <li key={role.key}>{role.name}</li>)}
          </ul>
        </section>
      )}
      {summary.nothingToApply && !summary.identical && <p className="text-ink-secondary">{t("templateSync.update.nothingToApply")}</p>}
    </div>
  );
}

/** "从模板更新": show what one update would change, then apply only on the person's word. */
export function UpdateFromTemplate({ projectId, projectName, onClose }: { projectId: string; projectName: string; onClose: () => void }) {
  const [preview, setPreview] = useState<TemplateUpdatePreview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<TemplateUpdateResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    previewTemplateUpdate(projectId)
      .then((next) => { if (!cancelled) setPreview(next); })
      .catch((cause: unknown) => { if (!cancelled) setLoadError(errorText(cause)); });
    return () => { cancelled = true; };
  }, [projectId]);

  const apply = () => {
    setBusy(true);
    setError(null);
    applyTemplateUpdate(projectId)
      .then(setResult)
      .catch((cause: unknown) => setError(errorText(cause)))
      .finally(() => setBusy(false));
  };

  const summary = preview ? summarizeDiff(preview.diff) : null;
  const body = result
    ? <p className="text-ink">{t("templateSync.update.done", { name: projectName, version: result.toVersion })}</p>
    : loadError
      ? <p className="text-danger">{loadError}</p>
      : summary
        ? <DiffSummaryView summary={summary} />
        : <p className="text-ink-secondary">{t("templateSync.loading")}</p>;

  return (
    <ReviewDialog
      titleId="template-sync-update-title"
      title={t("templateSync.update.title", { name: projectName })}
      confirmLabel={result ? t("common.close") : t("templateSync.update.apply")}
      busy={busy}
      canConfirm={result ? true : Boolean(preview?.can)}
      showCancel={!result}
      error={error}
      onConfirm={result ? onClose : apply}
      onClose={onClose}
    >
      {body}
    </ReviewDialog>
  );
}
