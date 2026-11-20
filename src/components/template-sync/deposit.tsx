import { useState, type ReactNode } from "react";

import { t } from "@/lib/i18n";
import { depositMemoryToTemplate, depositSkillToLibrary } from "@/lib/template-sync";
import { useTeamProjectSide } from "@/state/team-projects";
import { ReviewDialog } from "./ReviewDialog";

const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const triggerCls = "rounded-md px-2 py-1 text-[12px] font-medium text-accent-text hover:bg-accent/10 disabled:opacity-50";

/** A small button that, once pressed, shows what it would do and runs it only on confirm. Both "沉淀" actions share it. */
function DepositAction({ trigger, titleId, title, confirmLabel, confirmBody, doneBody, run }: {
  trigger: string;
  titleId: string;
  title: string;
  confirmLabel: string;
  confirmBody: ReactNode;
  doneBody: ReactNode;
  run: () => Promise<unknown>;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const start = () => { setOpen(true); setBusy(false); setError(null); setDone(false); };
  const confirm = () => {
    if (done) { setOpen(false); return; }
    setBusy(true);
    setError(null);
    run()
      .then(() => setDone(true))
      .catch((cause: unknown) => setError(errorText(cause)))
      .finally(() => setBusy(false));
  };

  return (
    <>
      <button type="button" className={triggerCls} onClick={start}>{trigger}</button>
      {open && (
        <ReviewDialog
          titleId={titleId}
          title={title}
          confirmLabel={done ? t("common.close") : confirmLabel}
          busy={busy}
          showCancel={!done}
          error={error}
          onConfirm={confirm}
          onClose={() => setOpen(false)}
        >
          {done ? doneBody : confirmBody}
        </ReviewDialog>
      )}
    </>
  );
}

/** "沉淀到技能库": move one of a bot's learned skills into the skills library, through the app's own share endpoint. */
export function DepositSkillButton({ botId, name }: { botId: string; name: string }) {
  return (
    <DepositAction
      trigger={t("templateSync.skill.button")}
      titleId="template-sync-skill-title"
      title={t("templateSync.skill.title", { name })}
      confirmLabel={t("templateSync.skill.confirm")}
      confirmBody={<p>{t("templateSync.skill.help", { name })}</p>}
      doneBody={<p>{t("templateSync.skill.done", { name })}</p>}
      run={() => depositSkillToLibrary(botId, name)}
    />
  );
}

/** "沉淀到模板": add one of a project bot's memory entries to its template role's starter memory. Only a project's bot has a template. */
export function DepositMemoryButton({ botId, path }: { botId: string; path: string }) {
  const inProject = useTeamProjectSide().of({ id: botId }) !== undefined;
  if (!inProject) return null;
  return (
    <DepositAction
      trigger={t("templateSync.memory.button")}
      titleId="template-sync-memory-title"
      title={t("templateSync.memory.title")}
      confirmLabel={t("templateSync.memory.confirm")}
      confirmBody={<p>{t("templateSync.memory.help", { path })}</p>}
      doneBody={<p>{t("templateSync.memory.done")}</p>}
      run={() => depositMemoryToTemplate(botId, path)}
    />
  );
}
