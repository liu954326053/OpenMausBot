import { readFileSync } from "node:fs";
import { z } from "zod";

import type { TeamProjectRecord } from "../../shared/team-projects.ts";
import { writeFileAtomic } from "../atomic.ts";
import { userErrorThrown } from "../user-errors.ts";

/** A project as `projects.json` keeps it: the record, and what only the server needs to remember about it. */
export interface StoredTeamProject extends TeamProjectRecord {
  /** The routines archiving paused, so that restoring resumes those and no others. */
  pausedRoutineIds?: string[];
}

const projectSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  folder: z.string().min(1),
  section: z.string().min(1),
  team: z.object({ key: z.string().min(1), name: z.string() }).optional(),
  template: z.object({ id: z.string(), name: z.string(), version: z.number().finite() }).optional(),
  leadBotId: z.string(),
  createdAt: z.number().finite(),
  archivedAt: z.number().finite().optional(),
  pausedRoutineIds: z.array(z.string()).optional(),
});
const fileSchema = z.object({ version: z.literal(1), root: z.string().min(1).optional(), projects: z.array(projectSchema) });
type ProjectsFile = z.infer<typeof fileSchema>;

type FileRead = { state: "ok"; data: ProjectsFile } | { state: "unreadable"; reason: string };

function readProjectsFile(file: string): FileRead {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code === "ENOENT" ? { state: "ok", data: { version: 1, projects: [] } } : { state: "unreadable", reason: code ?? "read failed" };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { state: "unreadable", reason: "not JSON" };
  }
  const checked = fileSchema.safeParse(parsed);
  return checked.success ? { state: "ok", data: checked.data } : { state: "unreadable", reason: "not a list of projects this version knows" };
}

/**
 * `<data dir>/projects.json`: where new projects go, and every project there is. Only this process writes it.
 *
 * A file that is there but cannot be read is never taken for an empty list: nothing is listed, every change is refused,
 * and the file stays as it is until it reads again.
 */
export class TeamProjectRegistry {
  private readonly file: string;
  private readonly log: (line: string) => void;
  private readonly projectListeners = new Set<(projectId: string) => void>();
  private data: ProjectsFile | null = null;

  constructor(file: string, log: (line: string) => void = (line) => console.error(line)) {
    this.file = file;
    this.log = log;
    this.load(true);
  }

  private load(first: boolean): void {
    const read = readProjectsFile(this.file);
    if (read.state === "ok") {
      this.data = read.data;
      return;
    }
    // Security: the reason is one of a few fixed words, never the file's text, which holds folder paths.
    if (first) this.log(`team projects: ${this.file} cannot be read (${read.reason}), so no project is listed or changed until it can; it is left as it is`);
  }

  private held(): ProjectsFile | null {
    if (!this.data) this.load(false);
    return this.data;
  }

  private current(): ProjectsFile {
    const data = this.held();
    if (!data) throw Object.assign(userErrorThrown("serverError.teamProject.unreadable"), { status: 500 });
    return data;
  }

  /** Throws, and writes nothing, when `next` is not a list this class would read back. */
  private save(next: ProjectsFile): void {
    const checked = fileSchema.parse(next);
    writeFileAtomic(this.file, `${JSON.stringify(checked, null, 2)}\n`, { mode: 0o600 });
    this.data = checked;
  }

  get readable(): boolean {
    return this.held() !== null;
  }

  /** The folder new projects are made in; null until a person chooses one. */
  root(): string | null {
    return this.current().root ?? null;
  }

  setRoot(root: string): void {
    this.save({ ...this.current(), root });
  }

  projects(): StoredTeamProject[] {
    return structuredClone(this.current().projects);
  }

  /** Undefined also while the list cannot be read: a project nobody can look up is one whose bots do not run. */
  find(id: string): StoredTeamProject | undefined {
    const found = this.held()?.projects.find((project) => project.id === id);
    return found && structuredClone(found);
  }

  /** Calls `listener` with a project's id once a change adding, replacing or removing it is saved. Returns how to stop. */
  onProjectChange(listener: (projectId: string) => void): () => void {
    this.projectListeners.add(listener);
    return () => {
      this.projectListeners.delete(listener);
    };
  }

  private changed(projectId: string): void {
    for (const listener of this.projectListeners) {
      try {
        listener(projectId);
      } catch (error) {
        // Security: the error's name only; its message can hold a project's folder path.
        this.log(`team projects: a listener to the list failed (${error instanceof Error ? error.name : "unknown"})`);
      }
    }
  }

  add(project: StoredTeamProject): void {
    const data = this.current();
    this.save({ ...data, projects: [...data.projects, structuredClone(project)] });
    this.changed(project.id);
  }

  /** False when no project has that id. */
  replace(project: StoredTeamProject): boolean {
    const data = this.current();
    if (!data.projects.some((held) => held.id === project.id)) return false;
    this.save({ ...data, projects: data.projects.map((held) => (held.id === project.id ? structuredClone(project) : held)) });
    this.changed(project.id);
    return true;
  }

  remove(id: string): void {
    const data = this.current();
    this.save({ ...data, projects: data.projects.filter((project) => project.id !== id) });
    this.changed(id);
  }
}
