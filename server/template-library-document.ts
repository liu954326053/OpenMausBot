import { z } from "zod";

import { AVATAR_FOCUS_CENTER, AVATAR_ZOOM_MIN, clampAvatarFocus, clampAvatarZoom, mascotFaceColorSchema } from "../shared/bot-avatar.ts";
import { BOT_PROFILE_LIMITS, fitsOnOneLine } from "../shared/bot-profile.ts";
import {
  AGENT_MAX_SKILLS, PACKAGE_FORMAT, PACKAGE_MAX_SKILLS, packageVersionFor, SEED_FILE_MAX_BYTES, TEAM_BRIEF_MAX_BYTES, utf8Bytes,
  type PackageAgent, type PackageDefinition, type PackageDocument, type PackageRoom,
} from "../shared/package-format.ts";
import { isSkillName, parseSkillMd, SKILL_FILE_MAX_BYTES } from "../shared/skill-md.ts";
import {
  isTemplateRoleKey, TEMPLATE_LIMITS, templateRoleKey,
  type BotTemplateContent, type BotTemplateSummary, type BotTemplateWire, type TeamTemplateContent, type TeamTemplateSummary,
  type TeamTemplateWire, type TemplateKind, type TemplateLookExtras, type TemplateOwnSkill, type TemplateRole, type TemplateRoleExtras,
} from "../shared/template-library.ts";
import { EFFORT_LEVELS, MAUS_COLOR_NAMES } from "../shared/wire.ts";
import { productName } from "./brand.ts";
import { picture } from "./package-export.ts";
import type { StoredTemplate, TemplateMeta } from "./template-library-store.ts";

/** A stored template made whole: keys a project can name folders by, a lead that is a role, extras for every role. */
export interface TemplateRecord {
  kind: TemplateKind;
  id: string;
  document: PackageDocument;
  version: number;
  updatedAt: number;
  genre: string;
  lead: string;
  extras: Record<string, TemplateRoleExtras>;
  /** Keys of roles the template had once and has no more. A new role never takes one. */
  retiredKeys: string[];
}

type Responder = PackageRoom["defaultResponder"];

/**
 * The document with every agent under a role key, and how each key it had is spelled now. `preferred` names, by the key
 * an agent has, the role key it gets when that is one and no agent before it took it. No other agent gets a key of
 * `retired`.
 */
export function withRoleKeys(
  document: PackageDocument, preferred: ReadonlyMap<string, string> = new Map(), retired: ReadonlySet<string> = new Set(),
): { document: PackageDocument; keys: Map<string, string> } {
  const pkg = document.package;
  const taken = new Set<string>();
  const keys = new Map<string, string>();
  const claim = (from: string, key: string | undefined) => {
    if (keys.has(from) || key === undefined || !isTemplateRoleKey(key) || taken.has(key)) return;
    keys.set(from, key);
    taken.add(key);
  };
  for (const agent of pkg.agents) claim(agent.key, preferred.get(agent.key));
  for (const agent of pkg.agents) if (!retired.has(agent.key)) claim(agent.key, agent.key);
  for (const agent of pkg.agents) claim(agent.key, templateRoleKey(agent.key, new Set([...taken, ...retired])));
  if ([...keys].every(([from, to]) => from === to)) return { document, keys };
  const renamed = (key: string) => keys.get(key) ?? key;
  const responder = (value: Responder): Responder =>
    (value.kind === "agent" || value.kind === "auto") && value.agent !== undefined ? { ...value, agent: renamed(value.agent) } : value;
  return {
    keys,
    document: {
      ...document,
      package: {
        ...pkg,
        ...(pkg.team ? { team: { ...pkg.team, ...(pkg.team.leader ? { leader: renamed(pkg.team.leader) } : {}) } } : {}),
        agents: pkg.agents.map((agent) => ({ ...agent, key: renamed(agent.key) })),
        ...(pkg.rooms ? { rooms: pkg.rooms.map((room) => ({ ...room, members: room.members.map(renamed), defaultResponder: responder(room.defaultResponder) })) } : {}),
        ...(pkg.routines ? { routines: pkg.routines.map((routine) => ({ ...routine, agent: renamed(routine.agent) })) } : {}),
      },
    },
  };
}

