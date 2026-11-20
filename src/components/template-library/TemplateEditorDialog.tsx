import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { X } from "lucide-react";

import { useModalDialog } from "@/hooks/use-modal-dialog";
import { cn } from "@/lib/cn";
import { intlLocale, t } from "@/lib/i18n";
import { utf8Bytes } from "@/lib/soul";
import { readBotTemplate, saveBotTemplate, saveTeamTemplate, templateFailure } from "@/lib/template-library";
import {
  botSaveBlock, botTemplateInput, hasRoomForRole, teamSaveBlock, teamTemplateInput, withNewRole, withoutOwnSkill, withoutRole, withRole, withRoleBack,
  withRoleFromBotTemplate, type ChangeRole, type RoleDraft, type SaveBlock, type TeamDraft,
} from "@/lib/template-library-draft";
import {
  changeEditedTemplate, closeTemplateEditor, refreshTemplateLibrary, TEAM_PAGE, templateSaved,
  type BotTemplateEditing, type TeamTemplateEditing, type TemplateEditing,
} from "@/state/template-library";
import { TEAM_BRIEF_MAX_BYTES } from "../../../shared/package-format";
import { TEMPLATE_LIMITS, type BotTemplateSummary } from "../../../shared/template-library";
import { UndoToast } from "../bot-access/ShareBotButton";
import { Field, inputCls } from "../bot-settings/field";
import { Select } from "../Select";
import { SettingsLook } from "../SettingsPrimitives";
import { TemplateRoleEditor } from "./TemplateRoleEditor";

const BLANK_ROLE = "blank";
const BLOCK_LINE = { name: "templateLibrary.needs.name", roleName: "templateLibrary.needs.roleName", context: "templateLibrary.needs.context" } as const satisfies Record<SaveBlock, string>;

const changeTeam = (change: (editing: TeamTemplateEditing) => TeamTemplateEditing): void =>
  changeEditedTemplate<TeamTemplateEditing>("team", (editing) => ({ ...change(editing), changed: true }));
const changeTeamDraft = (change: (draft: TeamDraft) => TeamDraft): void => changeTeam((editing) => ({ ...editing, draft: change(editing.draft) }));
const changeTeamRole = (id: string): ChangeRole => (change) =>
  changeTeamDraft((draft) => {
    const role = draft.roles.find((each) => each.id === id);
    return role ? withRole(draft, change(role)) : draft;
  });
const changeBotRole: ChangeRole = (change) =>
  changeEditedTemplate<BotTemplateEditing>("bot", (editing) => ({ ...editing, changed: true, draft: { ...editing.draft, role: change(editing.draft.role) } }));
const showInTeam = (shown: string): void => changeEditedTemplate<TeamTemplateEditing>("team", (editing) => ({ ...editing, shown }));

const roleName = (role: RoleDraft): string => role.name.trim() || t("templateLibrary.role.unnamed");

/** Something taken out of the open template, which Undo puts back. */
interface Removed { key: string; text: string; restore: () => void }

