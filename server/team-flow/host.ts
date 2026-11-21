import { watchFile } from "node:fs";
import { join } from "node:path";

import { DATA_DIR } from "../config.ts";
import type { RouteHandler } from "../routes/table.ts";
import { ensureSectionMemoryKey, sectionMemoryKey, sectionOfMemoryKey } from "../section-context.ts";
import { installTeamFlows } from "./flows.ts";
import { createTeamFlowRoutes } from "./routes.ts";
import { TeamFlows, type TeamFlowsDeps } from "./service.ts";

const FILE_POLL_MS = 2000;

/** This installation's flows, in `<data dir>/team-flows.json`, followed from the moment this returns and used for who may reach whom. */
export function createTeamFlowsHost(deps: { store: TeamFlowsDeps["store"] }): { flows: TeamFlows; routes: RouteHandler } {
  const file = join(DATA_DIR, "team-flows.json");
  const flows = new TeamFlows({
    store: deps.store, file,
    teamKey: sectionMemoryKey, ensureTeamKey: ensureSectionMemoryKey, teamOfKey: sectionOfMemoryKey,
    log: (line) => console.warn(`[team-flow] ${line}`),
  });
  flows.start();
  installTeamFlows(flows);
  // fs.watch follows the file it opened, and the file is replaced by a rename on every save, so only polling by path
  // keeps seeing it (Node.js docs, fs.watch caveats, "Inodes").
  watchFile(file, { interval: FILE_POLL_MS, persistent: false }, () => flows.reload());
  return { flows, routes: createTeamFlowRoutes(flows) };
}