/** Null: the folder does not hold a template of its kind (a bot template is one role, a team template at least one). */
export function templateRecord(kind: TemplateKind, id: string, stored: StoredTemplate): TemplateRecord | null {
  const { document } = withRoleKeys(stored.document);
  const pkg = document.package;
  if (!pkg.team || (kind === "bot" ? pkg.agents.length !== 1 : pkg.agents.length < 1)) return null;
  const keys = new Set(pkg.agents.map((agent) => agent.key));
  const meta = stored.meta;
  const lead = meta?.lead && keys.has(meta.lead) ? meta.lead : pkg.team.leader ?? pkg.agents[0]!.key;
  return {
    kind, id,
    document: { ...document, package: { ...pkg, team: { ...pkg.team, leader: lead } } },
    // A release is written as "<version>.0.0", so the version outlives a magicbot.json that was lost.
    version: meta?.version ?? Math.max(1, Number(pkg.release.split(".")[0])),
    updatedAt: meta?.updatedAt ?? stored.writtenAt,
    genre: meta?.genre ?? "",
    lead,
    extras: Object.fromEntries(pkg.agents.map((agent) => [agent.key, meta?.roles[agent.key] ?? { librarySkills: [] }])),
    retiredKeys: (meta?.retiredKeys ?? []).filter((key) => isTemplateRoleKey(key) && !keys.has(key)),
  };
}

export function botSummary(record: TemplateRecord): BotTemplateSummary {
  const agent = record.document.package.agents[0]!;
  return { id: record.id, name: record.document.package.name, title: agent.title ?? "", version: record.version, updatedAt: record.updatedAt };
}

export function teamSummary(record: TemplateRecord): TeamTemplateSummary {
  return {
    id: record.id, name: record.document.package.name, genre: record.genre, version: record.version, updatedAt: record.updatedAt, lead: record.lead,
    roles: record.document.package.agents.map((agent) => ({ key: agent.key, name: agent.name, title: agent.title ?? "" })),
  };
}

export function botContent(record: TemplateRecord): BotTemplateContent {
  const key = record.document.package.agents[0]!.key;
  return { ...botSummary(record), key, document: record.document, extras: record.extras[key]! };
}

export function teamContent(record: TemplateRecord): TeamTemplateContent {
  return { ...teamSummary(record), document: record.document, extras: record.extras };
}

function roleOf(agent: PackageAgent, { look, ...extras }: TemplateRoleExtras): TemplateRole {
  const { color, mascotExpression, mascotBody, avatar } = agent.appearance;
  return {
    key: agent.key, name: agent.name, title: agent.title ?? "", description: agent.description ?? "", soul: agent.soul ?? "",
    look: {
      color,
      ...(mascotExpression ? { mascotExpression } : {}),
      ...(mascotBody ? { mascotBody } : {}),
      ...(avatar ? { picture: `data:${avatar.mime};base64,${avatar.data}`, ...(avatar.crop === "circle" ? {} : { pictureCrop: avatar.crop }) } : {}),
      ...look,
    },
    ownSkills: [...(agent.skills ?? [])],
    memory: agent.seed?.memory["MEMORY.md"] ?? "",
    ...extras,
  };
}

const ownSkills = (pkg: PackageDefinition): TemplateOwnSkill[] => (pkg.skills?.entries ?? []).map((skill) => ({
  name: skill.name, description: skill.description, text: skill.instructions, ...(skill.files?.length ? { files: skill.files } : {}),
}));

export function botWire(record: TemplateRecord): BotTemplateWire {
  const pkg = record.document.package;
  return { ...botSummary(record), role: roleOf(pkg.agents[0]!, record.extras[pkg.agents[0]!.key]!), skills: ownSkills(pkg) };
}

export function teamWire(record: TemplateRecord): TeamTemplateWire {
  const pkg = record.document.package;
  return {
    ...teamSummary(record),
    context: pkg.team?.brief ?? "",
    roles: pkg.agents.map((agent) => roleOf(agent, record.extras[agent.key]!)),
    skills: ownSkills(pkg),
    carried: { groupChats: pkg.rooms?.length ?? 0, routines: pkg.routines?.length ?? 0 },
    ...(record.retiredKeys.length ? { retiredKeys: record.retiredKeys } : {}),
  };
}

