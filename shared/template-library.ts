// Templates the person prepares ahead: a bot template is one role, a team template a lead and its members. They live in
// the template library, apart from the share cards and a Team Cloud's own template list in `share-card.ts`.
import type { MascotFaceColor } from "./bot-avatar.ts";
import type { PackageDocument } from "./package-format.ts";
import type { MausColor, ModelSelection } from "./wire.ts";

/** One role of a team template, as a list shows it. `key` is unique within the template: lowercase letters, digits and dashes. */
export interface TemplateRoleSummary {
  key: string;
  name: string;
  /** What the role does, in a line. */
  title: string;
}

export interface BotTemplateSummary {
  id: string;
  name: string;
  title: string;
  version: number;
  updatedAt: number;
}

export interface TeamTemplateSummary {
  id: string;
  name: string;
  /** Which kinds of drama the team suits. The main bot picks a team by it. */
  genre: string;
  /** One more with every save. A project keeps the version it was made from. */
  version: number;
  updatedAt: number;
  /** The `key` of the role that leads the team. */
  lead: string;
  roles: TemplateRoleSummary[];
}

/** `GET /api/template-library`. */
export interface TemplateLibraryWire {
  bots: BotTemplateSummary[];
  teams: TeamTemplateSummary[];
}

/** The parts of a role's look the template folder format has no field for, named as a bot's own settings name them. */
export interface TemplateLookExtras {
  /** The colour of the mascot's face. Absent: the mascot's own. */
  mascotFaceColor?: MascotFaceColor;
  /** How far the picture is zoomed in, from 1 to 3. Absent: 1, the whole picture. */
  avatarZoom?: number;
  /** The point of the picture kept in the middle of its frame, each from 0 to 1. Absent: 0.5, the centre. */
  avatarFocusX?: number;
  avatarFocusY?: number;
}

/**
 * What a template keeps for one role beside its template folder, in the folder's `magicbot.json`: the folder format
 * has no field for a model and drops every field it does not know.
 */
export interface TemplateRoleExtras {
  /** The model the role's bot runs on. Absent: the app's default model at the time the bot is made. */
  model?: ModelSelection;
  /** Skills of the skills library the role uses, by name. Nothing is copied: every project reads the library's one copy. */
  librarySkills: string[];
  /** The MCP servers the role's bot uses, by name. Absent: no list of its own, so every server that is switched on. */
  mcpServers?: string[];
  /** Absent: nothing about the look beyond what the template folder carries. */
  look?: TemplateLookExtras;
}

/**
 * A whole team template: what making a real team from it takes.
 *
 * `document` is the team in the package format, as the package importer takes it. It has one agent per role, in the
 * order of `roles`, whose `key` is the role's key and which carries the role's name, title, description, persona
 * (`soul`), look, starter memory (`seed`) and the names of the template's own skills it gets; those skills are in
 * `package.skills` and the importer copies them into the bot. `package.team.brief` is the team's context and
 * `package.team.leader` is `lead`. Group chats and routines a template was saved with are there too.
 *
 * `extras` holds, by role key, what the package format cannot carry. Every role has an entry.
 */
export interface TeamTemplateContent extends TeamTemplateSummary {
  document: PackageDocument;
  extras: Record<string, TemplateRoleExtras>;
}

/** A whole bot template: its one role as `TeamTemplateContent` holds a team's, with `key` the role's key. */
export interface BotTemplateContent extends BotTemplateSummary {
  key: string;
  document: PackageDocument;
  extras: TemplateRoleExtras;
}

export const TEMPLATE_LIMITS = {
  /** Characters of a template's name, on one line. */
  name: 60,
  /** Characters of a team template's genre text. */
  genre: 2000,
  /** Roles of one team template. */
  roles: 30,
  /** Templates of one kind in the library. */
  templates: 200,
  /** Library skills and MCP servers one role names. */
  references: 100,
} as const;

const ROLE_KEY = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;
/** Names Windows keeps for devices: no folder can be called one, and a role's key names its bot's folder in a project. */
const DEVICE_NAME = /^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])$/;

/** A role's key: 1 to 40 lowercase letters, digits and dashes, starting and ending with a letter or digit. */
export function isTemplateRoleKey(value: string): boolean {
  return ROLE_KEY.test(value) && !DEVICE_NAME.test(value);
}

/**
 * The key of a new role: the letters and digits of its name when it has any, else `role-1`, `role-2`, …; never one of
 * `taken`. A role keeps the key it was first saved with, whatever its name becomes.
 */
export function templateRoleKey(name: string, taken: ReadonlySet<string>): string {
  const slug = name.normalize("NFKD").replace(/\p{M}+/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 36).replace(/-+$/, "");
  const base = isTemplateRoleKey(slug) ? slug : "role";
  if (base !== "role" && !taken.has(base)) return base;
  for (let n = base === "role" ? 1 : 2; ; n += 1) {
    const key = `${base}-${n}`;
    if (!taken.has(key)) return key;
  }
}

