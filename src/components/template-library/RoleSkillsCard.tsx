import { useCallback, useEffect, useState, type ReactNode } from "react";
import { X } from "lucide-react";

import { skillsLibraryEnabled } from "@/lib/feature-flags";
import { t } from "@/lib/i18n";
import { withLibrarySkill, withoutLibrarySkill, type ChangeRole, type RoleDraft } from "@/lib/template-library-draft";
import { api, useStore } from "@/state/store";
import type { TemplateOwnSkill } from "../../../shared/template-library";
import type { SkillsLibrarySkillWire } from "../../../shared/wire";
import { Select } from "../Select";

const LIST = "mt-2 divide-y divide-hairline/40 overflow-hidden rounded-lg border border-hairline/40";

function SkillRow({ name, line, onRemove }: { name: string; line?: ReactNode; onRemove: () => void }) {
  return (
    <li className="flex items-center justify-between gap-3 px-3 py-2">
      <div className="min-w-0 flex-1">
        <div className="truncate font-mono text-[13px] text-ink" title={name}>{name}</div>
        {line && <div className="truncate text-[12px] text-ink-secondary">{line}</div>}
      </div>
      <button type="button" onClick={onRemove} aria-label={t("templateLibrary.role.skills.remove", { name })} title={t("templateLibrary.role.skills.remove", { name })}
        className="ui-icon-button size-7 shrink-0">
        <X size={14} aria-hidden="true" />
      </button>
    </li>
  );
}

/**
 * The two ways a role carries skills: by name from the skills library, where nothing is copied, and as the template's
 * own, which arrive with a bot saved as a template and can only be taken out here.
 */
export function RoleSkillsCard({ role, own, change, onRemoveOwn }: {
  role: RoleDraft; own: TemplateOwnSkill[]; change: ChangeRole; onRemoveOwn: (name: string) => void;
}) {
  const offered = skillsLibraryEnabled(useStore().state.config);
  const [library, setLibrary] = useState<SkillsLibrarySkillWire[] | null>(null);
  const [failed, setFailed] = useState(false);
  const load = useCallback(() => {
    setFailed(false);
    api<{ skills?: SkillsLibrarySkillWire[] }>("/api/skills-library").then((answer) => setLibrary(answer.skills ?? []), () => setFailed(true));
  }, []);
  useEffect(() => { if (offered) load(); }, [offered, load]);

  const known = new Map((library ?? []).map((skill) => [skill.name, skill]));
  const free = (library ?? []).filter((skill) => !role.librarySkills.includes(skill.name));
  if (!offered && role.librarySkills.length === 0 && own.length === 0) return null;
  return (
    <div className="rounded-xl bg-card p-4" data-template-role-skills="">
      <div className="text-[15px] font-medium text-ink">{t("botSettings.sections.skills")}</div>
      {(offered || role.librarySkills.length > 0) && <>
        <div className="mt-0.5 text-[13px] text-ink-secondary">{t("templateLibrary.role.skills.library")}</div>
        {failed && (
          <div role="alert" className="mt-2 text-[12px] text-danger">
            {t("skills.library.loadError")} <button type="button" onClick={load} className="underline">{t("common.tryAgain")}</button>
          </div>
        )}
        {offered && library && (library.length === 0
          ? <div className="mt-2 rounded-lg bg-inset px-3 py-2 text-[12px] text-ink-secondary">{t("templateLibrary.role.skills.libraryEmpty")}</div>
          : <Select className="mt-2 max-w-full" value="" disabled={free.length === 0} aria-label={t("skills.library.addLabel")}
              onChange={(event) => { const name = event.target.value; if (name) change((latest) => withLibrarySkill(latest, name)); }}>
              <option value="">{t("skills.library.addPlaceholder")}</option>
              {free.map((skill) => <option key={skill.name} value={skill.name}>{skill.name}</option>)}
            </Select>)}
        {role.librarySkills.length > 0 && (
          <ul className={LIST}>
            {role.librarySkills.map((name) => (
              <SkillRow key={name} name={name} line={library && !known.has(name) ? t("templateLibrary.role.skills.missing") : known.get(name)?.description}
                onRemove={() => change((latest) => withoutLibrarySkill(latest, name))} />
            ))}
          </ul>
        )}
      </>}
      {own.length > 0 && <>
        <div className="mt-4 text-[13px] text-ink-secondary">{t("templateLibrary.role.skills.own")}</div>
        <ul className={LIST}>
          {own.map((skill) => <SkillRow key={skill.name} name={skill.name} line={skill.description} onRemove={() => onRemoveOwn(skill.name)} />)}
        </ul>
      </>}
    </div>
  );
}