export function TemplateEditorDialog({ editing, botTemplates }: { editing: TemplateEditing; botTemplates: BotTemplateSummary[] }) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState("");
  const [removed, setRemoved] = useState<Removed | null>(null);
  const forgetRemoved = useCallback(() => setRemoved(null), []);
  const close = () => { if (!saving) closeTemplateEditor(); };
  useModalDialog(dialogRef, close);

  const block = editing.kind === "team" ? teamSaveBlock(editing.draft) : botSaveBlock(editing.draft);
  const nothingToSave = editing.id !== undefined && !editing.changed;
  const save = async () => {
    setSaving(true);
    setProblem("");
    try {
      if (editing.kind === "team") await saveTeamTemplate(teamTemplateInput(editing.draft), editing.id);
      else await saveBotTemplate(botTemplateInput(editing.draft), editing.id);
      templateSaved();
      void refreshTemplateLibrary();
    } catch (cause) {
      setProblem(templateFailure(cause));
      setSaving(false);
      // A browser takes the focus from a button that is disabled while it has it; from nowhere, Tab would leave the dialog.
      dialogRef.current?.focus();
    }
  };
  const removeOwnSkill = (change: ChangeRole, role: RoleDraft, name: string) => {
    change((latest) => withoutOwnSkill(latest, name));
    setRemoved({
      key: `${role.id}:${name}`, text: t("templateLibrary.removed", { name }),
      restore: () => change((latest) => (latest.ownSkills.includes(name) ? latest : { ...latest, ownSkills: [...latest.ownSkills, name] })),
    });
  };

  const title = editing.kind === "team"
    ? t(editing.id ? "templateLibrary.editTeam" : "templateLibrary.newTeam")
    : t(editing.id ? "templateLibrary.editBot" : "templateLibrary.newBot");
  const shownRole = editing.kind === "team" ? editing.draft.roles.find((role) => role.id === editing.shown) : undefined;
  return (
    <SettingsLook.Provider value={false}>
      <div className="ui-scrim fixed inset-0 z-[65] flex items-center justify-center p-3 sm:p-5">
        <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-busy={saving || undefined} tabIndex={-1} style={{ outline: "none" }} data-template-editor={editing.kind}
          className="ui-modal animate-pop-in flex h-[min(760px,calc(100dvh-24px))] w-full max-w-[900px] flex-col overflow-hidden text-start text-ink motion-reduce:animate-none">
          <header className="flex h-[52px] shrink-0 items-center justify-between gap-3 pe-3 ps-5">
            <h2 id={titleId} className="min-w-0 truncate text-[17px] font-semibold">{title}</h2>
            <button type="button" disabled={saving} onClick={close} aria-label={t("common.close")} title={t("common.close")} className="ui-icon-button size-7 shrink-0">
              <X size={16} aria-hidden="true" />
            </button>
          </header>
          <div className="ui-modal-divider shrink-0" />
          <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
            {editing.kind === "team" && (
              <TeamNav editing={editing} botTemplates={botTemplates} disabled={saving} onProblem={setProblem} />
            )}
            <div className="min-h-0 min-w-0 flex-1 overflow-y-auto p-4 sm:p-5"><fieldset disabled={saving} className="min-w-0">
              {editing.kind === "bot" ? (
                <TemplateRoleEditor role={editing.draft.role} skills={editing.draft.skills} nameLimit={TEMPLATE_LIMITS.name} change={changeBotRole}
                  onRemoveOwnSkill={(name) => removeOwnSkill(changeBotRole, editing.draft.role, name)} />
              ) : shownRole ? (
                <TemplateRoleEditor key={shownRole.id} role={shownRole} skills={editing.draft.skills} change={changeTeamRole(shownRole.id)}
                  onRemoveOwnSkill={(name) => removeOwnSkill(changeTeamRole(shownRole.id), shownRole, name)}>
                  <RoleStanding draft={editing.draft} role={shownRole} onRemoved={setRemoved} />
                </TemplateRoleEditor>
              ) : (
                <TeamFields editing={editing} />
              )}
            </fieldset></div>
          </div>
          <div className="ui-modal-divider shrink-0" />
          <footer className="flex shrink-0 flex-wrap items-center justify-end gap-2 p-3">
            {problem
              ? <p role="alert" className="me-auto min-w-0 flex-1 basis-48 ps-2 text-[13px] leading-[18px] text-danger">{problem}</p>
              : block && <p className="me-auto min-w-0 flex-1 basis-48 ps-2 text-[13px] leading-[18px] text-ink-secondary">{t(BLOCK_LINE[block])}</p>}
            <button type="button" className="ui-button" disabled={saving} onClick={close}>{t("common.cancel")}</button>
            <button type="button" className="ui-button ui-button-primary" disabled={saving || block !== null || nothingToSave} data-template-save="" onClick={() => void save()}>
              {t(saving ? "common.saving" : "common.save")}
            </button>
          </footer>
        </div>
        {removed && <UndoToast key={removed.key} text={removed.text} onUndo={async () => removed.restore()} onDone={forgetRemoved} />}
      </div>
    </SettingsLook.Provider>
  );
}

