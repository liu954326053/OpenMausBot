import { Check, Loader2 } from "lucide-react";
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { isTeamProjectName, TEAM_PROJECT_NAME_MAX, type TeamProjectRefusal, type TeamProjectWire } from "../../../shared/team-projects";
import type { TeamTemplateSummary } from "../../../shared/template-library";
import { useModalDialog } from "@/hooks/use-modal-dialog";
import { cn } from "@/lib/cn";
import { activeLocale, t } from "@/lib/i18n";
import { imeComposing } from "@/lib/send-key";
import { refusalKey, refusalPlace, teamProjectFolder, templateTeam, type RefusalPlace } from "@/lib/team-projects";
import { listTemplates } from "@/lib/template-library";
import type { SettingsPageId } from "@/state/store";
import { useStoreDispatch } from "@/state/store-select";
import { createProject, refreshTeamProjects, useTeamProjectSide } from "@/state/team-projects";
import { SETTINGS_INPUT } from "../SettingsPrimitives";
import { dataSettingsPlace, templatesSettingsPlace } from "./where-in-settings";

interface Refusal {
  place: RefusalPlace;
  text: string;
}

/** The words for a refusal: this app's own by its code. Only the server can say why a project could not be made, and whether anything was left behind. */
function refusalOf(code: TeamProjectRefusal | null, sentence: string): Refusal {
  if (code === null || code === "failed") return { place: "form", text: sentence || t(refusalKey("failed")) };
  return { place: refusalPlace(code), text: t(refusalKey(code), { place: dataSettingsPlace() }) };
}

const listed = (names: string[]) => new Intl.ListFormat(activeLocale(), { type: "conjunction", style: "narrow" }).format(names);

const LABEL = "text-[13px] font-medium leading-[18px] text-ink";
const LINE = "text-[13px] leading-[18px] text-ink-secondary";

type Stage = "form" | "made" | "root" | "templates";

function Frame({ stage, title, onClose, children, footer }: { stage: Stage; title: string; onClose: () => void; children: ReactNode; footer: ReactNode }) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const titleId = useId();
  useModalDialog(dialogRef, onClose);
  // React 19 focuses an `autoFocus` element before effects run, so `useModalDialog` would give the keyboard back to that element instead of to what opened the dialog.
  useEffect(() => { dialogRef.current?.querySelector<HTMLElement>("[data-keyboard-start]")?.focus(); }, [stage]);
  return createPortal(
    <div className="ui-scrim fixed inset-0 z-[60] flex items-center justify-center p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} data-new-team-project=""
        className="ui-modal flex max-h-full w-full max-w-[480px] flex-col text-ink outline-none animate-pop-in motion-reduce:animate-none">
        <header className="px-5 pb-2 pt-5">
          <h2 id={titleId} dir="auto" className="truncate text-[20px] font-semibold leading-7 tracking-[-0.01em]" title={title}>{title}</h2>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4">{children}</div>
        <footer className="flex flex-wrap items-center justify-end gap-2 px-5 pb-5">{footer}</footer>
      </div>
    </div>,
    document.body,
  );
}

