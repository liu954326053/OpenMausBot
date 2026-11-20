import { AVATAR_FOCUS_CENTER, AVATAR_ZOOM_MIN, type BotAvatarCrop } from "../../shared/bot-avatar";
import { botBodySchema } from "../../shared/bot-body";
import { BOT_PROFILE_LIMITS } from "../../shared/bot-profile";
import { TEAM_BRIEF_MAX_BYTES, utf8Bytes } from "../../shared/package-format";
import { takeImportName } from "../../shared/import-name";
import {
  TEMPLATE_LIMITS, templateRoleKey,
  type BotTemplateInput, type BotTemplateWire, type TeamTemplateInput, type TeamTemplateWire, type TemplateOwnSkill, type TemplateRole,
  type TemplateRoleLook,
} from "../../shared/template-library";
import { MAUS_COLOR_NAMES } from "../../shared/wire";
import type { Bot, ModelSelection } from "@/state/store";
import { randomUuid } from "./random-uuid";

/** A role's look as the bot editors change it: `shape` is the mascot or the frame its picture sits in. */
export interface RoleLookDraft extends Omit<TemplateRoleLook, "pictureCrop"> {
  shape: BotAvatarCrop;
}

/** A role while the Templates page edits it. `id` names it on the page only; it is also the id of its stand-in bot. */
export interface RoleDraft extends Omit<TemplateRole, "key" | "look"> {
  id: string;
  /** Absent until a save gives the role its key. */
  key?: string;
  look: RoleLookDraft;
}

/** How an editor changes a role: from the role as it is now, so two changes in a row both count. */
export type ChangeRole = (change: (role: RoleDraft) => RoleDraft) => void;

export interface TeamDraft {
  name: string;
  genre: string;
  context: string;
  /** The `id` of the role that leads. */
  lead: string;
  roles: RoleDraft[];
  skills: TemplateOwnSkill[];
  /**
   * Keys no new role gets: those the template's roles had when it was opened, and those of roles it lost before. A
   * project made from an earlier version may still have a bot under one.
   */
  spentKeys: string[];
}

export interface BotDraft {
  role: RoleDraft;
  skills: TemplateOwnSkill[];
}

/** What a bot editor changes on the stand-in bot. Anything else it sends has no place in a template. */
export type RolePatch = Partial<Pick<Bot,
  "name" | "title" | "description" | "soul" | "color" | "mascotExpression" | "mascotBody" | "mascotFaceColor" | "avatarUrl" | "avatarCrop"
  | "avatarZoom" | "avatarFocusX" | "avatarFocusY" | "mcpServers">> & { modelSelection?: ModelSelection | null };

const newId = () => `draft-${randomUuid()}`;

/** A role with nothing filled in, in the first colour none of `others` wears; in turn once every colour is worn. */
export function blankRole(others: readonly RoleDraft[] = []): RoleDraft {
  const worn = new Set(others.map((role) => role.look.color));
  const color = MAUS_COLOR_NAMES.find((each) => !worn.has(each)) ?? MAUS_COLOR_NAMES[others.length % MAUS_COLOR_NAMES.length]!;
  return { id: newId(), name: "", title: "", description: "", soul: "", memory: "", ownSkills: [], librarySkills: [], look: { color, shape: "mascot" } };
}

export function roleDraftOf(role: TemplateRole): RoleDraft {
  const { pictureCrop, ...look } = role.look;
  return { ...role, id: newId(), look: { ...look, shape: look.picture ? pictureCrop ?? "circle" : "mascot" } };
}

export function blankTeamDraft(): TeamDraft {
  const lead = blankRole();
  return { name: "", genre: "", context: "", lead: lead.id, roles: [lead], skills: [], spentKeys: [] };
}

export const blankBotDraft = (): BotDraft => ({ role: blankRole(), skills: [] });

export function teamDraftOf(template: TeamTemplateWire): TeamDraft {
  const roles = template.roles.map(roleDraftOf);
  const lead = roles.find((role) => role.key === template.lead) ?? roles[0]!;
  const spentKeys = [...template.roles.map((role) => role.key), ...(template.retiredKeys ?? [])];
  return { name: template.name, genre: template.genre, context: template.context, lead: lead.id, roles, skills: template.skills, spentKeys };
}

export const botDraftOf = (template: BotTemplateWire): BotDraft => ({ role: roleDraftOf(template.role), skills: template.skills });

