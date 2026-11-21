import { Check, Crown, Loader2 } from "lucide-react";
import { Fragment, useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { isTeamProjectName, TEAM_PROJECT_NAME_MAX, type ProjectTeamWire, type TeamProjectRefusal } from "../../../shared/team-projects";
import { useModalDialog } from "@/hooks/use-modal-dialog";
import { cn } from "@/lib/cn";
import { activeLocale, t } from "@/lib/i18n";
import { imeComposing } from "@/lib/send-key";
import { refusalKey, refusalPlace, teamProjectFolder, unusableKey, type RefusalPlace } from "@/lib/team-projects";
import { listProjectTeams } from "@/lib/team-projects-api";
import type { SettingsPageId } from "@/state/store";
import { useStoreDispatch } from "@/state/store-select";
import { createProject, refreshTeamProjects, useTeamProjectSide } from "@/state/team-projects";
import { ChiefPicker } from "../ChiefPicker";
import { SETTINGS_INPUT } from "../SettingsPrimitives";
import { dataSettingsPlace } from "./where-in-settings";

interface Refusal {
  place: RefusalPlace;
  text: string;
}

/** The words for a refusal: this app's own by its code. Only the server can say why a project could not be made, whether anything was left behind, and what a team lacks. */
function refusalOf(code: TeamProjectRefusal | null, sentence: string): Refusal {
  if (code === null || code === "failed") return { place: "form", text: sentence || t(refusalKey("failed")) };
  if (code === "team_unusable") return { place: "team", text: sentence || t(refusalKey(code)) };
  return { place: refusalPlace(code), text: t(refusalKey(code), { place: dataSettingsPlace() }) };
}

const listed = (names: string[]) => new Intl.ListFormat(activeLocale(), { type: "conjunction", style: "narrow" }).format(names);

/** Who leads a project made from the team and who else comes; a team without a Chief of Staff who can lead is only its members. */
function teamLine(team: ProjectTeamWire): string {
  const chief = team.unusable ? undefined : team.chief;
  if (!chief) return team.members.length ? t("teamProjects.teamMembersOnly", { members: listed(team.members.map((member) => member.name)) }) : "";
  const members = team.members.filter((member) => member.id !== chief.id).map((member) => member.name);
  return members.length ? t("teamProjects.teamMembers", { chief: chief.name, members: listed(members) }) : t("teamProjects.teamChiefOnly", { chief: chief.name });
}

const LABEL = "text-[13px] font-medium leading-[18px] text-ink";
const LINE = "text-[13px] leading-[18px] text-ink-secondary";

type Stage = "form" | "root" | "teams";

const usableRows = (list: HTMLElement | null): HTMLButtonElement[] => [...list?.querySelectorAll<HTMLButtonElement>("[data-team]") ?? []].filter((row) => !row.disabled);

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

/** `team`: the team it opens with, chosen once a project can be made from it; no other team is then chosen for the person. */
export function NewTeamProjectDialog({ team: preset, onClose }: { team?: string; onClose: () => void }) {
  const side = useTeamProjectSide();
  const dispatch = useStoreDispatch();
  const formId = useId(), nameId = useId(), teamsId = useId(), folderId = useId();
  const [teams, setTeams] = useState<ProjectTeamWire[] | "failed" | null>(null);
  const [name, setName] = useState("");
  const [teamName, setTeamName] = useState<string | null>(preset ?? null);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const [choosingChief, setChoosingChief] = useState<{ team: string; anchor: HTMLElement } | null>(null);
  const teamRows = useRef<HTMLDivElement>(null);
  const arriving = useRef<string | null>(null);
  const live = useRef(true);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  useEffect(() => {
    const row = usableRows(teamRows.current).find((one) => one.dataset.team === arriving.current);
    if (!row) return;
    arriving.current = null;
    row.focus();
  }, [teams]);

  const loadTeams = (prefer?: string) => {
    listProjectTeams().then((found) => {
      if (!live.current) return;
      const usable = found.filter((team) => !team.unusable);
      const offered = (name: string | null | undefined) => usable.some((team) => team.name === name);
      setTeams(found);
      setTeamName((chosen) => (offered(prefer) ? prefer! : offered(chosen) ? chosen : preset === undefined && usable.length === 1 ? usable[0]!.name : null));
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

  if (side.root === null) {
    return (
      <Frame stage="root" title={t("teamProjects.new")} onClose={onClose} footer={<>
        {cancel}
        <button type="button" data-keyboard-start="" data-team-project-settings="root" className="ui-button ui-button-md ui-button-primary" onClick={() => openSettings("data")}>{t("teamProjects.openSettings")}</button>
      </>}>
        <p data-team-project-setup="root" className={LINE}>{t("teamProjects.noRoot", { place: dataSettingsPlace() })}</p>
      </Frame>
    );
  }
  if (Array.isArray(teams) && teams.length === 0) {
    return (
      <Frame stage="teams" title={t("teamProjects.new")} onClose={onClose}
        footer={<button type="button" data-keyboard-start="" data-team-project-done="" className="ui-button ui-button-md ui-button-primary" onClick={onClose}>{t("common.ok")}</button>}>
        <p data-team-project-setup="teams" className={LINE}>{t("teamProjects.noTeams")}</p>
      </Frame>
    );
  }

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
    if (teamName === null) {
      setRefusal({ place: "team", text: t("teamProjects.pickTeam") });
      usableRows(teamRows.current)[0]?.focus();
      return;
    }
    setBusy(true);
    setRefusal(null);
    try {
      const outcome = await createProject({ name: trimmed, team: teamName });
      if (!live.current) return;
      if ("project" in outcome) {
        dispatch({ type: "showProject", projectId: outcome.project.id });
        onClose();
        return;
      }
      if (outcome.refused === "no_team" || outcome.refused === "team_unusable") loadTeams();
      setRefusal(refusalOf(outcome.refused, outcome.error));
    } catch {
      if (live.current) setRefusal(refusalOf(null, ""));
    } finally {
      if (live.current) setBusy(false);
    }
  };

  const choose = (team: string) => {
    setTeamName(team);
    if (refusal?.place === "team") setRefusal(null);
  };
  const step = (event: KeyboardEvent<HTMLDivElement>) => {
    const by = event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
    const rows = usableRows(event.currentTarget);
    const at = rows.indexOf(event.target as HTMLButtonElement);
    if (!by || at < 0) return;
    event.preventDefault();
    const next = rows[(at + by + rows.length) % rows.length]!;
    choose(next.dataset.team!);
    next.focus();
  };
  const firstUsable = Array.isArray(teams) ? teams.find((team) => !team.unusable)?.name : undefined;

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
          <div id={teamsId} className={LABEL}>{t("teamProjects.team")}</div>
          {teams === "failed" ? (
            <div role="alert" className="mt-1.5 flex flex-wrap items-center gap-2 text-[13px] leading-[18px] text-danger">
              <span>{t("teamProjects.teamsFailed")}</span>
              <button type="button" data-teams-retry="" className="ui-button ui-button-sm" onClick={() => { setTeams(null); loadTeams(); }}>{t("common.tryAgain")}</button>
            </div>
          ) : (
            <div ref={teamRows} role="radiogroup" aria-labelledby={teamsId} data-teams="" onKeyDown={step}
              className="mt-1.5 flex max-h-[min(264px,40vh)] min-h-[66px] flex-col gap-0.5 overflow-y-auto rounded-xl border border-hairline/40 p-1">
              {(teams ?? []).map((team) => {
                const chosen = team.name === teamName;
                const members = teamLine(team);
                const context = team.context.trim();
                const dim = team.unusable && "opacity-50";
                const picking = choosingChief?.team === team.name;
                return (
                  <Fragment key={team.name}>
                    <button type="button" role="radio" aria-checked={chosen} data-team={team.name} data-team-unusable={team.unusable}
                      disabled={busy || team.unusable !== undefined}
                      tabIndex={chosen || (teamName === null && team.name === firstUsable) ? 0 : -1}
                      onClick={() => choose(team.name)}
                      className={cn("flex w-full shrink-0 items-start gap-3 rounded-lg px-2 py-2 text-start enabled:hover:bg-ink/[0.04] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus aria-checked:bg-ink/[0.06]", !team.unusable && "disabled:opacity-50")}>
                      <span className="min-w-0 flex-1">
                        <span dir="auto" className={cn("block truncate text-[13px] font-medium leading-[18px] text-ink", dim)} title={team.name}>{team.name}</span>
                        {context && <span dir="auto" className={cn("mt-0.5 line-clamp-2 text-[12px] leading-4 text-ink-secondary", dim)} title={context}>{context}</span>}
                        {members && <span dir="auto" className={cn("mt-0.5 line-clamp-2 text-[12px] leading-4 text-ink-tertiary", dim)} title={members}>{members}</span>}
                        {team.unusable && <span dir="auto" data-team-unusable-reason="" className="mt-0.5 block text-[12px] leading-4 text-ink-secondary">{t(unusableKey(team.unusable))}</span>}
                      </span>
                      <span className="flex h-[18px] w-4 shrink-0 items-center text-ink">{chosen && <Check size={16} aria-hidden="true" />}</span>
                    </button>
                    {team.unusable === "no_chief" && (
                      <button type="button" data-choose-chief={team.name} aria-haspopup="menu" aria-expanded={picking} disabled={busy} title={t("chiefPicker.title", { team: team.name })}
                        onClick={(event) => setChoosingChief(picking ? null : { team: team.name, anchor: event.currentTarget })}
                        className="ui-button ui-button-sm mb-1.5 ms-2 self-start">
                        <Crown size={14} aria-hidden="true" />{t("chiefPicker.choose")}
                      </button>
                    )}
                  </Fragment>
                );
              })}
            </div>
          )}
          {choosingChief && <ChiefPicker department={choosingChief.team} anchor={choosingChief.anchor} onClose={() => setChoosingChief(null)}
            onChosen={() => { arriving.current = choosingChief.team; loadTeams(choosingChief.team); if (refusal?.place === "team") setRefusal(null); }} />}
          {problem("team")}
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