const line = (max: number) => z.string().trim().min(1).max(max).refine(fitsOnOneLine);
const optionalLine = (max: number) => z.string().trim().max(max).refine(fitsOnOneLine);
const withinBytes = (max: number) => z.string().refine((value) => utf8Bytes(value) <= max);
const skillName = z.string().refine(isSkillName);
const unique = (names: readonly string[]) => new Set(names).size === names.length;

const roleSchema = z.object({
  key: z.string().refine(isTemplateRoleKey),
  name: line(BOT_PROFILE_LIMITS.name),
  title: optionalLine(BOT_PROFILE_LIMITS.title).default(""),
  description: z.string().trim().max(BOT_PROFILE_LIMITS.description).default(""),
  soul: withinBytes(BOT_PROFILE_LIMITS.soul).default(""),
  look: z.object({
    color: z.enum(MAUS_COLOR_NAMES),
    mascotExpression: z.string().trim().min(1).max(80).nullish(),
    mascotBody: z.string().trim().min(1).max(40).nullish(),
    picture: z.string().max(100_000).nullish(),
    pictureCrop: z.enum(["circle", "rounded", "square"]).nullish(),
    mascotFaceColor: mascotFaceColorSchema.nullish(),
    avatarZoom: z.number().nullish(),
    avatarFocusX: z.number().nullish(),
    avatarFocusY: z.number().nullish(),
  }),
  ownSkills: z.array(skillName).max(AGENT_MAX_SKILLS).refine(unique).default([]),
  memory: withinBytes(SEED_FILE_MAX_BYTES).default(""),
  model: z.object({
    instanceId: z.string().max(200),
    model: z.string().max(200),
    effort: z.enum(EFFORT_LEVELS).nullish(),
    variant: z.string().max(100).nullish(),
  }).nullish(),
  librarySkills: z.array(skillName).max(TEMPLATE_LIMITS.references).refine(unique).default([]),
  mcpServers: z.array(z.string().regex(/^[a-z][a-z0-9_-]{0,31}$/)).max(TEMPLATE_LIMITS.references).refine(unique).nullish(),
});
type RoleInput = z.output<typeof roleSchema>;

const skillSchema = z.object({
  name: skillName,
  text: withinBytes(SKILL_FILE_MAX_BYTES).refine((value) => value.length > 0),
  files: z.array(z.object({ path: z.string().min(1).max(300), content: z.string() })).max(30).nullish(),
});
const skillsSchema = z.array(skillSchema).max(PACKAGE_MAX_SKILLS).refine((skills) => unique(skills.map((skill) => skill.name))).default([]);

export const botTemplateInputSchema = z.object({
  role: roleSchema.extend({ name: line(TEMPLATE_LIMITS.name) }),
  skills: skillsSchema,
});
export const teamTemplateInputSchema = z.object({
  name: line(TEMPLATE_LIMITS.name),
  genre: z.string().trim().max(TEMPLATE_LIMITS.genre).default(""),
  context: withinBytes(TEAM_BRIEF_MAX_BYTES).default(""),
  lead: z.string().refine(isTemplateRoleKey),
  roles: z.array(roleSchema).min(1).max(TEMPLATE_LIMITS.roles),
  skills: skillsSchema,
});
export type CheckedBotTemplate = z.output<typeof botTemplateInputSchema>;
export type CheckedTeamTemplate = z.output<typeof teamTemplateInputSchema>;

/** Why an input that passed its schema still cannot be a template. */
export type TemplateProblem =
  | { problem: "roleName"; name: string }
  | { problem: "roleKey" }
  | { problem: "lead" }
  | { problem: "picture"; name: string }
  | { problem: "skill"; name: string };

/** A picture's framing is kept only where there is a picture to frame, and only where it is not the default. */
export function lookExtrasOf(look: { [Key in keyof TemplateLookExtras]?: unknown }, pictured: boolean): TemplateLookExtras | undefined {
  const face = mascotFaceColorSchema.safeParse(look.mascotFaceColor).data;
  const zoom = clampAvatarZoom(look.avatarZoom), focusX = clampAvatarFocus(look.avatarFocusX), focusY = clampAvatarFocus(look.avatarFocusY);
  const extras: TemplateLookExtras = {
    ...(face ? { mascotFaceColor: face } : {}),
    ...(pictured && zoom !== AVATAR_ZOOM_MIN ? { avatarZoom: zoom } : {}),
    ...(pictured && focusX !== AVATAR_FOCUS_CENTER ? { avatarFocusX: focusX } : {}),
    ...(pictured && focusY !== AVATAR_FOCUS_CENTER ? { avatarFocusY: focusY } : {}),
  };
  return Object.keys(extras).length ? extras : undefined;
}