/** The role as a bot that exists on this page only, for the editors that take a bot. */
export function standInBot(role: RoleDraft): Bot {
  const body = botBodySchema.safeParse(role.look.mascotBody);
  return {
    id: role.id, threadId: role.id, name: role.name, title: role.title, description: role.description, soul: role.soul,
    notifications: true, unread: false, messages: [],
    color: role.look.color,
    mascotExpression: role.look.mascotExpression ?? null,
    mascotBody: body.success ? body.data : null,
    mascotFaceColor: role.look.mascotFaceColor ?? null,
    avatarUrl: role.look.picture ?? null,
    avatarCrop: role.look.shape,
    avatarZoom: role.look.avatarZoom ?? AVATAR_ZOOM_MIN,
    avatarFocusX: role.look.avatarFocusX ?? AVATAR_FOCUS_CENTER,
    avatarFocusY: role.look.avatarFocusY ?? AVATAR_FOCUS_CENTER,
    modelSelection: role.model ?? { instanceId: "", model: "" },
    ...(role.mcpServers ? { mcpServers: role.mcpServers } : {}),
  };
}

/** What a patch leaves of a field: its own value when it names the field (null or "" clears it), else what was there. */
function after<Value>(patch: RolePatch, field: keyof RolePatch, before: Value | undefined): Value | undefined {
  if (!(field in patch)) return before;
  const value = patch[field] as Value | null | undefined | "";
  return value === null || value === undefined || value === "" ? undefined : value;
}

const withoutUnset = <Fields extends object>(fields: Fields): Fields =>
  Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined)) as Fields;

/** A change a bot editor made to the stand-in bot, made to the role. */
export function patchedRole(role: RoleDraft, patch: RolePatch): RoleDraft {
  const picture = after(patch, "avatarUrl", role.look.picture);
  const model = after(patch, "modelSelection", role.model);
  return withoutUnset({
    ...role,
    name: patch.name ?? role.name,
    title: patch.title ?? role.title,
    description: patch.description ?? role.description,
    soul: patch.soul ?? role.soul,
    look: withoutUnset({
      color: patch.color ?? role.look.color,
      shape: picture ? patch.avatarCrop ?? role.look.shape : "mascot",
      mascotExpression: after(patch, "mascotExpression", role.look.mascotExpression),
      mascotBody: after(patch, "mascotBody", role.look.mascotBody),
      mascotFaceColor: after(patch, "mascotFaceColor", role.look.mascotFaceColor),
      picture,
      avatarZoom: after(patch, "avatarZoom", role.look.avatarZoom),
      avatarFocusX: after(patch, "avatarFocusX", role.look.avatarFocusX),
      avatarFocusY: after(patch, "avatarFocusY", role.look.avatarFocusY),
    }),
    model: model?.instanceId && model.model ? model : undefined,
    mcpServers: after(patch, "mcpServers", role.mcpServers),
  });
}

export const withRole = (draft: TeamDraft, role: RoleDraft): TeamDraft =>
  ({ ...draft, roles: draft.roles.map((each) => (each.id === role.id ? role : each)) });

export const hasRoomForRole = (draft: TeamDraft): boolean => draft.roles.length < TEMPLATE_LIMITS.roles;

export function withNewRole(draft: TeamDraft): { draft: TeamDraft; id: string } {
  const role = blankRole(draft.roles);
  return { draft: { ...draft, roles: [...draft.roles, role] }, id: role.id };
}

/**
 * The team with a copy of a bot template's role: the copy is the team's own from here on. A name the team already
 * uses gets a number, and a skill the team already carries under that name stays the team's.
 */
export function withRoleFromBotTemplate(draft: TeamDraft, template: BotTemplateWire): { draft: TeamDraft; id: string } {
  const names = new Set(draft.roles.map((role) => role.name.trim().toLowerCase()));
  const { key: _key, ...copied } = roleDraftOf(template.role);
  const role: RoleDraft = { ...copied, name: takeImportName(copied.name, names, BOT_PROFILE_LIMITS.name) };
  const carried = new Set(draft.skills.map((skill) => skill.name));
  const skills = [...draft.skills, ...template.skills.filter((skill) => role.ownSkills.includes(skill.name) && !carried.has(skill.name))];
  return { draft: { ...draft, roles: [...draft.roles, role], skills }, id: role.id };
}

