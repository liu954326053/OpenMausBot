// The renderer side of 模板同步: the requests behind the four actions, and the pure shaping of a diff into what the
// review dialog shows. "Move a skill into the library" has no route of its own; it reuses the app's existing
// share endpoint.
import { api } from "@/state/store";
import type { LocaleKey } from "@/locales";
import type {
  RoleFieldChange, SaveBackInput, SaveBackResult, TemplateSyncDiff, TemplateUpdatePreview, TemplateUpdateResult,
} from "../../shared/template-sync";

const projectPath = (projectId: string, tail = ""): string => `/api/template-sync/projects/${encodeURIComponent(projectId)}${tail}`;

/** What one "update from template" would change, without changing anything. */
export function previewTemplateUpdate(projectId: string): Promise<TemplateUpdatePreview> {
  return api(projectPath(projectId, "/update/preview"), { method: "POST" });
}

/** Bring the project's bots in line with its template, and record the new version. */
export function applyTemplateUpdate(projectId: string): Promise<TemplateUpdateResult> {
  return api(projectPath(projectId, "/update"), { method: "POST" });
}

/** Save the project's team back as its template's next version, or as a new template. */
export function saveTeamBack(projectId: string, input: SaveBackInput): Promise<SaveBackResult> {
  return api(projectPath(projectId, "/save-back"), { method: "POST", body: JSON.stringify(input) });
}

/** Add one of a project bot's memory entries to its template role's starter memory. */
export function depositMemoryToTemplate(botId: string, path: string): Promise<{ id: string; name: string; version: number }> {
  return api("/api/template-sync/memory/deposit", { method: "POST", body: JSON.stringify({ botId, path }) });
}

/** Move one of a bot's learned skills into the skills library, through the app's own share endpoint. */
export function depositSkillToLibrary(botId: string, name: string): Promise<{ ok: true; shared: unknown }> {
  return api(`/api/bots/${encodeURIComponent(botId)}/skills/${encodeURIComponent(name)}/share`, { method: "POST" });
}

/** The i18n key for each changed setting, for the review dialog's per-role lines. */
export const ROLE_FIELD_LABEL: Record<RoleFieldChange, LocaleKey> = {
  persona: "templateSync.field.persona",
  model: "templateSync.field.model",
  skills: "templateSync.field.skills",
  mcp: "templateSync.field.mcp",
};

export interface ChangedRoleRow {
  key: string;
  /** The bot's name now. */
  from: string;
  /** The role's name in the template. */
  to: string;
  /** True when the bot was renamed from the role's template name. */
  renamed: boolean;
  fields: RoleFieldChange[];
}

export interface DiffSummary {
  changed: ChangedRoleRow[];
  added: Array<{ key: string; name: string; title: string }>;
  removed: Array<{ key: string; name: string }>;
  /** No role's settings differ: there is nothing to apply, though roles may be added or removed. */
  nothingToApply: boolean;
  /** The whole teams match: nothing changed, added or removed. */
  identical: boolean;
}

/** Shape a diff for the review dialog. Pure: the dialog turns the field keys and counts into the person's language. */
export function summarizeDiff(diff: TemplateSyncDiff): DiffSummary {
  const changed = diff.changed.map((role) => ({
    key: role.key, from: role.currentName, to: role.templateName, renamed: role.currentName !== role.templateName, fields: role.fields,
  }));
  const added = diff.added.map((role) => ({ key: role.key, name: role.name, title: role.title }));
  const removed = diff.removed.map((role) => ({ key: role.key, name: role.name }));
  return {
    changed, added, removed,
    nothingToApply: changed.length === 0,
    identical: changed.length === 0 && added.length === 0 && removed.length === 0,
  };
}
