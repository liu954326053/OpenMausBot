import { useState } from "react";
import { Library } from "lucide-react";

import { ConfirmDialog } from "@/components/ConfirmDialog";
import { t } from "@/lib/i18n";
import { api } from "@/state/api";

const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** Puts one of a bot's learned skills in the skills library through the app's own share endpoint, once the person confirms. */
export function DepositSkillButton({ botId, name }: { botId: string; name: string }) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  if (done) return <span className="px-2 py-1 text-[12px] text-ink-tertiary">{t("skills.deposit.done", { name })}</span>;

  const confirm = () => {
    setPending(true);
    setError(null);
    api(`/api/bots/${encodeURIComponent(botId)}/skills/${encodeURIComponent(name)}/share`, { method: "POST" })
      .then(() => { setOpen(false); setDone(true); })
      .catch((cause: unknown) => setError(errorText(cause)))
      .finally(() => setPending(false));
  };

  return (
    <>
      <button
        type="button"
        className="rounded-md px-2 py-1 text-[12px] font-medium text-accent-text hover:bg-accent/10 disabled:opacity-50"
        onClick={() => { setError(null); setOpen(true); }}
      >
        {t("skills.deposit.button")}
      </button>
      <ConfirmDialog
        open={open}
        tone="neutral"
        icon={<Library size={18} aria-hidden />}
        title={t("skills.deposit.title", { name })}
        body={<>
          {t("skills.deposit.help", { name })}
          {error && <span role="alert" className="mt-2 block text-danger">{error}</span>}
        </>}
        confirmLabel={t("skills.deposit.confirm")}
        pending={pending}
        onCancel={() => setOpen(false)}
        onConfirm={confirm}
      />
    </>
  );
}
