import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { writeFileAtomic } from "../atomic.ts";

const PROJECT_ID = /^[A-Za-z0-9_-]{1,128}$/;

export const isProjectId = (value: string): boolean => PROJECT_ID.test(value);

/**
 * Where project generation keeps what it must not lose, under MagicBot's data folder: each project's settings and jobs,
 * the settings the person saved last, and what each bot started. Files that can't be read are reported and left alone.
 */
export class GenerationStore {
  private readonly dir: string;
  private readonly log: (line: string) => void;

  constructor(dir: string, log: (line: string) => void) {
    this.dir = dir;
    this.log = log;
  }

  private path(...parts: string[]): string {
    return join(this.dir, ...parts);
  }

  private read(path: string): unknown {
    try {
      return JSON.parse(readFileSync(path, "utf8"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") this.log(`project generation: ${path} could not be read`);
      return undefined;
    }
  }

  private write(path: string, value: unknown): void {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    writeFileAtomic(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  }

  private project(projectId: string, file: "settings.json" | "jobs.json"): string {
    if (!isProjectId(projectId)) throw new Error("not a project id");
    return this.path("projects", projectId, file);
  }

  settings(projectId: string): unknown {
    return this.read(this.project(projectId, "settings.json"));
  }

  saveSettings(projectId: string, settings: unknown): void {
    this.write(this.project(projectId, "settings.json"), settings);
  }

  lastSettings(): unknown {
    return this.read(this.path("last-settings.json"));
  }

  saveLastSettings(settings: unknown): void {
    this.write(this.path("last-settings.json"), settings);
  }

  jobs(projectId: string): unknown[] {
    const jobs = this.read(this.project(projectId, "jobs.json"));
    return Array.isArray(jobs) ? jobs : [];
  }

  saveJobs(projectId: string, jobs: unknown[]): void {
    this.write(this.project(projectId, "jobs.json"), jobs);
  }

  projectsWithJobs(): string[] {
    try {
      return readdirSync(this.path("projects")).filter((name) => isProjectId(name));
    } catch {
      return [];
    }
  }

  botLedger(): unknown[] {
    const entries = this.read(this.path("bot-ledger.json"));
    return Array.isArray(entries) ? entries : [];
  }

  saveBotLedger(entries: unknown[]): void {
    this.write(this.path("bot-ledger.json"), entries);
  }
}