export function NewTeamProjectDialog({ onClose }: { onClose: () => void }) {
  const side = useTeamProjectSide();
  const dispatch = useStoreDispatch();
  const formId = useId(), nameId = useId(), templatesId = useId(), folderId = useId();
  const [teams, setTeams] = useState<TeamTemplateSummary[] | "failed" | null>(null);
  const [name, setName] = useState("");
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const [made, setMade] = useState<{ project: TeamProjectWire; missingSkills: string[] } | null>(null);
  const templates = useRef<HTMLDivElement>(null);
  const live = useRef(true);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);

  const loadTeams = () => {
    listTemplates().then((library) => {
      if (!live.current) return;
      const found = Array.isArray(library.teams) ? library.teams : [];
      setTeams(found);
      setTemplateId((chosen) => (found.some((team) => team.id === chosen) ? chosen : found.length === 1 ? found[0]!.id : null));
    }, () => { if (live.current) setTeams("failed"); });
  };
  useEffect(() => {
    void refreshTeamProjects();
    loadTeams();
  }, []);

  const openSettings = (page: SettingsPageId) => {
    dispatch({ type: "toggleAppSettings", open: true, section: page });
    onClose();
  };
  const close = () => { if (!busy) onClose(); };
  const cancel = <button type="button" className="ui-button ui-button-md" onClick={close} disabled={busy}>{t("common.cancel")}</button>;

  if (made) {
    return (
      <Frame stage="made" title={t("teamProjects.created", { name: made.project.name })} onClose={onClose}
        footer={<button type="button" data-keyboard-start="" data-team-project-done="" className="ui-button ui-button-md ui-button-primary" onClick={onClose}>{t("common.done")}</button>}>
        <p className={LINE}>{t("teamProjects.missingSkills")}</p>
        <ul data-team-project-missing-skills="" className="mt-2 flex flex-col gap-1">
          {made.missingSkills.map((skill) => <li key={skill} dir="auto" className="font-mono text-[13px] leading-[18px] break-words text-ink">{skill}</li>)}
        </ul>
        <p className={cn(LINE, "mt-3")}>{t("teamProjects.missingSkillsNext")}</p>
      </Frame>
    );
  }

  const setUp = (mark: "root" | "templates", text: string, page: SettingsPageId) => (
    <Frame stage={mark} title={t("teamProjects.new")} onClose={onClose} footer={<>
      {cancel}
      <button type="button" data-keyboard-start="" data-team-project-settings={mark} className="ui-button ui-button-md ui-button-primary" onClick={() => openSettings(page)}>{t("teamProjects.openSettings")}</button>
    </>}>
      <p data-team-project-setup={mark} className={LINE}>{text}</p>
    </Frame>
  );
  if (side.root === null) return setUp("root", t("teamProjects.noRoot", { place: dataSettingsPlace() }), "data");
  if (Array.isArray(teams) && teams.length === 0) return setUp("templates", t("teamProjects.noTemplates", { place: templatesSettingsPlace() }), "templates");

  const root = side.root;
  const trimmed = name.trim();
  const ready = trimmed.length > 0 && !busy;
  const problem = (place: RefusalPlace) => refusal?.place === place && (
    <div role="alert" data-team-project-problem={place} className={cn("text-[13px] leading-[18px] text-danger", place !== "form" && "mt-1.5")}>
      <p dir="auto">{refusal.text}</p>
      {place === "folder" && <button type="button" data-team-project-settings="root" className="ui-button ui-button-sm mt-2" onClick={() => openSettings("data")}>{t("teamProjects.openSettings")}</button>}
    </div>
  );

  const create = async () => {
    if (!ready) return;
    if (!isTeamProjectName(trimmed)) return setRefusal(refusalOf("bad_name", ""));
    if (templateId === null) {
      setRefusal({ place: "template", text: t("teamProjects.pickTemplate") });
      templates.current?.querySelector<HTMLElement>('[role="radio"]')?.focus();
      return;
    }
    setBusy(true);
    setRefusal(null);
    try {
      const outcome = await createProject({ name: trimmed, templateId });
      if (!live.current) return;
      if ("project" in outcome) {
        dispatch({ type: "select", id: outcome.project.leadBotId });
        if (outcome.missingSkills.length > 0) setMade(outcome);
        else onClose();
        return;
      }
      if (outcome.refused === "no_template") loadTeams();
      setRefusal(refusalOf(outcome.refused, outcome.error));
    } catch {
      if (live.current) setRefusal(refusalOf(null, ""));
    } finally {
      if (live.current) setBusy(false);
    }
  };

  const choose = (id: string) => {
    setTemplateId(id);
    if (refusal?.place === "template") setRefusal(null);
  };
  const step = (event: KeyboardEvent<HTMLDivElement>) => {
    const by = event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
    const rows = [...event.currentTarget.querySelectorAll<HTMLElement>("[data-team-template]")];
    const at = rows.indexOf(event.target as HTMLElement);
    if (!by || at < 0) return;
    event.preventDefault();
    const next = rows[(at + by + rows.length) % rows.length]!;
    choose(next.dataset.teamTemplate!);
    next.focus();
  };

  return (
    <Frame stage="form" title={t("teamProjects.new")} onClose={close} footer={<>
      {cancel}
      <button type="submit" form={formId} data-team-project-create="" className="ui-button ui-button-md ui-button-primary" disabled={!ready}>
        {busy && <Loader2 size={14} aria-hidden="true" className="animate-spin motion-reduce:animate-none" />}{t(busy ? "teamProjects.creating" : "teamProjects.create")}
      </button>
    </>}>
      <form id={formId} data-team-project-form="" className="flex flex-col gap-4" onSubmit={(event) => { event.preventDefault(); void create(); }}>
        <p className={LINE}>{t("teamProjects.intro")}</p>
        <div>
          <label htmlFor={nameId} className={LABEL}>{t("teamProjects.name")}</label>
          <input id={nameId} dir="auto" data-keyboard-start="" value={name} maxLength={TEAM_PROJECT_NAME_MAX} disabled={busy} spellCheck={false} autoComplete="off"
            aria-invalid={refusal?.place === "name" || undefined}
            onChange={(event) => { setName(event.target.value); if (refusal?.place === "name") setRefusal(null); }}
            onKeyDown={(event) => { if (event.key === "Enter" && imeComposing(event.nativeEvent)) event.preventDefault(); }}
            className={cn(SETTINGS_INPUT, "mt-1.5")} />
          {problem("name")}
        </div>
        <div>
          <div id={templatesId} className={LABEL}>{t("teamProjects.template")}</div>
          {teams === "failed" ? (
            <div role="alert" className="mt-1.5 flex flex-wrap items-center gap-2 text-[13px] leading-[18px] text-danger">
              <span>{t("teamProjects.templatesFailed")}</span>
              <button type="button" data-team-templates-retry="" className="ui-button ui-button-sm" onClick={() => { setTeams(null); loadTeams(); }}>{t("common.tryAgain")}</button>
            </div>
          ) : (
            <div ref={templates} role="radiogroup" aria-labelledby={templatesId} data-team-templates="" onKeyDown={step}
              className="mt-1.5 flex max-h-[min(264px,40vh)] min-h-[66px] flex-col gap-0.5 overflow-y-auto rounded-xl border border-hairline/40 p-1">
              {(teams ?? []).map((team, index) => {
                const chosen = team.id === templateId;
                const { lead, members } = templateTeam(team);
                const names = listed(members.map((role) => role.name));
                const roles = !lead ? names : names ? t("teamProjects.templateTeam", { lead: lead.name, members: names }) : t("teamProjects.templateLeadOnly", { lead: lead.name });
                return (
                  <button key={team.id} type="button" role="radio" aria-checked={chosen} data-team-template={team.id} disabled={busy}
                    tabIndex={chosen || (templateId === null && index === 0) ? 0 : -1}
                    onClick={() => choose(team.id)}
                    className="flex w-full shrink-0 items-start gap-3 rounded-lg px-2 py-2 text-start enabled:hover:bg-ink/[0.04] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus aria-checked:bg-ink/[0.06] disabled:opacity-50">
                    <span className="min-w-0 flex-1">
                      <span dir="auto" className="block truncate text-[13px] font-medium leading-[18px] text-ink" title={team.name}>{team.name}</span>
                      {team.genre.trim() && <span dir="auto" className="mt-0.5 line-clamp-2 text-[12px] leading-4 text-ink-secondary" title={team.genre}>{team.genre}</span>}
                      {roles && <span dir="auto" className="mt-0.5 line-clamp-2 text-[12px] leading-4 text-ink-tertiary" title={roles}>{roles}</span>}
                    </span>
                    <span className="flex h-[18px] w-4 shrink-0 items-center text-ink">{chosen && <Check size={16} aria-hidden="true" />}</span>
                  </button>
                );
              })}
            </div>
          )}
          {problem("template")}
        </div>
        <div>
          <div id={folderId} className={LABEL}>{t("teamProjects.folder")}</div>
          <div role="group" aria-labelledby={folderId} data-team-project-folder="" dir="ltr"
            className="mt-1.5 rounded-lg border border-hairline/40 bg-inset px-3 py-2 font-mono text-[13px] leading-[18px] break-all text-ink">
            {trimmed ? teamProjectFolder(root, trimmed) : <span className="text-ink-tertiary">{teamProjectFolder(root, "…")}</span>}
          </div>
          <p className="mt-1.5 text-[12px] leading-4 text-ink-tertiary">{t("teamProjects.folderHint")}</p>
          {problem("folder")}
        </div>
        {problem("form")}
      </form>
    </Frame>
  );
}
