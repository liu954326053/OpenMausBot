import { useCallback, useRef, useState } from "react";
import { Trash2 } from "lucide-react";

import { activeLocale, t } from "@/lib/i18n";
import { readBotTemplate, readTeamTemplate, removeTemplate, restoreTemplate, templateFailure } from "@/lib/template-library";
import { blankBotDraft, blankTeamDraft, botDraftOf, teamDraftOf } from "@/lib/template-library-draft";
import { editTemplate, forgetDiscardedTemplate, refreshTemplateLibrary, TEAM_PAGE, useTemplateLibrary, type TemplateEditing } from "@/state/template-library";
import type { TeamTemplateSummary, TemplateKind } from "../../../shared/template-library";
import { AdminOnly } from "../AdminOnly";
import { UndoToast } from "../bot-access/ShareBotButton";
import { Layer } from "../Layer";
import { SettingRow, SettingsEmptyRow, SettingsGroup, SettingsRows } from "../SettingsPrimitives";
import { TemplateEditorDialog } from "./TemplateEditorDialog";

/** The team's roles in a line, the lead marked. */
function rolesLine(template: TeamTemplateSummary): string {
  const names = template.roles.map((role) => (role.key === template.lead ? t("templateLibrary.leadNamed", { name: role.name }) : role.name));
  return new Intl.ListFormat(activeLocale(), { type: "conjunction" }).format(names);
}

const discardedLine = (discarded: TemplateEditing): string => {
  const name = discarded.kind === "team" ? discarded.draft.name.trim() : discarded.draft.role.name.trim();
  return name ? t("templateLibrary.discarded", { name }) : t("templateLibrary.discardedUnnamed");
};

function TemplateRow({ name, version, line, onEdit, onDelete }: { name: string; version: number; line: string; onEdit: () => void; onDelete: () => void }) {
  return (
    <SettingRow title={name} tag={t("templateLibrary.version", { version })} subtitle={line || undefined}>
      <button type="button" className="ui-button ui-button-md" aria-label={t("templateLibrary.editNamed", { name })} onClick={onEdit}>{t("templateLibrary.edit")}</button>
      <button type="button" className="ui-icon-button size-7" aria-label={t("templateLibrary.deleteNamed", { name })} title={t("templateLibrary.deleteNamed", { name })} onClick={onDelete}>
        <Trash2 size={16} aria-hidden="true" />
      </button>
    </SettingRow>
  );
}

function Templates() {
  const { library, failed, editing, discarded } = useTemplateLibrary();
  const [problem, setProblem] = useState("");
  const [removed, setRemoved] = useState<{ name: string; undo: string } | null>(null);
  const forgetRemoved = useCallback(() => setRemoved(null), []);
  const working = useRef(false);
  /** One request of a row at a time. Its buttons stay enabled meanwhile, so the one pressed keeps the focus the editor gives back. */
  const once = async (work: () => Promise<void>) => {
    if (working.current) return;
    working.current = true;
    setProblem("");
    try {
      await work();
    } catch (cause) {
      setProblem(templateFailure(cause));
      void refreshTemplateLibrary();
    } finally {
      working.current = false;
    }
  };

  const open = (kind: TemplateKind, id: string) => once(async () => {
    if (kind === "team") {
      const template = await readTeamTemplate(id);
      editTemplate({ kind, id, changed: false, draft: teamDraftOf(template), shown: TEAM_PAGE, carried: template.carried });
    } else {
      editTemplate({ kind, id, changed: false, draft: botDraftOf(await readBotTemplate(id)) });
    }
  });
  const remove = (kind: TemplateKind, id: string, name: string) => once(async () => {
    setRemoved({ name, undo: await removeTemplate(kind, id) });
    await refreshTemplateLibrary();
  });
  const putBack = async (undo: string) => {
    try {
      await restoreTemplate(undo);
    } catch (cause) {
      setProblem(templateFailure(cause));
    }
    await refreshTemplateLibrary();
  };

  const waiting = library === null && !failed;
  return (
    <>
      {failed && (
        <p role="alert" className="flex flex-wrap items-center gap-2 px-4 text-[13px] leading-[18px] text-danger">
          {t("templateLibrary.loadFailed")}
          <button type="button" className="ui-button ui-button-sm" onClick={() => void refreshTemplateLibrary()}>{t("common.tryAgain")}</button>
        </p>
      )}
      {problem && <p role="alert" className="px-4 text-[13px] leading-[18px] text-danger">{problem}</p>}
      <SettingsGroup label={t("templateLibrary.teams")} block="team-templates"
        actions={<button type="button" className="ui-button ui-button-md" data-template-new="team"
          onClick={() => { const draft = blankTeamDraft(); editTemplate({ kind: "team", changed: false, draft, shown: TEAM_PAGE, carried: { groupChats: 0, routines: 0 } }); }}>{t("templateLibrary.newTeam")}</button>}>
        <SettingsRows>
          {waiting || !library ? <SettingsEmptyRow>{" "}</SettingsEmptyRow> : library.teams.length === 0 ? <SettingsEmptyRow>{t("templateLibrary.teams.empty")}</SettingsEmptyRow>
            : library.teams.map((template) => (
              <TemplateRow key={template.id} name={template.name} version={template.version} line={rolesLine(template)}
                onEdit={() => void open("team", template.id)} onDelete={() => void remove("team", template.id, template.name)} />
            ))}
        </SettingsRows>
      </SettingsGroup>
      <SettingsGroup label={t("templateLibrary.bots")} block="bot-templates"
        actions={<button type="button" className="ui-button ui-button-md" data-template-new="bot"
          onClick={() => editTemplate({ kind: "bot", changed: false, draft: blankBotDraft() })}>{t("templateLibrary.newBot")}</button>}>
        <SettingsRows>
          {waiting || !library ? <SettingsEmptyRow>{" "}</SettingsEmptyRow> : library.bots.length === 0 ? <SettingsEmptyRow>{t("templateLibrary.bots.empty")}</SettingsEmptyRow>
            : library.bots.map((template) => (
              <TemplateRow key={template.id} name={template.name} version={template.version} line={template.title}
                onEdit={() => void open("bot", template.id)} onDelete={() => void remove("bot", template.id, template.name)} />
            ))}
        </SettingsRows>
      </SettingsGroup>
      {removed && <UndoToast key={removed.undo} text={t("templateLibrary.deleted", { name: removed.name })} onUndo={() => putBack(removed.undo)} onDone={forgetRemoved} />}
      {discarded && !editing && (
        <UndoToast text={discardedLine(discarded)} actionLabel={t("templateLibrary.keepEditing")} onUndo={async () => editTemplate(discarded)} onDone={forgetDiscardedTemplate} />
      )}
      {editing && <Layer modal><TemplateEditorDialog editing={editing} botTemplates={library?.bots ?? []} /></Layer>}
    </>
  );
}

/** Settings → Templates: the bot templates and team templates the person prepares ahead of making projects. */
export function TemplatesPage() {
  return <AdminOnly><Templates /></AdminOnly>;
}
