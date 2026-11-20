import { useEffect, useId, useRef, useState, type FormEvent, type RefObject } from "react";
import { FolderX } from "lucide-react";

import type { TeamProjectWire } from "../../../shared/team-projects";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { refreshTeamProjects, restoreProject, saveProjectsRoot, useTeamProjectSide } from "@/state/team-projects";
import { SETTINGS_INPUT, SettingRow, SettingsEmptyRow, SettingsGroup, SettingsRows } from "../SettingsPrimitives";

type FolderPicker = NonNullable<NonNullable<Window["ogb"]>["pickFolder"]>;

const PATH = "block break-all font-mono text-[12px] leading-4";
const PROBLEM = "text-[12px] leading-4 text-danger";

/** The desktop's picker chooses a folder of this computer, so an app that drives another computer cannot use it: projects are made on the other one. */
const folderPicker = (): FolderPicker | undefined => (window.ogb?.remoteClient?.active ? undefined : window.ogb?.pickFolder);

function useLive() {
  const live = useRef(true);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  return live;
}

interface RootProblem {
  path: string;
  text: string;
}

function useRootSaving() {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<RootProblem | null>(null);
  const live = useLive();
  const save = async (path: string): Promise<boolean> => {
    setBusy(true);
    setProblem(null);
    try {
      const saved = await saveProjectsRoot(path);
      if ("root" in saved) return true;
      if (live.current) setProblem({ path, text: saved.error || t("teamProjects.settings.rootFailed") });
    } catch {
      if (live.current) setProblem({ path, text: t("teamProjects.settings.rootFailed") });
    } finally {
      if (live.current) setBusy(false);
    }
    return false;
  };
  return { busy, problem, save, forgetProblem: () => setProblem(null) };
}

const rootUnset = () => <span data-team-projects-root="">{t("teamProjects.settings.rootUnset")}</span>;

function PickedRoot({ root, pick }: { root: string | null; pick: FolderPicker }) {
  const { busy, problem, save } = useRootSaving();
  const choose = async () => {
    const chosen = await pick(root ?? undefined);
    if (chosen) await save(chosen);
  };
  return (
    <SettingRow title={t("teamProjects.settings.root")}
      subtitle={root === null ? rootUnset() : <span data-team-projects-root="" dir="ltr" className={PATH}>{root}</span>}
      message={problem && (
        <div role="alert" className={PROBLEM}>
          <span dir="ltr" className="block break-all font-mono">{problem.path}</span>
          <span dir="auto" className="block">{problem.text}</span>
        </div>
      )}>
      <button type="button" data-team-projects-choose="" disabled={busy} onClick={() => void choose()} className="ui-button">
        {t("teamProjects.settings.choose")}
      </button>
    </SettingRow>
  );
}

function TypedRoot({ root }: { root: string | null }) {
  const fieldId = useId();
  const [draft, setDraft] = useState<string | null>(null);
  const { busy, problem, save, forgetProblem } = useRootSaving();
  const typed = (draft ?? root ?? "").trim();
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!busy && typed && typed !== root && await save(typed)) setDraft(null);
  };
  return (
    <div data-setting-row="" className="flex flex-col px-4 py-3">
      <label htmlFor={fieldId} className="text-[14px] leading-5 text-ink">{t("teamProjects.settings.root")}</label>
      {root === null && <div className="mt-0.5 text-[13px] leading-[18px] text-ink-secondary">{rootUnset()}</div>}
      <form data-team-projects-root-form="" onSubmit={(event) => void submit(event)} className="mt-2 flex items-center gap-2">
        <input id={fieldId} data-team-projects-path="" dir="ltr" value={draft ?? root ?? ""} disabled={busy}
          placeholder={t("teamProjects.settings.path")}
          spellCheck={false} autoComplete="off" autoCapitalize="none" autoCorrect="off"
          onChange={(event) => { setDraft(event.target.value); forgetProblem(); }}
          className={cn(SETTINGS_INPUT, "min-w-0 flex-1 font-mono text-[12px]")} />
        <button type="submit" disabled={busy || !typed || typed === root} className="ui-button shrink-0">{t("common.save")}</button>
      </form>
      {problem && <p role="alert" dir="auto" className={cn(PROBLEM, "mt-1.5")}>{problem.text}</p>}
    </div>
  );
}

