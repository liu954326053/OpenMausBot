import { lstatSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

import { TEAM_PROJECT_FOLDER, isTeamProjectRole, type TeamProjectRecord } from "../../shared/team-projects.ts";
import { writeFileAtomicIfChanged } from "../atomic.ts";
import type { BotRecord } from "../store.ts";
import { teamProjectFolderReady } from "../workspace.ts";

export interface TeamMemoryLine {
  kind: string;
  name: string;
  detail: string;
  aliases: readonly string[];
  status: string;
}

/** Where the copies come from: the app's own data, which stays the one the program reads. */
export interface TeamProjectCopySources {
  bots(projectId: string): readonly BotRecord[];
  context(section: string): string;
  memory(section: string): readonly TeamMemoryLine[];
}

const PERSONAS = "team/personas";
const PERSONA_FILE = /^[a-z0-9-]+\.md$/;

function publicRecord(project: TeamProjectRecord): TeamProjectRecord {
  const { id, name, folder, section, team, template, leadBotId, createdAt, archivedAt } = project;
  return {
    id, name, folder, section, ...(team ? { team: { ...team } } : {}), ...(template ? { template: { ...template } } : {}), leadBotId, createdAt,
    ...(archivedAt === undefined ? {} : { archivedAt }),
  };
}

const paragraphs = (parts: Array<string | undefined>) => parts.map((part) => part?.trim() ?? "").filter(Boolean).join("\n\n");
const withNewline = (text: string) => (text.trim() ? `${text.trimEnd()}\n` : "");

/**
 * A project's copies, by their path under `.magic-team`: its record, and its team's personas, context and accepted
 * memory. Of a model, a library skill and an MCP server they carry the name and nothing else.
 */
export function renderTeamProjectCopies(project: TeamProjectRecord, sources: TeamProjectCopySources): Record<string, string> {
  const members = sources.bots(project.id).filter((bot) => bot.teamProject?.id === project.id && isTeamProjectRole(bot.teamProject.role));
  const lead = members.find((bot) => bot.id === project.leadBotId);
  const ordered = lead ? [lead, ...members.filter((bot) => bot !== lead)] : members;
  const team = {
    department: project.section,
    lead: lead?.teamProject?.role ?? null,
    bots: ordered.map((bot) => ({
      role: bot.teamProject!.role,
      name: bot.name,
      title: bot.title ?? "",
      description: bot.description ?? "",
      model: { ...bot.modelSelection },
      librarySkills: [...(bot.assignedSkills ?? [])],
      ...(bot.mcpServers ? { mcpServers: [...bot.mcpServers] } : {}),
    })),
  };
  const memory = sources.memory(project.section).filter((entry) => entry.status === "accepted")
    .map((entry) => `- **${entry.name}** (${[entry.kind, ...entry.aliases].join("; ")}): ${entry.detail}\n`).join("");
  const files: Record<string, string> = {
    "project.json": `${JSON.stringify(publicRecord(project), null, 2)}\n`,
    "team/team.json": `${JSON.stringify(team, null, 2)}\n`,
    "team/context.md": withNewline(sources.context(project.section)),
    "team/memory.md": memory,
  };
  for (const bot of ordered) {
    files[`${PERSONAS}/${bot.teamProject!.role}.md`] = `${paragraphs([`# ${bot.name}`, bot.title, bot.description, bot.soul])}\n`;
  }
  return files;
}

type FolderState = "ours" | "link" | "gone";

function ownFolder(path: string): FolderState {
  try {
    mkdirSync(path);
    return "ours";
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return "gone";
    if (code !== "EEXIST") throw error;
  }
  return lstatSync(path).isDirectory() ? "ours" : "link";
}

/**
 * Writes the copies into the project folder: "missing" when the folder is not there (it is never made again), and
 * "refused" when one of the folders the copies go in is not a real folder.
 *
 * Security: the project folder is the one its bots work in, so a bot can plant a link there. Nothing is written
 * through a link at `.magic-team`, `team` or `team/personas`, and a link at a file's own path is replaced, not
 * followed. Known open risk: a folder swapped for a link between this check and the write is followed.
 */
export function writeTeamProjectCopies(folder: string, files: Readonly<Record<string, string>>): "written" | "missing" | "refused" {
  if (!teamProjectFolderReady(folder)) return "missing";
  const home = join(folder, TEAM_PROJECT_FOLDER);
  for (const path of [home, join(home, "team"), join(home, ...PERSONAS.split("/"))]) {
    const state = ownFolder(path);
    if (state !== "ours") return state === "gone" ? "missing" : "refused";
  }
  for (const [path, text] of Object.entries(files)) writeFileAtomicIfChanged(join(home, ...path.split("/")), text, { durable: false });
  const personas = join(home, ...PERSONAS.split("/"));
  for (const name of readdirSync(personas)) {
    if (PERSONA_FILE.test(name) && !Object.hasOwn(files, `${PERSONAS}/${name}`)) rmSync(join(personas, name), { force: true });
  }
  return "written";
}