const NAV_ITEM = "flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-start text-[13px] leading-[18px] sm:w-full";

function NavItem({ current, onClick, children }: { current: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-current={current ? "page" : undefined}
      className={cn(NAV_ITEM, current ? "bg-control text-ink" : "text-ink-secondary hover:bg-ink/[0.06]")}>
      {children}
    </button>
  );
}

function TeamNav({ editing, botTemplates, disabled, onProblem }: {
  editing: TeamTemplateEditing; botTemplates: BotTemplateSummary[]; disabled: boolean; onProblem: (problem: string) => void;
}) {
  const { draft, shown } = editing;
  const add = async (choice: string) => {
    if (!choice) return;
    onProblem("");
    if (choice === BLANK_ROLE) {
      changeTeam((latest) => { const added = withNewRole(latest.draft); return { ...latest, draft: added.draft, shown: added.id }; });
      return;
    }
    try {
      const template = await readBotTemplate(choice);
      changeTeam((latest) => { const added = withRoleFromBotTemplate(latest.draft, template); return { ...latest, draft: added.draft, shown: added.id }; });
    } catch (cause) {
      onProblem(templateFailure(cause));
    }
  };
  const full = !hasRoomForRole(draft);
  const pages = useRef<HTMLDivElement>(null);
  useEffect(() => {
    pages.current?.querySelector('[aria-current="page"]')?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [shown]);
  return (
    <nav aria-label={t("templateLibrary.nav")} data-template-nav=""
      className="flex shrink-0 items-center gap-2 border-b border-hairline/40 p-2 sm:w-52 sm:flex-col sm:items-stretch sm:gap-1 sm:border-b-0 sm:border-e">
      <div ref={pages} className="-m-1 flex min-w-0 flex-1 gap-1 overflow-x-auto p-1 sm:min-h-0 sm:flex-initial sm:flex-col sm:overflow-x-hidden sm:overflow-y-auto">
        <NavItem current={shown === TEAM_PAGE} onClick={() => showInTeam(TEAM_PAGE)}>{t("templateLibrary.nav.team")}</NavItem>
        {draft.roles.map((role) => (
          <NavItem key={role.id} current={shown === role.id} onClick={() => showInTeam(role.id)}>
            <span className="min-w-0 max-w-40 truncate sm:max-w-none sm:flex-1" title={roleName(role)}>{roleName(role)}</span>
            {draft.lead === role.id && <span className="ui-chip shrink-0 bg-ink/[0.06] text-ink-secondary">{t("templateLibrary.lead")}</span>}
          </NavItem>
        ))}
      </div>
      <Select className="shrink-0 sm:mt-1" size="sm" value="" disabled={disabled || full} aria-label={t("templateLibrary.addRole")}
        title={full ? t("templateLibrary.addRole.full", { count: TEMPLATE_LIMITS.roles.toLocaleString(intlLocale()) }) : undefined}
        onChange={(event) => void add(event.target.value)}>
        <option value="">{t("templateLibrary.addRole")}</option>
        <option value={BLANK_ROLE}>{t("templateLibrary.addRole.blank")}</option>
        {botTemplates.map((template) => <option key={template.id} value={template.id}>{t("templateLibrary.addRole.copyOf", { name: template.name })}</option>)}
      </Select>
      {botTemplates.length > 0 && <p className="hidden px-1 pt-1 text-[12px] leading-4 text-ink-tertiary sm:block">{t("templateLibrary.addRole.note")}</p>}
    </nav>
  );
}

function TeamFields({ editing }: { editing: TeamTemplateEditing }) {
  const { draft, carried } = editing;
  const genreHintId = useId();
  const contextSizeId = useId();
  const contextBytes = utf8Bytes(draft.context);
  const contextTooLong = contextBytes > TEAM_BRIEF_MAX_BYTES;
  const set = (field: "name" | "genre" | "context") => (event: { target: { value: string } }) => changeTeamDraft((latest) => ({ ...latest, [field]: event.target.value }));
  return (
    <div className="flex flex-col gap-4" data-template-team="">
      <Field label={t("templateLibrary.team.name")}>
        <input className={inputCls} maxLength={TEMPLATE_LIMITS.name} value={draft.name} placeholder={t("templateLibrary.team.namePlaceholder")} autoFocus={!draft.name} data-template-name="" onChange={set("name")} />
      </Field>
      <div>
        <Field label={t("templateLibrary.team.genre")}>
          <textarea className={cn(inputCls, "min-h-[72px] resize-y leading-relaxed")} maxLength={TEMPLATE_LIMITS.genre} dir="auto" value={draft.genre} aria-describedby={genreHintId}
            placeholder={t("templateLibrary.team.genrePlaceholder")} data-template-genre="" onChange={set("genre")} />
        </Field>
        <div id={genreHintId} className="mt-1.5 text-[12px] leading-4 text-ink-secondary">{t("templateLibrary.team.genreHint")}</div>
      </div>
      <div>
        <Field label={t("templateLibrary.team.context")}>
          <textarea className={cn(inputCls, "min-h-[160px] resize-y leading-relaxed")} dir="auto" value={draft.context} aria-invalid={contextTooLong || undefined}
            aria-describedby={contextTooLong ? contextSizeId : undefined} placeholder={t("templateLibrary.team.contextPlaceholder")} data-template-context="" onChange={set("context")} />
        </Field>
        {contextTooLong && (
          <div id={contextSizeId} className="mt-1.5 text-[12px] leading-4 tabular-nums text-danger">
            {t("botIdentity.soul.bytes", { bytes: contextBytes.toLocaleString(intlLocale()), limit: TEAM_BRIEF_MAX_BYTES.toLocaleString(intlLocale()) })}
          </div>
        )}
      </div>
      {(carried.groupChats > 0 || carried.routines > 0) && (
        <p className="text-[12px] leading-4 text-ink-secondary">{t("templateLibrary.team.carried", { groupChats: carried.groupChats, routines: carried.routines })}</p>
      )}
    </div>
  );
}

/** A role's place in its team: whether it leads, and the way out of the team. */
function RoleStanding({ draft, role, onRemoved }: { draft: TeamDraft; role: RoleDraft; onRemoved: (removed: Removed) => void }) {
  const leads = draft.lead === role.id;
  const remove = () => {
    const at = draft.roles.findIndex((each) => each.id === role.id);
    changeTeam((latest) => ({ ...latest, draft: withoutRole(latest.draft, role.id), shown: TEAM_PAGE }));
    onRemoved({
      key: role.id, text: t("templateLibrary.removed", { name: roleName(role) }),
      restore: () => changeTeam((latest) => ({ ...latest, draft: withRoleBack(latest.draft, role, at, leads), shown: role.id })),
    });
  };
  return (
    <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-hairline/40 pt-4">
      {leads
        ? <p className="me-auto text-[13px] leading-[18px] text-ink-secondary">{t("templateLibrary.role.leads")}</p>
        : <button type="button" className="ui-button ui-button-md me-auto" data-template-make-lead="" onClick={() => changeTeamDraft((latest) => ({ ...latest, lead: role.id }))}>{t("templateLibrary.role.makeLead")}</button>}
      {draft.roles.length > 1 && (
        <button type="button" className="ui-button ui-button-md text-danger" data-template-remove-role="" onClick={remove}>{t("templateLibrary.role.remove")}</button>
      )}
    </div>
  );
}
