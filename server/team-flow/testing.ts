import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { vi } from "vitest";

import type { BotRecord } from "../store.ts";
import type { TeamFlowsDeps } from "./service.ts";

export type TeamFlowsTestApp = Awaited<ReturnType<typeof teamFlowsInstallation>>;

/** The real bot store and departments in a throwaway home, with the flows service over them. */
export async function teamFlowsInstallation() {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "omb-team-flow-")));
  vi.resetModules();
  vi.stubEnv("HOME", home);
  vi.stubEnv("USERPROFILE", home);
  const { DATA_DIR } = await import("../config.ts");
  const { Store } = await import("../store.ts");
  const sections = await import("../section-context.ts");
  const { TeamFlows } = await import("./service.ts");

  const store = new Store(() => ({ instanceId: "claude", model: "default-model" }));
  const logged: string[] = [];
  const changed = vi.fn<() => void>();
  const file = join(DATA_DIR, "team-flows.json");
  const deps: TeamFlowsDeps = {
    store, file,
    teamKey: sections.sectionMemoryKey,
    ensureTeamKey: sections.ensureSectionMemoryKey,
    teamOfKey: sections.sectionOfMemoryKey,
    log: (line) => logged.push(line),
    changed,
  };
  const flows = new TeamFlows(deps);
  const stop = flows.start();

  const bot = (name: string, section: string, extra: Partial<BotRecord> = {}): BotRecord => {
    const made = store.createBot({ name, section });
    return Object.keys(extra).length ? store.patchBot(made.id, extra)! : made;
  };
  /** A team: its Chief and members, by name. */
  const team = (section: string, chief: string, ...members: string[]) => {
    const byName = new Map<string, BotRecord>([[chief, bot(chief, section, { chiefOfStaff: true })]]);
    for (const member of members) byName.set(member, bot(member, section));
    return (name: string) => byName.get(name)!.id;
  };
  const restarted = () => new TeamFlows(deps);

  return { home, dataDir: DATA_DIR, store, sections, file, flows, stop, logged, changed, bot, team, restarted, deps };
}

export async function closeTeamFlowsInstallation(app: TeamFlowsTestApp | undefined): Promise<void> {
  app?.stop();
  const { closeMessageDb } = await import("../message-db.ts");
  closeMessageDb();
  vi.unstubAllEnvs();
  if (app) rmSync(app.home, { recursive: true, force: true });
}
