import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { GenerationJob } from "../../shared/project-generation.ts";
import type { McpOAuthManager } from "../mcp-oauth.ts";
import { GenerationPlugins } from "../generation-plugins/store.ts";
import { createProjectGeneration, type ProjectGeneration } from "../project-generation/host.ts";
import type { JobTiming } from "../project-generation/jobs.ts";
import { startFakeGenerationMcp, type FakeGenerationMcpOptions } from "./fake-generation-mcp-server.ts";

/** Shaped like a real key, so a leak of it is caught by the masking of secret-shaped words as well. */
export const GENERATION_KEY = "sk-gen-4f9c2a7e1b8d6035aa71c4e2";

const SIGNED_OUT = {
  authState: () => "none", accessToken: async () => null, tokenRefused: async () => "unknown", requireSignIn: () => undefined, markNeedsSignIn: () => undefined,
} as unknown as McpOAuthManager;

export interface GenerationHarnessOptions {
  fake?: FakeGenerationMcpOptions;
  timing?: Partial<JobTiming>;
}

/** Project generation over temp folders and a fake generation MCP server named `gen`, saved with its key in a header. */
export async function generationHarness(options: GenerationHarnessOptions = {}) {
  const fake = await startFakeGenerationMcp({ key: GENERATION_KEY, taskMs: 600, ...options.fake });
  const root = mkdtempSync(join(tmpdir(), "omb-generation-"));
  const dataDir = join(root, "data");
  mkdirSync(dataDir);
  const projects = new Map<string, { folder: string; archivedAt?: number }>();
  const logs: string[] = [];
  let servers: Record<string, unknown> = { gen: { type: "http", url: fake.url, headers: { Authorization: `Bearer ${GENERATION_KEY}` }, enabled: true } };
  const plugins = new GenerationPlugins({ dataDir, log: (line) => logs.push(line) });
  const open = (): ProjectGeneration => createProjectGeneration({
    dataDir, lookup: (id) => projects.get(id), storedServers: () => servers, oauth: SIGNED_OUT, personMcp: () => [], policyRefusal: () => undefined,
    probeAs: () => ({}), log: (line) => logs.push(line), timing: { pollMs: 100, minPollMs: 50, maxPollMs: 200, ...options.timing }, plugins,
  });
  let generation = open();

  const until = async <T,>(read: () => T | undefined | null | false, ms = 10_000): Promise<T> => {
    const started = Date.now();
    for (;;) {
      const value = read();
      if (value) return value;
      if (Date.now() - started > ms) throw new Error("timed out waiting");
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  };

  return {
    fake, root, dataDir, logs, plugins,
    get generation() { return generation; },
    get api() { return generation.api; },
    project(id: string, archivedAt?: number): string {
      const folder = join(root, id);
      mkdirSync(folder, { recursive: true });
      projects.set(id, { folder, ...(archivedAt ? { archivedAt } : {}) });
      return folder;
    },
    setServers(next: (url: string) => Record<string, unknown>) {
      servers = next(fake.url);
    },
    /** MagicBot stopped and started again over the same data. */
    restart(): ProjectGeneration {
      generation.close();
      generation = open();
      return generation;
    },
    until,
    ended: (projectId: string, jobId: string) => until(() => {
      const job = generation.api.job(projectId, jobId);
      return job && ["done", "failed", "cancelled"].includes(job.status) ? job : null;
    }) as Promise<GenerationJob>,
    async close() {
      generation.close();
      await fake.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}

export type GenerationHarness = Awaited<ReturnType<typeof generationHarness>>;
