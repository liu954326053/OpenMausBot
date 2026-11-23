// The projects of a bench workspace, made as the app makes them: MagicBot first, as the app's first start makes it, so it
// stays the place's Chief of Staff; then the team, a seeded department with one of its bots made its Chief; then each
// project from that team by the app's own project service, in a folder of the bench's.
import { join } from "node:path";

import type { ModelSelection } from "../../shared/wire.ts";
import { DATA_DIR } from "../../server/config.ts";
import { ensureDefaultBot } from "../../server/default-bot.ts";
import type { PackageImportDeps } from "../../server/package-import.ts";
import { RoutineManager } from "../../server/routines.ts";
import { readSectionContext, writeSectionContext } from "../../server/section-context.ts";
import { createCommunityPublisher } from "../../server/share-publish.ts";
import { createShareHost } from "../../server/share.ts";
import { skillExport } from "../../server/skill-export.ts";
import { installOrgSkill, installSkill, listSkills, readSkillFile, setSkillEnabled } from "../../server/skills.ts";
import type { Store } from "../../server/store.ts";
import { TeamMemory } from "../../server/team-memory.ts";
import { createTeamProjectsHost } from "../../server/team-projects/host.ts";
import { TeamProjectRegistry } from "../../server/team-projects/registry.ts";
import { checkTeamProjectsRoot } from "../../server/team-projects/root.ts";
import { setTeamProjectLookup, workspaceDir, writeMemoryFile, writeMemoryTopic } from "../../server/workspace.ts";

const refuse = (what: string) => () => { throw new Error(`a bench team has no ${what}`); };

/** Makes `count` projects, "Project 1" on, in `root` from the department `team`; returns their ids in that order, none
 * when the department has no bot. */
export async function seedProjects(store: Store, { team, count, root, selection }: { team: string; count: number; root: string; selection: ModelSelection }): Promise<string[]> {
  const projects = count < 1 ? null : openTeamProjects(store, { team, root, selection });
  if (!projects) return [];
  const ids: string[] = [];
  for (let index = 1; index <= count; index += 1) {
    const made = await projects.api.create({ name: `Project ${index}`, team });
    if (!("project" in made)) throw new Error(`Project ${index} was not made: ${made.error}`);
    ids.push(made.project.id);
  }
  return ids;
}

/** The app's project service over `store`, with the first bot of `team` its Chief and `root` the projects' folder;
 * null when the department has no bot. */
export function openTeamProjects(store: Store, { team, root, selection }: { team: string; root: string; selection: ModelSelection }): ReturnType<typeof createTeamProjectsHost> | null {
  const chief = store.bots.find((bot) => bot.section === team && !bot.hidden);
  if (!chief) return null;
  ensureDefaultBot(store, { dataDir: DATA_DIR });
  store.setChiefOfStaff(chief.id);
  const checked = checkTeamProjectsRoot(root, DATA_DIR);
  if (!checked.ok) throw new Error(`${root} cannot hold projects: ${checked.error}`);
  new TeamProjectRegistry(join(DATA_DIR, "projects.json")).setRoot(checked.root);

  const routines = new RoutineManager({ file: join(DATA_DIR, "routines.json"), botState: (id) => (store.bot(id) ? "ready" : "missing"), createTask: () => null, startTurn: async () => {} });
  const importDeps: PackageImportDeps = {
    store, routines,
    skills: { install: installSkill, setEnabled: setSkillEnabled, installOrg: installOrgSkill },
    memory: { writeIndex: writeMemoryFile, writeTopic: writeMemoryTopic },
    mcp: { servers: () => ({}), refusal: () => undefined, persist: refuse("connections") },
    sections: { writeBrief: (section, text) => void writeSectionContext(section, text) },
    images: { save: refuse("pictures") },
    defaultSelection: () => selection,
  };
  const share = createShareHost({
    dataDir: DATA_DIR, bots: () => store.bots, groups: () => store.groups, routines: () => routines.listRoutines(),
    brief: (section) => readSectionContext(section)?.text,
    collectTeamSkills: skillExport({ listBotSkills: (bot) => listSkills(bot.id), readBotSkillFile: (bot, name) => readSkillFile(bot.id, name) }).collectTeamSkills,
    picture: () => undefined, botFolder: workspaceDir, publisher: createCommunityPublisher({ access: () => null, selfHosted: true }), patch: refuse("template cards"),
  });
  const projects = createTeamProjectsHost({
    store, routines: () => routines, teamMemory: new TeamMemory(join(DATA_DIR, "team-memory.json")), importDeps: async () => importDeps,
    deleteBot: async () => "a bench seed deletes no bot",
    exportDocument: (target, listed, carries) => share.document(target, listed, carries),
    ownSkillNames: (botId) => listSkills(botId).map((skill) => skill.name), language: () => undefined, broadcast: () => {},
    updateRoom: (groupId, patch) => {
      const room = store.patchGroup(groupId, patch);
      if (!room) throw new Error("a bench room is gone");
      return room;
    },
    publishedRoom: () => {},
  });
  setTeamProjectLookup(projects.lookup);
  return projects;
}