export function extrasOf(role: Pick<RoleInput, "model" | "librarySkills" | "mcpServers" | "look">): TemplateRoleExtras {
  const model = role.model && role.model.instanceId && role.model.model ? role.model : undefined;
  const look = lookExtrasOf(role.look, Boolean(role.look.picture));
  return {
    ...(model ? { model: { instanceId: model.instanceId, model: model.model, ...(model.effort ? { effort: model.effort } : {}), ...(model.variant ? { variant: model.variant } : {}) } } : {}),
    librarySkills: [...role.librarySkills],
    ...(role.mcpServers ? { mcpServers: [...role.mcpServers] } : {}),
    ...(look ? { look } : {}),
  };
}

function agentOf(role: RoleInput, previous: PackageAgent | undefined): PackageAgent | TemplateProblem {
  const { title: _title, description: _description, soul: _soul, skills: _skills, seed: _seed, ...kept } = previous ?? ({} as Partial<PackageAgent>);
  let avatar: PackageAgent["appearance"]["avatar"];
  if (role.look.picture) {
    const read = picture(role.look.picture);
    if (typeof read === "string") return { problem: "picture", name: role.name };
    avatar = { ...read, crop: role.look.pictureCrop ?? "circle" };
  }
  const memory = { ...previous?.seed?.memory };
  if (role.memory.trim()) memory["MEMORY.md"] = role.memory;
  else delete memory["MEMORY.md"];
  return {
    ...kept,
    key: role.key,
    name: role.name,
    ...(role.title ? { title: role.title } : {}),
    ...(role.description ? { description: role.description } : {}),
    ...(role.soul.trim() ? { soul: role.soul } : {}),
    appearance: {
      color: role.look.color,
      ...(role.look.mascotExpression ? { mascotExpression: role.look.mascotExpression } : {}),
      ...(role.look.mascotBody ? { mascotBody: role.look.mascotBody } : {}),
      ...(avatar ? { avatar } : {}),
    },
    ...(role.ownSkills.length ? { skills: [...role.ownSkills] } : {}),
    ...(Object.keys(memory).length ? { seed: { memory } } : {}),
  };
}

/** The skills some role gets, as the package holds them: named and described by their own SKILL.md. */
function skillEntries(skills: CheckedBotTemplate["skills"], roles: readonly RoleInput[]): NonNullable<PackageDefinition["skills"]>["entries"] | TemplateProblem {
  const given = new Map(skills.map((skill) => [skill.name, skill]));
  const used = [...new Set(roles.flatMap((role) => role.ownSkills))];
  const entries: NonNullable<PackageDefinition["skills"]>["entries"] = [];
  for (const name of used) {
    const skill = given.get(name);
    const parsed = skill ? parseSkillMd(skill.text) : null;
    if (!skill || !parsed || "error" in parsed || parsed.name !== name) return { problem: "skill", name };
    entries.push({
      name, description: parsed.description, instructions: skill.text,
      ...(parsed.license ? { license: parsed.license } : {}), ...(parsed.compatibility ? { compatibility: parsed.compatibility } : {}),
      ...(skill.files?.length ? { files: skill.files } : {}),
    });
  }
  return entries;
}

const firstLine = (text: string, max: number) => (text.split(/\r?\n/).map((part) => part.trim()).find(Boolean) ?? "").slice(0, max);

