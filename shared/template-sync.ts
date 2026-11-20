// Template sync keeps a project and its team template in step by hand. A project is made from a team template and then
// drifts apart from it; these wire types carry what one hand action would change, shown to the person before it runs.

/** One of a matched role's settings that differs between the template and the project's bot. */
export type RoleFieldChange = "persona" | "model" | "skills" | "mcp";

/** A role the template and the project both have, matched by its key (stable across a rename). */
export interface MatchedRole {
  /** The role key; also the bot's folder name in the project. */
  key: string;
  botId: string;
  /** The role's name in the template now. */
  templateName: string;
  /** The bot's name now; may differ when the person renamed it. */
  currentName: string;
  /** The settings that would change on "update from template"; empty when nothing but the name differs. */
  fields: RoleFieldChange[];
}

/** A role the template has that the project has no bot for: a new role, or a role whose bot the person deleted. */
export interface AddedRole {
  key: string;
  name: string;
  title: string;
}

/** A bot in the project whose role the template no longer has: a bot the person added to the project. */
export interface RemovedRole {
  key: string;
  name: string;
  botId: string;
}

/** The whole comparison of a project's team against its team template. Pure, computed on the server. */
export interface TemplateSyncDiff {
  templateId: string;
  templateName: string;
  /** The template version the project was made from or last synced to. */
  fromVersion: number;
  /** The template's version now. */
  toVersion: number;
  /** Matched roles whose settings changed. */
  changed: MatchedRole[];
  /** Matched roles with no setting change, including a bot renamed but otherwise the same. */
  unchanged: MatchedRole[];
  /** Roles the template has that the project lacks. */
  added: AddedRole[];
  /** Bots in the project the template does not have a role for. */
  removed: RemovedRole[];
}

/** `POST /api/template-sync/projects/:id/update/preview`. `can` is false when there is nothing to apply. */
export interface TemplateUpdatePreview {
  diff: TemplateSyncDiff;
  /** True when at least one matched role has a setting change to apply. */
  can: boolean;
}

/** `POST /api/template-sync/projects/:id/update`: what the apply changed. */
export interface TemplateUpdateResult {
  /** How many roles had their settings brought in line with the template. */
  applied: number;
  /** The version the project now records. */
  toVersion: number;
}

export type SaveBackMode = "version" | "new";

/** `POST /api/template-sync/projects/:id/save-back`. A new template is named after the project's department. */
export interface SaveBackInput {
  mode: SaveBackMode;
}

/** What saving the project's team back to a template answers. */
export interface SaveBackResult {
  templateId: string;
  name: string;
  version: number;
  /** "version": a new version of the project's own template; "new": a brand new template. */
  mode: SaveBackMode;
}

/** `POST /api/template-sync/memory/deposit`: add one memory entry to the project template's starter memory. */
export interface DepositMemoryInput {
  botId: string;
  /** The memory file: "MEMORY.md" or "memory/<topic>.md". */
  path: string;
}
