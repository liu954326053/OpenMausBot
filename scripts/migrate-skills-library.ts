// Standalone skills-library migration for a stopped server:
//
//   node --experimental-strip-types scripts/migrate-skills-library.ts [--data-dir <dir>]
//
// It never writes bots.json and does not read features.skillsLibrary: a migrated skill is in the library with the review
// state its private copy had. Run it only when the flag is on.
import { resolve } from "node:path";

const args = process.argv.slice(2);
const dataDirFlag = args.indexOf("--data-dir");
if (dataDirFlag !== -1 && (!args[dataDirFlag + 1]?.trim() || args[dataDirFlag + 1]!.startsWith("-"))) {
  console.error("Usage: migrate-skills-library.ts [--data-dir <dir>]");
  process.exit(2);
}
const dataDir = dataDirFlag !== -1 ? resolve(args[dataDirFlag + 1]!) : undefined;
// A bare invocation runs against the real application data dir: a scratch
// fallback here would report success while migrating nothing.
if (dataDir) process.env.OMB_DATA_DIR = dataDir;

const { botIdsWithSkillState, migrateBotSkillsToLibrary } = await import("../server/skills-library-migration.ts");
const { DATA_DIR } = await import("../server/config.ts");

const outcomes = [];
for (const botId of botIdsWithSkillState(DATA_DIR)) outcomes.push(...migrateBotSkillsToLibrary(botId));
const applied = outcomes.filter((outcome) => outcome.outcome !== "skipped").length;
console.log(JSON.stringify({ dataDir: DATA_DIR, applied, skipped: outcomes.length - applied, outcomes }, null, 2));
