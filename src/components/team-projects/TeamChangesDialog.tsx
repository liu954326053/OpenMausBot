import { Loader2 } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

import type { TeamMemberWire, TeamProjectChanges, TeamProjectWire } from "../../../shared/team-projects";
import { useModalDialog } from "@/hooks/use-modal-dialog";
import { t } from "@/lib/i18n";
import { decideProjectTeamChanges } from "@/state/team-projects";
import { Segmented } from "../SettingsPrimitives";

type Departed = "keep" | "remove";

const LABEL = "text-[13px] font-medium leading-[18px] text-ink";
const LINE = "text-[13px] leading-[18px] text-ink-secondary";

function Member({ member }: { member: TeamMemberWire }) {
  return (
    <span className="min-w-0 flex-1">
      <span dir="auto" className="block truncate text-[13px] font-medium leading-[18px] text-ink" title={member.name}>{member.name}</span>
      {member.title && <span dir="auto" className="block truncate text-[12px] leading-4 text-ink-tertiary" title={member.title}>{member.title}</span>}
    </span>
  );
}

/**
 * What changed in a project's team, and what the project does about each change: a new member is added as a copy
 * unless the person unticks it; a copy whose source left stays as the project's own unless the person removes it.
 */
export function TeamChangesDialog({ project, changes: shown, onClose }: { project: TeamProjectWire; changes: TeamProjectChanges; onClose: () => void }) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const titleId = useId();
  const team = project.team?.name ?? project.name;
  const [changes, setChanges] = useState(shown);
  const [adding, setAdding] = useState(() => new Set(shown.joined.map((member) => member.id)));
  const [departed, setDeparted] = useState<Record<string, Departed>>({});
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const live = useRef(true);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  const close = () => { if (!busy) onClose(); };
  useModalDialog(dialogRef, close);

  const toggle = (id: string, on: boolean) => setAdding((current) => {
    const next = new Set(current);
    if (on) next.add(id); else next.delete(id);
    return next;
  });
  const apply = async () => {
    setBusy(true);
    setProblem(null);
    const remove = changes.left.filter((copy) => departed[copy.id] === "remove").map((copy) => copy.id);
    const keep = changes.left.filter((copy) => departed[copy.id] !== "remove").map((copy) => copy.id);
    try {
      const decided = await decideProjectTeamChanges(project.id, { add: [...adding], remove, keep });
      if (!live.current) return;
      const left = decided.project.teamChanges;
      if (!decided.skipped.length || !left) return onClose();
      setChanges(left);
      setAdding(new Set(left.joined.filter((member) => adding.has(member.id)).map((member) => member.id)));
      setProblem(t("teamProjects.changes.skipped"));
    } catch {
      if (live.current) setProblem(t("teamProjects.changes.failed"));
    } finally {
      if (live.current) setBusy(false);
    }
  };

  return createPortal(
    <div className="ui-scrim fixed inset-0 z-[60] flex items-center justify-center p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} data-team-changes={project.id}
        className="ui-modal flex max-h-full w-full max-w-[480px] flex-col text-ink outline-none animate-pop-in motion-reduce:animate-none">
        <header className="px-5 pb-2 pt-5">
          <h2 id={titleId} className="truncate text-[20px] font-semibold leading-7 tracking-[-0.01em]">{t("teamProjects.changes.title")}</h2>
        </header>
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 pb-4">
          <p dir="auto" className={LINE}>{t("teamProjects.changes.intro", { team, project: project.name })}</p>
          {changes.joined.length > 0 && (
            <section data-team-changes-joined="">
              <h3 dir="auto" className={LABEL}>{t("teamProjects.changes.joined", { team })}</h3>
              <div className="mt-1.5 flex flex-col gap-0.5 rounded-xl border border-hairline/40 p-1">
                {changes.joined.map((member) => (
                  <label key={member.id} data-team-change-member={member.id} className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2 hover:bg-ink/[0.04]">
                    <Member member={member} />
                    <input type="checkbox" className="accent-accent" checked={adding.has(member.id)} disabled={busy}
                      aria-label={t("teamProjects.changes.add", { name: member.name, project: project.name })}
                      onChange={(event) => toggle(member.id, event.target.checked)} />
                  </label>
                ))}
              </div>
            </section>
          )}
          {changes.left.length > 0 && (
            <section data-team-changes-left="">
              <h3 dir="auto" className={LABEL}>{t("teamProjects.changes.left", { team })}</h3>
              <div className="mt-1.5 flex flex-col gap-0.5 rounded-xl border border-hairline/40 p-1">
                {changes.left.map((copy) => (
                  <div key={copy.id} data-team-change-copy={copy.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg px-2 py-2">
                    <Member member={copy} />
                    <Segmented<Departed>
                      label={copy.name}
                      value={departed[copy.id] ?? "keep"}
                      disabled={busy}
                      onChange={(choice) => setDeparted((current) => ({ ...current, [copy.id]: choice }))}
                      options={[{ value: "keep", label: t("teamProjects.changes.keep") }, { value: "remove", label: t("teamProjects.changes.remove") }]}
                    />
                  </div>
                ))}
              </div>
              <p className="mt-1.5 text-[12px] leading-4 text-ink-tertiary">{t("teamProjects.changes.removeHint")}</p>
            </section>
          )}
          {problem && <p role="alert" data-team-changes-problem="" className="text-[13px] leading-[18px] text-danger">{problem}</p>}
        </div>
        <footer className="flex flex-wrap items-center justify-end gap-2 px-5 pb-5">
          <button type="button" className="ui-button ui-button-md" onClick={close} disabled={busy}>{t("common.cancel")}</button>
          <button type="button" data-team-changes-apply="" className="ui-button ui-button-md ui-button-primary" onClick={() => void apply()} disabled={busy}>
            {busy && <Loader2 size={14} aria-hidden="true" className="animate-spin motion-reduce:animate-none" />}{t(busy ? "teamProjects.changes.applying" : "teamProjects.changes.apply")}
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