/** How a role's bot looks. */
export interface TemplateRoleLook extends TemplateLookExtras {
  color: MausColor;
  mascotExpression?: string;
  mascotBody?: string;
  /** The role's picture as a `data:` URL: a PNG, JPEG or WebP of at most 64 KB. Absent: its mascot. */
  picture?: string;
  /** Absent: a circle. */
  pictureCrop?: "circle" | "rounded" | "square";
}

/** One of a template's own skills: copied into the role's bot when a project is made. */
export interface TemplateOwnSkill {
  name: string;
  description: string;
  /** The whole SKILL.md. */
  text: string;
  /** The files beside SKILL.md. */
  files?: Array<{ path: string; content: string }>;
}

/** One role as the Templates page shows and saves it. */
export interface TemplateRole extends TemplateRoleSummary, TemplateRoleExtras {
  description: string;
  /** The persona: who the role is and the rules it never breaks. */
  soul: string;
  look: TemplateRoleLook;
  /** The names of the template's own skills this role gets. */
  ownSkills: string[];
  /** Starter memory: what the role's bot knows from its first day. Empty: none. */
  memory: string;
}

/** `GET /api/template-library/bots/:id`, and what saving a bot template answers. The template's name is its role's. */
export interface BotTemplateWire extends BotTemplateSummary {
  role: TemplateRole;
  skills: TemplateOwnSkill[];
}

/** `GET /api/template-library/teams/:id`, and what saving a team template answers. */
export interface TeamTemplateWire extends TeamTemplateSummary {
  /** The team's context: what every role should know about the work. */
  context: string;
  roles: TemplateRole[];
  skills: TemplateOwnSkill[];
  /** What the template carries from the department it was saved from, which the page shows and does not edit. */
  carried: { groupChats: number; routines: number };
  /**
   * Keys of roles the template had once and has no more. A new role never takes one: a project made from an earlier
   * version may still have a bot under it, and a project's bots are matched to a template's roles by key. Absent: none.
   */
  retiredKeys?: string[];
}

/** The body of `POST /api/template-library/bots` and `PUT /api/template-library/bots/:id`. */
export interface BotTemplateInput {
  role: TemplateRole;
  skills: TemplateOwnSkill[];
}

/** The body of `POST /api/template-library/teams` and `PUT /api/template-library/teams/:id`. */
export interface TeamTemplateInput {
  name: string;
  genre: string;
  context: string;
  /** The `key` of the role that leads. */
  lead: string;
  roles: TemplateRole[];
  skills: TemplateOwnSkill[];
}

/** What the rest of the server asks of the template library. */
export interface TemplateLibraryApi {
  list(): TemplateLibraryWire;
  /** Null: no team template has that id, or its folder cannot be read. */
  readTeam(id: string): TeamTemplateContent | null;
  /** Null: no bot template has that id, or its folder cannot be read. */
  readBot(id: string): BotTemplateContent | null;
}

export type TemplateKind = "bot" | "team";

/**
 * What the Templates page's routes ask of the template library. A request it refuses is thrown with the sentence for
 * the person: a name that is taken, a template that is gone, an input that is not a template.
 */
export interface TemplateLibraryEditor extends TemplateLibraryApi {
  botTemplate(id: string): BotTemplateWire | null;
  teamTemplate(id: string): TeamTemplateWire | null;
  /** Makes a bot template, or saves the one `id` names as its next version. `input` is checked here. */
  saveBot(input: unknown, id?: string): BotTemplateWire;
  /** Makes a team template, or saves the one `id` names as its next version. `input` is checked here. */
  saveTeam(input: unknown, id?: string): TeamTemplateWire;
  /** Moves the template to the archive. `undo` names it for `restore`. */
  remove(kind: TemplateKind, id: string): { undo: string };
  /** Puts back what `remove` took out, as it was. */
  restore(undo: string): { kind: TemplateKind; id: string };
  /** Saves a bot as a new bot template, through the share export: no chats, memory or keys. */
  saveFromBot(botId: string): BotTemplateWire;
  /**
   * Saves a department's bots as a team template, through the share export: a new one, or the next version of the one
   * `into` names. That one keeps its name and genre; a bot keeps the key of the role it was made from, and a role whose
   * key stays keeps its starter memory.
   */
  saveFromDepartment(department: string, into?: string): TeamTemplateWire;
  /** Adds `text` after what one role's starter memory holds, as the template's next version. Empty text changes nothing. */
  addStarterMemory(kind: TemplateKind, id: string, role: string, text: string): void;
}