function documentOf(
  previous: PackageDefinition | undefined,
  fields: { id: string; version: number; name: string; tagline: string; summary: string; brief: string; lead: string },
  roles: readonly RoleInput[],
  skills: CheckedBotTemplate["skills"],
): PackageDocument | TemplateProblem {
  const names = new Set<string>();
  const keys = new Set<string>();
  for (const role of roles) {
    if (names.has(role.name.toLowerCase())) return { problem: "roleName", name: role.name };
    if (keys.has(role.key)) return { problem: "roleKey" };
    names.add(role.name.toLowerCase());
    keys.add(role.key);
  }
  if (!keys.has(fields.lead)) return { problem: "lead" };
  const before = new Map((previous?.agents ?? []).map((agent) => [agent.key, agent]));
  const agents: PackageAgent[] = [];
  for (const role of roles) {
    const agent = agentOf(role, before.get(role.key));
    if ("problem" in agent) return agent;
    agents.push(agent);
  }
  const entries = skillEntries(skills, roles);
  if ("problem" in entries) return entries;
  const rooms = (previous?.rooms ?? []).flatMap((room): PackageRoom[] => {
    const members = room.members.filter((member) => keys.has(member));
    if (!members.length) return [];
    const responder = room.defaultResponder;
    const gone = (responder.kind === "agent" || responder.kind === "auto") && responder.agent !== undefined && !members.includes(responder.agent);
    return [{ ...room, members, defaultResponder: gone ? { kind: "agent", agent: members[0]! } : responder }];
  });
  const membersOf = new Map(rooms.map((room) => [room.key, room.members]));
  const routines = (previous?.routines ?? []).filter((routine) =>
    keys.has(routine.agent) && (routine.room === undefined || Boolean(membersOf.get(routine.room)?.includes(routine.agent))));
  const { rooms: _rooms, routines: _routines, skills: _skills, ...kept } = previous ?? ({} as Partial<PackageDefinition>);
  const pkg: PackageDefinition = {
    category: "Community",
    author: { name: `${productName()} user` },
    license: "Unspecified",
    outcomes: [`Start a project with this ${roles.length === 1 ? "bot" : "team"}.`],
    setupMinutes: 2,
    requirements: { apps: [], capabilities: [] },
    ...kept,
    id: `template-${fields.id}`,
    release: `${fields.version}.0.0`,
    name: fields.name,
    tagline: fields.tagline || previous?.tagline || `A ${roles.length === 1 ? "bot" : "team"} template made in ${productName()}.`,
    summary: fields.summary || previous?.summary || `A ${roles.length === 1 ? "bot" : "team"} template made in ${productName()}.`,
    team: { name: fields.name, ...(fields.brief.trim() ? { brief: fields.brief } : {}), leader: fields.lead },
    agents,
    ...(rooms.length ? { rooms } : {}),
    ...(routines.length ? { routines } : {}),
    ...(entries.length ? { skills: { version: 1 as const, entries } } : {}),
  };
  return { format: PACKAGE_FORMAT, version: packageVersionFor(pkg), package: pkg };
}

/** The bot template's document, which still has to pass the package gate. `previous` is the saved one it replaces. */
export function botTemplateDocument(input: CheckedBotTemplate, previous: PackageDefinition | undefined, id: string, version: number): PackageDocument | TemplateProblem {
  const { role } = input;
  return documentOf(previous, {
    id, version, name: role.name, tagline: firstLine(role.title || role.description, 160), summary: role.description.slice(0, 2_000), brief: "", lead: role.key,
  }, [role], input.skills);
}

/** The team template's document, which still has to pass the package gate. `previous` is the saved one it replaces. */
export function teamTemplateDocument(input: CheckedTeamTemplate, previous: PackageDefinition | undefined, id: string, version: number): PackageDocument | TemplateProblem {
  return documentOf(previous, {
    id, version, name: input.name, tagline: firstLine(input.genre, 160), summary: input.genre, brief: input.context, lead: input.lead,
  }, input.roles, input.skills);
}

/** What `magicbot.json` holds for a document about to be written. */
export function templateMeta(
  document: PackageDocument, extras: Record<string, TemplateRoleExtras>,
  fields: { version: number; updatedAt: number; genre?: string; lead?: string; retiredKeys?: string[] },
): TemplateMeta {
  return {
    version: fields.version,
    updatedAt: fields.updatedAt,
    ...(fields.genre ? { genre: fields.genre } : {}),
    ...(fields.lead ? { lead: fields.lead } : {}),
    roles: Object.fromEntries(document.package.agents.map((agent) => [agent.key, extras[agent.key] ?? { librarySkills: [] }])),
    ...(fields.retiredKeys?.length ? { retiredKeys: fields.retiredKeys } : {}),
  };
}