/** The team without the role. Its last role stays, and the lead passes to the first role when the lead goes. */
export function withoutRole(draft: TeamDraft, id: string): TeamDraft {
  if (draft.roles.length < 2) return draft;
  const roles = draft.roles.filter((role) => role.id !== id);
  return { ...draft, roles, lead: draft.lead === id ? roles[0]!.id : draft.lead };
}

/** Undoes `withoutRole`: the role back at its place `at`, leading again if it `led`. */
export function withRoleBack(draft: TeamDraft, role: RoleDraft, at: number, led: boolean): TeamDraft {
  if (draft.roles.some((each) => each.id === role.id)) return draft;
  return { ...draft, roles: [...draft.roles.slice(0, at), role, ...draft.roles.slice(at)], lead: led ? role.id : draft.lead };
}

export const withoutOwnSkill = (role: RoleDraft, name: string): RoleDraft =>
  ({ ...role, ownSkills: role.ownSkills.filter((skill) => skill !== name) });

export const withLibrarySkill = (role: RoleDraft, name: string): RoleDraft =>
  (role.librarySkills.includes(name) ? role : { ...role, librarySkills: [...role.librarySkills, name] });

export const withoutLibrarySkill = (role: RoleDraft, name: string): RoleDraft =>
  ({ ...role, librarySkills: role.librarySkills.filter((skill) => skill !== name) });

const isNamed = (role: RoleDraft): boolean => role.name.trim().length > 0;

/** What still keeps a template from being saved: its name, a role's name, or a background longer than a team holds. */
export type SaveBlock = "name" | "roleName" | "context";

export function teamSaveBlock(draft: TeamDraft): SaveBlock | null {
  if (!draft.name.trim()) return "name";
  if (!draft.roles.every(isNamed)) return "roleName";
  return utf8Bytes(draft.context) > TEAM_BRIEF_MAX_BYTES ? "context" : null;
}

/** A bot template is named by its one role. */
export const botSaveBlock = (draft: BotDraft): SaveBlock | null => (isNamed(draft.role) ? null : "name");

/** A picture under the mascot shape is not part of the look, so it is left out, and with it its framing. */
function roleLook(look: RoleLookDraft): TemplateRoleLook {
  const { shape, picture, avatarZoom, avatarFocusX, avatarFocusY, ...mascot } = look;
  if (shape === "mascot" || !picture) return mascot;
  return {
    ...mascot, picture,
    ...(shape === "circle" ? {} : { pictureCrop: shape }),
    ...(avatarZoom === undefined ? {} : { avatarZoom }),
    ...(avatarFocusX === undefined ? {} : { avatarFocusX }),
    ...(avatarFocusY === undefined ? {} : { avatarFocusY }),
  };
}

function templateRole(role: RoleDraft, key: string): TemplateRole {
  const { id: _id, look, ...fields } = role;
  return { ...fields, key, name: role.name.trim(), title: role.title.trim(), look: roleLook(look) };
}

/** A template keeps only the skills of its own that a role still has. */
const skillsOf = (skills: TemplateOwnSkill[], roles: RoleDraft[]): TemplateOwnSkill[] =>
  skills.filter((skill) => roles.some((role) => role.ownSkills.includes(skill.name)));

/** The team as a save sends it. A role without a key gets one from its name here, and keeps it from then on. */
export function teamTemplateInput(draft: TeamDraft): TeamTemplateInput {
  const keys = new Set([...draft.spentKeys, ...draft.roles.flatMap((role) => (role.key ? [role.key] : []))]);
  const keyOf = new Map<string, string>();
  for (const role of draft.roles) {
    const key = role.key ?? templateRoleKey(role.name, keys);
    keys.add(key);
    keyOf.set(role.id, key);
  }
  return {
    name: draft.name.trim(), genre: draft.genre.trim(), context: draft.context,
    lead: keyOf.get(draft.lead) ?? keyOf.get(draft.roles[0]!.id)!,
    roles: draft.roles.map((role) => templateRole(role, keyOf.get(role.id)!)),
    skills: skillsOf(draft.skills, draft.roles),
  };
}

export function botTemplateInput(draft: BotDraft): BotTemplateInput {
  return { role: templateRole(draft.role, draft.role.key ?? templateRoleKey(draft.role.name, new Set())), skills: skillsOf(draft.skills, [draft.role]) };
}