function ArchivedProjects({ projects, onRestored }: { projects: TeamProjectWire[]; onRestored: (index: number) => void }) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const live = useLive();

  const restore = async (project: TeamProjectWire, index: number) => {
    setBusy(true);
    setFailed(null);
    try {
      await restoreProject(project.id);
      if (live.current) onRestored(index);
    } catch {
      if (live.current) setFailed(project.id);
    } finally {
      if (live.current) setBusy(false);
    }
  };

  return (
    <SettingsRows>
      {projects.map((project, index) => (
        <div key={project.id} data-team-project-archived={project.id} className="contents">
          <SettingRow title={project.name}
            subtitle={<>
              <span dir="ltr" className={PATH}>{project.folder}</span>
              {project.folderState === "missing" && (
                <span data-team-project-missing="" className="mt-1 flex items-center gap-1 text-[12px] leading-4 text-warning">
                  <FolderX size={14} aria-hidden="true" className="shrink-0" />{t("teamProjects.folderMissing")}
                </span>
              )}
            </>}
            message={failed === project.id && <p role="alert" className={PROBLEM}>{t("teamProjects.settings.restoreFailed", { name: project.name })}</p>}>
            <button type="button" data-team-project-restore={project.id} disabled={busy} onClick={() => void restore(project, index)}
              aria-label={t("teamProjects.settings.restoreNamed", { name: project.name })} className="ui-button">
              {t("teamProjects.settings.restore")}
            </button>
          </SettingRow>
        </div>
      ))}
      {projects.length === 0 && <SettingsEmptyRow><span tabIndex={-1} data-team-projects-none-archived="">{t("teamProjects.settings.archivedEmpty")}</span></SettingsEmptyRow>}
    </SettingsRows>
  );
}

function useKeyboardFocusAfterRestore(blocks: RefObject<HTMLElement | null>): (restoredRow: number) => void {
  const [restoredRow, setRestoredRow] = useState<number | null>(null);
  useEffect(() => {
    if (restoredRow === null) return;
    setRestoredRow(null);
    const active = document.activeElement;
    const leftWithTheRow = !active || active === document.body || !active.isConnected;
    if (!leftWithTheRow) return;
    const buttons = blocks.current?.querySelectorAll<HTMLElement>("[data-team-project-restore]") ?? [];
    const next = buttons[Math.min(restoredRow, buttons.length - 1)] ?? blocks.current?.querySelector<HTMLElement>("[data-team-projects-none-archived]");
    next?.focus({ preventScroll: true });
  }, [restoredRow, blocks]);
  return setRestoredRow;
}

export function TeamProjectsSettings() {
  const side = useTeamProjectSide();
  const blocks = useRef<HTMLDivElement>(null);
  const focusAfterRestore = useKeyboardFocusAfterRestore(blocks);
  useEffect(() => { void refreshTeamProjects(); }, []);
  if (!side.shown) return null;
  const pick = folderPicker();
  return (
    <div ref={blocks} className="contents">
      <SettingsGroup label={t("teamProjects.settings.group")} block="projects" footnote={t("teamProjects.settings.rootNote")}>
        <SettingsRows>{pick ? <PickedRoot root={side.root} pick={pick} /> : <TypedRoot root={side.root} />}</SettingsRows>
      </SettingsGroup>
      <SettingsGroup label={t("teamProjects.settings.archived")} block="archived-projects">
        <ArchivedProjects projects={side.archived} onRestored={focusAfterRestore} />
      </SettingsGroup>
    </div>
  );
}
